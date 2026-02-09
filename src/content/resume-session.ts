import { mergeTweets } from '@/core/resume/merge';
import type { ResumeStorage } from '@/core/resume/storage';
import type { ExportMeta, TweetItem } from '@/types/domain';

type ResumeMetaInput = (Partial<ExportMeta> & Record<string, unknown>) | null;

type RuntimeLoggers = {
    logInfo: (message: string, data?: unknown) => void;
    logWarn: (message: string, data?: unknown) => void;
    logError: (message: string, data?: unknown) => void;
};

export type ResumeSessionState = {
    previousTweets: TweetItem[];
    previousExportMeta: ExportMeta | null;
    isResumeMode: boolean;
};

/**
 * Creates in-memory resume state for the current tab runtime.
 */
export const createResumeSessionState = (): ResumeSessionState => ({
    previousTweets: [],
    previousExportMeta: null,
    isResumeMode: false,
});

/**
 * Clears tab-local resume state without touching persisted storage.
 */
export const clearInMemoryResumeState = (state: ResumeSessionState) => {
    state.previousTweets = [];
    state.previousExportMeta = null;
    state.isResumeMode = false;
};

/**
 * Activates resume mode from parsed file/storage data.
 */
export const setResumeState = (state: ResumeSessionState, tweets: TweetItem[], sourceMeta: ResumeMetaInput) => {
    state.previousTweets = tweets;
    state.previousExportMeta = normalizeExportMeta('', sourceMeta);
    state.isResumeMode = true;
};

/**
 * Merges current collected tweets with previous resume payload when resume mode is active.
 */
export const mergeWithPreviousTweets = (state: ResumeSessionState, newTweets: TweetItem[]) => {
    const freshTweets = Array.isArray(newTweets) ? [...newTweets] : [];

    if (!state.isResumeMode || state.previousTweets.length === 0) {
        return { tweets: freshTweets, mergeInfo: null };
    }

    return mergeTweets(freshTweets, state.previousTweets);
};

/**
 * Convenience helper for call sites that only need merged tweets, not merge metadata.
 */
export const getConsolidatedCollectedTweets = (state: ResumeSessionState, currentTweets: TweetItem[]) => {
    return mergeWithPreviousTweets(state, currentTweets).tweets;
};

const normalizeUsername = (value: string) => {
    return String(value || '')
        .replace(/^@/, '')
        .toLowerCase();
};

const normalizeExportMeta = (fallbackUsername: string, meta: ResumeMetaInput) => {
    if (!meta) {
        return null;
    }

    const username = normalizeUsername(String(meta.username ?? fallbackUsername));
    return {
        ...meta,
        username,
    } as ExportMeta;
};

/**
 * Clears persisted resume payload while swallowing storage failures (non-fatal cleanup).
 */
export const clearPersistedResumeState = async (resumeStorage: ResumeStorage, loggers: RuntimeLoggers) => {
    try {
        await resumeStorage.clear();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        loggers.logWarn('Failed to clear persisted resume payload', { error: message });
    }
};

/**
 * Persists current progress so the next run can resume and merge accurately.
 */
export const persistResumeState = async (input: {
    resumeStorage: ResumeStorage;
    username: string;
    tweets: TweetItem[];
    exportMeta: ResumeMetaInput;
    loggers: RuntimeLoggers;
}) => {
    const normalizedUsername = normalizeUsername(input.username);
    const payload = {
        username: normalizedUsername,
        saved_at: Date.now(),
        meta: normalizeExportMeta(normalizedUsername, input.exportMeta),
        tweets: input.tweets,
    };

    try {
        const persisted = await input.resumeStorage.persist(payload);
        if (persisted) {
            input.loggers.logInfo('Persisted resume payload', {
                tweets: input.tweets.length,
                username: payload.username,
            });
        } else {
            input.loggers.logError('Failed to persist resume payload', {
                error: 'Resume storage rejected payload',
            });
        }
        return persisted;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        input.loggers.logError('Failed to persist resume payload', {
            error: message,
            tweets: input.tweets.length,
            username: payload.username,
        });
        return false;
    }
};

/**
 * Restores persisted resume payload into in-memory state for the active username.
 */
export const restoreResumeStateFromStorage = async (input: {
    state: ResumeSessionState;
    resumeStorage: ResumeStorage;
    targetUsername: string;
    loggers: RuntimeLoggers;
}) => {
    if (input.state.isResumeMode && input.state.previousTweets.length > 0) {
        return true;
    }

    try {
        const payload = await input.resumeStorage.restore(input.targetUsername);
        if (!payload) {
            return false;
        }

        input.state.previousTweets = payload.tweets;
        input.state.previousExportMeta = payload.meta || null;
        input.state.isResumeMode = true;
        input.loggers.logInfo(`Restored ${input.state.previousTweets.length} resume tweets from extension storage`);
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        input.loggers.logWarn('Failed to restore resume payload', { error: message });
        return false;
    }
};
