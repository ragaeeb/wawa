import type { XGrokGraphqlContext } from '@/core/x-grok/types';

const DETAIL_PATH_PATTERN = /\/i\/api\/graphql\/([^/]+)\/GrokConversationItemsByRestId$/;
const HISTORY_PATH_PATTERN = /\/i\/api\/graphql\/([^/]+)\/GrokHistory$/;

const parseUrl = (url: string) => {
    try {
        return new URL(url, 'https://x.com');
    } catch {
        return null;
    }
};

const readOptionalString = (value: string | null) => {
    if (!value) {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const readFieldToggles = (url: URL) =>
    readOptionalString(url.searchParams.get('fieldToggles')) ??
    readOptionalString(url.searchParams.get('field_toggles'));

export const isXGrokDetailUrl = (url: string) => {
    const parsed = parseUrl(url);
    return Boolean(parsed?.pathname.match(DETAIL_PATH_PATTERN));
};

export const isXGrokHistoryUrl = (url: string) => {
    const parsed = parseUrl(url);
    return Boolean(parsed?.pathname.match(HISTORY_PATH_PATTERN));
};

const buildDetailContext = (
    existing: XGrokGraphqlContext | null | undefined,
    parsed: URL,
    detailQueryId: string,
    now: number,
) => {
    const nextContext: XGrokGraphqlContext = {
        detailQueryId,
        updatedAt: now,
    };

    if (existing?.historyQueryId) {
        nextContext.historyQueryId = existing.historyQueryId;
    }

    const detailFeatures = readOptionalString(parsed.searchParams.get('features')) ?? existing?.detailFeatures;
    if (detailFeatures) {
        nextContext.detailFeatures = detailFeatures;
    }

    const detailFieldToggles = readFieldToggles(parsed) ?? existing?.detailFieldToggles;
    if (detailFieldToggles) {
        nextContext.detailFieldToggles = detailFieldToggles;
    }

    return nextContext;
};

const buildHistoryContext = (existing: XGrokGraphqlContext | null | undefined, historyQueryId: string, now: number) => {
    const nextContext: XGrokGraphqlContext = {
        historyQueryId,
        updatedAt: now,
    };

    if (existing?.detailQueryId) {
        nextContext.detailQueryId = existing.detailQueryId;
    }

    if (existing?.detailFeatures) {
        nextContext.detailFeatures = existing.detailFeatures;
    }

    if (existing?.detailFieldToggles) {
        nextContext.detailFieldToggles = existing.detailFieldToggles;
    }

    return nextContext;
};

export const captureXGrokGraphqlContext = (
    existing: XGrokGraphqlContext | null | undefined,
    url: string,
    now = Date.now(),
) => {
    const parsed = parseUrl(url);
    if (!parsed) {
        return existing ?? null;
    }

    const detailMatch = parsed.pathname.match(DETAIL_PATH_PATTERN);
    if (detailMatch) {
        const detailQueryId = readOptionalString(detailMatch[1]);
        if (!detailQueryId) {
            return existing ?? null;
        }
        return buildDetailContext(existing, parsed, detailQueryId, now);
    }

    const historyMatch = parsed.pathname.match(HISTORY_PATH_PATTERN);
    if (!historyMatch) {
        return existing ?? null;
    }

    const historyQueryId = readOptionalString(historyMatch[1]);
    if (!historyQueryId) {
        return existing ?? null;
    }

    return buildHistoryContext(existing, historyQueryId, now);
};
