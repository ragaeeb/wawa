import { describe, expect, it } from 'bun:test';
import { normalizeTweetResult } from '@/content/timeline-collector';

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
