type RateLimitInfo = {
    limit: number | string | null;
    remaining: number | string | null;
    reset: number | string | null;
};

const extractUrlFromRequest = (requestLike: RequestInfo | URL): string | undefined => {
    if (typeof requestLike === 'string') {
        return requestLike;
    }
    if (requestLike instanceof URL) {
        return requestLike.toString();
    }
    return requestLike?.url;
};

const extractRateLimitHeaders = (headers: Headers): RateLimitInfo => {
    return {
        limit: headers.get('x-rate-limit-limit'),
        remaining: headers.get('x-rate-limit-remaining'),
        reset: headers.get('x-rate-limit-reset'),
    };
};

const parseRateLimitHeaders = (headers: Headers): { limit: number; remaining: number; reset: number } => {
    return {
        limit: Number.parseInt(headers.get('x-rate-limit-limit') ?? '150', 10) || 150,
        remaining: Number.parseInt(headers.get('x-rate-limit-remaining') ?? '50', 10) || 50,
        reset: Number.parseInt(headers.get('x-rate-limit-reset') ?? '0', 10) || Date.now() / 1000 + 900,
    };
};

const isTargetGraphQLEndpoint = (url: string | undefined): boolean => {
    if (!url?.includes('/graphql/')) {
        return false;
    }
    return (
        url.includes('UserTweets') ||
        url.includes('UserTweetsAndReplies') ||
        url.includes('UserMedia') ||
        url.includes('SearchTimeline')
    );
};

const handleRateLimitResponse = (url: string | undefined, rateLimitInfo: RateLimitInfo): void => {
    window.postMessage(
        {
            type: 'WAWA_RATE_LIMIT',
            payload: { url, method: 'fetch', rateLimitInfo, status: 429 },
        },
        '*',
    );
};

const handleAuthErrorResponse = (url: string | undefined): void => {
    window.postMessage({ type: 'WAWA_AUTH_ERROR', payload: { url, status: 401 } }, '*');
};

const handleGraphQLResponse = async (url: string, response: Response): Promise<void> => {
    const rateLimitInfo = parseRateLimitHeaders(response.headers);
    const cloned = response.clone();
    const data = await cloned.json();

    window.postMessage(
        {
            type: 'WAWA_INTERCEPTED_RESPONSE',
            payload: {
                url,
                data,
                timestamp: Date.now(),
                rateLimitInfo,
            },
        },
        '*',
    );
};

const handleXHRRateLimitResponse = (url: string | undefined, xhr: XMLHttpRequest): void => {
    const rateLimitInfo = {
        limit: xhr.getResponseHeader('x-rate-limit-limit'),
        remaining: xhr.getResponseHeader('x-rate-limit-remaining'),
        reset: xhr.getResponseHeader('x-rate-limit-reset'),
    };

    window.postMessage(
        {
            type: 'WAWA_RATE_LIMIT',
            payload: { url, method: 'xhr', rateLimitInfo, status: 429 },
        },
        '*',
    );
};

const handleXHRAuthErrorResponse = (url: string | undefined): void => {
    window.postMessage({ type: 'WAWA_AUTH_ERROR', payload: { url, status: 401 } }, '*');
};

const handleXHRGraphQLResponse = (url: string, xhr: XMLHttpRequest): void => {
    const rateLimitInfo = {
        limit: Number.parseInt(xhr.getResponseHeader('x-rate-limit-limit') ?? '150', 10) || 150,
        remaining: Number.parseInt(xhr.getResponseHeader('x-rate-limit-remaining') ?? '50', 10) || 50,
        reset: Number.parseInt(xhr.getResponseHeader('x-rate-limit-reset') ?? '0', 10) || Date.now() / 1000 + 900,
    };

    const data = JSON.parse(xhr.responseText);

    window.postMessage(
        {
            type: 'WAWA_INTERCEPTED_RESPONSE',
            payload: {
                url,
                data,
                timestamp: Date.now(),
                rateLimitInfo,
            },
        },
        '*',
    );
};

const createXHRLoadHandler = () => {
    return function (this: XMLHttpRequest & { _url?: string }) {
        const url = this._url;

        if (this.status === 429) {
            handleXHRRateLimitResponse(url, this);
            return;
        }

        if (this.status === 401) {
            handleXHRAuthErrorResponse(url);
            return;
        }

        try {
            if (isTargetGraphQLEndpoint(url)) {
                handleXHRGraphQLResponse(url as string, this);
            }
        } catch {
            // Ignore parse errors.
        }
    };
};

export default defineUnlistedScript(() => {
    console.log('[Wawa] Interceptor script starting v4 (WXT injected)...');

    if ((window as { __wawaFetchIntercepted?: boolean }).__wawaFetchIntercepted) {
        console.warn('[Wawa] Already intercepted');
        return;
    }

    (window as { __wawaFetchIntercepted?: boolean }).__wawaFetchIntercepted = true;

    const originalFetch = window.fetch;
    (window as { __wawaOriginalFetch?: typeof window.fetch }).__wawaOriginalFetch = originalFetch;

    window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
        const url = extractUrlFromRequest(args[0]);
        const response = await originalFetch.apply(this, args);

        if (response.status === 429) {
            handleRateLimitResponse(url, extractRateLimitHeaders(response.headers));
            return response;
        }

        if (response.status === 401) {
            handleAuthErrorResponse(url);
            return response;
        }

        try {
            if (isTargetGraphQLEndpoint(url)) {
                await handleGraphQLResponse(url as string, response);
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
        this.addEventListener('load', createXHRLoadHandler());
        originalSend.apply(this, sendArgs);
    };

    console.log('[Wawa] INTERCEPTOR READY v4 (Fetch + XHR with Rate Limit Headers)');
});
