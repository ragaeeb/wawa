export default defineUnlistedScript(() => {
    console.log('[TwExport] Interceptor script starting v4 (WXT injected)...');

    if ((window as { __twexportFetchIntercepted?: boolean }).__twexportFetchIntercepted) {
        console.warn('[TwExport] Already intercepted');
        return;
    }

    (window as { __twexportFetchIntercepted?: boolean }).__twexportFetchIntercepted = true;

    const originalFetch = window.fetch;
    (window as { __twexportOriginalFetch?: typeof window.fetch }).__twexportOriginalFetch = originalFetch;

    window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
        const requestLike = args[0];
        const url =
            typeof requestLike === 'string'
                ? requestLike
                : requestLike instanceof URL
                  ? requestLike.toString()
                  : requestLike?.url;

        const response = await originalFetch.apply(this, args);

        if (response.status === 429) {
            const rateLimitInfo = {
                limit: response.headers.get('x-rate-limit-limit'),
                remaining: response.headers.get('x-rate-limit-remaining'),
                reset: response.headers.get('x-rate-limit-reset'),
            };

            window.postMessage(
                {
                    type: 'TWEXPORT_RATE_LIMIT',
                    payload: { url, method: 'fetch', rateLimitInfo, status: 429 },
                },
                '*',
            );

            return response;
        }

        if (response.status === 401) {
            window.postMessage({ type: 'TWEXPORT_AUTH_ERROR', payload: { url, status: 401 } }, '*');
            return response;
        }

        try {
            if (
                url?.includes('/graphql/') &&
                (url.includes('UserTweets') ||
                    url.includes('UserTweetsAndReplies') ||
                    url.includes('UserMedia') ||
                    url.includes('SearchTimeline'))
            ) {
                const rateLimitInfo = {
                    limit: Number.parseInt(response.headers.get('x-rate-limit-limit') ?? '150', 10) || 150,
                    remaining: Number.parseInt(response.headers.get('x-rate-limit-remaining') ?? '50', 10) || 50,
                    reset:
                        Number.parseInt(response.headers.get('x-rate-limit-reset') ?? '0', 10) ||
                        Date.now() / 1000 + 900,
                };

                const cloned = response.clone();
                const data = await cloned.json();

                window.postMessage(
                    {
                        type: 'TWEXPORT_INTERCEPTED_RESPONSE',
                        payload: {
                            url,
                            data,
                            timestamp: Date.now(),
                            rateLimitInfo,
                        },
                    },
                    '*',
                );
            }
        } catch {
            // Ignore parse errors from non-json response bodies.
        }

        return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    const patchedOpen: typeof XMLHttpRequest.prototype.open = function (
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null,
    ): void {
        const useAsync = async ?? true;
        (this as XMLHttpRequest & { _url?: string })._url = String(url);
        originalOpen.call(this, method, url, useAsync, username, password);
    };

    XMLHttpRequest.prototype.open = patchedOpen;

    XMLHttpRequest.prototype.send = function (...sendArgs: Parameters<typeof originalSend>): void {
        this.addEventListener('load', function () {
            const xhr = this as XMLHttpRequest & { _url?: string };

            if (xhr.status === 429) {
                const rateLimitInfo = {
                    limit: xhr.getResponseHeader('x-rate-limit-limit'),
                    remaining: xhr.getResponseHeader('x-rate-limit-remaining'),
                    reset: xhr.getResponseHeader('x-rate-limit-reset'),
                };

                window.postMessage(
                    {
                        type: 'TWEXPORT_RATE_LIMIT',
                        payload: { url: xhr._url, method: 'xhr', rateLimitInfo, status: 429 },
                    },
                    '*',
                );

                return;
            }

            if (xhr.status === 401) {
                window.postMessage({ type: 'TWEXPORT_AUTH_ERROR', payload: { url: xhr._url, status: 401 } }, '*');
                return;
            }

            try {
                const url = xhr._url;

                if (
                    url?.includes('/graphql/') &&
                    (url.includes('UserTweets') ||
                        url.includes('UserTweetsAndReplies') ||
                        url.includes('UserMedia') ||
                        url.includes('SearchTimeline'))
                ) {
                    const rateLimitInfo = {
                        limit: Number.parseInt(xhr.getResponseHeader('x-rate-limit-limit') ?? '150', 10) || 150,
                        remaining: Number.parseInt(xhr.getResponseHeader('x-rate-limit-remaining') ?? '50', 10) || 50,
                        reset:
                            Number.parseInt(xhr.getResponseHeader('x-rate-limit-reset') ?? '0', 10) ||
                            Date.now() / 1000 + 900,
                    };

                    const data = JSON.parse(xhr.responseText);

                    window.postMessage(
                        {
                            type: 'TWEXPORT_INTERCEPTED_RESPONSE',
                            payload: {
                                url,
                                data,
                                timestamp: Date.now(),
                                rateLimitInfo,
                            },
                        },
                        '*',
                    );
                }
            } catch {
                // Ignore parse errors.
            }
        });

        originalSend.apply(this, sendArgs);
    };

    console.log('[TwExport] INTERCEPTOR READY v4 (Fetch + XHR with Rate Limit Headers)');
});
