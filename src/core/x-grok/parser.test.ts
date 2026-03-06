import { describe, expect, it } from 'bun:test';
import { formatXGrokFilename, parseXGrokConversation, resolveXGrokConversationIdFromUrl } from '@/core/x-grok/parser';
import type { XGrokConversationData } from '@/core/x-grok/types';

const sampleConversation = {
    data: {
        grok_conversation_items_by_rest_id: {
            items: [
                {
                    chat_item_id: 'user-1',
                    sender_type: 'User',
                    created_at_ms: 1_772_658_000_000,
                    message: 'How do I export this conversation?',
                    grok_mode: 'Normal',
                    model: 'grok-4',
                },
                {
                    chat_item_id: 'assistant-1',
                    sender_type: 'Agent',
                    created_at_ms: 1_772_658_001_000,
                    message: 'Use the export button.',
                    grok_mode: 'Normal',
                    model: 'grok-4',
                    deepsearch_headers: [
                        {
                            header: 'Reasoning',
                            steps: [{ final_message: 'I should explain the export flow.' }],
                        },
                    ],
                },
            ],
        },
    },
};

describe('x-grok parser', () => {
    it('should parse x-grok conversation payloads into conversation data', () => {
        const result = parseXGrokConversation(sampleConversation, {
            conversationId: '2029114150362702208',
            cachedTitle: 'Stored Title',
        });

        expect(result?.conversation_id).toBe('2029114150362702208');
        expect(result?.title).toBe('Stored Title');
        expect(result?.default_model_slug).toBe('grok-4');
        expect(result?.mapping['grok-root']?.children).toEqual(['user-1']);
        expect(result?.mapping['assistant-1']?.message?.content.thoughts?.[0]?.content).toBe(
            'I should explain the export flow.',
        );
    });

    it('should derive a title from the first user message when no cached title exists', () => {
        const result = parseXGrokConversation(sampleConversation, {
            conversationId: '2029114150362702208',
        });

        expect(result?.title).toBe('How do I export this conversation?');
    });

    it('should return null for malformed payloads', () => {
        expect(parseXGrokConversation({ data: { grok_conversation_items_by_rest_id: { items: [] } } })).toBeNull();
        expect(parseXGrokConversation({ invalid: true })).toBeNull();
    });

    it('should resolve conversation ids from detail urls', () => {
        expect(
            resolveXGrokConversationIdFromUrl(
                `https://x.com/i/api/graphql/test/GrokConversationItemsByRestId?variables=${encodeURIComponent(JSON.stringify({ restId: '2029114150362702208' }))}`,
            ),
        ).toBe('2029114150362702208');
    });

    it('should resolve conversation ids from relative detail urls', () => {
        expect(
            resolveXGrokConversationIdFromUrl(
                `/i/api/graphql/test/GrokConversationItemsByRestId?variables=${encodeURIComponent(JSON.stringify({ restId: '2029114150362702208' }))}`,
            ),
        ).toBe('2029114150362702208');
    });

    it('should format filenames using the conversation title and timestamp', () => {
        const conversation = parseXGrokConversation(sampleConversation, {
            conversationId: '2029114150362702208',
            cachedTitle: 'Export this chat',
        });

        expect(formatXGrokFilename(conversation!)).toContain('Export_this_chat');
    });

    it('should derive the conversation id from the first item when none is provided', () => {
        const result = parseXGrokConversation(sampleConversation);

        expect(result?.conversation_id).toBe('user-1');
    });

    it('should ignore malformed items and read the model slug from metadata', () => {
        const result = parseXGrokConversation({
            data: {
                grok_conversation_items_by_rest_id: {
                    items: [
                        null,
                        {
                            chat_item_id: 'assistant-2',
                            sender_type: 'Agent',
                            created_at_ms: 1_772_658_002_000,
                            message: 'Metadata model fallback',
                            deepsearch_headers: [{ header: 'Plan', steps: [{}] }],
                            metadata: {
                                model: 'grok-3-mini',
                            },
                        },
                    ],
                },
            },
        });

        expect(result?.mapping['assistant-2']?.message?.content.content_type).toBe('text');
        expect(result?.default_model_slug).toBe('grok-3-mini');
    });

    it('should return null when every conversation item is malformed', () => {
        expect(
            parseXGrokConversation({
                data: {
                    grok_conversation_items_by_rest_id: {
                        items: [null, {}, { sender_type: 'User' }],
                    },
                },
            }),
        ).toBeNull();
    });

    it('should return null when conversation ids cannot be read from the url', () => {
        expect(
            resolveXGrokConversationIdFromUrl(
                'https://x.com/i/api/graphql/test/GrokConversationItemsByRestId?variables=%7Bbad-json',
            ),
        ).toBeNull();
        expect(
            resolveXGrokConversationIdFromUrl('https://x.com/i/api/graphql/test/GrokConversationItemsByRestId'),
        ).toBeNull();
    });

    it('should fall back to the conversation id when formatting blank titles', () => {
        const conversation: XGrokConversationData = {
            title: '   ',
            conversation_id: '2029114150362702208',
            create_time: 1_772_658_000,
            update_time: 1_772_658_001,
            mapping: {
                'grok-root': {
                    id: 'grok-root',
                    message: null,
                    parent: null,
                    children: [],
                },
            },
            current_node: 'grok-root',
            moderation_results: [],
            plugin_ids: null,
            gizmo_id: null,
            gizmo_type: null,
            is_archived: false,
            default_model_slug: 'grok-4',
            safe_urls: [],
            blocked_urls: [],
        };

        expect(formatXGrokFilename(conversation)).toContain('grok_conversation_20291141');
    });
});
