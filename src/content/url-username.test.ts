import { describe, expect, it } from 'bun:test';
import { extractUsernameFromLocation } from '@/content/url-username';

describe('extractUsernameFromLocation', () => {
    it('should extract username from profile path', () => {
        const result = extractUsernameFromLocation('/username', '');
        expect(result).toBe('username');
    });

    it('should extract username from profile with trailing slash', () => {
        const result = extractUsernameFromLocation('/username/', '');
        expect(result).toBe('username');
    });

    it('should extract username from profile subpath', () => {
        const result = extractUsernameFromLocation('/username/with_replies', '');
        expect(result).toBe('username');
    });

    it('should extract username with underscores and numbers', () => {
        const result = extractUsernameFromLocation('/user_name_123', '');
        expect(result).toBe('user_name_123');
    });

    it('should extract username from search query with from: operator', () => {
        const result = extractUsernameFromLocation('/search', '?q=from:testuser');
        expect(result).toBe('testuser');
    });

    it('should extract username from search query with mixed case', () => {
        const result = extractUsernameFromLocation('/search', '?q=from:TestUser');
        expect(result).toBe('testuser');
    });

    it('should extract username from complex search query', () => {
        const result = extractUsernameFromLocation('/search', '?q=from:user hello world&src=typed_query');
        expect(result).toBe('user');
    });

    it('should return null for reserved segment "home"', () => {
        const result = extractUsernameFromLocation('/home', '');
        expect(result).toBeNull();
    });

    it('should return null for reserved segment "explore"', () => {
        const result = extractUsernameFromLocation('/explore', '');
        expect(result).toBeNull();
    });

    it('should return null for reserved segment "search"', () => {
        const result = extractUsernameFromLocation('/search', '');
        expect(result).toBeNull();
    });

    it('should return null for reserved segment "notifications"', () => {
        const result = extractUsernameFromLocation('/notifications', '');
        expect(result).toBeNull();
    });

    it('should return null for reserved segment "messages"', () => {
        const result = extractUsernameFromLocation('/messages', '');
        expect(result).toBeNull();
    });

    it('should return null for reserved segment "i"', () => {
        const result = extractUsernameFromLocation('/i/flow/login', '');
        expect(result).toBeNull();
    });

    it('should return null for reserved segment "settings"', () => {
        const result = extractUsernameFromLocation('/settings', '');
        expect(result).toBeNull();
    });

    it('should return null for empty pathname', () => {
        const result = extractUsernameFromLocation('/', '');
        expect(result).toBeNull();
    });

    it('should return null for search without query param', () => {
        const result = extractUsernameFromLocation('/search', '?src=typed_query');
        expect(result).toBeNull();
    });

    it('should return null for search query without from: operator', () => {
        const result = extractUsernameFromLocation('/search', '?q=hello world');
        expect(result).toBeNull();
    });

    it('should return null for invalid pathname format', () => {
        const result = extractUsernameFromLocation('//', '');
        expect(result).toBeNull();
    });

    it('should handle reserved segments case-insensitively', () => {
        const result = extractUsernameFromLocation('/HOME', '');
        expect(result).toBeNull();
    });

    it('should handle all reserved segments', () => {
        const reserved = [
            'home',
            'explore',
            'search',
            'notifications',
            'messages',
            'bookmarks',
            'lists',
            'settings',
            'compose',
            'i',
            'intent',
            'login',
            'logout',
            'signup',
            'tos',
            'privacy',
            'about',
            'help',
            'jobs',
            'download',
        ];

        for (const segment of reserved) {
            const result = extractUsernameFromLocation(`/${segment}`, '');
            expect(result).toBeNull();
        }
    });

    it('should extract username up to 15 characters max', () => {
        const result = extractUsernameFromLocation('/username12345', '');
        expect(result).toBe('username12345');
    });
});
