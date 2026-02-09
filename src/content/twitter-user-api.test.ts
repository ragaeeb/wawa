import { describe, expect, it, mock } from 'bun:test';
import { buildGraphqlUrl, getCsrfTokenFromCookieString, resolveUserByScreenName } from '@/content/twitter-user-api';

describe('getCsrfTokenFromCookieString', () => {
    it('should extract CSRF token from cookie string', () => {
        const result = getCsrfTokenFromCookieString('ct0=abc123; other=value');
        expect(result).toBe('abc123');
    });

    it('should extract CSRF token when it is first cookie', () => {
        const result = getCsrfTokenFromCookieString('ct0=token123; session=xyz');
        expect(result).toBe('token123');
    });

    it('should extract CSRF token when it is last cookie', () => {
        const result = getCsrfTokenFromCookieString('session=xyz; ct0=token456');
        expect(result).toBe('token456');
    });

    it('should extract CSRF token when it is only cookie', () => {
        const result = getCsrfTokenFromCookieString('ct0=onlytoken');
        expect(result).toBe('onlytoken');
    });

    it('should return null when ct0 cookie is not present', () => {
        const result = getCsrfTokenFromCookieString('session=xyz; other=value');
        expect(result).toBeNull();
    });

    it('should return null for empty cookie string', () => {
        const result = getCsrfTokenFromCookieString('');
        expect(result).toBeNull();
    });

    it('should handle cookie with spaces after semicolon', () => {
        const result = getCsrfTokenFromCookieString('session=xyz;  ct0=spaced');
        expect(result).toBe('spaced');
    });
});

describe('buildGraphqlUrl', () => {
    it('should build GraphQL URL with all parameters', () => {
        const result = buildGraphqlUrl({
            host: 'x.com',
            endpoint: { id: 'abc123', path: 'UserByScreenName' },
            variables: { screen_name: 'testuser' },
            features: { responsive_web_graphql_timeline_navigation_enabled: true },
            fieldToggles: { withArticlePlainText: false },
        });

        expect(result).toContain('https://x.com/i/api/graphql/abc123/UserByScreenName');
        expect(result).toContain('variables=');
        expect(result).toContain('features=');
        expect(result).toContain('field_toggles=');
    });

    it('should build GraphQL URL without field toggles', () => {
        const result = buildGraphqlUrl({
            host: 'twitter.com',
            endpoint: { id: 'xyz789', path: 'SomePath' },
            variables: { userId: '123' },
            features: { enabled: true },
            fieldToggles: null,
        });

        expect(result).toContain('https://twitter.com/i/api/graphql/xyz789/SomePath');
        expect(result).toContain('variables=');
        expect(result).toContain('features=');
        expect(result).not.toContain('field_toggles=');
    });

    it('should encode variables as JSON in URL', () => {
        const result = buildGraphqlUrl({
            host: 'x.com',
            endpoint: { id: 'id1', path: 'path1' },
            variables: { screen_name: 'user', withSafetyModeUserFields: true },
            features: {},
        });

        const url = new URL(result);
        const variables = JSON.parse(url.searchParams.get('variables') || '{}');
        expect(variables.screen_name).toBe('user');
        expect(variables.withSafetyModeUserFields).toBe(true);
    });

    it('should encode features as JSON in URL', () => {
        const result = buildGraphqlUrl({
            host: 'x.com',
            endpoint: { id: 'id1', path: 'path1' },
            variables: {},
            features: { feature1: true, feature2: false },
        });

        const url = new URL(result);
        const features = JSON.parse(url.searchParams.get('features') || '{}');
        expect(features.feature1).toBe(true);
        expect(features.feature2).toBe(false);
    });

    it('should use custom fieldTogglesParam when provided', () => {
        const result = buildGraphqlUrl({
            host: 'x.com',
            endpoint: { id: 'id1', path: 'path1' },
            variables: {},
            features: {},
            fieldToggles: { toggle: true },
            fieldTogglesParam: 'custom_toggles',
        });

        expect(result).toContain('custom_toggles=');
        expect(result).not.toContain('field_toggles=');
    });
});

describe('resolveUserByScreenName', () => {
    it('should resolve user successfully', async () => {
        const mockFetch = mock(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                data: {
                    user: {
                        result: {
                            __typename: 'User',
                            rest_id: '123456',
                            legacy: {
                                name: 'Test User',
                                statuses_count: 100,
                            },
                        },
                    },
                },
            }),
        })) as unknown as typeof fetch;

        const loggers = {
            logInfo: mock(() => {}),
            logDebug: mock(() => {}),
            logError: mock(() => {}),
        };

        const result = await resolveUserByScreenName({
            host: 'x.com',
            csrfToken: 'csrf123',
            username: 'testuser',
            bearerToken: 'Bearer token123',
            endpoint: { id: 'endpoint1', path: 'UserByScreenName' },
            features: {},
            fieldToggles: {},
            fetchImpl: mockFetch,
            loggers,
        });

        expect(result.id).toBe('123456');
        expect(result.legacy.name).toBe('Test User');
        expect(result.legacy.statuses_count).toBe(100);
        expect(loggers.logInfo).toHaveBeenCalled();
    });

    it('should throw error when user not found', async () => {
        const mockFetch = mock(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                data: {
                    user: {
                        result: {
                            __typename: 'UserUnavailable',
                        },
                    },
                },
            }),
        })) as unknown as typeof fetch;

        const loggers = {
            logInfo: mock(() => {}),
            logDebug: mock(() => {}),
            logError: mock(() => {}),
        };

        await expect(
            resolveUserByScreenName({
                host: 'x.com',
                csrfToken: 'csrf123',
                username: 'nonexistent',
                bearerToken: 'Bearer token123',
                endpoint: { id: 'endpoint1', path: 'UserByScreenName' },
                features: {},
                fieldToggles: {},
                fetchImpl: mockFetch,
                loggers,
            }),
        ).rejects.toThrow('User not found or unavailable');

        expect(loggers.logError).toHaveBeenCalled();
    });

    it('should throw error on HTTP error response', async () => {
        const mockFetch = mock(async () => ({
            ok: false,
            status: 404,
            text: async () => 'Not found',
        })) as unknown as typeof fetch;

        const loggers = {
            logInfo: mock(() => {}),
            logDebug: mock(() => {}),
            logError: mock(() => {}),
        };

        await expect(
            resolveUserByScreenName({
                host: 'x.com',
                csrfToken: 'csrf123',
                username: 'testuser',
                bearerToken: 'Bearer token123',
                endpoint: { id: 'endpoint1', path: 'UserByScreenName' },
                features: {},
                fieldToggles: {},
                fetchImpl: mockFetch,
                loggers,
            }),
        ).rejects.toThrow('User lookup failed (404)');

        expect(loggers.logError).toHaveBeenCalled();
    });

    it('should handle missing rest_id gracefully', async () => {
        const mockFetch = mock(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                data: {
                    user: {
                        result: {
                            __typename: 'User',
                            legacy: { name: 'Test' },
                        },
                    },
                },
            }),
        })) as unknown as typeof fetch;

        const loggers = {
            logInfo: mock(() => {}),
            logDebug: mock(() => {}),
            logError: mock(() => {}),
        };

        const result = await resolveUserByScreenName({
            host: 'x.com',
            csrfToken: 'csrf123',
            username: 'testuser',
            bearerToken: 'Bearer token123',
            endpoint: { id: 'endpoint1', path: 'UserByScreenName' },
            features: {},
            fieldToggles: {},
            fetchImpl: mockFetch,
            loggers,
        });

        expect(result.id).toBe('unknown');
        expect(result.legacy.name).toBe('Test');
    });

    it('should handle missing legacy field', async () => {
        const mockFetch = mock(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                data: {
                    user: {
                        result: {
                            __typename: 'User',
                            rest_id: '789',
                        },
                    },
                },
            }),
        })) as unknown as typeof fetch;

        const loggers = {
            logInfo: mock(() => {}),
            logDebug: mock(() => {}),
            logError: mock(() => {}),
        };

        const result = await resolveUserByScreenName({
            host: 'x.com',
            csrfToken: 'csrf123',
            username: 'testuser',
            bearerToken: 'Bearer token123',
            endpoint: { id: 'endpoint1', path: 'UserByScreenName' },
            features: {},
            fieldToggles: {},
            fetchImpl: mockFetch,
            loggers,
        });

        expect(result.id).toBe('789');
        expect(result.legacy).toEqual({});
    });

    it('should use AbortSignal when provided', async () => {
        const mockFetch = mock(async (_url, init) => {
            expect(init?.signal).toBeDefined();
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    data: {
                        user: {
                            result: {
                                __typename: 'User',
                                rest_id: '123',
                                legacy: {},
                            },
                        },
                    },
                }),
            };
        }) as unknown as typeof fetch;

        const loggers = {
            logInfo: mock(() => {}),
            logDebug: mock(() => {}),
            logError: mock(() => {}),
        };

        const controller = new AbortController();

        await resolveUserByScreenName({
            host: 'x.com',
            csrfToken: 'csrf123',
            username: 'testuser',
            bearerToken: 'Bearer token123',
            endpoint: { id: 'endpoint1', path: 'UserByScreenName' },
            features: {},
            fieldToggles: {},
            signal: controller.signal,
            fetchImpl: mockFetch,
            loggers,
        });

        expect(mockFetch).toHaveBeenCalled();
    });
});
