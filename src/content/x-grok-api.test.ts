import { describe, expect, it, mock } from 'bun:test';
import { fetchXGrokConversationById, listXGrokConversations, runXGrokBulkExport } from '@/content/x-grok-api';

const createLoggers = () => ({
    logInfo: mock(() => {}),
    logDebug: mock(() => {}),
    logWarn: mock(() => {}),
    logError: mock(() => {}),
});

const buildHistoryPayload = (ids: string[], cursor: string | null = null) => ({
    data: {
        grok_conversation_history: {
            cursor,
            items: ids.map((id, index) => ({
                title: `Conversation ${index + 1}`,
                grokConversation: { rest_id: id },
            })),
        },
    },
});

const buildConversationPayload = (conversationId: string) => ({
    data: {
        grok_conversation_items_by_rest_id: {
            items: [
                {
                    chat_item_id: `${conversationId}-user`,
                    sender_type: 'User',
                    created_at_ms: 1_772_658_000_000,
                    message: `Prompt ${conversationId}`,
                    model: 'grok-4',
                },
                {
                    chat_item_id: `${conversationId}-assistant`,
                    sender_type: 'Agent',
                    created_at_ms: 1_772_658_001_000,
                    message: `Answer ${conversationId}`,
                    model: 'grok-4',
                },
            ],
        },
    },
});

describe('x-grok api', () => {
    it('should reuse stored history context and paginate conversation discovery', async () => {
        const fetchImpl = mock(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/stored-history-id/GrokHistory') && url.includes('cursor%22%3A%22cursor-1')) {
                return new Response(JSON.stringify(buildHistoryPayload(['333'], null)), { status: 200 });
            }
            if (url.includes('/stored-history-id/GrokHistory')) {
                return new Response(JSON.stringify(buildHistoryPayload(['111', '222'], 'cursor-1')), { status: 200 });
            }
            return new Response('', { status: 404 });
        }) as unknown as typeof fetch;

        const result = await listXGrokConversations({
            context: {
                historyQueryId: 'stored-history-id',
                updatedAt: 10,
            },
            csrfToken: 'csrf',
            fetchImpl,
            sleepImpl: async () => {},
            nowImpl: () => 100,
            language: 'en-US',
            loggers: createLoggers(),
            maxItems: null,
        });

        expect(result.ids).toEqual(['111', '222', '333']);
        expect(result.titles.get('111')).toBe('Conversation 1');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('should fetch conversation detail with observed query id and features', async () => {
        const fetchImpl = mock(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (!url.includes('/observed-detail-id/GrokConversationItemsByRestId')) {
                return new Response('', { status: 404 });
            }
            expect(url).toContain('features=');
            expect(url).toContain('fieldToggles=');
            return new Response(JSON.stringify(buildConversationPayload('2029114150362702208')), { status: 200 });
        }) as unknown as typeof fetch;

        const result = await fetchXGrokConversationById('2029114150362702208', {
            context: {
                detailQueryId: 'observed-detail-id',
                detailFeatures: '{"responsive_web_grok_annotations_enabled":true}',
                detailFieldToggles: '{"withGrok":true}',
                updatedAt: 10,
            },
            csrfToken: 'csrf',
            fetchImpl,
            sleepImpl: async () => {},
            nowImpl: () => 100,
            language: 'en-US',
            loggers: createLoggers(),
            titleCache: new Map([['2029114150362702208', 'Stored Title']]),
        });

        expect(result?.conversation_id).toBe('2029114150362702208');
        expect(result?.title).toBe('Stored Title');
    });

    it('should retry rate-limited requests before succeeding', async () => {
        let attempts = 0;
        const fetchImpl = mock(async () => {
            attempts += 1;
            if (attempts === 1) {
                return new Response('', {
                    status: 429,
                    headers: {
                        'retry-after': '0',
                    },
                });
            }
            return new Response(JSON.stringify(buildConversationPayload('2029114150362702208')), { status: 200 });
        }) as unknown as typeof fetch;

        const result = await fetchXGrokConversationById('2029114150362702208', {
            context: {
                detailQueryId: 'observed-detail-id',
                updatedAt: 10,
            },
            csrfToken: 'csrf',
            fetchImpl,
            sleepImpl: async () => {},
            nowImpl: () => 100,
            language: 'en-US',
            loggers: createLoggers(),
        });

        expect(result?.conversation_id).toBe('2029114150362702208');
        expect(attempts).toBe(2);
    });

    it('should invoke fetch with the global receiver to avoid illegal invocation', async () => {
        const fetchImpl = mock(function (this: unknown, input: RequestInfo | URL) {
            expect(this).toBe(globalThis);
            const url = String(input);
            if (!url.includes('/stored-history-id/GrokHistory')) {
                return Promise.resolve(new Response('', { status: 404 }));
            }
            return Promise.resolve(new Response(JSON.stringify(buildHistoryPayload(['111'])), { status: 200 }));
        }) as unknown as typeof fetch;

        const result = await listXGrokConversations({
            context: {
                historyQueryId: 'stored-history-id',
                updatedAt: 10,
            },
            csrfToken: 'csrf',
            fetchImpl,
            sleepImpl: async () => {},
            nowImpl: () => 100,
            language: 'en-US',
            loggers: createLoggers(),
            maxItems: null,
        });

        expect(result.ids).toEqual(['111']);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('should export multiple conversations and surface failures', async () => {
        const downloads: string[] = [];
        const fetchImpl = mock(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/stored-history-id/GrokHistory')) {
                return new Response(JSON.stringify(buildHistoryPayload(['111', '222'])), { status: 200 });
            }
            if (url.includes('restId%22%3A%22111%22') || url.includes('"restId":"111"')) {
                return new Response(JSON.stringify(buildConversationPayload('111')), { status: 200 });
            }
            if (url.includes('restId%22%3A%22222%22') || url.includes('"restId":"222"')) {
                return new Response('', { status: 404 });
            }
            return new Response('', { status: 404 });
        }) as unknown as typeof fetch;

        const result = await runXGrokBulkExport({
            context: {
                historyQueryId: 'stored-history-id',
                detailQueryId: 'observed-detail-id',
                updatedAt: 10,
            },
            csrfToken: 'csrf',
            maxItems: null,
            fetchImpl,
            loggers: createLoggers(),
            onDownload: (_conversation, filename) => {
                downloads.push(filename);
            },
        });

        expect(result.discovered).toBe(2);
        expect(result.exported).toBe(1);
        expect(result.failed).toBe(1);
        expect(downloads).toHaveLength(1);
    });

    it('should continue when one conversation download handler throws', async () => {
        const downloads: string[] = [];
        const fetchImpl = mock(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/stored-history-id/GrokHistory')) {
                return new Response(JSON.stringify(buildHistoryPayload(['111', '222'])), { status: 200 });
            }
            if (url.includes('restId%22%3A%22111%22') || url.includes('"restId":"111"')) {
                return new Response(JSON.stringify(buildConversationPayload('111')), { status: 200 });
            }
            if (url.includes('restId%22%3A%22222%22') || url.includes('"restId":"222"')) {
                return new Response(JSON.stringify(buildConversationPayload('222')), { status: 200 });
            }
            return new Response('', { status: 404 });
        }) as unknown as typeof fetch;

        const result = await runXGrokBulkExport({
            context: {
                historyQueryId: 'stored-history-id',
                detailQueryId: 'observed-detail-id',
                updatedAt: 10,
            },
            csrfToken: 'csrf',
            maxItems: null,
            fetchImpl,
            loggers: createLoggers(),
            onDownload: (conversation, filename) => {
                if (conversation.conversation_id === '111') {
                    throw new Error('disk full');
                }
                downloads.push(filename);
            },
        });

        expect(result.discovered).toBe(2);
        expect(result.exported).toBe(1);
        expect(result.failed).toBe(1);
        expect(result.warnings).toContain('X-Grok export failed for 111: disk full');
        expect(downloads).toHaveLength(1);
        expect(downloads[0]).toContain('Conversation_2');
    });
});
