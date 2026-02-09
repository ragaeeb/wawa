import { describe, expect, it } from 'bun:test';
import {
    applyUntilToQuery,
    buildResumeFileConfirmation,
    buildResumeSearchUrl,
    buildResumeUrl,
    parseResumeImportData,
    resolveUntilDateFromTweetDate,
} from '@/content/resume-flow';

describe('parseResumeImportData', () => {
    it('should parse resume data with items array', () => {
        const data = {
            items: [
                { id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' },
                { id: '2', created_at: 'Wed Mar 16 10:00:00 +0000 2023' },
            ],
            meta: {
                username: 'testuser',
            },
        };

        const result = parseResumeImportData(data, null);

        expect(result.tweets).toHaveLength(2);
        expect(result.username).toBe('testuser');
        expect(result.untilDate).toBe('2023-03-16');
        expect(result.sourceMeta?.username).toBe('testuser');
    });

    it('should parse resume data with tweets array', () => {
        const data = {
            tweets: [{ id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' }],
        };

        const result = parseResumeImportData(data, 'fallback');

        expect(result.tweets).toHaveLength(1);
        expect(result.username).toBe('fallback');
    });

    it('should sort tweets in descending order by date', () => {
        const data = {
            items: [
                { id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' },
                { id: '2', created_at: 'Wed Mar 17 10:00:00 +0000 2023' },
                { id: '3', created_at: 'Wed Mar 16 10:00:00 +0000 2023' },
            ],
        };

        const result = parseResumeImportData(data, null);

        expect(result.tweets[0].id).toBe('2'); // newest first
        expect(result.tweets[1].id).toBe('3');
        expect(result.tweets[2].id).toBe('1'); // oldest last
    });

    it('should compute untilDate as next day after oldest tweet', () => {
        const data = {
            items: [
                { id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' },
                { id: '2', created_at: 'Wed Mar 14 10:00:00 +0000 2023' },
            ],
        };

        const result = parseResumeImportData(data, null);

        expect(result.untilDate).toBe('2023-03-15'); // day after March 14
        expect(result.oldestTweet.id).toBe('2');
    });

    it('should use username from metadata field', () => {
        const data = {
            items: [{ id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' }],
            metadata: {
                username: 'from_metadata',
            },
        };

        const result = parseResumeImportData(data, null);

        expect(result.username).toBe('from_metadata');
    });

    it('should prefer meta.username over metadata.username', () => {
        const data = {
            items: [{ id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' }],
            meta: {
                username: 'from_meta',
            },
            metadata: {
                username: 'from_metadata',
            },
        };

        const result = parseResumeImportData(data, null);

        expect(result.username).toBe('from_meta');
    });

    it('should normalize username by removing @ and lowercasing', () => {
        const data = {
            items: [{ id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' }],
            meta: {
                username: '@UserName',
            },
        };

        const result = parseResumeImportData(data, null);

        expect(result.username).toBe('username');
    });

    it('should use fallback username when no username in data', () => {
        const data = {
            items: [{ id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' }],
        };

        const result = parseResumeImportData(data, 'fallback_user');

        expect(result.username).toBe('fallback_user');
    });

    it('should default to "unknown" when no username available', () => {
        const data = {
            items: [{ id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' }],
        };

        const result = parseResumeImportData(data, null);

        expect(result.username).toBe('unknown');
    });

    it('should throw error when no tweets found', () => {
        expect(() => parseResumeImportData({ items: [] }, null)).toThrow('No tweets found in file');
        expect(() => parseResumeImportData({}, null)).toThrow('No tweets found in file');
        expect(() => parseResumeImportData(null, null)).toThrow('No tweets found in file');
    });

    it('should throw error when oldest tweet has invalid date', () => {
        const data = {
            items: [{ id: '1', created_at: 'invalid date' }],
        };

        expect(() => parseResumeImportData(data, null)).toThrow('Could not parse date from oldest tweet');
    });

    it('should throw error when oldest tweet has no date', () => {
        const data = {
            items: [{ id: '1' }],
        };

        expect(() => parseResumeImportData(data, null)).toThrow('Could not parse date from oldest tweet');
    });

    it('should preserve sourceMeta structure', () => {
        const data = {
            items: [{ id: '1', created_at: 'Wed Mar 15 10:00:00 +0000 2023' }],
            meta: {
                username: 'test',
                collected_count: 100,
                custom_field: 'value',
            },
        };

        const result = parseResumeImportData(data, null);

        expect(result.sourceMeta?.collected_count).toBe(100);
        expect(result.sourceMeta?.custom_field).toBe('value');
    });
});

describe('buildResumeUrl', () => {
    it('should build resume URL with username and until date', () => {
        const url = buildResumeUrl('testuser', '2023-03-15');

        expect(url).toBe('https://x.com/search?q=from:testuser until:2023-03-15&src=typed_query&f=live&wawa_resume=1');
    });

    it('should handle different usernames', () => {
        const url = buildResumeUrl('another_user', '2024-01-01');

        expect(url).toContain('from:another_user');
        expect(url).toContain('until:2024-01-01');
    });

    it('should always include resume marker', () => {
        const url = buildResumeUrl('user', '2023-01-01');

        expect(url).toContain('wawa_resume=1');
    });

    it('should include live filter', () => {
        const url = buildResumeUrl('user', '2023-01-01');

        expect(url).toContain('f=live');
    });
});

describe('buildResumeFileConfirmation', () => {
    it('should build confirmation message with all details', () => {
        const details = {
            tweets: new Array(150),
            oldestTweet: { created_at: 'Wed Mar 15 10:00:00 +0000 2023' },
            untilDate: '2023-03-16',
            username: 'testuser',
            sourceMeta: null,
        };

        const message = buildResumeFileConfirmation(details);

        expect(message).toContain('Resume from File');
        expect(message).toContain('150 tweets');
        expect(message).toContain('Wed Mar 15 10:00:00 +0000 2023');
        expect(message).toContain('2023-03-16');
    });

    it('should include merge instruction', () => {
        const details = {
            tweets: [],
            oldestTweet: { created_at: 'Wed Mar 15 10:00:00 +0000 2023' },
            untilDate: '2023-03-16',
            username: 'test',
            sourceMeta: null,
        };

        const message = buildResumeFileConfirmation(details);

        expect(message).toContain('New tweets will be merged');
    });
});

describe('resolveUntilDateFromTweetDate', () => {
    it('should return next day from tweet date', () => {
        const result = resolveUntilDateFromTweetDate('Wed Mar 15 10:00:00 +0000 2023');

        expect(result).toBe('2023-03-16');
    });

    it('should handle end of month', () => {
        const result = resolveUntilDateFromTweetDate('Tue Jan 31 10:00:00 +0000 2023');

        expect(result).toBe('2023-02-01');
    });

    it('should handle end of year', () => {
        const result = resolveUntilDateFromTweetDate('Sat Dec 31 23:59:59 +0000 2022');

        expect(result).toBe('2023-01-01');
    });

    it('should return null for invalid date', () => {
        const result = resolveUntilDateFromTweetDate('invalid date');

        expect(result).toBeNull();
    });

    it('should return null for undefined', () => {
        const result = resolveUntilDateFromTweetDate(undefined);

        expect(result).toBeNull();
    });

    it('should handle leap year', () => {
        const result = resolveUntilDateFromTweetDate('Wed Feb 28 10:00:00 +0000 2024');

        expect(result).toBe('2024-02-29');
    });
});

describe('applyUntilToQuery', () => {
    it('should add until clause when not present', () => {
        const result = applyUntilToQuery('from:testuser', '2023-03-15');

        expect(result).toBe('from:testuser until:2023-03-15');
    });

    it('should replace existing until clause', () => {
        const result = applyUntilToQuery('from:user until:2023-01-01', '2023-03-15');

        expect(result).toBe('from:user until:2023-03-15');
    });

    it('should replace until clause case-insensitively', () => {
        const result = applyUntilToQuery('from:user UNTIL:2023-01-01', '2023-03-15');

        expect(result).toBe('from:user until:2023-03-15');
    });

    it('should handle query with multiple clauses', () => {
        const result = applyUntilToQuery('from:user lang:en until:2023-01-01', '2023-03-15');

        expect(result).toBe('from:user lang:en until:2023-03-15');
    });

    it('should handle empty query', () => {
        const result = applyUntilToQuery('', '2023-03-15');

        expect(result).toBe('until:2023-03-15');
    });

    it('should preserve other query operators', () => {
        const result = applyUntilToQuery('from:user filter:replies min_faves:10', '2023-03-15');

        expect(result).toBe('from:user filter:replies min_faves:10 until:2023-03-15');
    });
});

describe('buildResumeSearchUrl', () => {
    it('should build search URL with encoded query', () => {
        const url = buildResumeSearchUrl('from:testuser until:2023-03-15');

        expect(url).toContain('https://x.com/search?q=');
        expect(url).toContain('from%3Atestuser');
        expect(url).toContain('until%3A2023-03-15');
    });

    it('should include resume marker', () => {
        const url = buildResumeSearchUrl('from:user');

        expect(url).toContain('wawa_resume=1');
    });

    it('should include live filter', () => {
        const url = buildResumeSearchUrl('from:user');

        expect(url).toContain('f=live');
    });

    it('should include typed_query source', () => {
        const url = buildResumeSearchUrl('from:user');

        expect(url).toContain('src=typed_query');
    });

    it('should properly encode spaces', () => {
        const url = buildResumeSearchUrl('hello world');

        expect(url).toContain('hello%20world');
    });

    it('should handle complex queries', () => {
        const url = buildResumeSearchUrl('from:user lang:en filter:replies');

        expect(url).toContain('from%3Auser');
        expect(url).toContain('lang%3Aen');
        expect(url).toContain('filter%3Areplies');
    });
});
