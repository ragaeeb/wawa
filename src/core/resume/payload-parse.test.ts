import { describe, expect, it } from 'bun:test';
import {
    buildResumePayload,
    extractTweetsFromExportData,
    normalizeUsername,
    parseResumeInput,
    parseTweetDate,
} from '@/core/resume/payload';

describe('resume payload parsing', () => {
    it('should accept items array format', () => {
        const tweets = extractTweetsFromExportData({ items: [{ id: '1' }] });
        expect(tweets).toEqual([{ id: '1' }]);
    });

    it('should accept tweets array format', () => {
        const tweets = extractTweetsFromExportData({ tweets: [{ id: '2' }] });
        expect(tweets).toEqual([{ id: '2' }]);
    });

    it('should accept root array format', () => {
        const tweets = extractTweetsFromExportData([{ id: '3' }]);
        expect(tweets).toEqual([{ id: '3' }]);
    });

    it('should extract username from meta payload', () => {
        const parsed = parseResumeInput({
            meta: {
                username: '@ExampleUser',
            },
            items: [{ id: '1' }],
        });

        expect(parsed.username).toBe('exampleuser');
        expect(parsed.tweets).toHaveLength(1);
    });

    it('should read metadata alias when meta key is missing', () => {
        const parsed = parseResumeInput({
            metadata: {
                username: '  @AnotherUser  ',
            },
            tweets: [{ id: '9' }],
        });

        expect(parsed.username).toBe('anotheruser');
        expect(parsed.meta?.username).toBe('  @AnotherUser  ');
    });

    it('should parse custom Wawa date string', () => {
        const parsed = parseTweetDate('2014-01-29 06:15:43');
        expect(parsed?.toISOString()).toBe('2014-01-29T06:15:43.000Z');
    });

    it('should return null for invalid dates', () => {
        expect(parseTweetDate('not-a-date')).toBeNull();
    });

    it('should normalize usernames while building persisted resume payload', () => {
        const payload = buildResumePayload({
            username: ' @MixedCase ',
            tweets: [{ id: 'x1' }],
            meta: null,
            savedAt: 123,
        });

        expect(payload.username).toBe('mixedcase');
        expect(payload.saved_at).toBe(123);
    });

    it('should return null for missing tweet date strings', () => {
        expect(parseTweetDate(undefined)).toBeNull();
    });

    it('should return empty list for non-object export payloads', () => {
        expect(extractTweetsFromExportData('invalid')).toEqual([]);
        expect(extractTweetsFromExportData({ notTweets: true })).toEqual([]);
    });

    it('should return empty resume metadata for non-object input', () => {
        const parsed = parseResumeInput(null);
        expect(parsed.meta).toBeNull();
        expect(parsed.username).toBeNull();
    });

    it('should return null when normalizing non-string usernames', () => {
        expect(normalizeUsername(123)).toBeNull();
    });
});
