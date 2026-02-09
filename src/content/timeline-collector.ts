type AnyRecord = Record<string, any>;

type RuntimeLoggers = {
    logInfo: (message: string, data?: unknown) => void;
    logDebug: (message: string, data?: unknown) => void;
};

const MAX_NESTED_DEPTH = 2;

const padNumber = (value: number) => String(value).padStart(2, '0');

const formatDate = (dateString: string | undefined) => {
    if (!dateString) {
        return '';
    }

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
        return dateString;
    }

    return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`;
};

const getFullText = (tweet: AnyRecord) => {
    const note = tweet.note_tweet?.note_tweet_results?.result;
    if (note?.text) {
        return note.text;
    }
    return tweet.legacy?.full_text ?? '';
};

export const normalizeTweetResult = (result: unknown) => {
    if (!result || typeof result !== 'object') {
        return null;
    }

    const candidate = result as AnyRecord;
    if (candidate.__typename === 'Tweet') {
        return candidate;
    }
    if (candidate.__typename === 'TweetWithVisibilityResults') {
        return candidate.tweet ?? null;
    }

    return null;
};

const unwrapUserResult = (userResult: unknown) => {
    if (!userResult || typeof userResult !== 'object') {
        return null;
    }

    let result = userResult as AnyRecord;
    if (result.result) {
        result = result.result;
    }
    if (result.user_results?.result) {
        result = result.user_results.result;
    }
    if (result.user) {
        result = result.user;
    }

    return result;
};

const extractUserInfo = (userResult: unknown) => {
    const result = unwrapUserResult(userResult);
    if (!result) {
        return null;
    }

    const legacy = result.legacy ?? {};
    const core = result.core ?? {};

    const info = {
        id: result.rest_id || result.id_str,
        username: core.screen_name || legacy.screen_name,
        name: core.name || legacy.name,
        verified: legacy.verified ?? result.verification?.verified ?? false,
        followers_count: legacy.followers_count,
        following_count: legacy.friends_count,
    };

    return info.id ? info : null;
};

const collectMedia = (legacy: AnyRecord) => {
    const entities = legacy.entities ?? {};
    const extendedEntities = legacy.extended_entities ?? {};
    const mediaSource = extendedEntities.media ?? entities.media ?? [];

    const media = mediaSource.map((entry: AnyRecord) => {
        const item: AnyRecord = {
            type: entry.type,
            url: entry.media_url_https,
        };

        if (entry.type === 'video' || entry.type === 'animated_gif') {
            const variants = (entry.video_info?.variants ?? [])
                .filter((variant: AnyRecord) => variant.content_type?.includes('video'))
                .sort((a: AnyRecord, b: AnyRecord) => (b.bitrate || 0) - (a.bitrate || 0));

            if (variants.length > 0) {
                item.video_url = variants[0].url;
            }
        }

        return item;
    });

    return media.length > 0 ? media : null;
};

const mapHashtags = (entities: AnyRecord) =>
    (entities.hashtags ?? []).map((entry: AnyRecord) => entry.text).filter(Boolean);

const mapUrls = (entities: AnyRecord) =>
    (entities.urls ?? []).map((entry: AnyRecord) => ({
        url: entry.url,
        expanded_url: entry.expanded_url,
        display_url: entry.display_url,
    }));

const mapMentions = (entities: AnyRecord) =>
    (entities.user_mentions ?? []).map((entry: AnyRecord) => ({
        id: entry.id_str,
        username: entry.screen_name,
        name: entry.name,
    }));

const createBaseTweetData = (tweet: AnyRecord) => {
    const legacy = tweet.legacy ?? {};
    const entities = legacy.entities ?? {};
    const hashtags = mapHashtags(entities);
    const urls = mapUrls(entities);
    const mentions = mapMentions(entities);

    const baseTweetData: AnyRecord = {
        id: tweet.rest_id,
        author: extractUserInfo(tweet.core?.user_results?.result),
        text: getFullText(tweet),
        created_at: formatDate(legacy.created_at),
        favorite_count: legacy.favorite_count,
        retweet_count: legacy.retweet_count,
        reply_count: legacy.reply_count,
        quote_count: legacy.quote_count,
        bookmark_count: legacy.bookmark_count,
        view_count: tweet.views?.count,
        in_reply_to_status_id: legacy.in_reply_to_status_id_str || null,
        in_reply_to_user_id: legacy.in_reply_to_user_id_str || null,
        in_reply_to_username: legacy.in_reply_to_screen_name || null,
        conversation_id: legacy.conversation_id_str || null,
        language: legacy.lang,
        source: tweet.source,
        hashtags: hashtags.length > 0 ? hashtags : null,
        urls: urls.length > 0 ? urls : null,
        media: collectMedia(legacy),
        mentions: mentions.length > 0 ? mentions : null,
        is_quote_status: legacy.is_quote_status || false,
        possibly_sensitive: legacy.possibly_sensitive || false,
        permalink: legacy.quoted_status_permalink?.expanded || null,
    };

    return baseTweetData;
};

const ensureAuthorFromPermalink = (data: AnyRecord) => {
    if (!data.permalink || data.author?.username) {
        return;
    }

    const match = data.permalink.match(/twitter\.com\/([^/]+)\/status/);
    if (!match?.[1]) {
        return;
    }

    data.author ??= {};
    data.author.username = match[1];
};

const addNoteTweetTextIfNeeded = (tweet: AnyRecord, data: AnyRecord) => {
    const noteText = tweet.note_tweet?.note_tweet_results?.result?.text;
    if (noteText && noteText !== data.text) {
        data.note_tweet_text = noteText;
    }
};

const removeNullishFields = (value: AnyRecord) => {
    Object.keys(value).forEach((key) => {
        if (value[key] === null || value[key] === undefined) {
            delete value[key];
        }
    });
};

const extractNestedTweet = (
    container: unknown,
    fieldName: 'quoted_tweet' | 'retweeted_tweet',
    logLabel: string,
    parentTweetId: string,
    depth: number,
    loggers: RuntimeLoggers,
) => {
    const normalized = normalizeTweetResult(container);
    if (!normalized) {
        return null;
    }

    const extracted = extractFullTweetData(normalized, loggers, depth + 1);
    if (!extracted) {
        return null;
    }

    loggers.logDebug(logLabel, {
        main: parentTweetId,
        [fieldName]: normalized.rest_id,
    });

    return extracted;
};

const extractFullTweetData = (tweet: AnyRecord, loggers: RuntimeLoggers, depth = 0) => {
    if (!tweet || depth > MAX_NESTED_DEPTH) {
        return null;
    }

    const data = createBaseTweetData(tweet);
    ensureAuthorFromPermalink(data);
    addNoteTweetTextIfNeeded(tweet, data);

    const quoted = extractNestedTweet(
        tweet.quoted_status_result?.result,
        'quoted_tweet',
        'Extracted quoted tweet',
        tweet.rest_id,
        depth,
        loggers,
    );
    if (quoted) {
        data.quoted_tweet = quoted;
    }

    const retweeted = extractNestedTweet(
        tweet.legacy?.retweeted_status_result?.result,
        'retweeted_tweet',
        'Extracted retweeted tweet',
        tweet.rest_id,
        depth,
        loggers,
    );
    if (retweeted) {
        data.retweeted_tweet = retweeted;
    }

    removeNullishFields(data);
    return data;
};

const buildTweetRow = (tweet: AnyRecord, type: string, loggers: RuntimeLoggers) => {
    const data = extractFullTweetData(tweet, loggers);
    if (!data) {
        return null;
    }

    if (type && type !== 'Tweet') {
        data.type = type;
    }

    return data;
};

const getTimelineInstructions = (data: unknown) => {
    const payload = data as AnyRecord;

    const timelineV2 = payload?.data?.user?.result?.timeline_v2?.timeline;
    if (timelineV2?.instructions?.length) {
        return timelineV2.instructions;
    }

    const timeline = payload?.data?.user?.result?.timeline?.timeline;
    if (timeline?.instructions?.length) {
        return timeline.instructions;
    }

    const searchTimeline = payload?.data?.search_by_raw_query?.search_timeline?.timeline;
    if (searchTimeline?.instructions?.length) {
        return searchTimeline.instructions;
    }

    return [];
};

const getInstructionEntries = (instruction: AnyRecord) =>
    instruction.entries ?? (instruction.entry ? [instruction.entry] : []);

const pushTweetEntry = (entry: AnyRecord, items: AnyRecord[], loggers: RuntimeLoggers) => {
    const tweetResult = normalizeTweetResult(entry.content?.itemContent?.tweet_results?.result);
    if (!tweetResult) {
        return;
    }

    const type = tweetResult.legacy?.retweeted_status_result?.result ? 'Retweet' : 'Tweet';
    const row = buildTweetRow(tweetResult, type, loggers);
    if (!row) {
        return;
    }

    items.push(row);
    loggers.logDebug(type === 'Retweet' ? 'Added retweet' : 'Added tweet', {
        id: tweetResult.rest_id,
        has_quoted: type === 'Tweet' ? Boolean(row.quoted_tweet) : undefined,
    });
};

const pushConversationTweets = (entry: AnyRecord, items: AnyRecord[], loggers: RuntimeLoggers) => {
    const convoItems = entry.content?.items ?? [];
    loggers.logDebug(`Processing conversation with ${convoItems.length} items`);

    for (const convoItem of convoItems) {
        const tweetResult = normalizeTweetResult(convoItem?.item?.itemContent?.tweet_results?.result);
        if (!tweetResult) {
            continue;
        }

        const row = buildTweetRow(tweetResult, 'Tweet', loggers);
        if (!row) {
            continue;
        }

        items.push(row);
        loggers.logDebug('Added conversation tweet', { id: tweetResult.rest_id });
    }
};

const applyCursorIfPresent = (entry: AnyRecord, currentCursor: string | null) => {
    if (entry.entryId?.startsWith('cursor-bottom-') && entry.content?.cursorType === 'Bottom') {
        return entry.content?.value ?? null;
    }

    return currentCursor;
};

const processEntry = (entry: AnyRecord, items: AnyRecord[], nextCursor: string | null, loggers: RuntimeLoggers) => {
    const entryId = entry.entryId || '';

    if (entryId.startsWith('promoted-tweet-')) {
        return nextCursor;
    }

    if (entryId.startsWith('tweet-')) {
        pushTweetEntry(entry, items, loggers);
        return nextCursor;
    }

    if (entryId.startsWith('profile-conversation-')) {
        pushConversationTweets(entry, items, loggers);
        return nextCursor;
    }

    return applyCursorIfPresent(entry, nextCursor);
};

const processInstruction = (
    instruction: AnyRecord,
    items: AnyRecord[],
    nextCursor: string | null,
    loggers: RuntimeLoggers,
) => {
    if (instruction.type !== 'TimelineAddEntries' && instruction.type !== 'TimelineReplaceEntry') {
        return nextCursor;
    }

    const entries = getInstructionEntries(instruction);
    loggers.logDebug(`Processing ${entries.length} entries`);

    let cursor = nextCursor;
    for (const entry of entries) {
        cursor = processEntry(entry, items, cursor, loggers);
    }

    return cursor;
};

const extractTimeline = (data: unknown, loggers: RuntimeLoggers) => {
    loggers.logDebug('Extracting timeline from response');

    const instructions = getTimelineInstructions(data);
    loggers.logDebug(`Found ${instructions.length} timeline instructions`);

    const items: AnyRecord[] = [];
    let nextCursor: string | null = null;

    for (const instruction of instructions) {
        nextCursor = processInstruction(instruction, items, nextCursor, loggers);
    }

    loggers.logInfo(`Extracted ${items.length} items from timeline page`);
    return { items, nextCursor };
};

const shouldIncludeItem = (item: AnyRecord, targetUserId: string) => {
    if (!item.id) {
        return false;
    }

    if (targetUserId === 'unknown') {
        return true;
    }

    const authorId = item.author?.id;
    if (authorId === targetUserId) {
        return true;
    }

    return item.type === 'Retweet';
};

const appendNewItems = (items: AnyRecord[], targetUserId: string, seenIds: Set<string>, destination: AnyRecord[]) => {
    for (const item of items) {
        if (!shouldIncludeItem(item, targetUserId) || seenIds.has(item.id)) {
            continue;
        }

        seenIds.add(item.id);
        destination.push(item);
    }
};

export const extractTweetsFromResponses = (
    interceptedResponses: AnyRecord[],
    targetUserId: string,
    loggers: RuntimeLoggers,
) => {
    const allTweets: AnyRecord[] = [];
    const seenIds = new Set<string>();

    for (const response of interceptedResponses) {
        try {
            const { items } = extractTimeline(response.data, loggers);
            appendNewItems(items, targetUserId, seenIds, allTweets);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            loggers.logDebug('Error extracting from intercepted response', { error: message });
        }
    }

    loggers.logInfo(`Extracted ${allTweets.length} unique tweets from intercepted responses`);
    return allTweets;
};
