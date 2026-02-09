import {
    applyUntilToQuery,
    buildResumeFileConfirmation,
    buildResumeSearchUrl,
    buildResumeUrl,
    parseResumeImportData,
    resolveUntilDateFromTweetDate,
} from '@/content/resume-flow';

type AnyRecord = Record<string, any>;

type ResumeFileFlowInput = {
    file: File;
    fallbackUsername: string | null;
    updateButton: (text: string) => void;
    setResumeState: (tweets: AnyRecord[], sourceMeta: AnyRecord | null) => void;
    resetResumeFlowState: () => void;
    persistResumeState: (username: string, tweets: AnyRecord[], sourceMeta: AnyRecord | null) => Promise<boolean>;
    saveAutoStartContext: (context: Record<string, unknown>) => Promise<void>;
    logInfo: (message: string, data?: unknown) => void;
    navigateTo: (url: string) => void;
};

type ResumeLinkInput = {
    collectedTweets: AnyRecord[];
    searchQuery: string | null;
    fallbackUsername: string | null;
    previousMetaUsername: string | null;
};

type ParseTweetDate = (dateString: string | undefined) => Date | null;

export const sortTweetsByCreatedAtDescending = (tweets: AnyRecord[], parseTweetDate: ParseTweetDate) => {
    return [...tweets].sort((left, right) => {
        const leftDate = parseTweetDate(left.created_at) ?? new Date(0);
        const rightDate = parseTweetDate(right.created_at) ?? new Date(0);
        return rightDate.getTime() - leftDate.getTime();
    });
};

export const createSearchAutoStartContext = <T extends Record<string, unknown>>(username: string, extra: T = {} as T) =>
    ({
        username,
        autoStart: true,
        timestamp: Date.now(),
        ...extra,
    }) as { username: string; autoStart: true; timestamp: number } & T;

export const normalizeResumeUsername = (value: unknown) => {
    return String(value || 'unknown')
        .replace(/^@/, '')
        .toLowerCase();
};

export const processResumeFileUpload = async ({
    file,
    fallbackUsername,
    updateButton,
    setResumeState,
    resetResumeFlowState,
    persistResumeState,
    saveAutoStartContext,
    logInfo,
    navigateTo,
}: ResumeFileFlowInput) => {
    updateButton('📂 Loading file...');

    const text = await file.text();
    const data = JSON.parse(text);
    const details = parseResumeImportData(data, fallbackUsername);

    logInfo(`Loaded ${details.tweets.length} tweets from file`);
    logInfo(`Oldest tweet date: ${details.oldestTweet.created_at}, resuming until: ${details.untilDate}`);

    setResumeState(details.tweets, details.sourceMeta);
    const resumeUrl = buildResumeUrl(details.username, details.untilDate);
    logInfo(`Resume URL: ${resumeUrl}`);

    const confirmed = confirm(buildResumeFileConfirmation(details));
    if (!confirmed) {
        resetResumeFlowState();
        return;
    }

    const persisted = await persistResumeState(details.username, details.tweets, details.sourceMeta);
    if (!persisted) {
        throw new Error('Could not persist resume payload before navigation. Try a smaller file or a fresh export.');
    }

    await saveAutoStartContext(
        createSearchAutoStartContext(details.username, {
            resumeMode: true,
            previousTweetsCount: details.tweets.length,
        }),
    );

    navigateTo(resumeUrl);
};

export const buildResumeLinkFromCollectedTweets = ({
    collectedTweets,
    searchQuery,
    fallbackUsername,
    previousMetaUsername,
}: ResumeLinkInput) => {
    if (collectedTweets.length === 0) {
        throw new Error('No tweets collected to resume from');
    }

    const lastTweet = collectedTweets[collectedTweets.length - 1];
    const untilDate = resolveUntilDateFromTweetDate(lastTweet?.created_at);
    if (!untilDate) {
        throw new Error(`Could not parse date from last tweet: ${lastTweet?.created_at || ''}`);
    }

    const fallbackQueryUsername = fallbackUsername || 'unknown';
    const baseQuery = searchQuery || `from:${fallbackQueryUsername}`;
    const query = applyUntilToQuery(baseQuery, untilDate);

    return {
        url: buildResumeSearchUrl(query),
        resumeUsername: normalizeResumeUsername(fallbackUsername || previousMetaUsername),
    };
};

export const buildPartialExportPayload = (input: {
    username: string | null;
    sortedCollected: AnyRecord[];
    isResumeMode: boolean;
    mergeInfo: AnyRecord | null;
}) => {
    return {
        meta: {
            username: input.username,
            note: 'PARTIAL EXPORT (Rate Limit)',
            collected_count: input.sortedCollected.length,
            resume_mode: input.isResumeMode || undefined,
            merge_info: input.mergeInfo || undefined,
        },
        items: input.sortedCollected,
    };
};
