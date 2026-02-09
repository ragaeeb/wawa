// @ts-nocheck
// Wawa Minimal - Content Script
// Injects a "Save Tweets" button into Twitter/X profile pages and handles export.

import {
    BEARER_TOKEN,
    ENDPOINTS,
    TIMELINE_FEATURES,
    TIMELINE_FIELD_TOGGLES,
    USER_BY_SCREEN_NAME_FEATURES,
    USER_BY_SCREEN_NAME_FIELD_TOGGLES,
} from '@/content/constants';
import { buildConsolidatedMeta } from '@/core/export/meta';
import { createInitialLifecycle, reduceExportLifecycle, shouldPromptLooksDone } from '@/core/rate-limit/state';
import { mergeTweets } from '@/core/resume/merge';
import {
    extractTweetsFromExportData as extractTweetsFromResumeInput,
    parseTweetDate as parseTweetDateCore,
} from '@/core/resume/payload';
import { createChromeLocalFallbackStorage, createResumeStorage } from '@/core/resume/storage';

(() => {
    // Cache for dynamically discovered query IDs
    const discoveredQueryIds = {};

    // Attempt to extract query IDs from Twitter's JS bundles
    async function refreshQueryIds() {
        logInfo("Attempting to refresh query IDs from Twitter's JS bundles...");

        try {
            // Find main.js script URLs from the page
            const scripts = Array.from(document.querySelectorAll('script[src*="main."]'));
            const bundleUrls = scripts.map((s) => s.src).filter((src) => src.includes('.js') && !src.includes('.json'));

            // Also check for api.js or client bundles
            const allScripts = Array.from(document.querySelectorAll('script[src]'));
            for (const script of allScripts) {
                if (script.src.includes('api.') || script.src.includes('bundle.') || script.src.includes('client.')) {
                    bundleUrls.push(script.src);
                }
            }

            logDebug(`Found ${bundleUrls.length} potential bundle URLs`);

            for (const url of bundleUrls.slice(0, 5)) {
                // Limit to 5 bundles
                try {
                    const response = await fetch(url);
                    if (!response.ok) {
                        continue;
                    }

                    const text = await response.text();

                    // Look for SearchTimeline query ID pattern
                    // Pattern: queryId:"xxx",operationName:"SearchTimeline"
                    // or: {queryId:"xxx",...operationName:"SearchTimeline"}
                    const searchMatch = text.match(/queryId:\s*"([^"]+)"[^}]*operationName:\s*"SearchTimeline"/);
                    if (searchMatch) {
                        discoveredQueryIds.SearchTimeline = searchMatch[1];
                        logInfo(`Found SearchTimeline query ID: ${searchMatch[1]}`);
                    }

                    // Alternative pattern: SearchTimeline...queryId
                    const altMatch = text.match(/"SearchTimeline"[^}]*queryId:\s*"([^"]+)"/);
                    if (altMatch && !discoveredQueryIds.SearchTimeline) {
                        discoveredQueryIds.SearchTimeline = altMatch[1];
                        logInfo(`Found SearchTimeline query ID (alt pattern): ${altMatch[1]}`);
                    }

                    // Generic pattern looking for the ID near SearchTimeline
                    const genericMatch = text.match(
                        /([A-Za-z0-9_-]{20,30})[^"]*SearchTimeline|SearchTimeline[^"]*([A-Za-z0-9_-]{20,30})/,
                    );
                    if (genericMatch && !discoveredQueryIds.SearchTimeline) {
                        const id = genericMatch[1] || genericMatch[2];
                        if (id && id.length >= 20) {
                            discoveredQueryIds.SearchTimeline = id;
                            logInfo(`Found SearchTimeline query ID (generic pattern): ${id}`);
                        }
                    }

                    if (discoveredQueryIds.SearchTimeline) {
                        break;
                    }
                } catch (e) {
                    logDebug(`Failed to fetch bundle ${url}`, { error: e.message });
                }
            }

            if (discoveredQueryIds.SearchTimeline) {
                ENDPOINTS.searchTimeline.id = discoveredQueryIds.SearchTimeline;
                return true;
            }
        } catch (e) {
            logWarn('Could not refresh query IDs from bundles', { error: e.message });
        }

        return false;
    }

    // Try multiple query IDs until one works
    async function trySearchWithFallbacks(csrfToken, query, cursor = null) {
        const idsToTry = [
            discoveredQueryIds.SearchTimeline,
            ENDPOINTS.searchTimeline.id,
            ...ENDPOINTS.searchTimeline.ids,
        ].filter(Boolean);

        // Deduplicate
        const uniqueIds = [...new Set(idsToTry)];

        for (const queryId of uniqueIds) {
            try {
                const tempEndpoint = { id: queryId, path: 'SearchTimeline' };
                const result = await fetchSearchPageWithId(csrfToken, query, cursor, tempEndpoint);

                // If successful, cache this ID
                discoveredQueryIds.SearchTimeline = queryId;
                ENDPOINTS.searchTimeline.id = queryId;

                return result;
            } catch (err) {
                if (err.message.includes('404')) {
                    logDebug(`Query ID ${queryId} returned 404, trying next...`);
                    continue;
                }
                throw err;
            }
        }

        throw new Error('All SearchTimeline query IDs failed with 404');
    }

    // ========== SCROLL-BASED COLLECTION ==========
    // Intercept fetch by injecting into the page context
    // Content scripts run in an isolated world, so we need to inject into the actual page

    let interceptedResponses = [];
    let isInterceptingFetch = false;
    let isRateLimited = false;
    let isPendingDone = false; // Waiting for user to confirm completion

    // === RESUME FROM FILE STATE ===
    let previousTweets = []; // Tweets loaded from a previous export file
    let previousExportMeta = null; // Metadata loaded from previous export file
    let isResumeMode = false; // Whether we're resuming from a previous export
    const RESUME_STORAGE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
    const resumeStorage = createResumeStorage({
        indexedDbFactory: typeof indexedDB !== 'undefined' ? indexedDB : undefined,
        fallbackStorage:
            typeof chrome !== 'undefined' && chrome.storage?.local ? createChromeLocalFallbackStorage() : undefined,
        maxAgeMs: RESUME_STORAGE_MAX_AGE_MS,
    });

    // Tracks the last moment we saw timeline activity that should reset "Looks Done" idle detection.
    let timelineActivityAt = Date.now();
    let lifecycle = createInitialLifecycle();

    // === RATE LIMIT TRACKING ===
    const rateLimitState = {
        mode: 'normal', // 'normal', 'cooldown', 'paused'
        requestCount: 0, // Requests since last cooldown
        limit: 150, // From x-rate-limit-limit
        remaining: 150, // From x-rate-limit-remaining
        resetTime: 0, // Unix timestamp from x-rate-limit-reset
        lastRequestTime: 0, // When we last made a request
        retryCount: 0, // For exponential backoff
        dynamicDelay: 2500, // Calculated delay between requests
    };

    // Calculate optimal delay based on rate limit headers
    function calculateDynamicDelay() {
        // Simple tiered delay based on remaining quota
        let baseDelay = 3000; // 3 seconds default

        // Increase delay when quota is getting low
        if (rateLimitState.remaining < 20) {
            baseDelay = 5000; // 5 seconds when getting low
        }
        if (rateLimitState.remaining < 10) {
            baseDelay = 8000; // 8 seconds when critical
        }

        rateLimitState.dynamicDelay = baseDelay;
        return baseDelay;
    }

    // Update rate limit info from response headers
    function updateRateLimitInfo(rateLimitInfo) {
        if (!rateLimitInfo) {
            return;
        }

        if (rateLimitInfo.limit) {
            rateLimitState.limit = parseInt(rateLimitInfo.limit, 10);
        }
        if (rateLimitInfo.remaining !== undefined) {
            rateLimitState.remaining = parseInt(rateLimitInfo.remaining, 10);
        }
        if (rateLimitInfo.reset) {
            rateLimitState.resetTime = parseInt(rateLimitInfo.reset, 10);
        }

        rateLimitState.requestCount++;
        rateLimitState.lastRequestTime = Date.now();

        // Recalculate delay
        calculateDynamicDelay();

        logDebug(
            `Rate limit update: ${rateLimitState.remaining}/${rateLimitState.limit} remaining, delay: ${Math.round(rateLimitState.dynamicDelay)}ms`,
        );

        // Check if we should enter cooldown mode (every 20 requests)
        if (rateLimitState.requestCount > 0 && rateLimitState.requestCount % 20 === 0) {
            rateLimitState.mode = 'cooldown';
            lifecycle = reduceExportLifecycle(lifecycle, { type: 'enter_cooldown' });
            logInfo(`Entering cooldown mode after ${rateLimitState.requestCount} requests`);
        }

        // Check if remaining is critically low
        if (rateLimitState.remaining < 10) {
            rateLimitState.mode = 'cooldown';
            lifecycle = reduceExportLifecycle(lifecycle, { type: 'enter_cooldown' });
            logWarn(`Low remaining requests (${rateLimitState.remaining}), entering cooldown`);
        }
    }

    // Listen for messages from the injected script
    window.addEventListener('message', (event) => {
        if (event.source !== window) {
            return;
        }

        if (event.data?.type === 'WAWA_RATE_LIMIT') {
            if (!isRateLimited && isExporting) {
                isRateLimited = true;
                rateLimitState.mode = 'paused';
                rateLimitState.retryCount++;
                lifecycle = reduceExportLifecycle(lifecycle, { type: 'pause_rate_limit' });

                // Update from headers if available
                if (event.data.payload?.rateLimitInfo) {
                    updateRateLimitInfo(event.data.payload.rateLimitInfo);
                }

                logWarn(`Rate limit hit! Retry #${rateLimitState.retryCount}`);
                handleRateLimitEvent();
            }
            return;
        }

        if (event.data?.type === 'WAWA_AUTH_ERROR') {
            logError('Authentication error - session may have expired');
            isRateLimited = true;
            rateLimitState.mode = 'paused';
            lifecycle = reduceExportLifecycle(lifecycle, { type: 'pause_rate_limit' });
            handleRateLimitEvent();
            return;
        }

        if (event.data?.type === 'WAWA_INTERCEPTED_RESPONSE') {
            interceptedResponses.push(event.data.payload);
            markTimelineActivity();

            // Update rate limit info from headers
            if (event.data.payload?.rateLimitInfo) {
                updateRateLimitInfo(event.data.payload.rateLimitInfo);
            }

            // If we were rate limited but got data, reset
            if (isRateLimited && rateLimitState.mode !== 'paused') {
                isRateLimited = false;
                rateLimitState.retryCount = 0;
            }

            logInfo(`Received response #${interceptedResponses.length}`, {
                remaining: rateLimitState.remaining,
                delay: `${Math.round(rateLimitState.dynamicDelay)}ms`,
            });
        }
    });

    async function startFetchInterception() {
        if (isInterceptingFetch) {
            return;
        }
        isInterceptingFetch = true;
        interceptedResponses = [];

        // Inject external script into the page context to intercept fetch
        // Using external file to bypass CSP restrictions on inline scripts
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const scriptUrl = chrome.runtime.getURL('/interceptor.js');
            script.src = scriptUrl;

            logInfo(`Injecting interceptor from: ${scriptUrl}`);

            script.onload = function () {
                logInfo('Interceptor script loaded successfully');
                this.remove(); // Clean up after loading
                // Give it a moment to execute
                setTimeout(resolve, 500); // 500ms to be safe
            };
            script.onerror = (e) => {
                logError('Failed to load interceptor script', { error: e });
                reject(new Error('Failed to load interceptor script'));
            };
            (document.head || document.documentElement).appendChild(script);
        });
    }

    function stopFetchInterception() {
        if (!isInterceptingFetch) {
            return;
        }
        isInterceptingFetch = false;

        // Note: We can't restore the original fetch due to CSP restrictions
        // The interceptor remains active but we stop collecting responses
        logInfo(`Stopped fetch interception, captured ${interceptedResponses.length} responses`);
    }

    function clearInterceptedResponses() {
        interceptedResponses = [];
    }

    // Scroll the page to trigger Twitter to load more tweets
    async function scrollToLoadMore(maxScrolls = 100) {
        logInfo(`Starting scroll - based loading(max ${maxScrolls} scrolls)`);

        let lastScrollHeight = 0;
        let noChangeCount = 0;
        let scrollCount = 0;
        const startingPathname = window.location.pathname;

        while (scrollCount < maxScrolls && noChangeCount < 8) {
            if (abortController?.signal?.aborted) {
                break;
            }

            // === PENDING DONE HANDLING ===
            // If we are waiting for user to confirm "Looks Done" or "Route Change", pause here
            if (isPendingDone) {
                await sleep(1000);
                continue;
            }

            // === ROUTE CHANGE DETECTION ===
            // Check if we've navigated away from the search page
            if (window.location.pathname !== startingPathname) {
                logWarn(`Route changed! Was: ${startingPathname}, Now: ${window.location.pathname}`);
                logWarn('Navigation detected - possibly clicked on a tweet. Pausing export.');

                // Show a warning UI
                if (!isPendingDone) {
                    isPendingDone = true;
                    lifecycle = reduceExportLifecycle(lifecycle, { type: 'mark_pending_done' });
                    handleRouteChange(interceptedResponses.length);
                }

                await sleep(1000);
                continue;
            }

            // === RATE LIMIT MODE HANDLING ===

            // PAUSED MODE (red) - Hard rate limit hit, manual intervention needed
            if (isRateLimited || rateLimitState.mode === 'paused') {
                await sleep(1000);
                continue;
            }

            // COOLDOWN MODE (orange) - Every 20 requests, pause for 3 minutes
            // COOLDOWN MODE (orange)
            if (rateLimitState.mode === 'cooldown') {
                lifecycle = reduceExportLifecycle(lifecycle, { type: 'enter_cooldown' });
                let cooldownTime = 180000; // Default 3 minutes
                let reason = `batch pacing (${rateLimitState.requestCount} requests)`;

                // If actual API limit is low, wait for the full reset time
                if (rateLimitState.remaining < 10 && rateLimitState.resetTime > 0) {
                    const nowSec = Date.now() / 1000;
                    const waitSec = rateLimitState.resetTime - nowSec;

                    if (waitSec > 0) {
                        // Wait until reset + 10s buffer
                        cooldownTime = waitSec * 1000 + 10000;
                        reason = `API limit low (${rateLimitState.remaining} left), reset at ${new Date(rateLimitState.resetTime * 1000).toLocaleTimeString()}`;
                    }
                }

                logInfo(`Cooldown mode: pausing for ${Math.round(cooldownTime / 1000)}s due to ${reason}`);

                showCooldownUI(cooldownTime);

                // Wait loop (interruptible)
                // Use wall-clock time to be resilient against background tab throttling
                const checkInterval = 1000;
                const endTime = Date.now() + cooldownTime;

                while (Date.now() < endTime && isExporting && !window.wawaSkipCooldown) {
                    const remaining = Math.max(0, endTime - Date.now());
                    updateCooldownTimer(remaining);
                    await sleep(checkInterval);
                }

                // Reset skip flag
                if (window.wawaSkipCooldown) {
                    logInfo('Cooldown skipped by user');
                    window.wawaSkipCooldown = false;
                }

                removeCooldownUI();

                rateLimitState.mode = 'normal';
                rateLimitState.requestCount = 0; // Reset counter after cooldown
                lifecycle = reduceExportLifecycle(lifecycle, { type: 'exit_cooldown', at: Date.now() });
                noChangeCount = 0;
                markTimelineActivity();
                updateButton(`🟢 Resuming...`);
                await sleep(1000);
            }

            // --- DOM CLEANUP ---
            try {
                const tweets = document.querySelectorAll('article[data-testid="tweet"]');
                if (tweets.length > 50) {
                    const toRemove = tweets.length - 20;
                    if (scrollCount % 5 === 0) {
                        logDebug(`Cleaning up DOM: removing ${toRemove} tweets`);
                    }
                    for (let i = 0; i < toRemove; i++) {
                        tweets[i].remove();
                    }
                }
            } catch {
                /* ignore */
            }

            // Scroll to bottom
            window.scrollTo(0, document.body.scrollHeight);
            scrollCount++;

            // Use DYNAMIC delay based on rate limit headers
            const currentDelay = Math.max(rateLimitState.dynamicDelay, 3000);
            await sleep(currentDelay);

            // === CHECK FOR TWITTER ERROR STATES ===
            // Look for "Something went wrong" or "Retry" buttons
            const errorText =
                document.body.innerText.includes('Something went wrong') ||
                document.body.innerText.includes('Try again');

            // Check for actual retry button more specifically
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
            const actualRetryBtn = allButtons.find(
                (btn) =>
                    btn.textContent.trim().toLowerCase() === 'retry' ||
                    btn.textContent.trim().toLowerCase() === 'try again',
            );

            if (actualRetryBtn || errorText) {
                logWarn('Twitter error state detected, attempting auto-retry...');
                updateButton('⚠️ Twitter error - retrying...');

                // Click the retry button if found
                if (actualRetryBtn) {
                    actualRetryBtn.click();
                    logInfo('Clicked Retry button');
                }

                // Wait for recovery
                await sleep(5000);
                noChangeCount = 0; // Reset counter, don't give up
                markTimelineActivity();
                continue; // Skip end-of-timeline check this iteration
            }

            // Smarter check for "end of timeline"
            const currentHeight = document.body.scrollHeight;
            const responsesCaptured = interceptedResponses.length;
            const shouldShowLooksDone = shouldPromptLooksDone(lifecycle, {
                now: Date.now(),
                idleThresholdMs: 30000,
                scrollCount,
                responsesCaptured,
                heightStable: currentHeight === lastScrollHeight,
            });

            if (shouldShowLooksDone) {
                // Instead of auto-completing, show "Looks Done" UI
                if (!isPendingDone) {
                    isPendingDone = true;
                    lifecycle = reduceExportLifecycle(lifecycle, { type: 'mark_pending_done' });
                    logInfo('Timeline appears complete - waiting for user confirmation');
                    handleLooksDone(responsesCaptured);
                }

                // Wait in this state until user decides
                await sleep(1000);
                continue;
            }

            // Improved end detection:
            // Always increment counter if height is static, regardless of network activity
            if (currentHeight === lastScrollHeight) {
                noChangeCount++;
                if (noChangeCount > 3) {
                    logDebug(`No height change (attempt ${noChangeCount}/8)`);
                }
            } else {
                noChangeCount = 0;
                lastScrollHeight = currentHeight;
            }

            // Update button with mode indicator
            if (exportButton && !isRateLimited) {
                const modeIcon = rateLimitState.mode === 'cooldown' ? '🟠' : '🟢';
                const remaining = rateLimitState.remaining;
                updateButton(`${modeIcon} Scrolling... (${responsesCaptured} batches, ${remaining} left)`);
            }
        }

        logInfo(`Scroll loading complete: ${scrollCount} scrolls, ${interceptedResponses.length} responses captured`);
        return interceptedResponses.length;
    }

    // Extract tweets from intercepted responses
    function extractTweetsFromInterceptedResponses(targetUserId) {
        const allTweets = [];
        const seenIds = new Set();

        for (const response of interceptedResponses) {
            try {
                const { items } = extractTimeline(response.data);

                for (const item of items) {
                    if (!item.id || seenIds.has(item.id)) {
                        continue;
                    }

                    // Verify it's from the target user (for their own tweets, not RTs)
                    const authorId = item.author?.id;
                    const isRetweet = item.type === 'Retweet';

                    // Include if it's by the user OR it's a retweet they made
                    // If targetUserId is unknown (e.g. search fallback), include everything found
                    if (targetUserId === 'unknown' || authorId === targetUserId || isRetweet) {
                        seenIds.add(item.id);
                        allTweets.push(item);
                    }
                }
            } catch (e) {
                logDebug('Error extracting from intercepted response', { error: e.message });
            }
        }

        logInfo(`Extracted ${allTweets.length} unique tweets from intercepted responses`);
        return allTweets;
    }

    // State
    let isExporting = false;
    let currentExportUserId = null;
    let abortController = null;
    let exportButton = null;
    let logs = [];
    let pendingAutoStartContext = null;

    // ========== LOGGING ==========
    function log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const entry = { timestamp, level, message, data };
        logs.push(entry);

        if (logs.length > 500) {
            logs = logs.slice(-500);
        }

        const prefix = `[Wawa ${timestamp.split('T')[1].split('.')[0]}]`;
        if (level === 'error') {
            console.error(prefix, message, data ?? '');
        } else if (level === 'warn') {
            console.warn(prefix, message, data ?? '');
        } else if (level === 'debug') {
            console.debug(prefix, message, data ?? '');
        } else {
            console.log(prefix, message, data ?? '');
        }

        try {
            if (chrome.runtime?.id) {
                chrome.runtime.sendMessage({ type: 'log', entry }).catch(() => {});
            }
        } catch {}
    }

    function logInfo(message, data = null) {
        log('info', message, data);
    }
    function logDebug(message, data = null) {
        log('debug', message, data);
    }
    function logWarn(message, data = null) {
        log('warn', message, data);
    }
    function logError(message, data = null) {
        log('error', message, data);
    }

    // ========== UTILITIES ==========
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function markTimelineActivity() {
        timelineActivityAt = Date.now();
        lifecycle = reduceExportLifecycle(lifecycle, { type: 'activity', at: timelineActivityAt });
    }

    function formatDate(dateString) {
        if (!dateString) {
            return '';
        }
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) {
            return dateString;
        }
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    function getFullText(tweet) {
        const note = tweet.note_tweet?.note_tweet_results?.result;
        if (note?.text) {
            return note.text;
        }
        return tweet.legacy?.full_text ?? '';
    }

    function normalizeTweetResult(result) {
        if (!result) {
            return null;
        }
        if (result.__typename === 'Tweet') {
            return result;
        }
        if (result.__typename === 'TweetWithVisibilityResults') {
            return result.tweet;
        }
        return null;
    }

    // ========== TWEET DATA EXTRACTION ==========

    // Extract user info from a tweet's user result
    function extractUserInfo(userResult) {
        if (!userResult) {
            return null;
        }

        let result = userResult;
        if (result.result) {
            result = result.result;
        }
        if (result.user_results?.result) {
            result = result.user_results.result;
        }
        if (result.user) {
            result = result.user;
        }

        const legacy = result.legacy ?? {};
        const core = result.core ?? {};

        const info = {
            id: result.rest_id || result.id_str,
            username: core.screen_name || legacy.screen_name,
            name: core.name || legacy.name,
            verified: legacy.verified ?? result.verification?.verified ?? false,
            followers_count: legacy.followers_count,
            following_count: legacy.friends_count,
        };

        return info.id ? info : null;
    }

    // Extract all available data from a tweet (recursive for quoted/retweeted)
    function extractFullTweetData(tweet, depth = 0) {
        if (!tweet || depth > 2) {
            return null;
        }

        const legacy = tweet.legacy ?? {};
        const userResult = tweet.core?.user_results?.result;
        const author = extractUserInfo(userResult);

        const entities = legacy.entities ?? {};
        const extendedEntities = legacy.extended_entities ?? {};

        const hashtags = (entities.hashtags ?? []).map((h) => h.text);

        const urls = (entities.urls ?? []).map((u) => ({
            url: u.url,
            expanded_url: u.expanded_url,
            display_url: u.display_url,
        }));

        const mediaSource = extendedEntities.media ?? entities.media ?? [];
        const media = mediaSource.map((m) => {
            const item = { type: m.type, url: m.media_url_https };
            if (m.type === 'video' || m.type === 'animated_gif') {
                const variants = (m.video_info?.variants ?? [])
                    .filter((v) => v.content_type?.includes('video'))
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                if (variants.length > 0) {
                    item.video_url = variants[0].url;
                }
            }
            return item;
        });

        const mentions = (entities.user_mentions ?? []).map((m) => ({
            id: m.id_str,
            username: m.screen_name,
            name: m.name,
        }));

        const data = {
            id: tweet.rest_id,
            author,
            text: getFullText(tweet),
            created_at: formatDate(legacy.created_at),
            favorite_count: legacy.favorite_count,
            retweet_count: legacy.retweet_count,
            reply_count: legacy.reply_count,
            quote_count: legacy.quote_count,
            bookmark_count: legacy.bookmark_count,
            view_count: tweet.views?.count,
            in_reply_to_status_id: legacy.in_reply_to_status_id_str || null,
            in_reply_to_user_id: legacy.in_reply_to_user_id_str || null,
            in_reply_to_username: legacy.in_reply_to_screen_name || null,
            conversation_id: legacy.conversation_id_str || null,
            language: legacy.lang,
            source: tweet.source,
            hashtags: hashtags.length > 0 ? hashtags : null,
            urls: urls.length > 0 ? urls : null,
            media: media.length > 0 ? media : null,
            mentions: mentions.length > 0 ? mentions : null,
            is_quote_status: legacy.is_quote_status || false,
            possibly_sensitive: legacy.possibly_sensitive || false,
            permalink: legacy.quoted_status_permalink?.expanded || null,
        };

        // If author is missing but we have a permalink (common in quotes), try to extract username from URL
        if (data.permalink && (!data.author || !data.author.username)) {
            const match = data.permalink.match(/twitter\.com\/([^/]+)\/status/);
            if (match && match[1]) {
                if (!data.author) {
                    data.author = {};
                }
                data.author.username = match[1];
            }
        }

        const noteText = tweet.note_tweet?.note_tweet_results?.result?.text;
        if (noteText && noteText !== data.text) {
            data.note_tweet_text = noteText;
        }

        // Quoted tweet with full author info
        if (tweet.quoted_status_result?.result) {
            const qt = normalizeTweetResult(tweet.quoted_status_result.result);
            if (qt) {
                data.quoted_tweet = extractFullTweetData(qt, depth + 1);
                logDebug('Extracted quoted tweet', { main: tweet.rest_id, quoted: qt.rest_id });
            }
        }

        // Retweeted status with full author info
        if (legacy.retweeted_status_result?.result) {
            const rt = normalizeTweetResult(legacy.retweeted_status_result.result);
            if (rt) {
                data.retweeted_tweet = extractFullTweetData(rt, depth + 1);
                logDebug('Extracted retweeted tweet', { main: tweet.rest_id, retweeted: rt.rest_id });
            }
        }

        // Clean up null values
        Object.keys(data).forEach((key) => {
            if (data[key] === null || data[key] === undefined) {
                delete data[key];
            }
        });

        return data;
    }

    // Build a row for export
    function buildTweetRow(tweet, type) {
        const data = extractFullTweetData(tweet);
        if (!data) {
            return null;
        }
        if (type && type !== 'Tweet') {
            data.type = type;
        }
        return data;
    }

    // ========== TIMELINE EXTRACTION ==========
    function getTimelineInstructions(data) {
        const timelineV2 = data?.data?.user?.result?.timeline_v2?.timeline;
        if (timelineV2?.instructions?.length) {
            return timelineV2.instructions;
        }

        const timeline = data?.data?.user?.result?.timeline?.timeline;
        if (timeline?.instructions?.length) {
            return timeline.instructions;
        }

        // Search Timeline path
        const searchTimeline = data?.data?.search_by_raw_query?.search_timeline?.timeline;
        if (searchTimeline?.instructions?.length) {
            return searchTimeline.instructions;
        }

        return [];
    }

    function extractTimeline(data) {
        logDebug('Extracting timeline from response');

        const instructions = getTimelineInstructions(data);
        logDebug(`Found ${instructions.length} timeline instructions`);

        const items = [];
        let nextCursor = null;

        for (const instruction of instructions) {
            if (instruction.type !== 'TimelineAddEntries' && instruction.type !== 'TimelineReplaceEntry') {
                continue;
            }

            const entries = instruction.entries ?? (instruction.entry ? [instruction.entry] : []);
            logDebug(`Processing ${entries.length} entries`);

            for (const entry of entries) {
                const entryId = entry.entryId || '';

                if (entryId.startsWith('promoted-tweet-')) {
                    continue;
                }

                if (entryId.startsWith('tweet-')) {
                    const tweetResult = normalizeTweetResult(entry.content?.itemContent?.tweet_results?.result);
                    if (!tweetResult) {
                        continue;
                    }

                    // For retweets, we still want to capture them with type "Retweet"
                    // The retweeted_tweet field will have the original author
                    if (tweetResult.legacy?.retweeted_status_result?.result) {
                        const row = buildTweetRow(tweetResult, 'Retweet');
                        if (row) {
                            items.push(row);
                            logDebug('Added retweet', { id: tweetResult.rest_id });
                        }
                    } else {
                        const row = buildTweetRow(tweetResult, 'Tweet');
                        if (row) {
                            items.push(row);
                            logDebug('Added tweet', { id: tweetResult.rest_id, has_quoted: !!row.quoted_tweet });
                        }
                    }
                } else if (entryId.startsWith('profile-conversation-')) {
                    const convoItems = entry.content?.items ?? [];
                    logDebug(`Processing conversation with ${convoItems.length} items`);

                    for (const convoItem of convoItems) {
                        const tweetResult = normalizeTweetResult(convoItem?.item?.itemContent?.tweet_results?.result);
                        if (!tweetResult) {
                            continue;
                        }
                        const row = buildTweetRow(tweetResult, 'Tweet');
                        if (row) {
                            items.push(row);
                            logDebug('Added conversation tweet', { id: tweetResult.rest_id });
                        }
                    }
                } else if (entryId.startsWith('cursor-bottom-')) {
                    if (entry.content?.cursorType === 'Bottom') {
                        nextCursor = entry.content?.value ?? null;
                    }
                }
            }
        }

        logInfo(`Extracted ${items.length} items from timeline page`);
        return { items, nextCursor };
    }

    function summarizeResponseShape(data) {
        const user = data?.data?.user?.result;
        if (!user) {
            return 'No user result in response.';
        }
        const keys = Object.keys(user).slice(0, 20);
        const hasTimelineV2 = Boolean(user.timeline_v2?.timeline?.instructions);
        const hasTimeline = Boolean(user.timeline?.timeline?.instructions);
        return `user keys: [${keys.join(', ')}], has timeline_v2: ${hasTimelineV2}, has timeline: ${hasTimeline} `;
    }

    // ========== SEARCH EXTRACTION ==========
    // Used for fetching historical tweets beyond the 3,200 timeline limit

    // Features from actual Twitter search request (captured from browser)
    const SEARCH_FEATURES = {
        rweb_video_screen_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_profile_redirect_enabled: false,
        rweb_tipjar_consumption_enabled: false,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        premium_content_api_read_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: true,
        responsive_web_jetfuel_frame: true,
        responsive_web_grok_share_attachment_enabled: true,
        responsive_web_grok_annotations_enabled: false,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        responsive_web_grok_show_grok_translated_post: false,
        responsive_web_grok_analysis_button_from_backend: true,
        post_ctas_fetch_enabled: true,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_grok_imagine_annotation_enabled: true,
        responsive_web_grok_community_note_auto_translation_is_enabled: false,
        responsive_web_enhance_cards_enabled: false,
    };

    function getSearchInstructions(data) {
        // Search results come in a different structure than timeline
        const timeline = data?.data?.search_by_raw_query?.search_timeline?.timeline;
        if (timeline?.instructions?.length) {
            return timeline.instructions;
        }
        return [];
    }

    function extractSearchResults(data, targetUsername) {
        logDebug('Extracting search results from response');

        const instructions = getSearchInstructions(data);
        logDebug(`Found ${instructions.length} search instructions`);

        const items = [];
        let nextCursor = null;

        for (const instruction of instructions) {
            if (instruction.type !== 'TimelineAddEntries' && instruction.type !== 'TimelineReplaceEntry') {
                continue;
            }

            const entries = instruction.entries ?? (instruction.entry ? [instruction.entry] : []);
            logDebug(`Processing ${entries.length} search entries`);

            for (const entry of entries) {
                const entryId = entry.entryId || '';

                if (entryId.startsWith('promoted-tweet-')) {
                    continue;
                }

                if (entryId.startsWith('tweet-')) {
                    const tweetResult = normalizeTweetResult(entry.content?.itemContent?.tweet_results?.result);
                    if (!tweetResult) {
                        continue;
                    }

                    // Verify this tweet is from the target user (search can return quoted tweets, etc.)
                    const userResult = tweetResult.core?.user_results?.result;
                    const tweetUsername = userResult?.legacy?.screen_name?.toLowerCase();

                    if (tweetUsername === targetUsername.toLowerCase()) {
                        if (tweetResult.legacy?.retweeted_status_result?.result) {
                            const row = buildTweetRow(tweetResult, 'Retweet');
                            if (row) {
                                items.push(row);
                            }
                        } else {
                            const row = buildTweetRow(tweetResult, 'Tweet');
                            if (row) {
                                items.push(row);
                            }
                        }
                    }
                } else if (entryId.startsWith('cursor-bottom-')) {
                    nextCursor = entry.content?.value ?? null;
                }
            }
        }

        logInfo(`Extracted ${items.length} items from search results`);
        return { items, nextCursor };
    }

    // Core search fetch with explicit endpoint
    async function fetchSearchPageWithId(csrfToken, query, cursor, endpoint) {
        const variables = {
            rawQuery: query,
            count: 20,
            querySource: 'typed_query',
            product: 'Top', // Twitter uses "Top" in their actual requests
            withGrokTranslatedBio: false,
        };

        if (cursor) {
            variables.cursor = cursor;
        }

        const url = buildGraphqlUrl(endpoint, variables, SEARCH_FEATURES, null, 'fieldToggles');

        // Log the full URL for debugging
        logInfo(`Search request URL: ${url.slice(0, 200)}...`);

        const res = await fetchJson(url, {
            headers: {
                authorization: BEARER_TOKEN,
                'x-csrf-token': csrfToken,
                'x-twitter-auth-type': 'OAuth2Session',
                'x-twitter-active-user': 'yes',
                'x-twitter-client-language': 'en',
            },
        });

        const delay = getRateLimitDelay(res.headers);
        if (delay !== null) {
            logWarn(`Rate limit hit during search.Waiting ${(delay / 1000).toFixed(1)}s...`);
            await sleep(delay);
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            logError(`Search request failed(${res.status})`, {
                body: body.slice(0, 500),
                url: url.slice(0, 150),
            });
            throw new Error(`Search request failed(${res.status})`);
        }

        return await res.json();
    }

    // Main search function that tries fallback IDs on 404
    async function fetchSearchPage(csrfToken, query, cursor = null) {
        logInfo(`Fetching search page`, { query: query.slice(0, 50), hasCursor: !!cursor });

        // First, try to refresh query IDs if we haven't yet
        if (!discoveredQueryIds.SearchTimeline && !ENDPOINTS.searchTimeline.id) {
            await refreshQueryIds();
        }

        // Use the fallback mechanism
        return await trySearchWithFallbacks(csrfToken, query, cursor);
    }

    // Generate date ranges for searching historical tweets
    // Returns array of { since: "YYYY-MM-DD", until: "YYYY-MM-DD" } objects
    function generateDateRanges(startDate, endDate, monthsPerChunk = 6) {
        const ranges = [];
        const current = new Date(endDate);
        const end = new Date(startDate);

        while (current > end) {
            const until = current.toISOString().split('T')[0];
            current.setMonth(current.getMonth() - monthsPerChunk);
            const since = current < end ? end.toISOString().split('T')[0] : current.toISOString().split('T')[0];
            ranges.push({ since, until });
        }

        return ranges;
    }

    async function fetchHistoricalTweetsViaSearch(
        csrfToken,
        username,
        oldestCollectedDate,
        accountCreatedDate,
        seenIds,
        updateButtonFn,
    ) {
        logInfo('Starting historical tweet search', {
            oldestCollected: oldestCollectedDate,
            accountCreated: accountCreatedDate,
        });

        const historicalTweets = [];

        // Parse dates
        const oldestDate = new Date(oldestCollectedDate);
        const accountDate = accountCreatedDate ? new Date(accountCreatedDate) : new Date('2006-03-21'); // Twitter's launch date

        // Generate 6-month chunks going backwards from oldest collected date
        const dateRanges = generateDateRanges(accountDate, oldestDate, 6);
        logInfo(`Generated ${dateRanges.length} date ranges to search`);

        for (let i = 0; i < dateRanges.length; i++) {
            if (abortController?.signal?.aborted) {
                break;
            }

            const range = dateRanges[i];
            const query = `from:${username} since:${range.since} until:${range.until} `;

            updateButtonFn(`🔍 Searching ${range.since.slice(0, 7)}...`);
            logInfo(`Searching date range ${i + 1}/${dateRanges.length}`, range);

            let cursor = null;
            let rangePages = 0;
            let consecutiveEmpty = 0;

            // Paginate through this date range
            while (rangePages < 50) {
                // Safety limit per range
                if (abortController?.signal?.aborted) {
                    break;
                }

                try {
                    rangePages++;
                    const response = await fetchSearchPage(csrfToken, query, cursor);
                    const { items, nextCursor } = extractSearchResults(response, username);

                    // Filter out already-seen tweets
                    const newItems = items.filter((item) => {
                        if (!item.id || seenIds.has(item.id)) {
                            return false;
                        }
                        seenIds.add(item.id);
                        return true;
                    });

                    if (newItems.length > 0) {
                        historicalTweets.push(...newItems);
                        consecutiveEmpty = 0;
                        logDebug(`Found ${newItems.length} new tweets in range`, {
                            total: historicalTweets.length,
                        });
                    } else {
                        consecutiveEmpty++;
                        if (consecutiveEmpty >= 2) {
                            logDebug('No more results in this date range');
                            break;
                        }
                    }

                    cursor = nextCursor;
                    if (!cursor) {
                        break;
                    }

                    await sleep(3000); // 3 seconds between search pages to avoid rate limits
                } catch (err) {
                    logWarn(`Search error in range ${range.since} to ${range.until}`, { error: err.message });
                    break; // Move to next date range on error
                }
            }

            // Small delay between date ranges
            await sleep(2000); // 2 seconds between date ranges
        }

        logInfo(`Historical search complete`, { found: historicalTweets.length });
        return historicalTweets;
    }

    // ========== API HELPERS ==========
    function getRateLimitDelay(headers) {
        const remaining = Number(headers.get('x-rate-limit-remaining'));
        const reset = Number(headers.get('x-rate-limit-reset'));
        logDebug('Rate limit headers', { remaining, reset });
        if (!Number.isNaN(remaining) && remaining <= 0 && !Number.isNaN(reset)) {
            return Math.max(0, reset * 1000 - Date.now()) + 2000;
        }
        return null;
    }

    function getCsrfToken() {
        const match = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
        const token = match ? match[1] : null;
        logDebug('Retrieved CSRF token', { found: !!token });
        return token;
    }

    function buildGraphqlUrl(endpoint, variables, features, fieldToggles, fieldTogglesParam = 'field_toggles') {
        const host = window.location.hostname;
        const base = `https://${host}/i/api/graphql/${endpoint.id}/${endpoint.path}`;
        const params = new URLSearchParams();
        params.set('variables', JSON.stringify(variables));
        params.set('features', JSON.stringify(features));
        if (fieldToggles) {
            params.set(fieldTogglesParam, JSON.stringify(fieldToggles));
        }
        return `${base}?${params.toString()}`;
    }

    async function fetchJson(url, options = {}) {
        logDebug('Fetching', { url: `${url.slice(0, 100)}...` });
        const response = await fetch(url, {
            ...options,
            credentials: 'include',
            signal: abortController?.signal,
        });
        logDebug('Fetch response', { status: response.status, ok: response.ok });
        return response;
    }

    async function getUserByScreenName(csrfToken, username) {
        logInfo(`Looking up user: @${username}`);

        const url = buildGraphqlUrl(
            ENDPOINTS.userByScreenName,
            { screen_name: username, withSafetyModeUserFields: true },
            USER_BY_SCREEN_NAME_FEATURES,
            USER_BY_SCREEN_NAME_FIELD_TOGGLES,
            'field_toggles',
        );

        const res = await fetchJson(url, {
            headers: { authorization: BEARER_TOKEN, 'x-csrf-token': csrfToken },
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            logError(`User lookup failed (${res.status})`, { body: body.slice(0, 500) });
            throw new Error(`User lookup failed (${res.status})`);
        }

        const data = await res.json();
        const result = data?.data?.user?.result;

        if (result?.__typename !== 'User') {
            logError('User not found or unavailable', { typename: result?.__typename });
            throw new Error('User not found or unavailable.');
        }

        logInfo('User resolved successfully', {
            id: result.rest_id,
            name: result.legacy?.name,
            tweets: result.legacy?.statuses_count,
        });

        return { id: result.rest_id, legacy: result.legacy };
    }

    async function fetchTweetThread(csrfToken, tweetId) {
        logDebug(`Fetching conversation thread: ${tweetId}`);

        const variables = {
            focalTweetId: tweetId,
            with_rux_injections: false,
            rankingMode: 'Relevance',
            includePromotedContent: true,
            withCommunity: true,
            withQuickPromoteEligibilityTweetFields: true,
            withBirdwatchNotes: true,
            withVoice: true,
        };

        const features = {
            rweb_video_screen_enabled: false,
            profile_label_improvements_pcf_label_in_post_enabled: true,
            responsive_web_profile_redirect_enabled: false,
            rweb_tipjar_consumption_enabled: false,
            verified_phone_label_enabled: false,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            premium_content_api_read_enabled: false,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            responsive_web_grok_analyze_button_fetch_trends_enabled: false,
            responsive_web_grok_analyze_post_followups_enabled: true,
            responsive_web_jetfuel_frame: true,
            responsive_web_grok_share_attachment_enabled: true,
            responsive_web_grok_annotations_enabled: false,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            tweet_awards_web_tipping_enabled: false,
            responsive_web_grok_show_grok_translated_post: false,
            responsive_web_grok_analysis_button_from_backend: true,
            post_ctas_fetch_enabled: true,
            creator_subscriptions_quote_tweet_preview_enabled: false,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: true,
            responsive_web_grok_image_annotation_enabled: true,
            responsive_web_grok_imagine_annotation_enabled: true,
            responsive_web_grok_community_note_auto_translation_is_enabled: false,
            responsive_web_enhance_cards_enabled: false,
        };

        const fieldToggles = {
            withArticleRichContentState: true,
            withArticlePlainText: false,
            withGrokAnalyze: false,
            withDisallowedReplyControls: false,
        };

        const url = buildGraphqlUrl(ENDPOINTS.tweetDetail, variables, features, fieldToggles, 'fieldToggles');

        const res = await fetchJson(url, {
            headers: {
                authorization: BEARER_TOKEN,
                'x-csrf-token': csrfToken,
            },
        });

        if (!res.ok) {
            return null;
        }

        const data = await res.json();
        return data?.data?.threaded_conversation_with_injections_v2?.instructions ?? [];
    }

    async function fetchSelfThreads(csrfToken, collected, targetUserId, maxThreads = 50) {
        logInfo('Checking for self-reply threads...');

        const existingIds = new Set(collected.map((t) => t.id));
        const candidates = collected.filter(
            (t) => t.reply_count > 0 && t.author && (t.author.id === targetUserId || t.author.id_str === targetUserId),
        );

        if (candidates.length === 0) {
            return [];
        }

        logInfo(`Found ${candidates.length} tweets to check for self-replies`);
        updateButton(`🧵 Checking ${Math.min(candidates.length, maxThreads)} threads...`);

        const newTweets = [];
        let consecutiveErrors = 0;

        // Process most recent first as they are more likely to be relevant
        const toProcess = candidates.slice(0, maxThreads);

        for (let i = 0; i < toProcess.length; i++) {
            if (abortController?.signal?.aborted) {
                break;
            }

            // Rate limiting delay (2 seconds per request is safer)
            await sleep(2000);

            const candidate = toProcess[i];
            updateButton(`🧵 Checking thread ${i + 1}/${toProcess.length}...`);

            try {
                const instructions = await fetchTweetThread(csrfToken, candidate.id);

                // If null (error/429), count it
                if (!instructions) {
                    consecutiveErrors++;
                    if (consecutiveErrors >= 3) {
                        logWarn('Too many thread fetch errors. Stopping checks.');
                        await sleep(5000);
                        break;
                    }
                    continue;
                }

                consecutiveErrors = 0; // Reset on success

                if (!instructions.length) {
                    continue;
                }

                const threadItems = [];

                // Extract tweets from TimelineAddEntries (could be modules or single entries)
                for (const inst of instructions) {
                    if (inst.type !== 'TimelineAddEntries') {
                        continue;
                    }

                    for (const entry of inst.entries ?? []) {
                        // Check for conversation modules
                        if (entry.content?.entryType === 'TimelineTimelineModule') {
                            const items = entry.content.items ?? [];
                            for (const item of items) {
                                if (item.item?.itemContent) {
                                    threadItems.push(item.item.itemContent);
                                }
                            }
                        }
                        // Check for single tweets (unlikely in thread view but possible)
                        else if (entry.content?.itemContent) {
                            threadItems.push(entry.content.itemContent);
                        }
                    }
                }

                for (const content of threadItems) {
                    const tweetResult = normalizeTweetResult(content.tweet_results?.result);
                    if (!tweetResult) {
                        continue;
                    }

                    const tweetId = tweetResult.rest_id;
                    if (existingIds.has(tweetId)) {
                        continue;
                    }

                    // User check: MUST be same author
                    const userResult = tweetResult.core?.user_results?.result;
                    const authorId = userResult?.rest_id || userResult?.id;

                    if (authorId === targetUserId) {
                        const row = buildTweetRow(tweetResult, 'Thread');
                        if (row) {
                            newTweets.push(row);
                            existingIds.add(tweetId); // Avoid adding same tweet twice
                            logDebug(`Found self-reply: ${tweetId}`);
                        }
                    }
                }
            } catch (e) {
                logWarn(`Failed to fetch thread for ${candidate.id}`, { error: e.message });
            }
        }

        return newTweets;
    }

    async function fetchTweetById(csrfToken, tweetId) {
        logDebug(`Fetching missing tweet details: ${tweetId}`);

        const variables = {
            tweetId: tweetId,
            withCommunity: true,
            includePromotedContent: true,
            withVoice: true,
        };

        const features = {
            ...TIMELINE_FEATURES,
            tfw_timeline_list_config_finished_show_more_link: true,
        };

        const url = buildGraphqlUrl(
            ENDPOINTS.tweetResultByRestId,
            variables,
            features,
            null, // No field toggles for this one usually
            'fieldToggles',
        );

        const res = await fetchJson(url, {
            headers: {
                authorization: BEARER_TOKEN,
                'x-csrf-token': csrfToken,
            },
        });

        if (!res.ok) {
            return null;
        }

        const data = await res.json();
        const tweetResult = data?.data?.tweetResult?.result;
        return normalizeTweetResult(tweetResult);
    }

    async function fetchMissingTweets(csrfToken, collected, maxToFetch = 50) {
        // Find IDs of tweets that are replied to but not in our collection
        const existingIds = new Set(collected.map((t) => t.id));
        const missingIds = new Set();

        for (const tweet of collected) {
            if (tweet.in_reply_to_status_id && !existingIds.has(tweet.in_reply_to_status_id)) {
                missingIds.add(tweet.in_reply_to_status_id);
            }
        }

        if (missingIds.size === 0) {
            return [];
        }

        logInfo(`Found ${missingIds.size} missing parent tweets to fetch`);
        updateButton(`🔍 Fetching ${missingIds.size} parents...`);

        const fetchedEntries = [];
        const idsArray = Array.from(missingIds).slice(0, maxToFetch);

        for (const id of idsArray) {
            if (abortController?.signal?.aborted) {
                break;
            }

            try {
                const tweetResult = await fetchTweetById(csrfToken, id);
                if (tweetResult) {
                    const row = buildTweetRow(tweetResult, 'Context');
                    if (row) {
                        fetchedEntries.push(row);
                        logDebug(`Fetched missing parent: ${id}`);
                    }
                }
                await sleep(500); // Small delay between individual lookups
            } catch (e) {
                logWarn(`Failed to fetch parent tweet ${id}`, { error: e.message });
            }
        }

        return fetchedEntries;
    }

    async function fetchTimelinePage(csrfToken, variables, includeReplies) {
        const endpoint = includeReplies ? ENDPOINTS.userTweetsAndReplies : ENDPOINTS.userTweets;

        logInfo(`Fetching timeline page`, { endpoint: endpoint.path, hasCursor: !!variables.cursor });

        const url = buildGraphqlUrl(endpoint, variables, TIMELINE_FEATURES, TIMELINE_FIELD_TOGGLES, 'fieldToggles');

        const res = await fetchJson(url, {
            headers: {
                authorization: BEARER_TOKEN,
                'x-csrf-token': csrfToken,
                'x-twitter-auth-type': 'OAuth2Session',
                'x-twitter-active-user': 'yes',
                'x-twitter-client-language': 'en',
            },
        });

        const delay = getRateLimitDelay(res.headers);
        if (delay !== null) {
            logWarn(`Rate limit hit. Waiting ${(delay / 1000).toFixed(1)}s...`);
            updateButton(`⏳ Rate limited, waiting...`);
            await sleep(delay);
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            logError(`Timeline request failed (${res.status})`, { body: body.slice(0, 500) });
            throw new Error(`Timeline request failed (${res.status})`);
        }

        const data = await res.json();
        logDebug('Timeline response received', { shape: summarizeResponseShape(data) });
        return data;
    }

    // ========== FILE DOWNLOAD ==========
    function downloadFile(filename, content, mime) {
        logInfo('Downloading file', { filename, size: content.length });
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    // ========== USERNAME DETECTION ==========
    function getUsernameFromUrl() {
        const path = window.location.pathname;

        // Handle Search Page
        if (path === '/search') {
            const params = new URLSearchParams(window.location.search);
            const query = params.get('q');
            if (query) {
                const match = query.match(/from:([A-Za-z0-9_]+)/i);
                if (match) {
                    return match[1].toLowerCase();
                }
            }
            return null;
        }

        const match = path.match(/^\/([A-Za-z0-9_]{1,15})(?:\/|$)/);

        if (match) {
            const username = match[1].toLowerCase();
            const reserved = [
                'home',
                'explore',
                'search',
                'notifications',
                'messages',
                'bookmarks',
                'lists',
                'settings',
                'compose',
                'i',
                'intent',
                'login',
                'logout',
                'signup',
                'tos',
                'privacy',
                'about',
                'help',
                'jobs',
                'download',
            ];

            if (!reserved.includes(username)) {
                return match[1];
            }
        }

        return null;
    }

    // ========== UI ==========
    function createButton() {
        if (exportButton) {
            return;
        }

        exportButton = document.createElement('div');
        exportButton.id = 'wawa-button';
        exportButton.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 999999;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border-radius: 12px;
            padding: 10px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 160px;
        `;

        // Button style helper
        const btnStyle = (bg) => `
            padding: 10px 16px;
            border: none;
            background: ${bg};
            color: white;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            text-align: center;
        `;

        // Export button
        const exportBtn = document.createElement('button');
        exportBtn.id = 'wawa-export-btn';
        exportBtn.textContent = '📜 Export Tweets';
        exportBtn.style.cssText = btnStyle('linear-gradient(135deg, #1d9bf0 0%, #1a8cd8 100%)');
        exportBtn.onclick = () => {
            if (isExporting) {
                handleCancelExport();
            } else {
                handleScrollExport();
            }
        };

        // Resume button
        const resumeBtn = document.createElement('button');
        resumeBtn.id = 'wawa-resume-btn';
        resumeBtn.textContent = '📂 Resume';
        resumeBtn.style.cssText = btnStyle('linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%)');
        resumeBtn.onclick = () => {
            if (!isExporting) {
                handleResumeFromFile();
            }
        };

        exportButton.appendChild(exportBtn);
        exportButton.appendChild(resumeBtn);
        document.body.appendChild(exportButton);
        logInfo('Export buttons added to page');
    }

    function updateButton(text, isError = false) {
        if (!exportButton) {
            return;
        }

        // Skip updates if we are showing a special interaction UI
        if (
            isPendingDone ||
            document.getElementById('wawa-rl-controls') ||
            document.getElementById('wawa-done-controls') ||
            document.getElementById('wawa-route-controls')
        ) {
            return;
        }

        const exportBtn = document.getElementById('wawa-export-btn');
        if (exportBtn) {
            exportBtn.textContent = text;
        } else {
            exportButton.textContent = text;
        }

        if (isError) {
            exportButton.style.background = 'linear-gradient(135deg, #f4212e 0%, #d91c27 100%)';
            exportButton.style.boxShadow = '0 4px 12px rgba(244, 33, 46, 0.4)';
        } else if (isExporting) {
            exportButton.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
        } else {
            exportButton.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
        }
    }

    function resetButton() {
        // Recreate the button UI
        if (exportButton) {
            exportButton.remove();
            exportButton = null;
        }
        createButton();
    }

    function removeButton() {
        if (exportButton) {
            exportButton.remove();
            exportButton = null;
        }
    }
    // ========== COOLDOWN UI HANDLING ==========
    function showCooldownUI(duration) {
        if (!exportButton) {
            return;
        }

        // Clear content for custom UI
        exportButton.innerHTML = '';

        // Cooldown container
        exportButton.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            background: linear-gradient(135deg, #FF9800 0%, #E65100 100%);
            border: 1px solid #FFC107;
            border-radius: 12px;
            padding: 14px;
            min-width: 220px;
            box-shadow: 0 8px 24px rgba(255, 152, 0, 0.4);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            gap: 10px;
            color: white;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 14px;';
        header.innerHTML = `<span style="font-size: 18px;">⏳</span> Rate Limit Cooldown`;
        exportButton.appendChild(header);

        // Timer display
        const timerDisplay = document.createElement('div');
        timerDisplay.id = 'wawa-cooldown-timer';
        timerDisplay.style.cssText = 'font-size: 24px; font-weight: bold; text-align: center; margin: 4px 0;';
        timerDisplay.textContent = formatTime(duration);
        exportButton.appendChild(timerDisplay);

        // Controls container
        const controls = document.createElement('div');
        controls.id = 'wawa-rl-controls';
        controls.style.cssText = 'display: flex; gap: 8px;';

        // Skip Button
        const btnSkip = document.createElement('button');
        btnSkip.textContent = '⚡ Skip Wait';
        btnSkip.style.cssText = `
            flex: 1;
            padding: 8px;
            border: none;
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border-radius: 6px;
            font-weight: 600;
            font-size: 12px;
            cursor: pointer;
            transition: background 0.2s;
        `;
        btnSkip.onmouseover = () => {
            btnSkip.style.background = 'rgba(255, 255, 255, 0.3)';
        };
        btnSkip.onmouseout = () => {
            btnSkip.style.background = 'rgba(255, 255, 255, 0.2)';
        };
        btnSkip.onclick = () => {
            logInfo('User clicked Skip Wait');
            window.wawaSkipCooldown = true;
        };

        // Stop Button
        const btnStop = document.createElement('button');
        btnStop.textContent = '🛑 Stop';
        btnStop.style.cssText = `
            flex: 0 0 60px;
            padding: 8px;
            border: none;
            background: rgba(0, 0, 0, 0.2);
            color: white;
            border-radius: 6px;
            font-weight: 600;
            font-size: 12px;
            cursor: pointer;
        `;
        btnStop.onclick = () => {
            if (confirm('Stop export and save current progress?')) {
                window.wawaSkipCooldown = true; // Break wait loop
                handleCancelExport();
            }
        };

        controls.appendChild(btnSkip);
        controls.appendChild(btnStop);
        exportButton.appendChild(controls);
    }

    function updateCooldownTimer(ms) {
        const el = document.getElementById('wawa-cooldown-timer');
        if (el) {
            el.textContent = formatTime(ms);
        }
    }

    function removeCooldownUI() {
        if (exportButton) {
            // Remove the container completely so createButton rebuilds it fresh
            exportButton.remove();
            exportButton = null;
        }
        createButton();
    }

    function formatTime(ms) {
        const totalSec = Math.ceil(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // ========== "LOOKS DONE" HANDLING ==========
    function handleLooksDone(batchCount) {
        if (!exportButton) {
            return;
        }

        logInfo("Showing 'Looks Done' UI...");

        // Clear existing content and rebuild
        exportButton.innerHTML = '';

        // Style the container
        exportButton.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 1px solid #4CAF50;
            border-radius: 12px;
            padding: 14px;
            min-width: 220px;
            box-shadow: 0 8px 24px rgba(76, 175, 80, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText =
            'display: flex; align-items: center; gap: 8px; color: #4CAF50; font-weight: bold; font-size: 14px;';
        header.innerHTML = `<span style="font-size: 18px;">✅</span> Looks Complete!`;
        exportButton.appendChild(header);

        // Info text
        const info = document.createElement('div');
        info.style.cssText = 'color: #a0a0a0; font-size: 11px; line-height: 1.4;';
        info.innerHTML = `
            <div>${batchCount} batches collected</div>
            <div style="margin-top: 4px;">Timeline appears to have ended. What would you like to do?</div>
        `;
        exportButton.appendChild(info);

        // Button container
        const controls = document.createElement('div');
        controls.id = 'wawa-done-controls';
        controls.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

        // Button style helper
        const btnStyle = (bg, color) => `
            padding: 8px 12px;
            border: none;
            background: ${bg};
            color: ${color};
            cursor: pointer;
            border-radius: 6px;
            font-weight: 600;
            font-size: 12px;
            transition: opacity 0.2s;
        `;

        // Download Now button
        const btnDownload = document.createElement('button');
        btnDownload.textContent = '💾 Download Now';
        btnDownload.style.cssText = btnStyle('#4CAF50', '#fff');
        btnDownload.onclick = (e) => {
            e.stopPropagation();
            isPendingDone = false;
            // Signal to break loop and proceed with download
            if (abortController) {
                abortController.abort();
            }
            logInfo('User confirmed download');
        };

        // Keep Scrolling button
        const btnContinue = document.createElement('button');
        btnContinue.textContent = '📜 Keep Scrolling';
        btnContinue.style.cssText = btnStyle('#2196F3', '#fff');
        btnContinue.onclick = (e) => {
            e.stopPropagation();
            isPendingDone = false;
            lifecycle = reduceExportLifecycle(lifecycle, { type: 'resume_manual', at: Date.now() });
            markTimelineActivity();
            // Reset and continue scrolling
            updateButton('🟢 Continuing...');
            logInfo('User chose to continue scrolling');
        };

        // Resume Link button (to continue later)
        const btnResume = document.createElement('button');
        btnResume.textContent = '🔗 Copy Resume Link';
        btnResume.style.cssText = btnStyle('#9C27B0', '#fff');
        btnResume.onclick = (e) => {
            e.stopPropagation();
            copyResumeLink();
        };

        // Cancel button
        const btnCancel = document.createElement('button');
        btnCancel.textContent = '✖️ Cancel Export';
        btnCancel.style.cssText = `${btnStyle('transparent', '#888')}border: 1px solid #444;`;
        btnCancel.onclick = (e) => {
            e.stopPropagation();
            isPendingDone = false;
            lifecycle = reduceExportLifecycle(lifecycle, { type: 'cancel' });
            if (abortController) {
                abortController.abort();
            }
            isExporting = false;
            stopFetchInterception();
            resetButton();
        };

        controls.appendChild(btnDownload);
        controls.appendChild(btnContinue);
        controls.appendChild(btnResume);
        controls.appendChild(btnCancel);
        exportButton.appendChild(controls);
    }

    // ========== ROUTE CHANGE HANDLING ==========
    function handleRouteChange(batchCount) {
        if (!exportButton) {
            return;
        }

        logWarn('Showing route change warning UI...');

        // Clear existing content and rebuild
        exportButton.innerHTML = '';

        // Style the container - orange/warning color
        exportButton.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 1px solid #FF9800;
            border-radius: 12px;
            padding: 14px;
            min-width: 240px;
            box-shadow: 0 8px 24px rgba(255, 152, 0, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText =
            'display: flex; align-items: center; gap: 8px; color: #FF9800; font-weight: bold; font-size: 14px;';
        header.innerHTML = `<span style="font-size: 18px;">⚠️</span> Navigation Detected!`;
        exportButton.appendChild(header);

        // Info text
        const info = document.createElement('div');
        info.style.cssText = 'color: #a0a0a0; font-size: 11px; line-height: 1.4;';
        info.innerHTML = `
            <div>You navigated away from the search page.</div>
            <div style="margin-top: 4px;">${batchCount} batches collected so far.</div>
            <div style="margin-top: 4px; color: #FF9800;">Go back to continue, or save your progress.</div>
        `;
        exportButton.appendChild(info);

        // Button container
        const controls = document.createElement('div');
        controls.id = 'wawa-route-controls';
        controls.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

        // Button style helper
        const btnStyle = (bg, color) => `
            padding: 8px 12px;
            border: none;
            background: ${bg};
            color: ${color};
            cursor: pointer;
            border-radius: 6px;
            font-weight: 600;
            font-size: 12px;
            transition: opacity 0.2s;
        `;

        // Go Back button
        const btnBack = document.createElement('button');
        btnBack.textContent = '⬅️ Go Back & Continue';
        btnBack.style.cssText = btnStyle('#4CAF50', '#fff');
        btnBack.onclick = (e) => {
            e.stopPropagation();
            window.history.back();
            isPendingDone = false;
            lifecycle = reduceExportLifecycle(lifecycle, { type: 'resume_manual', at: Date.now() });
            markTimelineActivity();
            updateButton('🟢 Returning...');
            logInfo('User clicked Go Back');
        };

        // Save Progress button
        const btnSave = document.createElement('button');
        btnSave.textContent = '💾 Save Progress';
        btnSave.style.cssText = btnStyle('#2196F3', '#fff');
        btnSave.onclick = (e) => {
            e.stopPropagation();
            savePartialExport();
        };

        // Resume Link button
        const btnResume = document.createElement('button');
        btnResume.textContent = '🔗 Copy Resume Link';
        btnResume.style.cssText = btnStyle('#9C27B0', '#fff');
        btnResume.onclick = (e) => {
            e.stopPropagation();
            copyResumeLink();
        };

        // Cancel button
        const btnCancel = document.createElement('button');
        btnCancel.textContent = '✖️ Cancel Export';
        btnCancel.style.cssText = `${btnStyle('transparent', '#888')}border: 1px solid #444;`;
        btnCancel.onclick = (e) => {
            e.stopPropagation();
            isPendingDone = false;
            lifecycle = reduceExportLifecycle(lifecycle, { type: 'cancel' });
            if (abortController) {
                abortController.abort();
            }
            isExporting = false;
            stopFetchInterception();
            resetButton();
        };

        controls.appendChild(btnBack);
        controls.appendChild(btnSave);
        controls.appendChild(btnResume);
        controls.appendChild(btnCancel);
        exportButton.appendChild(controls);
    }

    // ========== RESUME FROM FILE ==========
    function extractTweetsFromExportData(data) {
        return extractTweetsFromResumeInput(data);
    }

    function clearInMemoryResumeState() {
        previousTweets = [];
        previousExportMeta = null;
        isResumeMode = false;
    }

    async function clearPersistedResumeState() {
        try {
            await resumeStorage.clear();
        } catch (err) {
            logWarn('Failed to clear persisted resume payload', { error: err.message });
        }
    }

    async function persistResumeState(username, tweets, exportMeta) {
        const payload = {
            username: String(username || '')
                .replace(/^@/, '')
                .toLowerCase(),
            saved_at: Date.now(),
            meta: exportMeta || null,
            tweets,
        };

        try {
            const persisted = await resumeStorage.persist(payload);
            if (persisted) {
                logInfo('Persisted resume payload', {
                    tweets: tweets.length,
                    username: payload.username,
                });
            } else {
                logError('Failed to persist resume payload', {
                    error: 'Resume storage rejected payload',
                });
            }
            return persisted;
        } catch (err) {
            logError('Failed to persist resume payload', {
                error: err.message,
                tweets: tweets.length,
                username: payload.username,
            });
            return false;
        }
    }

    async function restoreResumeStateFromStorage(targetUsername) {
        if (isResumeMode && previousTweets.length > 0) {
            return true;
        }

        try {
            const payload = await resumeStorage.restore(targetUsername);
            if (!payload) {
                return false;
            }

            previousTweets = payload.tweets;
            previousExportMeta = payload.meta || null;
            isResumeMode = true;
            logInfo(`Restored ${previousTweets.length} resume tweets from extension storage`);
            return true;
        } catch (err) {
            logWarn('Failed to restore resume payload', { error: err.message });
            return false;
        }
    }

    function mergeWithPreviousTweets(newTweets) {
        const freshTweets = Array.isArray(newTweets) ? [...newTweets] : [];

        if (!isResumeMode || previousTweets.length === 0) {
            return { tweets: freshTweets, mergeInfo: null };
        }

        return mergeTweets(freshTweets, previousTweets);
    }

    function getConsolidatedCollectedTweets(currentTweets) {
        return mergeWithPreviousTweets(currentTweets).tweets;
    }

    function handleResumeFromFile() {
        logInfo('Resume from File triggered');

        // Create file input
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';

        fileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) {
                return;
            }

            try {
                updateButton('📂 Loading file...');
                const text = await file.text();
                const data = JSON.parse(text);

                // Extract tweets from the file (check both 'items' and 'tweets')
                const tweets = extractTweetsFromExportData(data);
                const sourceMeta = data?.meta || data?.metadata || null;

                if (!tweets || !Array.isArray(tweets)) {
                    throw new Error('Could not find items/tweets array in file');
                }

                if (tweets.length === 0) {
                    throw new Error('No tweets found in file');
                }

                logInfo(`Loaded ${tweets.length} tweets from file`);

                // Sort by date descending (newest first)
                tweets.sort((a, b) => {
                    const dateA = parseTweetDate(a.created_at) || new Date(0);
                    const dateB = parseTweetDate(b.created_at) || new Date(0);
                    return dateB.getTime() - dateA.getTime();
                });

                // Find the oldest tweet (last in sorted array)
                const oldestTweet = tweets[tweets.length - 1];
                const oldestDate = parseTweetDate(oldestTweet.created_at);

                if (!oldestDate || Number.isNaN(oldestDate.getTime())) {
                    throw new Error('Could not parse date from oldest tweet');
                }

                // Add one day to ensure no gaps
                oldestDate.setDate(oldestDate.getDate() + 1);
                const untilDate = oldestDate.toISOString().slice(0, 10);

                logInfo(`Oldest tweet date: ${oldestTweet.created_at}, resuming until: ${untilDate}`);

                // Store the tweets for merging later
                previousTweets = tweets;
                previousExportMeta = sourceMeta;
                isResumeMode = true;

                // Determine the username from the file or URL
                let username = data.meta?.username || data.metadata?.username || getUsernameFromUrl() || 'unknown';
                username = String(username).replace(/^@/, '');

                // Build the resume URL
                const resumeUrl = `https://x.com/search?q=from:${username} until:${untilDate}&src=typed_query&f=live&wawa_resume=1`;

                logInfo(`Resume URL: ${resumeUrl}`);

                // Show confirmation
                const confirmed = confirm(
                    `📂 Resume from File\n\n` +
                        `Loaded: ${tweets.length} tweets\n` +
                        `Oldest: ${oldestTweet.created_at}\n` +
                        `Resume until: ${untilDate}\n\n` +
                        `Click OK to navigate to the resume URL.\n` +
                        `New tweets will be merged with existing ones.`,
                );

                if (confirmed) {
                    const persisted = await persistResumeState(username, tweets, sourceMeta);
                    if (!persisted) {
                        throw new Error(
                            'Could not persist resume payload before navigation. Try a smaller file or a fresh export.',
                        );
                    }

                    // Store auto-start flag
                    await chrome.storage.local.set({
                        wawa_search_autostart: {
                            username: username,
                            autoStart: true,
                            timestamp: Date.now(),
                            resumeMode: true,
                            previousTweetsCount: tweets.length,
                        },
                    });

                    // Navigate to resume URL
                    window.location.href = resumeUrl;
                } else {
                    clearInMemoryResumeState();
                    resetButton();
                }
            } catch (err) {
                logError(`Failed to parse resume file: ${err.message}`);
                alert(`❌ Failed to load file:\n${err.message}`);
                clearInMemoryResumeState();
                resetButton();
            }

            // Clean up
            fileInput.remove();
        };

        document.body.appendChild(fileInput);
        fileInput.click();
    }

    // Helper to parse our custom date format
    function parseTweetDate(dateStr) {
        return parseTweetDateCore(dateStr);
    }

    // ========== RATE LIMIT HANDLING ==========
    function handleRateLimitEvent() {
        if (!exportButton) {
            return;
        }

        // Don't override if already showing controls
        if (document.getElementById('wawa-rl-controls')) {
            return;
        }

        logInfo('Showing rate limit UI...');

        // Clear existing content and rebuild
        exportButton.innerHTML = '';

        // Style the container
        exportButton.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 1px solid #e94560;
            border-radius: 12px;
            padding: 14px;
            min-width: 220px;
            box-shadow: 0 8px 24px rgba(233, 69, 96, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;

        // Header with icon
        const header = document.createElement('div');
        header.style.cssText =
            'display: flex; align-items: center; gap: 8px; color: #e94560; font-weight: bold; font-size: 14px;';
        header.innerHTML = `<span style="font-size: 18px;">🔴</span> Rate Limit Hit (Retry #${rateLimitState.retryCount})`;
        exportButton.appendChild(header);

        // Calculate suggested wait time based on retry count (exponential backoff)
        const waitMinutes = rateLimitState.retryCount * 10; // 10, 20, 30 minutes
        const resetTime = rateLimitState.resetTime
            ? new Date(rateLimitState.resetTime * 1000).toLocaleTimeString()
            : 'unknown';

        // Info text
        const info = document.createElement('div');
        info.style.cssText = 'color: #a0a0a0; font-size: 11px; line-height: 1.4;';
        info.innerHTML = `
            <div>${interceptedResponses.length} batches collected (${rateLimitState.remaining}/${rateLimitState.limit} API calls left)</div>
            <div style="margin-top: 4px;">Suggested wait: <strong>${waitMinutes} min</strong> | Reset: ${resetTime}</div>
        `;
        exportButton.appendChild(info);

        // Button container
        const controls = document.createElement('div');
        controls.id = 'wawa-rl-controls';
        controls.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

        // Button style helper
        const btnStyle = (bg, color) => `
            padding: 8px 12px;
            border: none;
            background: ${bg};
            color: ${color};
            cursor: pointer;
            border-radius: 6px;
            font-weight: 600;
            font-size: 12px;
            transition: opacity 0.2s;
        `;

        // Try Now button
        const btnTry = document.createElement('button');
        btnTry.textContent = '▶️ Try Now';
        btnTry.style.cssText = btnStyle('#4CAF50', '#fff');
        btnTry.onclick = (e) => {
            e.stopPropagation();
            isRateLimited = false;
            rateLimitState.mode = 'normal';
            lifecycle = reduceExportLifecycle(lifecycle, { type: 'resume_manual', at: Date.now() });
            markTimelineActivity();
            // Remove the controls
            const ctrl = document.getElementById('wawa-rl-controls');
            if (ctrl) {
                ctrl.remove();
            }
            updateButton('📜 Resuming...');
            logInfo('User clicked Try Now - resuming scroll');
        };

        // Save Progress button
        const btnSave = document.createElement('button');
        btnSave.textContent = '💾 Save Progress';
        btnSave.style.cssText = btnStyle('#2196F3', '#fff');
        btnSave.onclick = (e) => {
            e.stopPropagation();
            savePartialExport();
        };

        // Copy Resume Link button
        const btnResume = document.createElement('button');
        btnResume.textContent = '🔗 Copy Resume Link';
        btnResume.style.cssText = btnStyle('#9C27B0', '#fff');
        btnResume.onclick = (e) => {
            e.stopPropagation();
            copyResumeLink();
        };

        // Cancel button
        const btnCancel = document.createElement('button');
        btnCancel.textContent = '✖️ Cancel Export';
        btnCancel.style.cssText = `${btnStyle('transparent', '#888')}border: 1px solid #444;`;
        btnCancel.onclick = (e) => {
            e.stopPropagation();
            lifecycle = reduceExportLifecycle(lifecycle, { type: 'cancel' });
            if (abortController) {
                abortController.abort();
            }
            isExporting = false;
            isRateLimited = false;
            stopFetchInterception();
            resetButton();
        };

        controls.appendChild(btnTry);
        controls.appendChild(btnSave);
        controls.appendChild(btnResume);
        controls.appendChild(btnCancel);
        exportButton.appendChild(controls);
    }

    function savePartialExport() {
        logInfo('Saving partial export...');
        const liveCollected = extractTweetsFromInterceptedResponses(currentExportUserId || 'unknown');
        const { tweets: collected, mergeInfo } = mergeWithPreviousTweets(liveCollected);

        // Sort DESC
        collected.sort((a, b) => {
            const dateA = parseTweetDate(a.created_at) || new Date(0);
            const dateB = parseTweetDate(b.created_at) || new Date(0);
            return dateB - dateA;
        });

        const username = getUsernameFromUrl();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `Wawa_${username}_PARTIAL_${timestamp}.json`;

        const payload = {
            meta: {
                username,
                note: 'PARTIAL EXPORT (Rate Limit)',
                collected_count: collected.length,
                resume_mode: isResumeMode || undefined,
                merge_info: mergeInfo || undefined,
            },
            items: collected,
        };

        downloadFile(filename, JSON.stringify(payload, null, 2), 'application/json');
        // Don't alert, just log/update UI briefly?
        logInfo(`Saved ${collected.length} tweets partially.`);
    }

    async function copyResumeLink() {
        try {
            const liveCollected = extractTweetsFromInterceptedResponses(currentExportUserId || 'unknown');
            const collected = getConsolidatedCollectedTweets(liveCollected);
            // Sort DESC (Newest -> Oldest)
            collected.sort((a, b) => {
                const dateA = parseTweetDate(a.created_at) || new Date(0);
                const dateB = parseTweetDate(b.created_at) || new Date(0);
                return dateB - dateA;
            });

            if (collected.length === 0) {
                logWarn('No tweets collected to resume from');
                return;
            }

            // The last collected tweet is the OLDEST we have reached.
            const lastTweet = collected[collected.length - 1];

            // Parse the date - our formatDate outputs "YYYY -MM -DD HH:MM:SS"
            // Extract just YYYY-MM-DD
            let until = '';
            const dateStr = lastTweet.created_at || '';
            const dateMatch = dateStr.match(/(\d{4})\s*-\s*(\d{2})\s*-\s*(\d{2})/);
            if (dateMatch) {
                // To prevent gaps, we use the DAY AFTER the last tweet.
                // (Twitter 'until' is exclusive of the date provided).
                const lastD = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
                lastD.setDate(lastD.getDate() + 1);
                until = lastD.toISOString().slice(0, 10);
            } else {
                // Fallback: try standard Date parsing
                const d = new Date(dateStr);
                if (!Number.isNaN(d.getTime())) {
                    d.setDate(d.getDate() + 1);
                    until = d.toISOString().slice(0, 10);
                } else {
                    logWarn(`Could not parse date from last tweet: ${dateStr}`);
                    alert('Could not determine resume date accurately. Check console.');
                    return;
                }
            }

            const params = new URLSearchParams(window.location.search);
            let query = params.get('q') || `from:${getUsernameFromUrl()}`;

            // Preserve original since: if exists, otherwise just from:
            // Replace or add 'until:YYYY-MM-DD'
            if (query.includes('until:')) {
                query = query.replace(/until:\d{4}-\d{2}-\d{2}/, `until:${until}`);
            } else {
                query += ` until:${until}`;
            }

            const newUrl = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live&wawa_resume=1`;

            const resumeUsername = getUsernameFromUrl() || previousExportMeta?.username || null;
            const persisted = await persistResumeState(resumeUsername || 'unknown', collected, {
                ...(previousExportMeta || {}),
                username: resumeUsername || undefined,
                collected_count: collected.length,
                resume_saved_at: new Date().toISOString(),
            });
            if (!persisted) {
                throw new Error('Could not persist resume payload before creating resume link.');
            }

            // Prime the auto-start for the next tab
            const searchCtx = {
                username: resumeUsername,
                autoStart: true,
                timestamp: Date.now(),
                resumeMode: true,
                previousTweetsCount: collected.length,
            };
            await chrome.storage.local.set({ wawa_search_autostart: searchCtx });

            await navigator.clipboard.writeText(newUrl);
            logInfo('Resume Link copied with auto-start flag.');
            alert(
                '✅ Resume Link Copied!\n\n1. Use a new account/tab.\n2. Paste the link.\n3. The export will RESUME AUTOMATICALLY from that point.',
            );
        } catch (err) {
            logError('Failed to copy resume link', { error: err.message });
            alert('❌ Could not copy resume link. Check console logs.');
        }
    }

    // ========== EXPORT LOGIC ==========

    // Handle cancel when already exporting
    function handleCancelExport() {
        if (isExporting) {
            logInfo('User requested export cancellation');
            if (abortController) {
                abortController.abort();
            }
            lifecycle = reduceExportLifecycle(lifecycle, { type: 'cancel' });
            isExporting = false;
            stopFetchInterception();
            updateButton('❌ Cancelled');
            setTimeout(resetButton, 2000);
        }
    }

    async function handleScrollExport() {
        if (isExporting) {
            handleCancelExport();
            return;
        }

        const autoStartCtx = pendingAutoStartContext;
        pendingAutoStartContext = null;

        const username = getUsernameFromUrl();
        if (!username) {
            logError('Cannot determine username from current URL');
            updateButton('❌ Navigate to a profile', true);
            setTimeout(resetButton, 3000);
            return;
        }

        logInfo('Starting scroll export...');

        // Check if we are on a profile page or search page
        const isSearchPage = window.location.pathname === '/search';

        if (!isSearchPage) {
            // If on profile page, REDIRECT to Search to get clean list
            logInfo('Redirecting to Search view for cleaner export...');
            updateButton('🔍 Preparing search...');

            let query = `from:${username}`;

            // Try to get account creation date to set strict bounds
            try {
                const csrfToken = getCsrfToken();
                if (csrfToken) {
                    const user = await getUserByScreenName(csrfToken, username);
                    if (user && user.legacy && user.legacy.created_at) {
                        const createdDate = new Date(user.legacy.created_at);
                        const since = createdDate.toISOString().slice(0, 10);

                        const now = new Date();
                        now.setMonth(now.getMonth() + 1);
                        const until = now.toISOString().slice(0, 10);

                        query += ` since:${since} until:${until}`;
                        logInfo('Added date bounds to search', { since, until });
                    }
                }
            } catch (e) {
                logWarn('Could not resolve specific dates for search', { error: e.message });
            }

            const searchCtx = {
                username: username,
                autoStart: true,
                timestamp: Date.now(),
            };

            await chrome.storage.local.set({ wawa_search_autostart: searchCtx });
            updateButton('🔄 Redirecting...');

            const encodedQuery = encodeURIComponent(query);
            window.location.href = `https://x.com/search?q=${encodedQuery}&src=typed_query&f=live`;
            return;
        }

        // We are on search page, proceed with export
        const params = new URLSearchParams(window.location.search);
        const query = params.get('q');
        let searchUser = username;

        if (query?.includes('from:')) {
            const match = query.match(/from:([A-Za-z0-9_]+)/i);
            if (match) {
                searchUser = match[1];
            }
        }

        const isResumeRequest = params.get('wawa_resume') === '1' || Boolean(autoStartCtx?.resumeMode);
        if (isResumeRequest) {
            const restoredResume = await restoreResumeStateFromStorage(searchUser);
            if (restoredResume) {
                logInfo(`Resume mode enabled for @${searchUser} (${previousTweets.length} prior tweets)`);
            } else {
                logError('Resume requested but no cached resume payload was found.');
                updateButton('❌ Resume data missing', true);
                alert(
                    "Resume state could not be restored. Please click 'Resume' again and reload your previous export file before continuing.",
                );
                setTimeout(resetButton, 5000);
                return;
            }
        }

        logInfo(`Starting Scroll Export for ${searchUser}`);

        isExporting = true;
        abortController = new AbortController();

        try {
            updateButton('🔍 Looking up user...');
            const csrfToken = getCsrfToken();
            if (!csrfToken) {
                throw new Error('Could not find CSRF token.');
            }

            let user = { id: 'unknown', legacy: { statuses_count: 0 } };
            try {
                user = await getUserByScreenName(csrfToken, searchUser);
            } catch {
                logWarn('Could not resolve user ID, continuing anyway');
            }

            await runScrollExport(searchUser, user.id, user);
        } catch (err) {
            logError('Scroll export failed', { error: err.message });
            updateButton('❌ Export failed');
            setTimeout(resetButton, 3000);
            isExporting = false;
            abortController = null;
        }
    }

    // ========== SCROLL-BASED EXPORT ==========
    // Alternative export that scrolls the page and captures Twitter's own API responses
    async function runScrollExport(username, userId, user) {
        logInfo('=== STARTING SCROLL-BASED EXPORT ===', { username });
        currentExportUserId = userId;

        // Detect if we are on the Replies tab
        const isOnRepliesTab = window.location.pathname.includes('/with_replies');
        if (isOnRepliesTab) {
            logInfo("Note: Exporting from 'Replies' tab. This will include your replies to others.");
        } else {
            logInfo("Note: Exporting from 'Posts' tab. This usually excludes your replies to others.");
        }

        const startedAt = new Date().toISOString();
        const totalTweetsReported = Number(user.legacy?.statuses_count ?? 0);

        if (abortController?.signal?.aborted) {
            return;
        }

        // Reset rate limit state for fresh export
        isRateLimited = false;
        isPendingDone = false;
        const runStartAt = Date.now();
        lifecycle = createInitialLifecycle(runStartAt);
        lifecycle = reduceExportLifecycle(lifecycle, { type: 'start', at: runStartAt });
        markTimelineActivity();
        rateLimitState.mode = 'normal';
        rateLimitState.requestCount = 0;
        rateLimitState.retryCount = 0;
        rateLimitState.remaining = 150;
        rateLimitState.dynamicDelay = 3000;

        // Start intercepting fetch requests
        await startFetchInterception();

        try {
            updateButton('📜 Scrolling to load tweets...');

            // Scroll to load all tweets
            // Use longer delays to be gentle on rate limits
            await scrollToLoadMore(500, 2500); // reduced delay for search mode (search endpoint is more robust)

            // Extract tweets from intercepted responses
            updateButton('📊 Processing captured data...');
            const collected = extractTweetsFromInterceptedResponses(userId);

            // If we are in "unknown" mode (search export), try to resolve the real user ID now
            if (userId === 'unknown' && collected.length > 0 && username) {
                // Find a tweet by this user
                const match = collected.find((t) => t.author?.username?.toLowerCase() === username.toLowerCase());
                if (match?.author?.id) {
                    userId = match.author.id;
                    currentExportUserId = userId;
                    logInfo(`Resolved User ID from captured data: ${userId}`);

                    // Update user object for metadata
                    if (user && user.id === 'unknown') {
                        user.id = userId;
                        user.name = match.author.name;
                        if (!user.legacy) {
                            user.legacy = {};
                        }
                        user.legacy.name = match.author.name;
                        user.legacy.screen_name = match.author.username;
                    }
                }
            }

            // --- THREAD EXPANSION (Disabled for Search Mode) ---
            // Search 'f=live' already returns all tweets and replies flatly
            /* 
            if (!abortController?.signal?.aborted) {
                try {
                    const extraTweets = await fetchSelfThreads(csrfToken, collected, userId, 200); 
                    if (extraTweets.length > 0) {
                        logInfo(`Found ${extraTweets.length} extra tweets from threads`);
                        // Dedup and merge
                        const seenIds = new Set(collected.map(t => t.id));
                        for (const t of extraTweets) {
                            if (!seenIds.has(t.id)) {
                                collected.push(t);
                                seenIds.add(t.id);
                            }
                        }
                    }
                } catch (e) {
                    logWarn("Thread expansion failed (API might be restricted): " + e.message);
                }
            }
            */
            // ------------------------

            // Sort by date (newest first)
            collected.sort((a, b) => {
                const dateA = parseTweetDate(a.created_at) || new Date(0);
                const dateB = parseTweetDate(b.created_at) || new Date(0);
                return dateB - dateA;
            });

            logInfo(`Scroll export collected ${collected.length} tweets`);

            // === MERGE WITH PREVIOUS TWEETS (Resume Mode) ===
            const { tweets: finalTweets, mergeInfo } = mergeWithPreviousTweets(collected);

            if (mergeInfo) {
                logInfo(
                    `Merged: ${mergeInfo.previous_count} previous + ${mergeInfo.new_count} new - ${mergeInfo.duplicates_removed} duplicates = ${mergeInfo.final_count} total`,
                );
            }

            const completedAt = new Date().toISOString();
            const consolidatedMeta = buildConsolidatedMeta({
                username,
                userId,
                name: user.legacy?.name || username,
                startedAt,
                completedAt,
                newCollectedCount: collected.length,
                previousCollectedCount: mergeInfo ? mergeInfo.previous_count : 0,
                reportedCountCurrent:
                    Number.isFinite(totalTweetsReported) && totalTweetsReported > 0 ? totalTweetsReported : null,
                previousMeta: previousExportMeta,
                collectionMethod: isResumeMode ? 'scroll-interception-resumed' : 'scroll-interception',
                scrollResponsesCapturedCurrent: interceptedResponses.length,
                mergeInfo,
            });

            // Build payload
            const payload = {
                meta: consolidatedMeta,
                items: finalTweets,
            };

            // Download the file
            const resumeSuffix = isResumeMode ? '_merged' : '';
            const filename = `${username}_tweets_scroll${resumeSuffix}_${new Date().toISOString().slice(0, 10)}.json`;
            downloadFile(filename, JSON.stringify(payload, null, 2), 'application/json');

            logInfo('=== SCROLL EXPORT COMPLETE ===', {
                collected: finalTweets.length,
                responses: interceptedResponses.length,
                resumed: isResumeMode,
            });

            if (isResumeMode) {
                clearInMemoryResumeState();
                await clearPersistedResumeState();
            }

            lifecycle = reduceExportLifecycle(lifecycle, { type: 'complete' });
            updateButton(`✅ Exported ${finalTweets.length} tweets!`);
            setTimeout(resetButton, 5000);
        } finally {
            // Always clean up
            stopFetchInterception();
            clearInterceptedResponses();
            currentExportUserId = null;
            isExporting = false;
            abortController = null;
        }
    }

    async function _runExport(username) {
        logInfo('=== STARTING EXPORT ===', { username });
        isExporting = true;
        abortController = new AbortController();
        updateButton('🔄 Starting...');

        // Get options from storage (default to including replies now)
        let options = { includeReplies: true, maxCount: 0 };
        try {
            if (chrome.runtime?.id) {
                options = await chrome.storage.local.get({
                    includeReplies: true,
                    maxCount: 0,
                });
            }
        } catch {
            logWarn('Could not access storage, using defaults');
        }

        const { includeReplies } = options;
        const maxCount = options.maxCount > 0 ? options.maxCount : Infinity;

        logInfo('Export options', { includeReplies, maxCount });

        try {
            const startedAt = new Date().toISOString();
            const csrfToken = getCsrfToken();
            if (!csrfToken) {
                throw new Error('Could not find CSRF token. Are you logged in?');
            }

            updateButton('🔍 Looking up user...');
            const user = await getUserByScreenName(csrfToken, username);
            const totalTweetsReported = Number(user.legacy?.statuses_count ?? 0);
            logInfo(`Account reports ${totalTweetsReported} total posts`);

            const collected = [];
            const seenIds = new Set(); // Deduplicate tweets
            let cursor = null;
            let page = 0;
            let consecutiveEmptyPages = 0;
            let effectiveIncludeReplies = includeReplies;

            while (collected.length < maxCount) {
                if (abortController?.signal?.aborted) {
                    throw new Error('Export cancelled by user.');
                }

                page += 1;
                updateButton(`📥 Page ${page} (${collected.length} tweets)`);
                logInfo(`Fetching page ${page}`, {
                    collected: collected.length,
                    cursor: cursor ? `${cursor.slice(0, 50)}...` : null,
                });

                const variables = {
                    userId: user.id,
                    count: 40, // Higher than default 20, but within commonly observed limits for internal GraphQL API
                    includePromotedContent: true,
                    withCommunity: true,
                    withVoice: true,
                };

                if (effectiveIncludeReplies) {
                    variables.withV2Timeline = true;
                } else {
                    variables.withQuickPromoteEligibilityTweetFields = true;
                }

                if (cursor) {
                    variables.cursor = cursor;
                }

                let response: Awaited<ReturnType<typeof fetchTimelinePage>>;
                try {
                    response = await fetchTimelinePage(csrfToken, variables, effectiveIncludeReplies);
                } catch (err) {
                    const msg = err?.message || String(err);
                    if (msg.includes('(404)') && effectiveIncludeReplies) {
                        logWarn('Replies endpoint returned 404. Falling back to posts-only.');
                        effectiveIncludeReplies = false;
                        delete variables.withV2Timeline;
                        variables.withQuickPromoteEligibilityTweetFields = true;
                        response = await fetchTimelinePage(csrfToken, variables, false);
                    } else {
                        throw err;
                    }
                }

                const { items, nextCursor } = extractTimeline(response);

                // Filter out duplicates that we've already seen
                const newItems = items.filter((item) => {
                    if (!item.id || seenIds.has(item.id)) {
                        return false;
                    }
                    seenIds.add(item.id);
                    return true;
                });

                if (!newItems.length) {
                    consecutiveEmptyPages++;
                    logWarn(`Page ${page} returned no new items`, {
                        consecutiveEmpty: consecutiveEmptyPages,
                        rawItemsCount: items.length,
                        nextCursor: nextCursor ? 'present' : 'missing',
                    });

                    // Sometimes API returns empty pages mid-stream; allow up to 3 before stopping
                    if (consecutiveEmptyPages >= 3) {
                        logInfo('Stopping after 3 consecutive empty pages.');
                        break;
                    }

                    // If there's still a cursor, try continuing
                    if (nextCursor) {
                        cursor = nextCursor;
                        await sleep(3000); // Longer delay after empty page
                        continue;
                    } else {
                        logInfo('No more items and no cursor. Export complete.');
                        break;
                    }
                }

                // Reset empty page counter on success
                consecutiveEmptyPages = 0;

                for (const item of newItems) {
                    if (collected.length >= maxCount) {
                        break;
                    }
                    collected.push(item);
                }

                // Log the date range of tweets collected so far for debugging
                const oldestTweet = newItems[newItems.length - 1];
                const oldestDate = oldestTweet?.created_at || 'unknown';

                cursor = nextCursor;
                logInfo(`Page ${page} complete`, {
                    newItems: newItems.length,
                    total: collected.length,
                    oldestOnPage: oldestDate,
                    hasMore: !!cursor,
                });

                if (!cursor) {
                    logInfo('No cursor found. Reached end of timeline.');
                    break;
                }

                await sleep(2500); // 2.5 seconds between timeline pages
            }

            // Determine the oldest tweet date we collected for potential historical search
            let oldestCollectedDate = null;
            for (const tweet of collected) {
                if (tweet.created_at) {
                    if (!oldestCollectedDate || tweet.created_at < oldestCollectedDate) {
                        oldestCollectedDate = tweet.created_at;
                    }
                }
            }

            // Check if we should try to get historical tweets via search
            // NOTE: As of Feb 2025, Twitter requires x-client-transaction-id header for search API
            // which is a cryptographically signed header we can't generate from content script.
            // Historical search is disabled until a workaround is found.
            const HISTORICAL_SEARCH_ENABLED = false;

            const shouldSearchHistorical =
                HISTORICAL_SEARCH_ENABLED &&
                collected.length >= 100 && // We got a decent number of tweets
                totalTweetsReported > collected.length + 200 && // Account has significantly more
                oldestCollectedDate; // We know where to start searching from

            let historicalTweetsCount = 0;

            if (shouldSearchHistorical) {
                logInfo(
                    `Timeline returned ${collected.length} tweets but account reports ${totalTweetsReported}. ` +
                        `Attempting historical search from ${oldestCollectedDate}...`,
                );

                updateButton(`🔍 Searching historical...`);

                try {
                    const historicalTweets = await fetchHistoricalTweetsViaSearch(
                        csrfToken,
                        username,
                        oldestCollectedDate,
                        user.legacy?.created_at, // Account creation date
                        seenIds,
                        updateButton,
                    );

                    if (historicalTweets.length > 0) {
                        historicalTweetsCount = historicalTweets.length;
                        logInfo(`Found ${historicalTweetsCount} additional historical tweets via search`);
                        collected.push(...historicalTweets);
                    }
                } catch (err) {
                    logWarn('Historical search failed, continuing with timeline data', {
                        error: err.message,
                    });
                }
            } else if (collected.length >= 3000 && totalTweetsReported > collected.length + 500) {
                // Warn about timeline limit
                logWarn(
                    `Twitter timeline API limits access to ~3,200 most recent tweets. ` +
                        `Account reports ${totalTweetsReported} total, but we collected ${collected.length}. ` +
                        `Historical search is currently unavailable due to Twitter's API restrictions.`,
                );
            }

            // After main export, optionally fill in missing parent tweets for thread context
            if (collected.length > 0) {
                updateButton(`🧵 Fetching context...`);

                // 1. Fetch missing parents (upwards)
                const missingParents = await fetchMissingTweets(csrfToken, collected);
                if (missingParents.length > 0) {
                    logInfo(`Adding ${missingParents.length} parent tweets for context`);
                    collected.push(...missingParents);
                }

                // 2. Fetch missing self-replies (downwards)
                const selfReplies = await fetchSelfThreads(csrfToken, collected, user.id);
                if (selfReplies.length > 0) {
                    logInfo(`Adding ${selfReplies.length} self-reply tweets for context`);
                    collected.push(...selfReplies);
                }
            }

            const finishedAt = new Date().toISOString();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `Wawa_${username}_${effectiveIncludeReplies ? 'replies' : 'posts'}_${timestamp}.json`;

            const payload = {
                meta: {
                    username,
                    user_id: user.id,
                    export_type: effectiveIncludeReplies ? 'posts_and_replies' : 'posts',
                    collected_count: collected.length,
                    historical_search_count: historicalTweetsCount || null,
                    total_tweets_reported: totalTweetsReported || null,
                    started_at: startedAt,
                    finished_at: finishedAt,
                    cursor_end: cursor,
                },
                items: collected,
            };

            downloadFile(filename, JSON.stringify(payload, null, 2), 'application/json');

            logInfo('=== EXPORT COMPLETE ===', { collected: collected.length, filename });
            updateButton(`✅ Saved ${collected.length} tweets`);

            try {
                if (chrome.runtime?.id) {
                    chrome.runtime
                        .sendMessage({
                            type: 'exportComplete',
                            username,
                            count: collected.length,
                        })
                        .catch(() => {});
                }
            } catch {}

            setTimeout(resetButton, 4000);
        } catch (err) {
            const message = err?.message || String(err);
            logError('Export failed', { error: message });
            updateButton(`❌ ${message.slice(0, 30)}...`, true);
            setTimeout(resetButton, 5000);
        } finally {
            isExporting = false;
            abortController = null;
        }
    }

    // ========== INITIALIZATION ==========
    function shouldShowButton() {
        return !!getUsernameFromUrl();
    }

    function initializeOrUpdate() {
        if (shouldShowButton()) {
            if (!exportButton) {
                createButton();
            }
        } else {
            removeButton();
        }
    }

    let lastUrl = window.location.href;
    const urlObserver = new MutationObserver(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            initializeOrUpdate();
        }
    });

    logInfo('Wawa Minimal content script loaded');

    // Check for auto-start flag (from redirect)
    if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['wawa_search_autostart'], (result) => {
            const ctx = result.wawa_search_autostart;
            if (ctx && ctx.autoStart) {
                // If timestamp is fresh (< 60s)
                if (Date.now() - ctx.timestamp < 60000) {
                    logInfo('Auto-start flag detected! Starting export...');
                    pendingAutoStartContext = ctx;
                    chrome.storage.local.remove('wawa_search_autostart');

                    // Wait for page to settle then trigger
                    setTimeout(() => {
                        handleScrollExport();
                    }, 3000);
                }
            }
        });
    }

    urlObserver.observe(document.body, { childList: true, subtree: true });

    // Expose manual stop function for rescue
    window.twExportStop = handleCancelExport;

    initializeOrUpdate();
    window.addEventListener('popstate', initializeOrUpdate);
})();
