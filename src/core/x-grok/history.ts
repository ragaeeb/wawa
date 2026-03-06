import type { XGrokHistoryPage } from '@/core/x-grok/types';

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const readString = (record: Record<string, unknown> | null, key: string) => {
    const value = record?.[key];
    return typeof value === 'string' ? value : null;
};

const uniqueStrings = (values: string[]) => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        result.push(trimmed);
    }
    return result;
};

export const DEFAULT_X_GROK_HISTORY_QUERY_ID_CANDIDATES = ['9Hyh5D4-WXLnExZkONSkZg'] as const;

export const buildXGrokHistoryUrl = (queryId: string, cursor: string | null) => {
    const variables = cursor ? { cursor } : {};
    return `https://x.com/i/api/graphql/${queryId}/GrokHistory?variables=${encodeURIComponent(JSON.stringify(variables))}`;
};

export const parseXGrokHistoryPage = (payload: unknown): XGrokHistoryPage => {
    const dataRecord = asRecord(asRecord(payload)?.data);
    const historyRecord = asRecord(dataRecord?.grok_conversation_history);
    const items = Array.isArray(historyRecord?.items) ? historyRecord.items : [];
    const ids: string[] = [];
    const titles = new Map<string, string>();

    for (const item of items) {
        const itemRecord = asRecord(item);
        const conversationRecord = asRecord(itemRecord?.grokConversation);
        const restId = readString(conversationRecord, 'rest_id');
        if (!restId) {
            continue;
        }

        ids.push(restId);
        const title = readString(itemRecord, 'title');
        if (title) {
            titles.set(restId, title);
        }
    }

    const nextCursor =
        readString(historyRecord, 'cursor') ??
        readString(historyRecord, 'next_cursor') ??
        readString(historyRecord, 'nextCursor');

    return {
        ids: uniqueStrings(ids),
        titles,
        nextCursor: nextCursor && nextCursor.length > 0 ? nextCursor : null,
    };
};
