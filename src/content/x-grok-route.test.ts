import { describe, expect, it } from 'bun:test';
import { isXGrokPage, readXGrokConversationIdFromSearch, shouldShowXGrokExportButton } from '@/content/x-grok-route';

describe('x-grok route', () => {
    it('should require a grok path boundary', () => {
        expect(isXGrokPage('/i/grok')).toBe(true);
        expect(isXGrokPage('/i/grok/conversation')).toBe(true);
        expect(isXGrokPage('/i/grokers')).toBe(false);
    });

    it('should show the export button only on grok conversation routes', () => {
        expect(readXGrokConversationIdFromSearch('?conversation=123')).toBe('123');
        expect(shouldShowXGrokExportButton('/i/grok', '?conversation=123')).toBe(true);
        expect(shouldShowXGrokExportButton('/i/grokers', '?conversation=123')).toBe(false);
        expect(shouldShowXGrokExportButton('/i/grok', '?conversation=')).toBe(false);
    });
});
