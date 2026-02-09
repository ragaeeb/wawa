import { extractTweetsFromExportData, normalizeUsername, parseTweetDate } from '@/core/resume/payload';

type AnyRecord = Record<string, any>;

export type ResumeImportDetails = {
    tweets: AnyRecord[];
    sourceMeta: AnyRecord | null;
    oldestTweet: AnyRecord;
    untilDate: string;
    username: string;
};

const getSourceMeta = (data: unknown) => {
    if (!data || typeof data !== 'object') {
        return null;
    }

    const payload = data as { meta?: AnyRecord; metadata?: AnyRecord };
    return payload.meta ?? payload.metadata ?? null;
};

const sortTweetsDescending = (tweets: AnyRecord[]) => {
    return [...tweets].sort((a, b) => {
        const dateA = parseTweetDate(a?.created_at) ?? new Date(0);
        const dateB = parseTweetDate(b?.created_at) ?? new Date(0);
        return dateB.getTime() - dateA.getTime();
    });
};

const toUntilDate = (date: Date) => {
    const clone = new Date(date.getTime());
    clone.setDate(clone.getDate() + 1);
    return clone.toISOString().slice(0, 10);
};

const resolveUsername = (data: unknown, sourceMeta: AnyRecord | null, fallbackUsername: string | null) => {
    const payload = data && typeof data === 'object' ? (data as AnyRecord) : null;

    const usernameFromMeta = normalizeUsername(sourceMeta?.username);
    const usernameFromData = normalizeUsername(payload?.meta?.username ?? payload?.metadata?.username);
    const usernameFromFallback = normalizeUsername(fallbackUsername);

    return usernameFromMeta ?? usernameFromData ?? usernameFromFallback ?? 'unknown';
};

/**
 * Parses resume file content and derives deterministic resume inputs (sorted tweets, username, until date).
 */
export const parseResumeImportData = (data: unknown, fallbackUsername: string | null) => {
    const tweets = extractTweetsFromExportData(data) as AnyRecord[];
    if (!Array.isArray(tweets) || tweets.length === 0) {
        throw new Error('No tweets found in file');
    }

    const sourceMeta = getSourceMeta(data);
    const sortedTweets = sortTweetsDescending(tweets);
    const oldestTweet = sortedTweets.at(-1);
    if (!oldestTweet) {
        throw new Error('No tweets found in file');
    }
    const oldestDate = parseTweetDate(oldestTweet?.created_at);

    if (!oldestDate || Number.isNaN(oldestDate.getTime())) {
        throw new Error('Could not parse date from oldest tweet');
    }

    return {
        tweets: sortedTweets,
        sourceMeta,
        oldestTweet,
        untilDate: toUntilDate(oldestDate),
        username: resolveUsername(data, sourceMeta, fallbackUsername),
    };
};

/**
 * Builds live-search resume URL from normalized username and computed `until` date.
 */
export const buildResumeUrl = (username: string, untilDate: string) => {
    return `https://x.com/search?q=from:${username} until:${untilDate}&src=typed_query&f=live&wawa_resume=1`;
};

/**
 * Builds confirmation copy shown before navigating to resume search.
 */
export const buildResumeFileConfirmation = (details: ResumeImportDetails) => {
    return (
        `📂 Resume from File\n\n` +
        `Loaded: ${details.tweets.length} tweets\n` +
        `Oldest: ${details.oldestTweet.created_at}\n` +
        `Resume until: ${details.untilDate}\n\n` +
        `Click OK to navigate to the resume URL.\n` +
        `New tweets will be merged with existing ones.`
    );
};

/**
 * Converts a tweet timestamp into the next-day `until` date used for resume searches.
 */
export const resolveUntilDateFromTweetDate = (dateValue: string | undefined) => {
    const parsed = parseTweetDate(dateValue);
    if (!parsed || Number.isNaN(parsed.getTime())) {
        return null;
    }

    return toUntilDate(parsed);
};

const hasUntilClause = (query: string) => /\buntil:\d{4}-\d{2}-\d{2}\b/i.test(query);

/**
 * Upserts `until:YYYY-MM-DD` in a query string.
 */
export const applyUntilToQuery = (query: string, untilDate: string) => {
    if (hasUntilClause(query)) {
        return query.replace(/until:\d{4}-\d{2}-\d{2}/i, `until:${untilDate}`);
    }

    return `${query} until:${untilDate}`.trim();
};

/**
 * Builds encoded search URL with resume marker flag.
 */
export const buildResumeSearchUrl = (query: string) => {
    return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live&wawa_resume=1`;
};
