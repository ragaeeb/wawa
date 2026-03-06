import { fetchXGrokConversationById, runXGrokBulkExport } from '@/content/x-grok-api';
import { readStoredXGrokContext, writeStoredXGrokContext } from '@/content/x-grok-storage';
import { captureXGrokGraphqlContext, isXGrokDetailUrl, isXGrokHistoryUrl } from '@/core/x-grok/context';
import { formatXGrokFilename } from '@/core/x-grok/parser';
import type { XGrokConversationData, XGrokGraphqlContext } from '@/core/x-grok/types';
import {
    normalizeXGrokBulkExportLimit,
    type XGrokBulkExportMessage,
    type XGrokBulkExportResponse,
} from './x-grok-contracts';
import { readXGrokConversationIdFromSearch, shouldShowXGrokExportButton } from './x-grok-route';

type RuntimeLoggers = {
    logInfo: (message: string, data?: unknown) => void;
    logDebug: (message: string, data?: unknown) => void;
    logWarn: (message: string, data?: unknown) => void;
    logError: (message: string, data?: unknown) => void;
};

type CreateXGrokFeatureInput = {
    getLocationPathname: () => string;
    getLocationSearch: () => string;
    getCsrfToken: () => string | null;
    getLanguage: () => string;
    downloadJson: (filename: string, payload: unknown) => void;
    loggers: RuntimeLoggers;
    readStoredContext?: () => Promise<XGrokGraphqlContext | null>;
    writeStoredContext?: (context: XGrokGraphqlContext) => Promise<void>;
    fetchConversationById?: typeof fetchXGrokConversationById;
    runBulkExport?: typeof runXGrokBulkExport;
    nowImpl?: () => number;
};

type ExportKind = 'single' | 'bulk';

type XGrokExportMeta = {
    captureSource: 'canonical_api';
    fidelity: 'high';
    completeness: 'complete';
    exportedAt: string;
    exportKind: ExportKind;
    platform: 'x-grok';
    sourceExtension: 'wawa';
};

export type XGrokFeature = {
    shouldShowButton: () => boolean;
    isOnGrokPage: () => boolean;
    observeInterceptedUrl: (url: string) => Promise<void>;
    exportCurrentConversation: () => Promise<{ filename: string; conversation: XGrokConversationData }>;
    handleBulkExportMessage: (message: XGrokBulkExportMessage) => Promise<XGrokBulkExportResponse>;
    getObservedContext: () => XGrokGraphqlContext | null;
};

const ensureJsonFilename = (filename: string) => {
    return filename.toLowerCase().endsWith('.json') ? filename : `${filename}.json`;
};

const buildExportPayload = (conversation: XGrokConversationData, exportKind: ExportKind, exportedAt: string) => {
    const exportMeta: XGrokExportMeta = {
        captureSource: 'canonical_api',
        fidelity: 'high',
        completeness: 'complete',
        exportedAt,
        exportKind,
        platform: 'x-grok',
        sourceExtension: 'wawa',
    };

    return {
        ...conversation,
        __blackiya: {
            exportMeta,
        },
    };
};

const isContextChanged = (current: XGrokGraphqlContext | null, next: XGrokGraphqlContext | null) => {
    if (!current && !next) {
        return false;
    }
    if (!current || !next) {
        return true;
    }

    return (
        current.detailQueryId !== next.detailQueryId ||
        current.historyQueryId !== next.historyQueryId ||
        current.detailFeatures !== next.detailFeatures ||
        current.detailFieldToggles !== next.detailFieldToggles ||
        current.updatedAt !== next.updatedAt
    );
};

const pickNewestContext = (primary: XGrokGraphqlContext | null, secondary: XGrokGraphqlContext | null) => {
    if (!primary) {
        return secondary;
    }
    if (!secondary) {
        return primary;
    }
    return primary.updatedAt >= secondary.updatedAt ? primary : secondary;
};

export const createXGrokFeature = (input: CreateXGrokFeatureInput): XGrokFeature => {
    const readContext = input.readStoredContext ?? readStoredXGrokContext;
    const writeContext = input.writeStoredContext ?? writeStoredXGrokContext;
    const fetchConversation = input.fetchConversationById ?? fetchXGrokConversationById;
    const runBulkExport = input.runBulkExport ?? runXGrokBulkExport;
    const nowImpl = input.nowImpl ?? Date.now;

    let observedContext: XGrokGraphqlContext | null = null;

    const shouldObserveUrl = (url: string) => isXGrokDetailUrl(url) || isXGrokHistoryUrl(url);

    const resolveContext = async () => {
        const stored = await readContext();
        return pickNewestContext(observedContext, stored);
    };

    const observeInterceptedUrl = async (url: string) => {
        if (!shouldObserveUrl(url)) {
            return;
        }

        if (!observedContext) {
            observedContext = await readContext();
        }

        const nextContext = captureXGrokGraphqlContext(observedContext, url, nowImpl());
        if (!nextContext || !isContextChanged(observedContext, nextContext)) {
            return;
        }

        observedContext = nextContext;
        input.loggers.logDebug('Observed x-grok GraphQL context', nextContext);
        await writeContext(nextContext);
    };

    const exportCurrentConversation = async () => {
        const conversationId = readXGrokConversationIdFromSearch(input.getLocationSearch());
        if (!conversationId) {
            throw new Error('No x-grok conversation id found in the current URL.');
        }

        const csrfToken = input.getCsrfToken();
        if (!csrfToken) {
            throw new Error('Could not find the X csrf token for x-grok export.');
        }

        const context = await resolveContext();
        if (!context) {
            input.loggers.logWarn('No observed x-grok GraphQL context found; falling back to default query ids.');
        }

        const conversation = await fetchConversation(conversationId, {
            context,
            csrfToken,
            fetchImpl: fetch,
            sleepImpl: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
            nowImpl,
            language: input.getLanguage(),
            loggers: input.loggers,
        });

        if (!conversation) {
            throw new Error(
                context
                    ? 'Could not fetch the current x-grok conversation.'
                    : 'Could not fetch the current x-grok conversation. Open Grok History or one conversation once, then retry.',
            );
        }

        const filename = ensureJsonFilename(formatXGrokFilename(conversation));
        input.downloadJson(filename, buildExportPayload(conversation, 'single', new Date(nowImpl()).toISOString()));
        return { filename, conversation };
    };

    const handleBulkExportMessage = async (message: XGrokBulkExportMessage): Promise<XGrokBulkExportResponse> => {
        try {
            const csrfToken = input.getCsrfToken();
            if (!csrfToken) {
                throw new Error('Could not find the X csrf token for x-grok export.');
            }

            const context = await resolveContext();
            if (!context) {
                input.loggers.logWarn(
                    'No observed x-grok GraphQL context found; bulk export will use default query ids.',
                );
            }

            const normalizedLimit = normalizeXGrokBulkExportLimit(message.limit);

            const result = await runBulkExport({
                context,
                csrfToken,
                maxItems: normalizedLimit === 0 ? null : normalizedLimit,
                language: input.getLanguage(),
                loggers: input.loggers,
                onDownload: (conversation, filename) => {
                    input.downloadJson(
                        ensureJsonFilename(filename),
                        buildExportPayload(conversation, 'bulk', new Date(nowImpl()).toISOString()),
                    );
                },
                onProgress: (state) => {
                    input.loggers.logInfo('x-grok bulk export progress', state);
                },
            });

            return { ok: true, result };
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            input.loggers.logError('x-grok bulk export failed', { error: messageText });
            return { ok: false, error: messageText };
        }
    };

    return {
        shouldShowButton: () => shouldShowXGrokExportButton(input.getLocationPathname(), input.getLocationSearch()),
        isOnGrokPage: () => input.getLocationPathname().startsWith('/i/grok'),
        observeInterceptedUrl,
        exportCurrentConversation,
        handleBulkExportMessage,
        getObservedContext: () => observedContext,
    };
};
