import { describe, expect, it, mock } from 'bun:test';
import {
    buildPartialExportPayload,
    buildResumeLinkFromCollectedTweets,
    createSearchAutoStartContext,
    normalizeResumeUsername,
    processResumeFileUpload,
    sortTweetsByCreatedAtDescending,
} from '@/content/resume-controller';

describe('sortTweetsByCreatedAtDescending', () => {
    const parseTweetDate = (dateString: string | undefined) => {
        if (!dateString) {
            return null;
        }
        return new Date(dateString);
    };

    it('should sort tweets by date descending', () => {
        const tweets = [
            { id: '1', created_at: '2023-01-01T00:00:00Z' },
            { id: '2', created_at: '2023-01-03T00:00:00Z' },
            { id: '3', created_at: '2023-01-02T00:00:00Z' },
        ];

        const result = sortTweetsByCreatedAtDescending(tweets, parseTweetDate);

        expect(result[0].id).toBe('2');
        expect(result[1].id).toBe('3');
        expect(result[2].id).toBe('1');
    });

    it('should not mutate original array', () => {
        const tweets = [
            { id: '1', created_at: '2023-01-01T00:00:00Z' },
            { id: '2', created_at: '2023-01-02T00:00:00Z' },
        ];

        const result = sortTweetsByCreatedAtDescending(tweets, parseTweetDate);

        expect(result).not.toBe(tweets);
        expect(tweets[0].id).toBe('1');
    });

    it('should handle tweets with undefined created_at', () => {
        const tweets = [
            { id: '1', created_at: '2023-01-02T00:00:00Z' },
            { id: '2' },
            { id: '3', created_at: '2023-01-01T00:00:00Z' },
        ];

        const result = sortTweetsByCreatedAtDescending(tweets, parseTweetDate);

        expect(result[0].id).toBe('1');
        expect(result[1].id).toBe('3');
        expect(result[2].id).toBe('2');
    });

    it('should handle empty array', () => {
        const result = sortTweetsByCreatedAtDescending([], parseTweetDate);

        expect(result).toHaveLength(0);
    });

    it('should handle single tweet', () => {
        const tweets = [{ id: '1', created_at: '2023-01-01T00:00:00Z' }];

        const result = sortTweetsByCreatedAtDescending(tweets, parseTweetDate);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('1');
    });

    it('should handle tweets with same date', () => {
        const tweets = [
            { id: '1', created_at: '2023-01-01T00:00:00Z' },
            { id: '2', created_at: '2023-01-01T00:00:00Z' },
        ];

        const result = sortTweetsByCreatedAtDescending(tweets, parseTweetDate);

        expect(result).toHaveLength(2);
    });
});

describe('createSearchAutoStartContext', () => {
    it('should create auto-start context with username', () => {
        const result = createSearchAutoStartContext('testuser');

        expect(result.username).toBe('testuser');
        expect(result.autoStart).toBe(true);
        expect(result.timestamp).toBeDefined();
        expect(typeof result.timestamp).toBe('number');
    });

    it('should include extra properties', () => {
        const result = createSearchAutoStartContext('testuser', {
            resumeMode: true,
            previousTweetsCount: 100,
        });

        expect(result.resumeMode).toBe(true);
        expect(result.previousTweetsCount).toBe(100);
    });

    it('should have timestamp close to current time', () => {
        const before = Date.now();
        const result = createSearchAutoStartContext('user');
        const after = Date.now();

        expect(result.timestamp).toBeGreaterThanOrEqual(before);
        expect(result.timestamp).toBeLessThanOrEqual(after);
    });
});

describe('normalizeResumeUsername', () => {
    it('should remove @ prefix', () => {
        expect(normalizeResumeUsername('@testuser')).toBe('testuser');
    });

    it('should lowercase username', () => {
        expect(normalizeResumeUsername('TestUser')).toBe('testuser');
    });

    it('should remove @ and lowercase', () => {
        expect(normalizeResumeUsername('@TestUser')).toBe('testuser');
    });

    it('should handle username without @', () => {
        expect(normalizeResumeUsername('testuser')).toBe('testuser');
    });

    it('should handle empty string', () => {
        expect(normalizeResumeUsername('')).toBe('unknown');
    });

    it('should handle null', () => {
        expect(normalizeResumeUsername(null)).toBe('unknown');
    });

    it('should handle undefined', () => {
        expect(normalizeResumeUsername(undefined)).toBe('unknown');
    });

    it('should convert number to string', () => {
        expect(normalizeResumeUsername(123)).toBe('123');
    });
});

describe('processResumeFileUpload', () => {
    it('should process file and navigate on confirm', async () => {
        const file = new File(
            [
                JSON.stringify({
                    items: [{ id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' }],
                    meta: { username: 'testuser' },
                }),
            ],
            'export.json',
        );

        const updateButton = mock(() => {});
        const setResumeState = mock(() => {});
        const resetResumeFlowState = mock(() => {});
        const persistResumeState = mock(async () => true);
        const saveAutoStartContext = mock(async () => {});
        const logInfo = mock(() => {});
        const navigateTo = mock(() => {});

        global.confirm = mock(() => true);

        await processResumeFileUpload({
            file,
            fallbackUsername: null,
            updateButton,
            setResumeState,
            resetResumeFlowState,
            persistResumeState,
            saveAutoStartContext,
            logInfo,
            navigateTo,
        });

        expect(updateButton).toHaveBeenCalledWith('📂 Loading file...');
        expect(setResumeState).toHaveBeenCalled();
        expect(persistResumeState).toHaveBeenCalled();
        expect(saveAutoStartContext).toHaveBeenCalled();
        expect(navigateTo).toHaveBeenCalled();
        expect(resetResumeFlowState).not.toHaveBeenCalled();
    });

    it('should reset state on cancel', async () => {
        const file = new File(
            [
                JSON.stringify({
                    items: [{ id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' }],
                }),
            ],
            'export.json',
        );

        const resetResumeFlowState = mock(() => {});
        const navigateTo = mock(() => {});

        global.confirm = mock(() => false);

        await processResumeFileUpload({
            file,
            fallbackUsername: null,
            updateButton: mock(() => {}),
            setResumeState: mock(() => {}),
            resetResumeFlowState,
            persistResumeState: mock(async () => true),
            saveAutoStartContext: mock(async () => {}),
            logInfo: mock(() => {}),
            navigateTo,
        });

        expect(resetResumeFlowState).toHaveBeenCalled();
        expect(navigateTo).not.toHaveBeenCalled();
    });

    it('should throw error when persist fails', async () => {
        const file = new File(
            [
                JSON.stringify({
                    items: [{ id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' }],
                }),
            ],
            'export.json',
        );

        global.confirm = mock(() => true);

        await expect(
            processResumeFileUpload({
                file,
                fallbackUsername: null,
                updateButton: mock(() => {}),
                setResumeState: mock(() => {}),
                resetResumeFlowState: mock(() => {}),
                persistResumeState: mock(async () => false),
                saveAutoStartContext: mock(async () => {}),
                logInfo: mock(() => {}),
                navigateTo: mock(() => {}),
            }),
        ).rejects.toThrow('Could not persist resume payload');
    });
});

describe('buildResumeLinkFromCollectedTweets', () => {
    it('should use previousMetaUsername as fallback', () => {
        const collectedTweets = [{ id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' }];

        const result = buildResumeLinkFromCollectedTweets({
            collectedTweets,
            searchQuery: null,
            fallbackUsername: null,
            previousMetaUsername: 'metauser',
        });

        expect(result.resumeUsername).toBe('metauser');
    });

    it('should prefer fallbackUsername over previousMetaUsername', () => {
        const collectedTweets = [{ id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' }];

        const result = buildResumeLinkFromCollectedTweets({
            collectedTweets,
            searchQuery: null,
            fallbackUsername: 'fallback',
            previousMetaUsername: 'meta',
        });

        expect(result.resumeUsername).toBe('fallback');
    });

    it('should throw error when no tweets collected', () => {
        expect(() =>
            buildResumeLinkFromCollectedTweets({
                collectedTweets: [],
                searchQuery: null,
                fallbackUsername: 'user',
                previousMetaUsername: null,
            }),
        ).toThrow('No tweets collected to resume from');
    });

    it('should throw error when last tweet has invalid date', () => {
        const collectedTweets = [{ id: '1', created_at: 'invalid' }];

        expect(() =>
            buildResumeLinkFromCollectedTweets({
                collectedTweets,
                searchQuery: null,
                fallbackUsername: 'user',
                previousMetaUsername: null,
            }),
        ).toThrow('Could not parse date from last tweet');
    });
});

describe('buildPartialExportPayload', () => {
    it('should build partial export payload with all fields', () => {
        const sortedCollected = [
            { id: '1', text: 'Tweet 1' },
            { id: '2', text: 'Tweet 2' },
        ];

        const mergeInfo = {
            previous_count: 10,
            new_count: 2,
            duplicates_removed: 1,
            final_count: 11,
        };

        const result = buildPartialExportPayload({
            username: 'testuser',
            sortedCollected,
            isResumeMode: true,
            mergeInfo,
        });

        expect(result.meta.username).toBe('testuser');
        expect(result.meta.note).toBe('PARTIAL EXPORT (Rate Limit)');
        expect(result.meta.collected_count).toBe(2);
        expect(result.meta.resume_mode).toBe(true);
        expect(result.meta.merge_info).toEqual(mergeInfo);
        expect(result.items).toEqual(sortedCollected);
    });

    it('should omit resume_mode when false', () => {
        const result = buildPartialExportPayload({
            username: 'testuser',
            sortedCollected: [],
            isResumeMode: false,
            mergeInfo: null,
        });

        expect(result.meta.resume_mode).toBeUndefined();
    });

    it('should omit merge_info when null', () => {
        const result = buildPartialExportPayload({
            username: 'testuser',
            sortedCollected: [],
            isResumeMode: false,
            mergeInfo: null,
        });

        expect(result.meta.merge_info).toBeUndefined();
    });

    it('should handle null username', () => {
        const result = buildPartialExportPayload({
            username: null,
            sortedCollected: [],
            isResumeMode: false,
            mergeInfo: null,
        });

        expect(result.meta.username).toBeNull();
    });

    it('should handle empty collected tweets', () => {
        const result = buildPartialExportPayload({
            username: 'user',
            sortedCollected: [],
            isResumeMode: false,
            mergeInfo: null,
        });

        expect(result.meta.collected_count).toBe(0);
        expect(result.items).toHaveLength(0);
    });
});
