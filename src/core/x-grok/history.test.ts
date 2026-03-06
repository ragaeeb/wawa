import { describe, expect, it } from 'bun:test';
import { buildXGrokHistoryUrl, parseXGrokHistoryPage } from '@/core/x-grok/history';

describe('x-grok history', () => {
    it('should build GrokHistory urls with encoded variables', () => {
        const initial = buildXGrokHistoryUrl('query-id', null);
        const next = buildXGrokHistoryUrl('query-id', 'cursor-1');

        expect(initial).toContain('/query-id/GrokHistory');
        expect(initial).toContain('variables=%7B%7D');
        expect(next).toContain('cursor-1');
    });

    it('should parse ids, titles, and next cursor from history payload', () => {
        const result = parseXGrokHistoryPage({
            data: {
                grok_conversation_history: {
                    cursor: 'next-cursor',
                    items: [
                        {
                            title: 'First Conversation',
                            grokConversation: { rest_id: '111' },
                        },
                        {
                            title: 'Second Conversation',
                            grokConversation: { rest_id: '222' },
                        },
                    ],
                },
            },
        });

        expect(result.ids).toEqual(['111', '222']);
        expect(result.titles.get('111')).toBe('First Conversation');
        expect(result.titles.get('222')).toBe('Second Conversation');
        expect(result.nextCursor).toBe('next-cursor');
    });

    it('should tolerate malformed history payloads', () => {
        const result = parseXGrokHistoryPage({ data: { grok_conversation_history: { items: [{ bad: true }] } } });

        expect(result.ids).toEqual([]);
        expect(result.titles.size).toBe(0);
        expect(result.nextCursor).toBeNull();
    });
});
