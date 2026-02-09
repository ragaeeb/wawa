import { describe, expect, it } from 'bun:test';
import type { TweetItem } from '../../types/domain';
import { mergeTweets } from './merge';

describe('resume merge', () => {
    it('should dedupe by id and preserve both previous and new tweets', () => {
        const previous: TweetItem[] = [
            { id: '2', text: 'older', created_at: '2023-01-01 00:00:00' },
            { id: '1', text: 'newer', created_at: '2023-02-01 00:00:00' },
        ];

        const next: TweetItem[] = [
            { id: '1', text: 'newer updated', created_at: '2023-02-01 00:00:00', view_count: 100 },
            { id: '3', text: 'latest', created_at: '2023-03-01 00:00:00' },
        ];

        const result = mergeTweets(next, previous);

        expect(result.tweets.map((item) => item.id)).toEqual(['3', '1', '2']);
        expect(result.mergeInfo).toEqual({
            previous_count: 2,
            new_count: 2,
            duplicates_removed: 1,
            final_count: 3,
        });
    });

    it('should prefer richer duplicate object', () => {
        const previous: TweetItem[] = [{ id: '1', text: 'base', created_at: '2024-01-01 00:00:00' }];
        const next: TweetItem[] = [
            {
                id: '1',
                text: 'base',
                created_at: '2024-01-01 00:00:00',
                favorite_count: 12,
                quote_count: 2,
                conversation_id: 'abc',
            },
        ];

        const result = mergeTweets(next, previous);
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0]?.favorite_count).toBe(12);
    });

    it('should return null mergeInfo when there is no previous payload', () => {
        const next: TweetItem[] = [{ id: '10', text: 'only', created_at: '2024-01-01 00:00:00' }];
        const result = mergeTweets(next, []);

        expect(result.tweets.map((item) => item.id)).toEqual(['10']);
        expect(result.mergeInfo).toBeNull();
    });

    it('should keep both items when ids are missing and text differs', () => {
        const previous: TweetItem[] = [{ created_at: '2024-01-01 00:00:00', text: 'a' }];
        const next: TweetItem[] = [{ created_at: '2024-01-01 00:00:00', text: 'b' }];

        const result = mergeTweets(next, previous);
        expect(result.tweets).toHaveLength(2);
        expect(result.mergeInfo?.duplicates_removed).toBe(0);
    });
});
