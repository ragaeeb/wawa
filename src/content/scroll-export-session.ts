import { createExportPayload, logTimelineScope, resolveUserIdFromCollected } from '@/content/export-flow';
import { sortTweetsByCreatedAtDescending } from '@/content/resume-controller';
import type { ResumeSessionState } from '@/content/resume-session';
import type { MergeInfo } from '@/types/domain';

type AnyRecord = Record<string, any>;
type ExportUser = {
    id: string;
    name?: string;
    legacy?: Record<string, any>;
};

type RunScrollExportSessionInput = {
    username: string;
    userId: string;
    user: ExportUser;
    pathname: string;
    resumeSession: ResumeSessionState;
    getAbortSignal: () => AbortSignal | null;
    setCurrentExportUserId: (userId: string | null) => void;
    resetRunState: () => void;
    startFetchInterception: () => Promise<void>;
    scrollToLoadMore: (maxScrolls: number) => Promise<void>;
    updateButton: (text: string) => void;
    extractTweetsFromInterceptedResponses: (userId: string) => AnyRecord[];
    parseTweetDate: (dateString: string | undefined) => Date | null;
    mergeWithPreviousTweets: (tweets: AnyRecord[]) => { tweets: AnyRecord[]; mergeInfo: MergeInfo | null };
    downloadFile: (filename: string, content: string, mime: string) => void;
    getCapturedResponsesCount: () => number;
    clearResumeState: () => Promise<void>;
    completeExportUi: (count: number) => void;
    stopFetchInterception: () => void;
    clearInterceptedResponses: () => void;
    finalizeRuntimeState: () => void;
    logInfo: (message: string, data?: unknown) => void;
};

export const runScrollExportSession = async (input: RunScrollExportSessionInput) => {
    input.logInfo('=== STARTING SCROLL-BASED EXPORT ===', { username: input.username });
    input.setCurrentExportUserId(input.userId);
    logTimelineScope(input.pathname, input.logInfo);

    const startedAt = new Date().toISOString();
    const totalTweetsReported = Number(input.user.legacy?.statuses_count ?? 0);

    if (input.getAbortSignal()?.aborted) {
        return;
    }

    input.resetRunState();
    await input.startFetchInterception();

    try {
        input.updateButton('📜 Scrolling to load tweets...');
        await input.scrollToLoadMore(500);

        input.updateButton('📊 Processing captured data...');
        const collected = sortTweetsByCreatedAtDescending(
            input.extractTweetsFromInterceptedResponses(input.userId),
            input.parseTweetDate,
        );
        const resolvedUserId = resolveUserIdFromCollected({
            username: input.username,
            userId: input.userId,
            user: input.user,
            collected,
            onResolved: (userId) => {
                input.setCurrentExportUserId(userId);
            },
            logInfo: input.logInfo,
        });

        input.logInfo(`Scroll export collected ${collected.length} tweets`);

        const { tweets: finalTweets, mergeInfo } = input.mergeWithPreviousTweets(collected);
        if (mergeInfo) {
            input.logInfo(
                `Merged: ${mergeInfo.previous_count} previous + ${mergeInfo.new_count} new - ${mergeInfo.duplicates_removed} duplicates = ${mergeInfo.final_count} total`,
            );
        }

        const payload = createExportPayload({
            username: input.username,
            userId: resolvedUserId,
            user: input.user,
            startedAt,
            totalTweetsReported,
            collectedCount: collected.length,
            previousMeta: input.resumeSession.previousExportMeta,
            isResumeMode: input.resumeSession.isResumeMode,
            scrollResponsesCaptured: input.getCapturedResponsesCount(),
            mergeInfo,
            finalTweets,
        });
        const resumeSuffix = input.resumeSession.isResumeMode ? '_merged' : '';
        const filename = `${input.username}_tweets_scroll${resumeSuffix}_${new Date().toISOString().slice(0, 10)}.json`;
        input.downloadFile(filename, JSON.stringify(payload, null, 2), 'application/json');

        input.logInfo('=== SCROLL EXPORT COMPLETE ===', {
            collected: finalTweets.length,
            responses: input.getCapturedResponsesCount(),
            resumed: input.resumeSession.isResumeMode,
        });

        if (input.resumeSession.isResumeMode) {
            await input.clearResumeState();
        }

        input.completeExportUi(finalTweets.length);
    } finally {
        input.stopFetchInterception();
        input.clearInterceptedResponses();
        input.setCurrentExportUserId(null);
        input.finalizeRuntimeState();
    }
};
