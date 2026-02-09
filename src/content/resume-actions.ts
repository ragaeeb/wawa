import {
    buildPartialExportPayload,
    buildResumeLinkFromCollectedTweets,
    createSearchAutoStartContext,
    sortTweetsByCreatedAtDescending,
} from '@/content/resume-controller';

type AnyRecord = Record<string, any>;

type ParseTweetDate = (dateString: string | undefined) => Date | null;

type RuntimeLoggers = {
    logInfo: (message: string, data?: unknown) => void;
    logWarn: (message: string, data?: unknown) => void;
    logError: (message: string, data?: unknown) => void;
};

type CreateResumeActionsInput = {
    getCurrentUsername: () => string | null;
    getCurrentSearchQuery: () => string | null;
    getLiveCollectedTweets: () => AnyRecord[];
    mergeCollectedTweets: (tweets: AnyRecord[]) => { tweets: AnyRecord[]; mergeInfo: AnyRecord | null };
    consolidateCollectedTweets: (tweets: AnyRecord[]) => AnyRecord[];
    getPreviousMeta: () => AnyRecord | null;
    isResumeMode: () => boolean;
    parseTweetDate: ParseTweetDate;
    persistResumeSnapshot: (username: string, tweets: AnyRecord[], exportMeta: AnyRecord | null) => Promise<boolean>;
    saveAutoStartContext: (context: Record<string, unknown>) => Promise<void>;
    downloadFile: (filename: string, content: string, mime: string) => void;
    writeToClipboard: (value: string) => Promise<void>;
    alertUser: (message: string) => void;
    loggers: RuntimeLoggers;
};

export type ResumeActions = {
    savePartialExport: () => void;
    copyResumeLink: () => Promise<void>;
};

const getSortedCollectedTweets = (input: CreateResumeActionsInput) => {
    return sortTweetsByCreatedAtDescending(
        input.consolidateCollectedTweets(input.getLiveCollectedTweets()),
        input.parseTweetDate,
    );
};

const handleCopyResumeLinkError = (input: Pick<CreateResumeActionsInput, 'alertUser' | 'loggers'>, error: unknown) => {
    if (error instanceof Error && error.message === 'No tweets collected to resume from') {
        input.loggers.logWarn('No tweets collected to resume from');
        return;
    }
    if (error instanceof Error && error.message.startsWith('Could not parse date from last tweet:')) {
        input.loggers.logWarn(error.message);
        input.alertUser('Could not determine resume date accurately. Check console.');
        return;
    }

    const message = error instanceof Error ? error.message : String(error);
    input.loggers.logError('Failed to copy resume link', { error: message });
    input.alertUser('❌ Could not copy resume link. Check console logs.');
};

export const createResumeActions = (input: CreateResumeActionsInput) => {
    const savePartialExport = () => {
        input.loggers.logInfo('Saving partial export...');

        const { tweets: collected, mergeInfo } = input.mergeCollectedTweets(input.getLiveCollectedTweets());
        const sortedCollected = sortTweetsByCreatedAtDescending(collected, input.parseTweetDate);
        const username = input.getCurrentUsername();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `Wawa_${username}_PARTIAL_${timestamp}.json`;

        const payload = buildPartialExportPayload({
            username,
            sortedCollected,
            isResumeMode: input.isResumeMode(),
            mergeInfo,
        });

        input.downloadFile(filename, JSON.stringify(payload, null, 2), 'application/json');
        input.loggers.logInfo(`Saved ${sortedCollected.length} tweets partially.`);
    };

    const copyResumeLink = async () => {
        try {
            const collected = getSortedCollectedTweets(input);
            const previousMeta = input.getPreviousMeta();

            const { url: newUrl, resumeUsername } = buildResumeLinkFromCollectedTweets({
                collectedTweets: collected,
                searchQuery: input.getCurrentSearchQuery(),
                fallbackUsername: input.getCurrentUsername(),
                previousMetaUsername: previousMeta?.username || null,
            });
            const persisted = await input.persistResumeSnapshot(resumeUsername, collected, {
                ...(previousMeta || {}),
                username: resumeUsername || undefined,
                collected_count: collected.length,
                resume_saved_at: new Date().toISOString(),
            });
            if (!persisted) {
                throw new Error('Could not persist resume payload before creating resume link.');
            }

            await input.saveAutoStartContext(
                createSearchAutoStartContext(resumeUsername, {
                    resumeMode: true,
                    previousTweetsCount: collected.length,
                }),
            );

            await input.writeToClipboard(newUrl);
            input.loggers.logInfo('Resume Link copied with auto-start flag.');
            input.alertUser(
                '✅ Resume Link Copied!\n\n1. Use a new account/tab.\n2. Paste the link.\n3. The export will RESUME AUTOMATICALLY from that point.',
            );
        } catch (error) {
            handleCopyResumeLinkError({ alertUser: input.alertUser, loggers: input.loggers }, error);
        }
    };

    return {
        savePartialExport,
        copyResumeLink,
    };
};
