// @ts-nocheck

import {
    BEARER_TOKEN,
    ENDPOINTS,
    USER_BY_SCREEN_NAME_FEATURES,
    USER_BY_SCREEN_NAME_FIELD_TOGGLES,
} from '@/content/constants';
import { extractSearchUser, resolveUserForExport } from '@/content/export-flow';
import { ensureResumeStateForSearch, redirectProfileExportToSearch } from '@/content/export-launch';
import { createInterceptorBridge } from '@/content/interceptor-bridge';
import { showLooksDonePanel, showRouteChangePanel } from '@/content/pending-panels';
import {
    createRateLimitState,
    getCooldownDetails as getRateLimitCooldownDetails,
    resetRateLimitStateForRun,
} from '@/content/rate-limit-controller';
import { createRateLimitHandlers } from '@/content/rate-limit-handlers';
import { showRateLimitPanel } from '@/content/rate-limit-panel-controller';
import { createResumeActions } from '@/content/resume-actions';
import { startResumeFromFile } from '@/content/resume-file-flow';
import {
    clearInMemoryResumeState as clearResumeSessionInMemory,
    clearPersistedResumeState as clearResumeSessionPersisted,
    createResumeSessionState,
    getConsolidatedCollectedTweets as getResumeConsolidatedTweets,
    mergeWithPreviousTweets as mergeResumeTweets,
    persistResumeState as persistResumeSessionState,
    restoreResumeStateFromStorage as restoreResumeSessionState,
    setResumeState as setResumeSessionState,
} from '@/content/resume-session';
import { bootstrapAutoStart, initializeForCurrentRoute, observeUrlChanges } from '@/content/runtime-bootstrap';
import { createRuntimeButtonController } from '@/content/runtime-button-controller';
import { createRuntimeLogger } from '@/content/runtime-logger';
import { runScrollExportSession } from '@/content/scroll-export-session';
import { runScrollToLoadMore } from '@/content/scroll-runner';
import { extractTweetsFromResponses } from '@/content/timeline-collector';
import { getCsrfTokenFromCookieString, resolveUserByScreenName } from '@/content/twitter-user-api';
import { extractUsernameFromLocation } from '@/content/url-username';
import { createInitialLifecycle, reduceExportLifecycle, shouldPromptLooksDone } from '@/core/rate-limit/state';
import { parseTweetDate as parseTweetDateCore } from '@/core/resume/payload';
import { createChromeLocalFallbackStorage, createResumeStorage } from '@/core/resume/storage';

(() => {
    let interceptedResponses = [];
    let isRateLimited = false;
    let isPendingDone = false; // Waiting for user to confirm completion

    const resumeSession = createResumeSessionState();
    const RESUME_STORAGE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
    const resumeStorage = createResumeStorage({
        indexedDbFactory: typeof indexedDB !== 'undefined' ? indexedDB : undefined,
        fallbackStorage:
            typeof chrome !== 'undefined' && chrome.storage?.local ? createChromeLocalFallbackStorage() : undefined,
        maxAgeMs: RESUME_STORAGE_MAX_AGE_MS,
    });

    let timelineActivityAt = Date.now();
    let lifecycle = createInitialLifecycle();

    const rateLimitState = createRateLimitState();

    let rateLimitHandlers: ReturnType<typeof createRateLimitHandlers> | null = null;

    const handleRateLimitMessage = (payload) => {
        rateLimitHandlers?.handleRateLimitMessage(payload);
    };

    const handleAuthErrorMessage = () => {
        rateLimitHandlers?.handleAuthErrorMessage();
    };

    const handleInterceptedResponseMessage = (payload) => {
        rateLimitHandlers?.handleInterceptedResponseMessage(payload);
    };

    let interceptorBridge: ReturnType<typeof createInterceptorBridge> | null = null;

    const getInterceptorBridge = () => {
        if (interceptorBridge) {
            return interceptorBridge;
        }

        interceptorBridge = createInterceptorBridge({
            getScriptUrl: () => chrome.runtime.getURL('/interceptor.js'),
            onRateLimit: handleRateLimitMessage,
            onAuthError: handleAuthErrorMessage,
            onInterceptedResponse: handleInterceptedResponseMessage,
            getCapturedCount: () => interceptedResponses.length,
            logInfo,
            logError,
        });
        return interceptorBridge;
    };

    const startFetchInterception = async () => {
        interceptedResponses = [];
        await getInterceptorBridge().start();
    };

    const stopFetchInterception = () => {
        interceptorBridge?.stop();
    };

    function clearInterceptedResponses() {
        interceptedResponses = [];
    }

    const updateScrollProgress = (responsesCaptured) => {
        if (!buttonController.getContainer() || isRateLimited) {
            return;
        }

        const modeIcon = rateLimitState.mode === 'cooldown' ? '🟠' : '🟢';
        updateButton(`${modeIcon} Scrolling... (${responsesCaptured} batches, ${rateLimitState.remaining} left)`);
    };

    const handleRouteChangedDuringScroll = (_currentPathname, responsesCaptured) => {
        if (isPendingDone) {
            return;
        }

        isPendingDone = true;
        lifecycle = reduceExportLifecycle(lifecycle, { type: 'mark_pending_done' });
        handleRouteChange(responsesCaptured);
    };

    const handleLooksDoneDetected = (responsesCaptured) => {
        if (isPendingDone) {
            return;
        }

        isPendingDone = true;
        lifecycle = reduceExportLifecycle(lifecycle, { type: 'mark_pending_done' });
        logInfo('Timeline appears complete - waiting for user confirmation');
        handleLooksDone(responsesCaptured);
    };

    async function scrollToLoadMore(maxScrolls = 100) {
        const startingPathname = window.location.pathname;

        return runScrollToLoadMore({
            maxScrolls,
            startingPathname,
            getAbortSignal: () => abortController?.signal || null,
            isPendingDone: () => isPendingDone,
            onRouteChanged: handleRouteChangedDuringScroll,
            isRateLimited: () => isRateLimited,
            getRateLimitMode: () => rateLimitState.mode,
            enterCooldown: () => {
                lifecycle = reduceExportLifecycle(lifecycle, { type: 'enter_cooldown' });
            },
            getCooldownConfig: () => getRateLimitCooldownDetails(rateLimitState),
            showCooldownUI,
            updateCooldownTimer,
            removeCooldownUI,
            isExporting: () => isExporting,
            shouldSkipCooldown: () => Boolean(window.wawaSkipCooldown),
            clearCooldownSkip: () => {
                window.wawaSkipCooldown = false;
            },
            onCooldownComplete: () => {
                rateLimitState.mode = 'normal';
                rateLimitState.requestCount = 0;
                lifecycle = reduceExportLifecycle(lifecycle, { type: 'exit_cooldown', at: Date.now() });
                markTimelineActivity();
            },
            sleep,
            getResponsesCaptured: () => interceptedResponses.length,
            shouldPromptLooksDone: (input) => {
                return shouldPromptLooksDone(lifecycle, input);
            },
            onLooksDoneDetected: handleLooksDoneDetected,
            updateProgress: updateScrollProgress,
            getCurrentDelay: () => rateLimitState.dynamicDelay,
            markTimelineActivity,
            updateButton,
            logInfo,
            logDebug,
            logWarn,
        });
    }

    let isExporting = false;
    let currentExportUserId = null;
    let abortController = null;
    let pendingAutoStartContext = null;

    const runtimeLogger = createRuntimeLogger({
        prefixLabel: 'Wawa',
        maxEntries: 500,
        onEntry: (entry) => {
            try {
                if (chrome.runtime?.id) {
                    chrome.runtime.sendMessage({ type: 'log', entry }).catch(() => {});
                }
            } catch {}
        },
    });
    const logInfo = runtimeLogger.logInfo;
    const logDebug = runtimeLogger.logDebug;
    const logWarn = runtimeLogger.logWarn;
    const logError = runtimeLogger.logError;

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function markTimelineActivity() {
        timelineActivityAt = Date.now();
        lifecycle = reduceExportLifecycle(lifecycle, { type: 'activity', at: timelineActivityAt });
    }

    rateLimitHandlers = createRateLimitHandlers({
        rateLimitState,
        getIsExporting: () => isExporting,
        getIsRateLimited: () => isRateLimited,
        setIsRateLimited: (value) => {
            isRateLimited = value;
        },
        getLifecycle: () => lifecycle,
        setLifecycle: (value) => {
            lifecycle = value;
        },
        reduceLifecycle: reduceExportLifecycle,
        markTimelineActivity,
        addInterceptedResponse: (payload) => {
            interceptedResponses.push(payload);
        },
        getInterceptedResponseCount: () => interceptedResponses.length,
        onRateLimitUiRequired: () => {
            handleRateLimitEvent();
        },
        logInfo,
        logDebug,
        logWarn,
        logError,
    });

    function extractTweetsFromInterceptedResponses(targetUserId) {
        return extractTweetsFromResponses(interceptedResponses, targetUserId, {
            logInfo,
            logDebug,
        });
    }

    function getCsrfToken() {
        const token = getCsrfTokenFromCookieString(document.cookie);
        logDebug('Retrieved CSRF token', { found: !!token });
        return token;
    }

    async function getUserByScreenName(csrfToken, username) {
        return resolveUserByScreenName({
            host: window.location.hostname,
            csrfToken,
            username,
            bearerToken: BEARER_TOKEN,
            endpoint: ENDPOINTS.userByScreenName,
            features: USER_BY_SCREEN_NAME_FEATURES,
            fieldToggles: USER_BY_SCREEN_NAME_FIELD_TOGGLES,
            signal: abortController?.signal,
            loggers: {
                logInfo,
                logDebug,
                logError,
            },
        });
    }

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

    function getUsernameFromUrl() {
        return extractUsernameFromLocation(window.location.pathname, window.location.search);
    }

    const buttonController = createRuntimeButtonController({
        onExportToggle: () => {
            if (isExporting) {
                handleCancelExport();
                return;
            }

            handleScrollExport();
        },
        onResume: () => {
            if (!isExporting) {
                handleResumeFromFile();
            }
        },
        onCancelExport: () => {
            handleCancelExport();
        },
        isExporting: () => isExporting,
        isPendingDone: () => isPendingDone,
        logInfo,
    });

    const createButton = () => {
        buttonController.createButton();
    };

    const updateButton = (text, isError = false) => {
        buttonController.updateButton(text, isError);
    };

    const resetButton = () => {
        buttonController.resetButton();
    };

    const removeButton = () => {
        buttonController.removeButton();
    };

    const showCooldownUI = (duration) => {
        buttonController.showCooldownUI(duration);
    };

    const updateCooldownTimer = (milliseconds) => {
        buttonController.updateCooldownTimer(milliseconds);
    };

    const removeCooldownUI = () => {
        buttonController.removeCooldownUI();
    };

    function handleLooksDone(batchCount) {
        showLooksDonePanel({
            container: buttonController.getContainer(),
            batchCount,
            onDownload: () => {
                isPendingDone = false;
                if (abortController) {
                    abortController.abort();
                }
                logInfo('User confirmed download');
            },
            onContinue: () => {
                isPendingDone = false;
                lifecycle = reduceExportLifecycle(lifecycle, { type: 'resume_manual', at: Date.now() });
                markTimelineActivity();
                updateButton('🟢 Continuing...');
                logInfo('User chose to continue scrolling');
            },
            onResumeLink: () => {
                resumeActions.copyResumeLink();
            },
            onCancel: () => {
                isPendingDone = false;
                lifecycle = reduceExportLifecycle(lifecycle, { type: 'cancel' });
                if (abortController) {
                    abortController.abort();
                }
                isExporting = false;
                stopFetchInterception();
                resetButton();
            },
            logInfo,
        });
    }

    function handleRouteChange(batchCount) {
        showRouteChangePanel({
            container: buttonController.getContainer(),
            batchCount,
            onGoBack: () => {
                window.history.back();
                isPendingDone = false;
                lifecycle = reduceExportLifecycle(lifecycle, { type: 'resume_manual', at: Date.now() });
                markTimelineActivity();
                updateButton('🟢 Returning...');
                logInfo('User clicked Go Back');
            },
            onSaveProgress: () => {
                resumeActions.savePartialExport();
            },
            onResumeLink: () => {
                resumeActions.copyResumeLink();
            },
            onCancel: () => {
                isPendingDone = false;
                lifecycle = reduceExportLifecycle(lifecycle, { type: 'cancel' });
                if (abortController) {
                    abortController.abort();
                }
                isExporting = false;
                stopFetchInterception();
                resetButton();
            },
            logWarn,
        });
    }
    const persistResumeSnapshot = (username, tweets, exportMeta) => {
        return persistResumeSessionState({
            resumeStorage,
            username,
            tweets,
            exportMeta,
            loggers: { logInfo, logWarn, logError },
        });
    };

    const resetResumeFlowState = () => {
        clearResumeSessionInMemory(resumeSession);
        resetButton();
    };

    const handleResumeFromFile = () => {
        startResumeFromFile({
            getFallbackUsername: getUsernameFromUrl,
            updateButton,
            setResumeState: (tweets, sourceMeta) => {
                setResumeSessionState(resumeSession, tweets, sourceMeta);
            },
            resetResumeFlowState,
            persistResumeState: persistResumeSnapshot,
            saveAutoStartContext: async (context) => {
                await chrome.storage.local.set({ wawa_search_autostart: context });
            },
            navigateTo: (url) => {
                window.location.href = url;
            },
            logInfo,
            logError,
            alertUser: (message) => {
                alert(message);
            },
        });
    };

    const parseTweetDate = parseTweetDateCore;

    const resumeActions = createResumeActions({
        getCurrentUsername: getUsernameFromUrl,
        getCurrentSearchQuery: () => {
            return new URLSearchParams(window.location.search).get('q');
        },
        getLiveCollectedTweets: () => {
            return extractTweetsFromInterceptedResponses(currentExportUserId || 'unknown');
        },
        mergeCollectedTweets: (tweets) => {
            return mergeResumeTweets(resumeSession, tweets);
        },
        consolidateCollectedTweets: (tweets) => {
            return getResumeConsolidatedTweets(resumeSession, tweets);
        },
        getPreviousMeta: () => {
            return resumeSession.previousExportMeta || null;
        },
        isResumeMode: () => {
            return resumeSession.isResumeMode;
        },
        parseTweetDate,
        persistResumeSnapshot,
        saveAutoStartContext: async (context) => {
            await chrome.storage.local.set({ wawa_search_autostart: context });
        },
        downloadFile,
        writeToClipboard: async (value) => {
            await navigator.clipboard.writeText(value);
        },
        alertUser: (message) => {
            alert(message);
        },
        loggers: { logInfo, logWarn, logError },
    });
    function handleRateLimitEvent() {
        showRateLimitPanel({
            container: buttonController.getContainer(),
            rateLimitState,
            batchesCollected: interceptedResponses.length,
            onTryNow: () => {
                isRateLimited = false;
                rateLimitState.mode = 'normal';
                lifecycle = reduceExportLifecycle(lifecycle, { type: 'resume_manual', at: Date.now() });
                markTimelineActivity();
                const controls = document.getElementById('wawa-rl-controls');
                if (controls) {
                    controls.remove();
                }
                updateButton('📜 Resuming...');
                logInfo('User clicked Try Now - resuming scroll');
            },
            onSaveProgress: () => {
                resumeActions.savePartialExport();
            },
            onResumeLink: () => {
                resumeActions.copyResumeLink();
            },
            onCancel: () => {
                lifecycle = reduceExportLifecycle(lifecycle, { type: 'cancel' });
                if (abortController) {
                    abortController.abort();
                }
                isExporting = false;
                isRateLimited = false;
                stopFetchInterception();
                resetButton();
            },
            logInfo,
        });
    }

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

        if (window.location.pathname !== '/search') {
            await redirectProfileExportToSearch({
                username,
                getCsrfToken,
                getUserByScreenName,
                updateButton,
                saveAutoStartContext: async (context) => {
                    await chrome.storage.local.set({ wawa_search_autostart: context });
                },
                navigateTo: (url) => {
                    window.location.href = url;
                },
                logInfo,
                logWarn,
            });
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const searchUser = extractSearchUser(params.get('q'), username);
        const hasResumeState = await ensureResumeStateForSearch({
            searchUser,
            params,
            autoStartCtx,
            restoreResumeState: async (targetUsername) => {
                return restoreResumeSessionState({
                    state: resumeSession,
                    resumeStorage,
                    targetUsername,
                    loggers: { logInfo, logWarn, logError },
                });
            },
            getPriorTweetsCount: () => resumeSession.previousTweets.length,
            updateButton,
            resetButton,
            alertUser: (message) => {
                alert(message);
            },
            logInfo,
            logError,
        });
        if (!hasResumeState) {
            return;
        }

        logInfo(`Starting Scroll Export for ${searchUser}`);

        isExporting = true;
        abortController = new AbortController();

        try {
            const user = await resolveUserForExport({
                username: searchUser,
                getCsrfToken,
                getUserByScreenName,
                updateButton,
                loggers: { logInfo, logWarn, logError },
            });
            await runScrollExportSession({
                username: searchUser,
                userId: user.id,
                user,
                pathname: window.location.pathname,
                resumeSession,
                getAbortSignal: () => abortController?.signal || null,
                setCurrentExportUserId: (userId) => {
                    currentExportUserId = userId;
                },
                resetRunState,
                startFetchInterception,
                scrollToLoadMore,
                updateButton,
                extractTweetsFromInterceptedResponses,
                parseTweetDate,
                mergeWithPreviousTweets: (tweets) => {
                    return mergeResumeTweets(resumeSession, tweets);
                },
                downloadFile,
                getCapturedResponsesCount: () => interceptedResponses.length,
                clearResumeState: async () => {
                    clearResumeSessionInMemory(resumeSession);
                    await clearResumeSessionPersisted(resumeStorage, { logInfo, logWarn, logError });
                },
                completeExportUi,
                stopFetchInterception,
                clearInterceptedResponses,
                finalizeRuntimeState: () => {
                    isExporting = false;
                    abortController = null;
                },
                logInfo,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logError('Scroll export failed', { error: message });
            updateButton('❌ Export failed');
            setTimeout(resetButton, 3000);
            isExporting = false;
            abortController = null;
        }
    }
    const resetRunState = () => {
        isRateLimited = false;
        isPendingDone = false;
        const runStartAt = Date.now();
        lifecycle = createInitialLifecycle(runStartAt);
        lifecycle = reduceExportLifecycle(lifecycle, { type: 'start', at: runStartAt });
        markTimelineActivity();
        resetRateLimitStateForRun(rateLimitState);
    };

    const completeExportUi = (count) => {
        lifecycle = reduceExportLifecycle(lifecycle, { type: 'complete' });
        updateButton(`✅ Exported ${count} tweets!`);
        setTimeout(resetButton, 5000);
    };
    const shouldShowButton = () => {
        return Boolean(getUsernameFromUrl());
    };

    const initializeOrUpdate = () => {
        initializeForCurrentRoute({
            shouldShowButton,
            createButton,
            removeButton,
        });
    };

    const urlObserver = observeUrlChanges(initializeOrUpdate);

    logInfo('Wawa content script loaded');

    bootstrapAutoStart({
        key: 'wawa_search_autostart',
        staleAfterMs: 60000,
        delayMs: 3000,
        logInfo,
        onFreshContext: (context) => {
            pendingAutoStartContext = context;
            handleScrollExport();
        },
    });

    window.wawaStop = handleCancelExport;

    initializeOrUpdate();
    window.addEventListener('popstate', initializeOrUpdate);
    window.addEventListener('beforeunload', () => {
        urlObserver.disconnect();
        interceptorBridge?.dispose();
    });
})();
