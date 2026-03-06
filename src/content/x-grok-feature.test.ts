import { describe, expect, it, mock } from 'bun:test';
import { WAWA_X_GROK_BULK_EXPORT_MESSAGE } from '@/content/x-grok-contracts';
import { createXGrokFeature } from '@/content/x-grok-feature';
import type { XGrokConversationData } from '@/core/x-grok/types';

const createLoggers = () => ({
    logInfo: mock(() => {}),
    logDebug: mock(() => {}),
    logWarn: mock(() => {}),
    logError: mock(() => {}),
});

const buildConversation = (conversationId: string): XGrokConversationData => ({
    title: 'Stored Title',
    create_time: 1_772_658_000,
    update_time: 1_772_658_001,
    mapping: {
        'grok-root': {
            id: 'grok-root',
            message: null,
            parent: null,
            children: [`${conversationId}-user`],
        },
        [`${conversationId}-user`]: {
            id: `${conversationId}-user`,
            parent: 'grok-root',
            children: [`${conversationId}-assistant`],
            message: {
                id: `${conversationId}-user`,
                author: { role: 'user', name: 'User', metadata: {} },
                create_time: 1_772_658_000,
                update_time: null,
                content: { content_type: 'text', parts: ['Prompt'] },
                status: 'finished_successfully',
                end_turn: true,
                weight: 1,
                metadata: {},
                recipient: 'all',
                channel: null,
            },
        },
        [`${conversationId}-assistant`]: {
            id: `${conversationId}-assistant`,
            parent: `${conversationId}-user`,
            children: [],
            message: {
                id: `${conversationId}-assistant`,
                author: { role: 'assistant', name: 'Grok', metadata: {} },
                create_time: 1_772_658_001,
                update_time: null,
                content: { content_type: 'text', parts: ['Answer'] },
                status: 'finished_successfully',
                end_turn: true,
                weight: 1,
                metadata: {},
                recipient: 'all',
                channel: null,
            },
        },
    },
    conversation_id: conversationId,
    current_node: `${conversationId}-assistant`,
    moderation_results: [],
    plugin_ids: null,
    gizmo_id: null,
    gizmo_type: null,
    is_archived: false,
    default_model_slug: 'grok-4',
    safe_urls: [],
    blocked_urls: [],
});

describe('x-grok feature', () => {
    it('should capture observed history/detail context and persist it', async () => {
        const writeStoredContext = mock(async () => {});
        const feature = createXGrokFeature({
            getLocationPathname: () => '/i/grok',
            getLocationSearch: () => '',
            getCsrfToken: () => 'csrf',
            getLanguage: () => 'en-US',
            downloadJson: mock(() => {}),
            writeStoredContext,
            loggers: createLoggers(),
            nowImpl: () => 123,
        });

        await feature.observeInterceptedUrl('https://x.com/i/api/graphql/history-id/GrokHistory?variables=%7B%7D');
        await feature.observeInterceptedUrl(
            'https://x.com/i/api/graphql/detail-id/GrokConversationItemsByRestId?variables=%7B%22restId%22%3A%221%22%7D&features=%7B%22responsive_web_grok_annotations_enabled%22%3Atrue%7D&fieldToggles=%7B%22withGrok%22%3Atrue%7D',
        );

        expect(feature.getObservedContext()).toEqual({
            historyQueryId: 'history-id',
            detailQueryId: 'detail-id',
            detailFeatures: '{"responsive_web_grok_annotations_enabled":true}',
            detailFieldToggles: '{"withGrok":true}',
            updatedAt: 123,
        });
        expect(writeStoredContext).toHaveBeenCalledTimes(2);
    });

    it('should export the current conversation using stored context', async () => {
        const downloadJson = mock(() => {});
        const fetchConversationById = mock(async (conversationId: string, input: { context: unknown }) => {
            expect(conversationId).toBe('2029114150362702208');
            expect(input.context).toEqual({
                detailQueryId: 'stored-detail-id',
                historyQueryId: 'stored-history-id',
                updatedAt: 10,
            });
            return buildConversation('2029114150362702208');
        });

        const feature = createXGrokFeature({
            getLocationPathname: () => '/i/grok',
            getLocationSearch: () => '?conversation=2029114150362702208',
            getCsrfToken: () => 'csrf',
            getLanguage: () => 'en-US',
            downloadJson,
            readStoredContext: async () => ({
                detailQueryId: 'stored-detail-id',
                historyQueryId: 'stored-history-id',
                updatedAt: 10,
            }),
            fetchConversationById:
                fetchConversationById as typeof import('@/content/x-grok-api').fetchXGrokConversationById,
            loggers: createLoggers(),
            nowImpl: () => 1000,
        });

        const result = await feature.exportCurrentConversation();

        expect(result.filename.endsWith('.json')).toBeTrue();
        expect(result.filename).toContain('Stored_Title');
        expect(downloadJson).toHaveBeenCalledTimes(1);
        const firstCall = downloadJson.mock.calls[0] as unknown as [string, Record<string, unknown>];
        const [filename, payload] = firstCall;
        expect(filename.endsWith('.json')).toBeTrue();
        expect(filename).toContain('Stored_Title');
        expect(payload.conversation_id).toBe('2029114150362702208');
        expect((payload.__blackiya as { exportMeta?: { platform?: string } }).exportMeta?.platform).toBe('x-grok');
    });

    it('should bulk export and wrap downloads with compatibility metadata', async () => {
        const downloadJson = mock(() => {});
        const runBulkExport = mock(
            async (input: { onDownload: (conversation: XGrokConversationData, filename: string) => void }) => {
                input.onDownload(buildConversation('111'), 'Stored_Title_2026-03-05_00-00-01');
                return {
                    discovered: 1,
                    attempted: 1,
                    exported: 1,
                    failed: 0,
                    elapsedMs: 25,
                    warnings: [],
                };
            },
        );

        const feature = createXGrokFeature({
            getLocationPathname: () => '/home',
            getLocationSearch: () => '',
            getCsrfToken: () => 'csrf',
            getLanguage: () => 'en-US',
            downloadJson,
            readStoredContext: async () => ({
                historyQueryId: 'stored-history-id',
                updatedAt: 10,
            }),
            runBulkExport: runBulkExport as typeof import('@/content/x-grok-api').runXGrokBulkExport,
            loggers: createLoggers(),
            nowImpl: () => 2000,
        });

        const response = await feature.handleBulkExportMessage({
            type: WAWA_X_GROK_BULK_EXPORT_MESSAGE,
            limit: 0,
        });

        expect(response.ok).toBeTrue();
        expect(downloadJson).toHaveBeenCalledTimes(1);
        const firstCall = downloadJson.mock.calls[0] as unknown as [string, Record<string, unknown>];
        const [filename, payload] = firstCall;
        expect(filename.endsWith('.json')).toBeTrue();
        expect(filename).toContain('Stored_Title');
        expect((payload.__blackiya as { exportMeta?: { exportKind?: string } }).exportMeta?.exportKind).toBe('bulk');
    });
});
