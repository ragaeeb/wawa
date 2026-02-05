// TwExport - Fetch Interceptor with Rate Limit Header Capture
// This script runs in the page context to intercept Twitter's API responses

(function () {
    console.log('[TwExport] Interceptor script starting v3 (with rate limit headers)...');

    if (window.__twexportFetchIntercepted) {
        console.warn('[TwExport] Already intercepted');
        return;
    }
    window.__twexportFetchIntercepted = true;

    // --- FETCH INTERCEPTION ---
    const originalFetch = window.fetch;
    window.__twexportOriginalFetch = originalFetch;

    window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

        const response = await originalFetch.apply(this, args);

        // Check for Rate Limit 429
        if (response.status === 429) {
            console.warn('[TwExport] 429 Rate Limit Detected (Fetch)');

            // Try to extract rate limit headers
            const rateLimitInfo = {
                limit: response.headers.get('x-rate-limit-limit'),
                remaining: response.headers.get('x-rate-limit-remaining'),
                reset: response.headers.get('x-rate-limit-reset'),
            };

            window.postMessage({
                type: 'TWEXPORT_RATE_LIMIT',
                payload: { url, method: 'fetch', rateLimitInfo, status: 429 }
            }, '*');
            return response;
        }

        // Check for other error statuses
        if (response.status === 401) {
            window.postMessage({ type: 'TWEXPORT_AUTH_ERROR', payload: { url, status: 401 } }, '*');
            return response;
        }

        try {
            // Check if it's a GraphQL request we care about
            if (url && url.includes('/graphql/')) {
                if (url.includes('UserTweets') || url.includes('UserTweetsAndReplies') ||
                    url.includes('UserMedia') || url.includes('SearchTimeline')) {

                    console.log('[TwExport] CAPTURING:', url.slice(0, 80));

                    // Extract rate limit headers BEFORE cloning
                    const rateLimitInfo = {
                        limit: parseInt(response.headers.get('x-rate-limit-limit')) || 150,
                        remaining: parseInt(response.headers.get('x-rate-limit-remaining')) || 50,
                        reset: parseInt(response.headers.get('x-rate-limit-reset')) || (Date.now() / 1000 + 900),
                    };

                    try {
                        const clonedResponse = response.clone();
                        const data = await clonedResponse.json();

                        window.postMessage({
                            type: 'TWEXPORT_INTERCEPTED_RESPONSE',
                            payload: {
                                url: url,
                                data: data,
                                timestamp: Date.now(),
                                rateLimitInfo: rateLimitInfo
                            }
                        }, '*');
                    } catch (jsonErr) {
                        // ignore json parse errors
                    }
                }
            }
        } catch (e) {
            console.error('[TwExport] Fetch intercept error:', e.message);
        }

        return response;
    };

    // --- XHR INTERCEPTION (Fallback) ---
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this._url = url;
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
        this.addEventListener('load', function () {
            // Check for Rate Limit 429
            if (this.status === 429) {
                console.warn('[TwExport] 429 Rate Limit Detected (XHR)');

                const rateLimitInfo = {
                    limit: this.getResponseHeader('x-rate-limit-limit'),
                    remaining: this.getResponseHeader('x-rate-limit-remaining'),
                    reset: this.getResponseHeader('x-rate-limit-reset'),
                };

                window.postMessage({
                    type: 'TWEXPORT_RATE_LIMIT',
                    payload: { url: this._url, method: 'xhr', rateLimitInfo, status: 429 }
                }, '*');
                return;
            }

            // Check for auth errors
            if (this.status === 401) {
                window.postMessage({ type: 'TWEXPORT_AUTH_ERROR', payload: { url: this._url, status: 401 } }, '*');
                return;
            }

            try {
                if (this._url && this._url.includes('/graphql/') &&
                    (this._url.includes('UserTweets') || this._url.includes('UserTweetsAndReplies') ||
                        this._url.includes('UserMedia') || this._url.includes('SearchTimeline'))) {

                    console.log('[TwExport] CAPTURING XHR:', this._url.slice(0, 80));

                    const rateLimitInfo = {
                        limit: parseInt(this.getResponseHeader('x-rate-limit-limit')) || 150,
                        remaining: parseInt(this.getResponseHeader('x-rate-limit-remaining')) || 50,
                        reset: parseInt(this.getResponseHeader('x-rate-limit-reset')) || (Date.now() / 1000 + 900),
                    };

                    const data = JSON.parse(this.responseText);
                    window.postMessage({
                        type: 'TWEXPORT_INTERCEPTED_RESPONSE',
                        payload: {
                            url: this._url,
                            data: data,
                            timestamp: Date.now(),
                            rateLimitInfo: rateLimitInfo
                        }
                    }, '*');
                }
            } catch (e) {
                // Ignore parsing errors
            }
        });
        return originalSend.apply(this, arguments);
    };

    console.log('[TwExport] INTERCEPTOR READY v3 (Fetch + XHR with Rate Limit Headers)');
})();
