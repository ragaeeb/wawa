import { describe, expect, it, mock } from 'bun:test';
import { appendTweetsFromResponseData, normalizeTweetResult } from '@/content/timeline-collector';

describe('normalizeTweetResult', () => {
    it('should return tweet when __typename is Tweet', () => {
        const input = {
            __typename: 'Tweet',
            rest_id: '123',
            legacy: { full_text: 'hello' },
        };

        const result = normalizeTweetResult(input);
        expect(result).toEqual(input);
    });

    it('should unwrap TweetWithVisibilityResults', () => {
        const tweet = {
            __typename: 'Tweet',
            rest_id: '456',
            legacy: { full_text: 'world' },
        };
        const input = {
            __typename: 'TweetWithVisibilityResults',
            tweet,
        };

        const result = normalizeTweetResult(input);
        expect(result).toEqual(tweet);
    });

    it('should return null for null input', () => {
        const result = normalizeTweetResult(null);
        expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
        const result = normalizeTweetResult(undefined);
        expect(result).toBeNull();
    });

    it('should return null for non-object input', () => {
        const result = normalizeTweetResult('string');
        expect(result).toBeNull();
    });

    it('should return null for object without __typename', () => {
        const result = normalizeTweetResult({ id: '123' });
        expect(result).toBeNull();
    });

    it('should return null for unknown __typename', () => {
        const result = normalizeTweetResult({
            __typename: 'TweetUnavailable',
        });
        expect(result).toBeNull();
    });

    it('should return null when TweetWithVisibilityResults has no tweet', () => {
        const result = normalizeTweetResult({
            __typename: 'TweetWithVisibilityResults',
        });
        expect(result).toBeNull();
    });
});

describe('appendTweetsFromResponseData', () => {
    const createLoggers = () => ({
        logInfo: mock(() => {}),
        logDebug: mock(() => {}),
    });

    const buildTimelineResponse = (tweetId: string) => ({
        data: {
            user: {
                result: {
                    timeline_v2: {
                        timeline: {
                            instructions: [
                                {
                                    type: 'TimelineAddEntries',
                                    entries: [
                                        {
                                            entryId: `tweet-${tweetId}`,
                                            content: {
                                                itemContent: {
                                                    tweet_results: {
                                                        result: {
                                                            __typename: 'Tweet',
                                                            rest_id: tweetId,
                                                            core: {
                                                                user_results: {
                                                                    result: {
                                                                        rest_id: 'user-1',
                                                                        core: {
                                                                            screen_name: 'tester',
                                                                            name: 'Tester',
                                                                        },
                                                                    },
                                                                },
                                                            },
                                                            legacy: {
                                                                created_at: 'Wed Oct 10 20:19:24 +0000 2018',
                                                                full_text: `tweet ${tweetId}`,
                                                                entities: {
                                                                    hashtags: [],
                                                                    urls: [],
                                                                    user_mentions: [],
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        },
    });

    it('should append unique extracted tweets and discard duplicate raw responses', () => {
        const destination: Array<Record<string, unknown>> = [];
        const seenIds = new Set<string>();
        const loggers = createLoggers();

        appendTweetsFromResponseData(buildTimelineResponse('1'), 'user-1', seenIds, destination, loggers);
        appendTweetsFromResponseData(buildTimelineResponse('1'), 'user-1', seenIds, destination, loggers);

        expect(destination).toHaveLength(1);
        expect(destination[0]?.id).toBe('1');
    });
});
