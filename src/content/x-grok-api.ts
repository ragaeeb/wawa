import { BEARER_TOKEN } from '@/content/constants';
import {
    buildXGrokHistoryUrl,
    DEFAULT_X_GROK_HISTORY_QUERY_ID_CANDIDATES,
    parseXGrokHistoryPage,
} from '@/core/x-grok/history';
import { formatXGrokFilename, parseXGrokConversation } from '@/core/x-grok/parser';
import type { XGrokBulkExportResult, XGrokConversationData, XGrokGraphqlContext } from '@/core/x-grok/types';

const DEFAULT_DELAY_MS = 1_200;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_429_RETRIES = 3;
const DEFAULT_DETAIL_QUERY_ID_CANDIDATES = ['n2bhau0B2DSY6R_bLolgSg', '6QmFg', '9Hyh5D4-WXLnExZkONSkZg'] as const;

type RuntimeLoggers = {
    logInfo: (message: string, data?: unknown) => void;
    logDebug: (message: string, data?: unknown) => void;
    logWarn: (message: string, data?: unknown) => void;
    logError: (message: string, data?: unknown) => void;
};

type RequestContext = {
    context: XGrokGraphqlContext | null;
    csrfToken: string;
    fetchImpl: typeof fetch;
    sleepImpl: (milliseconds: number) => Promise<void>;
    nowImpl: () => number;
    language: string;
    loggers: RuntimeLoggers;
    delayMs?: number;
    timeoutMs?: number;
};

type FetchTextResult =
    | { ok: true; text: string }
    | {
          ok: false;
          status: number;
          message: string;
      };

type ListResult = {
    ids: string[];
    titles: Map<string, string>;
    warnings: string[];
};

type BulkExportInput = {
    context: XGrokGraphqlContext | null;
    csrfToken: string;
    maxItems: number | null;
    fetchImpl?: typeof fetch;
    sleepImpl?: (milliseconds: number) => Promise<void>;
    nowImpl?: () => number;
    language?: string;
    loggers: RuntimeLoggers;
    onDownload: (conversation: XGrokConversationData, filename: string) => void;
    onProgress?: (state: {
        discovered: number;
        attempted: number;
        exported: number;
        failed: number;
        remaining: number;
    }) => void;
};

export const buildXGrokRequestHeaders = (csrfToken: string, language = 'en-US') => ({
    authorization: BEARER_TOKEN,
    'content-type': 'application/json',
    'x-csrf-token': csrfToken,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-language': language,
});

const uniqueStrings = (values: Array<string | null | undefined>) => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        if (typeof value !== 'string') {
            continue;
        }
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        result.push(trimmed);
    }
    return result;
};

const getRetryDelayMs = (response: Response, nowMs: number, attempt: number) => {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
        const numericRetryAfter = Number(retryAfter);
        if (Number.isFinite(numericRetryAfter) && numericRetryAfter > 0) {
            return numericRetryAfter * 1000;
        }
        const parsedDate = Date.parse(retryAfter);
        if (Number.isFinite(parsedDate)) {
            return Math.max(1_000, parsedDate - nowMs);
        }
    }

    const reset = response.headers.get('x-rate-limit-reset');
    if (reset) {
        const resetEpochSeconds = Number(reset);
        if (Number.isFinite(resetEpochSeconds) && resetEpochSeconds > 0) {
            return Math.max(1_000, resetEpochSeconds * 1000 - nowMs + 500);
        }
    }

    return Math.max(1_000, Math.min(30_000, 1_500 * 2 ** attempt));
};

const buildFetchHeaders = (context: RequestContext) => buildXGrokRequestHeaders(context.csrfToken, context.language);

const buildFetchFailureResult = (status: number, message: string) =>
    ({
        ok: false,
        status,
        message,
    }) satisfies FetchTextResult;

const tryHandleRateLimitRetry = async (response: Response, context: RequestContext, attempt: number) => {
    if (response.status !== 429 || attempt >= MAX_429_RETRIES) {
        return false;
    }

    const retryDelayMs = getRetryDelayMs(response, context.nowImpl(), attempt);
    context.loggers.logWarn('x-grok request rate limited; retrying', { url: response.url, attempt, retryDelayMs });
    await context.sleepImpl(retryDelayMs);
    return true;
};

const readSuccessfulResponse = async (response: Response, context: RequestContext) => {
    if ((context.delayMs ?? DEFAULT_DELAY_MS) > 0) {
        await context.sleepImpl(context.delayMs ?? DEFAULT_DELAY_MS);
    }

    return {
        ok: true,
        text: await response.text(),
    } satisfies FetchTextResult;
};

const fetchText = async (url: string, context: RequestContext) => {
    const headers = buildFetchHeaders(context);
    let attempt = 0;

    while (attempt <= MAX_429_RETRIES) {
        const controller = new AbortController();
        const timeoutId = globalThis.setTimeout(() => controller.abort(), context.timeoutMs ?? DEFAULT_TIMEOUT_MS);

        try {
            const response = await context.fetchImpl.call(globalThis, url, {
                credentials: 'include',
                headers,
                signal: controller.signal,
            });

            if (await tryHandleRateLimitRetry(response, context, attempt)) {
                attempt += 1;
                continue;
            }

            if (!response.ok) {
                return buildFetchFailureResult(response.status, response.statusText || 'Request failed');
            }

            return readSuccessfulResponse(response, context);
        } catch (error) {
            return buildFetchFailureResult(0, error instanceof Error ? error.message : String(error));
        } finally {
            globalThis.clearTimeout(timeoutId);
        }
    }

    return buildFetchFailureResult(429, 'Rate limit retries exhausted');
};

const parseJsonSafe = (text: string) => {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

const buildDetailUrl = (queryId: string, conversationId: string, context: XGrokGraphqlContext | null) => {
    const params = new URLSearchParams();
    params.set('variables', JSON.stringify({ restId: conversationId }));
    if (context?.detailFeatures) {
        params.set('features', context.detailFeatures);
    }
    if (context?.detailFieldToggles) {
        params.set('fieldToggles', context.detailFieldToggles);
    }
    return `https://x.com/i/api/graphql/${queryId}/GrokConversationItemsByRestId?${params.toString()}`;
};

const getHistoryQueryCandidates = (context: XGrokGraphqlContext | null) =>
    uniqueStrings([context?.historyQueryId, ...DEFAULT_X_GROK_HISTORY_QUERY_ID_CANDIDATES]);

const fetchHistoryPage = async (
    cursor: string | null,
    selectedHistoryQueryId: string | null,
    input: RequestContext & { maxItems: number | null },
) => {
    const queryCandidates = selectedHistoryQueryId
        ? [selectedHistoryQueryId]
        : getHistoryQueryCandidates(input.context);
    let pageResult: FetchTextResult | null = null;
    let resolvedQueryId = selectedHistoryQueryId;

    for (const queryId of queryCandidates) {
        const result = await fetchText(buildXGrokHistoryUrl(queryId, cursor), input);
        pageResult = result;
        if (result.ok) {
            resolvedQueryId = queryId;
            break;
        }
    }

    return { pageResult, selectedHistoryQueryId: resolvedQueryId };
};

export const listXGrokConversations = async (input: RequestContext & { maxItems: number | null }) => {
    const warnings: string[] = [];
    const ids: string[] = [];
    const titles = new Map<string, string>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let selectedHistoryQueryId: string | null = null;

    while (input.maxItems === null || ids.length < input.maxItems) {
        const fetchResult = await fetchHistoryPage(cursor, selectedHistoryQueryId, input);
        const pageResult = fetchResult.pageResult;
        selectedHistoryQueryId = fetchResult.selectedHistoryQueryId;

        if (!pageResult || !pageResult.ok) {
            warnings.push(
                `X-Grok history request failed: status=${pageResult?.status ?? 0} message=${pageResult?.message ?? 'Unknown error'}`,
            );
            break;
        }

        const page = parseXGrokHistoryPage(parseJsonSafe(pageResult.text));
        if (page.ids.length === 0) {
            break;
        }

        ids.push(...page.ids);
        for (const [conversationId, title] of page.titles) {
            titles.set(conversationId, title);
        }

        if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
            break;
        }
        seenCursors.add(page.nextCursor);
        cursor = page.nextCursor;
    }

    const uniqueIds = uniqueStrings(ids);
    return {
        ids: input.maxItems === null ? uniqueIds : uniqueIds.slice(0, input.maxItems),
        titles,
        warnings,
    } satisfies ListResult;
};

export const fetchXGrokConversationById = async (
    conversationId: string,
    input: RequestContext & { titleCache?: Map<string, string> },
) => {
    const queryCandidates = uniqueStrings([input.context?.detailQueryId, ...DEFAULT_DETAIL_QUERY_ID_CANDIDATES]);
    for (const queryId of queryCandidates) {
        const result = await fetchText(buildDetailUrl(queryId, conversationId, input.context), input);
        if (!result.ok) {
            if (result.status !== 404 && result.status !== 422) {
                input.loggers.logWarn('x-grok detail request failed', {
                    conversationId,
                    queryId,
                    status: result.status,
                    message: result.message,
                });
            }
            continue;
        }

        const parsed = parseXGrokConversation(parseJsonSafe(result.text), {
            conversationId,
            cachedTitle: input.titleCache?.get(conversationId) ?? null,
        });
        if (parsed) {
            return parsed;
        }
    }

    return null;
};

export const runXGrokBulkExport = async (input: BulkExportInput): Promise<XGrokBulkExportResult> => {
    const requestContext: RequestContext = {
        context: input.context,
        csrfToken: input.csrfToken,
        fetchImpl: input.fetchImpl ?? fetch,
        sleepImpl: input.sleepImpl ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
        nowImpl: input.nowImpl ?? Date.now,
        language: input.language ?? navigator.language ?? 'en-US',
        loggers: input.loggers,
    };
    const startedAt = requestContext.nowImpl();
    const listResult = await listXGrokConversations({
        ...requestContext,
        maxItems: input.maxItems,
    });

    if (listResult.ids.length === 0) {
        listResult.warnings.push('No conversations discovered from list endpoint.');
    }

    let attempted = 0;
    let exported = 0;
    let failed = 0;
    input.onProgress?.({
        discovered: listResult.ids.length,
        attempted,
        exported,
        failed,
        remaining: listResult.ids.length,
    });

    for (const conversationId of listResult.ids) {
        attempted += 1;
        const conversation = await fetchXGrokConversationById(conversationId, {
            ...requestContext,
            titleCache: listResult.titles,
        });
        if (!conversation) {
            failed += 1;
            input.onProgress?.({
                discovered: listResult.ids.length,
                attempted,
                exported,
                failed,
                remaining: Math.max(0, listResult.ids.length - attempted),
            });
            continue;
        }

        input.onDownload(conversation, formatXGrokFilename(conversation));
        exported += 1;
        input.onProgress?.({
            discovered: listResult.ids.length,
            attempted,
            exported,
            failed,
            remaining: Math.max(0, listResult.ids.length - attempted),
        });
    }

    return {
        discovered: listResult.ids.length,
        attempted,
        exported,
        failed,
        elapsedMs: requestContext.nowImpl() - startedAt,
        warnings: listResult.warnings,
    };
};
