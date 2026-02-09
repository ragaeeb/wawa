import { buildConsolidatedMeta } from '@/core/export/meta';
import type { ExportMeta } from '@/types/domain';

type RuntimeLogger = {
    logInfo: (message: string, data?: unknown) => void;
    logWarn: (message: string, data?: unknown) => void;
};

type RuntimeErrorLogger = RuntimeLogger & {
    logError: (message: string, data?: unknown) => void;
};

type ExportUser = {
    id: string;
    name?: string;
    legacy?: Record<string, any>;
};

type MergeInfo = {
    previous_count: number;
    new_count: number;
    duplicates_removed: number;
    final_count: number;
} | null;

type ResolveSearchQueryInput = {
    username: string;
    getCsrfToken: () => string | null;
    getUserByScreenName: (csrfToken: string, username: string) => Promise<ExportUser>;
    loggers: RuntimeLogger;
};

type ResolveUserForExportInput = {
    username: string;
    getCsrfToken: () => string | null;
    getUserByScreenName: (csrfToken: string, username: string) => Promise<ExportUser>;
    updateButton: (text: string) => void;
    loggers: RuntimeErrorLogger;
};

type ResolveUserIdInput = {
    username: string;
    userId: string;
    user: ExportUser;
    collected: Array<{ author?: { id?: string; username?: string; name?: string } }>;
    onResolved: (resolvedUserId: string) => void;
    logInfo: (message: string, data?: unknown) => void;
};

type CreateExportPayloadInput = {
    username: string;
    userId: string;
    user: ExportUser;
    startedAt: string;
    totalTweetsReported: number;
    collectedCount: number;
    previousMeta: ExportMeta | null;
    isResumeMode: boolean;
    scrollResponsesCaptured: number;
    mergeInfo: MergeInfo;
    finalTweets: unknown[];
};

/**
 * Builds a live-search URL from a raw X query expression.
 */
export const createSearchUrl = (query: string) => {
    return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
};

/**
 * Builds profile export query and opportunistically adds `since`/`until` bounds from account creation date.
 */
export const resolveSearchQueryForProfile = async ({
    username,
    getCsrfToken,
    getUserByScreenName,
    loggers,
}: ResolveSearchQueryInput) => {
    let query = `from:${username}`;

    try {
        const csrfToken = getCsrfToken();
        if (!csrfToken) {
            return query;
        }

        const user = await getUserByScreenName(csrfToken, username);
        const createdAt = user?.legacy?.created_at;
        if (!createdAt) {
            return query;
        }

        const createdDate = new Date(createdAt);
        const since = createdDate.toISOString().slice(0, 10);
        const untilDate = new Date();
        untilDate.setMonth(untilDate.getMonth() + 1);
        const until = untilDate.toISOString().slice(0, 10);

        query += ` since:${since} until:${until}`;
        loggers.logInfo('Added date bounds to search', { since, until });
        return query;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        loggers.logWarn('Could not resolve specific dates for search', { error: message });
        return query;
    }
};

/**
 * Extracts `from:<username>` from query, falling back to route-derived username.
 */
export const extractSearchUser = (query: string | null, fallbackUsername: string) => {
    if (!query) {
        return fallbackUsername;
    }

    const match = query.match(/from:([A-Za-z0-9_]+)/i);
    return match?.[1] ?? fallbackUsername;
};

const createUnknownUser = () => ({
    id: 'unknown',
    legacy: { statuses_count: 0 },
});

/**
 * Resolves user metadata needed for export.
 * Falls back to a minimal placeholder when lookup fails so export can continue.
 */
export const resolveUserForExport = async ({
    username,
    getCsrfToken,
    getUserByScreenName,
    updateButton,
    loggers,
}: ResolveUserForExportInput) => {
    updateButton('🔍 Looking up user...');

    const csrfToken = getCsrfToken();
    if (!csrfToken) {
        throw new Error('Could not find CSRF token.');
    }

    let user: ExportUser = createUnknownUser();
    try {
        user = await getUserByScreenName(csrfToken, username);
    } catch {
        loggers.logWarn('Could not resolve user ID, continuing anyway');
    }

    return user;
};

/**
 * Logs whether current timeline scope is Posts or Replies.
 */
export const logTimelineScope = (pathname: string, logInfo: (message: string, data?: unknown) => void) => {
    if (pathname.includes('/with_replies')) {
        logInfo("Note: Exporting from 'Replies' tab. This will include your replies to others.");
        return;
    }

    logInfo("Note: Exporting from 'Posts' tab. This usually excludes your replies to others.");
};

/**
 * Backfills unknown user id from collected tweets and syncs resolved fields to local user object.
 */
export const resolveUserIdFromCollected = ({
    username,
    userId,
    user,
    collected,
    onResolved,
    logInfo,
}: ResolveUserIdInput) => {
    if (userId !== 'unknown' || collected.length === 0 || !username) {
        return userId;
    }

    const match = collected.find((tweet) => tweet.author?.username?.toLowerCase() === username.toLowerCase());
    if (!match?.author?.id) {
        return userId;
    }

    const resolvedUserId = match.author.id;
    onResolved(resolvedUserId);
    logInfo(`Resolved User ID from captured data: ${resolvedUserId}`);

    if (user.id === 'unknown') {
        user.id = resolvedUserId;
        user.legacy ??= {};

        const authorName = match.author.name;
        if (authorName) {
            user.name = authorName;
            user.legacy.name = authorName;
        }

        const authorUsername = match.author.username;
        if (authorUsername) {
            user.legacy.screen_name = authorUsername;
        }
    }

    return resolvedUserId;
};

/**
 * Builds final export JSON payload with consolidated metadata.
 */
export const createExportPayload = ({
    username,
    userId,
    user,
    startedAt,
    totalTweetsReported,
    collectedCount,
    previousMeta,
    isResumeMode,
    scrollResponsesCaptured,
    mergeInfo,
    finalTweets,
}: CreateExportPayloadInput) => {
    const completedAt = new Date().toISOString();
    const consolidatedMeta = buildConsolidatedMeta({
        username,
        userId,
        name: user.legacy?.name || username,
        startedAt,
        completedAt,
        newCollectedCount: collectedCount,
        previousCollectedCount: mergeInfo ? mergeInfo.previous_count : 0,
        reportedCountCurrent:
            Number.isFinite(totalTweetsReported) && totalTweetsReported > 0 ? totalTweetsReported : null,
        previousMeta,
        collectionMethod: isResumeMode ? 'scroll-interception-resumed' : 'scroll-interception',
        scrollResponsesCapturedCurrent: scrollResponsesCaptured,
        mergeInfo,
    });

    return {
        meta: consolidatedMeta,
        items: finalTweets,
    };
};
