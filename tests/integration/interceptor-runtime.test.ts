import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';

type PostedMessage = {
    type?: string;
    payload?: Record<string, unknown>;
};

const posted: PostedMessage[] = [];
let fetchImpl: (input: RequestInfo | URL) => Promise<Response>;

describe('interceptor runtime integration', () => {
    beforeAll(async () => {
        (globalThis as unknown as { defineUnlistedScript: (setup: () => void) => unknown }).defineUnlistedScript = (
            setup: () => void,
        ) => {
            setup();
            return setup;
        };

        const delegatingFetch = (input: RequestInfo | URL) => fetchImpl(input);
        Object.defineProperty(window, 'fetch', {
            value: delegatingFetch,
            writable: true,
            configurable: true,
        });

        Object.defineProperty(window, 'postMessage', {
            value: (message: PostedMessage) => {
                posted.push(message);
            },
            writable: true,
            configurable: true,
        });

        await import('../../entrypoints/interceptor.inject');
    });

    beforeEach(() => {
        posted.length = 0;
    });

    it('should post WAWA_RATE_LIMIT on fetch 429 responses', async () => {
        fetchImpl = async () =>
            new Response('', {
                status: 429,
                headers: {
                    'x-rate-limit-limit': '150',
                    'x-rate-limit-remaining': '0',
                    'x-rate-limit-reset': '1700000000',
                },
            });

        await window.fetch('https://x.com/i/api/graphql/abc/UserTweets');

        expect(posted[0]?.type).toBe('WAWA_RATE_LIMIT');
        expect(posted[0]?.payload?.method).toBe('fetch');
        expect(posted[0]?.payload?.status).toBe(429);
    });

    it('should post WAWA_AUTH_ERROR on fetch 401 responses', async () => {
        fetchImpl = async () => new Response('', { status: 401 });

        await window.fetch('https://x.com/i/api/graphql/abc/UserTweets');

        expect(posted[0]?.type).toBe('WAWA_AUTH_ERROR');
        expect(posted[0]?.payload?.status).toBe(401);
    });

    it('should post WAWA_INTERCEPTED_RESPONSE for target graphql responses', async () => {
        fetchImpl = async () =>
            new Response(JSON.stringify({ data: { ok: true } }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                    'x-rate-limit-limit': '150',
                    'x-rate-limit-remaining': '50',
                    'x-rate-limit-reset': '1700000000',
                },
            });

        await window.fetch('https://x.com/i/api/graphql/abc/UserTweets');

        expect(posted[0]?.type).toBe('WAWA_INTERCEPTED_RESPONSE');
        expect(typeof posted[0]?.payload?.timestamp).toBe('number');
        expect(posted[0]?.payload?.url).toBe('https://x.com/i/api/graphql/abc/UserTweets');
    });

    it('should ignore non-target URLs', async () => {
        fetchImpl = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });

        await window.fetch('https://x.com/home');
        expect(posted).toHaveLength(0);
    });
});
