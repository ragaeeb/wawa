import { describe, expect, it } from 'bun:test';
import { extractTimeline, getTimelineInstructions, normalizeTweetResult } from './extract';

describe('timeline extraction', () => {
    it('should extract tweets from user timeline_v2 structure and cursor', () => {
        const data = {
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
                                                entryId: 'tweet-1',
                                                content: {
                                                    itemContent: {
                                                        tweet_results: {
                                                            result: {
                                                                __typename: 'Tweet',
                                                                rest_id: '1',
                                                                legacy: { full_text: 'hello' },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                            {
                                                entryId: 'cursor-bottom-0',
                                                content: {
                                                    cursorType: 'Bottom',
                                                    value: 'CURSOR_123',
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
        };

        const result = extractTimeline(data, (tweet, type) => ({ id: tweet.rest_id, type }));

        expect(result.items).toEqual([{ id: '1', type: 'Tweet' }]);
        expect(result.nextCursor).toBe('CURSOR_123');
    });

    it('should extract search timeline path', () => {
        const data = {
            data: {
                search_by_raw_query: {
                    search_timeline: {
                        timeline: {
                            instructions: [
                                {
                                    type: 'TimelineAddEntries',
                                    entries: [
                                        {
                                            entryId: 'tweet-2',
                                            content: {
                                                itemContent: {
                                                    tweet_results: {
                                                        result: {
                                                            __typename: 'Tweet',
                                                            rest_id: '2',
                                                            legacy: {
                                                                full_text: 'search tweet',
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
        };

        const result = extractTimeline(data, (tweet) => ({ id: tweet.rest_id }));
        expect(result.items).toEqual([{ id: '2' }]);
        expect(result.nextCursor).toBeNull();
    });

    it('should skip promoted entries and extract conversation rows and retweets', () => {
        const data = {
            data: {
                user: {
                    result: {
                        timeline: {
                            timeline: {
                                instructions: [
                                    {
                                        type: 'TimelineAddEntries',
                                        entries: [
                                            {
                                                entryId: 'promoted-tweet-xyz',
                                                content: {},
                                            },
                                            {
                                                entryId: 'tweet-3',
                                                content: {
                                                    itemContent: {
                                                        tweet_results: {
                                                            result: {
                                                                __typename: 'Tweet',
                                                                rest_id: '3',
                                                                legacy: {
                                                                    retweeted_status_result: {
                                                                        result: { rest_id: 'retw' },
                                                                    },
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                            {
                                                entryId: 'profile-conversation-1',
                                                content: {
                                                    items: [
                                                        {
                                                            item: {
                                                                itemContent: {
                                                                    tweet_results: {
                                                                        result: {
                                                                            __typename: 'Tweet',
                                                                            rest_id: '4',
                                                                        },
                                                                    },
                                                                },
                                                            },
                                                        },
                                                    ],
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
        };

        const result = extractTimeline(data, (tweet, type) => ({ id: tweet.rest_id, type }));
        expect(result.items).toEqual([
            { id: '3', type: 'Retweet' },
            { id: '4', type: 'Tweet' },
        ]);
        expect(result.nextCursor).toBeNull();
    });

    it('should support TimelineReplaceEntry format', () => {
        const data = {
            data: {
                user: {
                    result: {
                        timeline_v2: {
                            timeline: {
                                instructions: [
                                    {
                                        type: 'TimelineReplaceEntry',
                                        entry: {
                                            entryId: 'cursor-bottom-1',
                                            content: {
                                                cursorType: 'Bottom',
                                                value: 'CURSOR_REPLACED',
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        };

        const result = extractTimeline(data, () => null);
        expect(result.items).toEqual([]);
        expect(result.nextCursor).toBe('CURSOR_REPLACED');
    });

    it('should normalize TweetWithVisibilityResults payloads', () => {
        const normalized = normalizeTweetResult({
            __typename: 'TweetWithVisibilityResults',
            tweet: { rest_id: 'visibility-1' },
        });

        expect(normalized?.rest_id).toBe('visibility-1');
    });

    it('should return null when TweetWithVisibilityResults has no tweet payload', () => {
        const normalized = normalizeTweetResult({
            __typename: 'TweetWithVisibilityResults',
        });
        expect(normalized).toBeNull();
    });

    it('should return null for non-object tweet result payloads', () => {
        expect(normalizeTweetResult(null)).toBeNull();
    });

    it('should return empty instructions when timeline payload is invalid', () => {
        expect(getTimelineInstructions(null)).toEqual([]);
        expect(getTimelineInstructions({ data: {} })).toEqual([]);
    });

    it('should return unknown tweet result objects as-is', () => {
        const normalized = normalizeTweetResult({
            __typename: 'CustomTweetWrapper',
            value: 1,
        });
        expect(normalized?.value).toBe(1);
    });
});
