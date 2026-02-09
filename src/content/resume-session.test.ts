import { describe, expect, it, mock } from 'bun:test';
import {
    clearInMemoryResumeState,
    clearPersistedResumeState,
    createResumeSessionState,
    getConsolidatedCollectedTweets,
    mergeWithPreviousTweets,
    persistResumeState,
    restoreResumeStateFromStorage,
    setResumeState,
} from '@/content/resume-session';

describe('createResumeSessionState', () => {
    it('should create initial state', () => {
        const state = createResumeSessionState();

        expect(state.previousTweets).toEqual([]);
        expect(state.previousExportMeta).toBeNull();
        expect(state.isResumeMode).toBe(false);
    });

    it('should create new state object each time', () => {
        const state1 = createResumeSessionState();
        const state2 = createResumeSessionState();

        expect(state1).not.toBe(state2);
    });
});

describe('clearInMemoryResumeState', () => {
    it('should clear all resume state fields', () => {
        const state = createResumeSessionState();
        state.previousTweets = [{ id: '1' }];
        state.previousExportMeta = { username: 'test' };
        state.isResumeMode = true;

        clearInMemoryResumeState(state);

        expect(state.previousTweets).toEqual([]);
        expect(state.previousExportMeta).toBeNull();
        expect(state.isResumeMode).toBe(false);
    });
});

describe('setResumeState', () => {
    it('should set resume state with tweets and meta', () => {
        const state = createResumeSessionState();
        const tweets = [{ id: '1' }, { id: '2' }];
        const meta = { username: 'testuser', collected_count: 2 };

        setResumeState(state, tweets, meta);

        expect(state.previousTweets).toEqual(tweets);
        expect(state.previousExportMeta?.username).toBe('testuser');
        expect(state.isResumeMode).toBe(true);
    });

    it('should normalize username by removing @', () => {
        const state = createResumeSessionState();
        const meta = { username: '@TestUser' };

        setResumeState(state, [], meta);

        expect(state.previousExportMeta?.username).toBe('testuser');
    });

    it('should handle null meta', () => {
        const state = createResumeSessionState();

        setResumeState(state, [], null);

        expect(state.previousExportMeta).toBeNull();
        expect(state.isResumeMode).toBe(true);
    });

    it('should preserve other meta fields', () => {
        const state = createResumeSessionState();
        const meta = {
            username: 'test',
            collected_count: 100,
            custom_field: 'value',
        };

        setResumeState(state, [], meta);

        expect(state.previousExportMeta?.collected_count).toBe(100);
        expect(state.previousExportMeta?.custom_field).toBe('value');
    });
});

describe('mergeWithPreviousTweets', () => {
    it('should return new tweets when not in resume mode', () => {
        const state = createResumeSessionState();
        const newTweets = [{ id: '1' }, { id: '2' }];

        const result = mergeWithPreviousTweets(state, newTweets);

        expect(result.tweets).toEqual(newTweets);
        expect(result.mergeInfo).toBeNull();
    });

    it('should return new tweets when no previous tweets', () => {
        const state = createResumeSessionState();
        state.isResumeMode = true;
        const newTweets = [{ id: '1' }];

        const result = mergeWithPreviousTweets(state, newTweets);

        expect(result.tweets).toEqual(newTweets);
        expect(result.mergeInfo).toBeNull();
    });

    it('should merge tweets when in resume mode with previous tweets', () => {
        const state = createResumeSessionState();
        state.isResumeMode = true;
        state.previousTweets = [{ id: '1' }, { id: '2' }];
        const newTweets = [{ id: '3' }, { id: '4' }];

        const result = mergeWithPreviousTweets(state, newTweets);

        expect(result.tweets.length).toBeGreaterThan(0);
        expect(result.mergeInfo).not.toBeNull();
    });

    it('should handle empty new tweets array', () => {
        const state = createResumeSessionState();
        state.isResumeMode = true;
        state.previousTweets = [{ id: '1' }];

        const result = mergeWithPreviousTweets(state, []);

        expect(result.tweets).toBeDefined();
    });

    it('should not mutate input array', () => {
        const state = createResumeSessionState();
        const newTweets = [{ id: '1' }];
        const originalLength = newTweets.length;

        mergeWithPreviousTweets(state, newTweets);

        expect(newTweets).toHaveLength(originalLength);
    });

    it('should handle non-array input gracefully', () => {
        const state = createResumeSessionState();

        const result = mergeWithPreviousTweets(state, null as any);

        expect(result.tweets).toEqual([]);
    });
});

describe('getConsolidatedCollectedTweets', () => {
    it('should return merged tweets', () => {
        const state = createResumeSessionState();
        state.isResumeMode = true;
        state.previousTweets = [{ id: '1' }];
        const currentTweets = [{ id: '2' }];

        const result = getConsolidatedCollectedTweets(state, currentTweets);

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
    });

    it('should return just current tweets when not in resume mode', () => {
        const state = createResumeSessionState();
        const currentTweets = [{ id: '1' }];

        const result = getConsolidatedCollectedTweets(state, currentTweets);

        expect(result).toEqual(currentTweets);
    });
});

describe('clearPersistedResumeState', () => {
    it('should call resumeStorage.clear', async () => {
        const resumeStorage = {
            clear: mock(async () => {}),
        };
        const loggers = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        await clearPersistedResumeState(resumeStorage as any, loggers);

        expect(resumeStorage.clear).toHaveBeenCalled();
    });

    it('should not throw when clear fails', async () => {
        const resumeStorage = {
            clear: mock(async () => {
                throw new Error('Clear failed');
            }),
        };
        const loggers = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        await expect(clearPersistedResumeState(resumeStorage as any, loggers)).resolves.toBeUndefined();

        expect(loggers.logWarn).toHaveBeenCalled();
    });
});

describe('persistResumeState', () => {
    it('should persist resume state successfully', async () => {
        const resumeStorage = {
            persist: mock(async () => true),
        };
        const loggers = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        const result = await persistResumeState({
            resumeStorage: resumeStorage as any,
            username: 'testuser',
            tweets: [{ id: '1' }],
            exportMeta: { username: 'testuser' },
            loggers,
        });

        expect(result).toBe(true);
        expect(resumeStorage.persist).toHaveBeenCalled();
        expect(loggers.logInfo).toHaveBeenCalled();
    });

    it('should normalize username before persisting', async () => {
        const resumeStorage = {
            persist: mock(async (payload) => {
                expect(payload.username).toBe('testuser');
                return true;
            }),
        };
        const loggers = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        await persistResumeState({
            resumeStorage: resumeStorage as any,
            username: '@TestUser',
            tweets: [],
            exportMeta: null,
            loggers,
        });

        expect(resumeStorage.persist).toHaveBeenCalled();
    });

    it('should return false when persist fails', async () => {
        const resumeStorage = {
            persist: mock(async () => false),
        };
        const loggers = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        const result = await persistResumeState({
            resumeStorage: resumeStorage as any,
            username: 'testuser',
            tweets: [],
            exportMeta: null,
            loggers,
        });

        expect(result).toBe(false);
        expect(loggers.logError).toHaveBeenCalled();
    });

    it('should return false and log error on exception', async () => {
        const resumeStorage = {
            persist: mock(async () => {
                throw new Error('Persist error');
            }),
        };
        const loggers = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        const result = await persistResumeState({
            resumeStorage: resumeStorage as any,
            username: 'testuser',
            tweets: [],
            exportMeta: null,
            loggers,
        });

        expect(result).toBe(false);
        expect(loggers.logError).toHaveBeenCalled();
    });

    it('should include saved_at timestamp', async () => {
        const resumeStorage = {
            persist: mock(async (payload) => {
                expect(payload.saved_at).toBeDefined();
                expect(typeof payload.saved_at).toBe('number');
                return true;
            }),
        };
        const loggers = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        await persistResumeState({
            resumeStorage: resumeStorage as any,
            username: 'test',
            tweets: [],
            exportMeta: null,
            loggers,
        });
    });
});

describe('restoreResumeStateFromStorage', () => {
    it('should restore state from storage', async () => {
        const state = createResumeSessionState();
        const resumeStorage = {
            restore: mock(async () => ({
                tweets: [{ id: '1' }, { id: '2' }],
                meta: { username: 'testuser' },
            })),
        };
        const loggers = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        const result = await restoreResumeStateFromStorage({
            state,
            resumeStorage: resumeStorage as any,
            targetUsername: 'testuser',
            loggers,
        });

        expect(result).toBe(true);
        expect(state.previousTweets).toHaveLength(2);
        expect(state.previousExportMeta?.username).toBe('testuser');
        expect(state.isResumeMode).toBe(true);
        expect(loggers.logInfo).toHaveBeenCalled();
    });

    it('should return false when no payload found', async () => {
        const state = createResumeSessionState();
        const resumeStorage = {
            restore: mock(async () => null),
        };
        const loggers = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        const result = await restoreResumeStateFromStorage({
            state,
            resumeStorage: resumeStorage as any,
            targetUsername: 'testuser',
            loggers,
        });

        expect(result).toBe(false);
        expect(state.isResumeMode).toBe(false);
    });

    it('should skip restoration if already in resume mode', async () => {
        const state = createResumeSessionState();
        state.isResumeMode = true;
        state.previousTweets = [{ id: '1' }];

        const resumeStorage = {
            restore: mock(async () => ({ tweets: [], meta: null })),
        };
        const loggers = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        const result = await restoreResumeStateFromStorage({
            state,
            resumeStorage: resumeStorage as any,
            targetUsername: 'testuser',
            loggers,
        });

        expect(result).toBe(true);
        expect(resumeStorage.restore).not.toHaveBeenCalled();
    });

    it('should handle restore errors gracefully', async () => {
        const state = createResumeSessionState();
        const resumeStorage = {
            restore: mock(async () => {
                throw new Error('Restore failed');
            }),
        };
        const loggers = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        const result = await restoreResumeStateFromStorage({
            state,
            resumeStorage: resumeStorage as any,
            targetUsername: 'testuser',
            loggers,
        });

        expect(result).toBe(false);
        expect(loggers.logWarn).toHaveBeenCalled();
    });

    it('should handle payload with null meta', async () => {
        const state = createResumeSessionState();
        const resumeStorage = {
            restore: mock(async () => ({
                tweets: [{ id: '1' }],
                meta: null,
            })),
        };
        const loggers = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        const result = await restoreResumeStateFromStorage({
            state,
            resumeStorage: resumeStorage as any,
            targetUsername: 'testuser',
            loggers,
        });

        expect(result).toBe(true);
        expect(state.previousExportMeta).toBeNull();
    });
});
