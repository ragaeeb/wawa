/**
 * Timeline extraction utilities for parsing Twitter's GraphQL API responses.
 *
 * This module handles the complex nested structure of Twitter's timeline_v2
 * and search_timeline GraphQL responses, extracting tweet data while handling
 * various edge cases (promoted tweets, retweets, thread structures).
 */

type TimelineInstruction = {
    type?: string;
    entries?: TimelineEntry[];
    entry?: TimelineEntry;
};

type TimelineEntry = {
    entryId?: string;
    content?: {
        cursorType?: string;
        value?: string;
        itemContent?: {
            tweet_results?: {
                result?: unknown;
            };
        };
        items?: Array<{
            item?: {
                itemContent?: {
                    tweet_results?: {
                        result?: unknown;
                    };
                };
            };
        }>;
    };
};

/**
 * Result of timeline extraction containing tweets and pagination cursor.
 *
 * @template T - The type of processed tweet items (e.g., TweetItem, custom format)
 */
export type ExtractedTimeline<T> = {
    /** Extracted and processed tweet items */
    items: T[];

    /** Cursor token for fetching next page of tweets (null if no more pages) */
    nextCursor: string | null;
};

/**
 * Classification of tweet types for differentiation in exports.
 */
export type TweetItemType = 'Tweet' | 'Retweet';

/**
 * Function type for converting raw GraphQL tweet data into application format.
 *
 * @template T - The target item type to build
 * @param tweetResult - Raw tweet object from GraphQL response
 * @param type - Classification as Tweet or Retweet
 * @returns Processed item or null if tweet should be excluded
 *
 * @example
 * ```typescript
 * const builder: TimelineRowBuilder<TweetItem> = (tweet, type) => {
 *   if (type === "Retweet" && !includeRetweets) return null;
 *
 *   return {
 *     id: tweet.rest_id,
 *     text: tweet.legacy?.full_text,
 *     type
 *   };
 * };
 * ```
 */
export type TimelineRowBuilder<T> = (tweetResult: Record<string, unknown>, type: TweetItemType) => T | null;

/**
 * Normalizes tweet result objects to handle Twitter's polymorphic response types.
 *
 * Twitter's GraphQL returns tweets in different wrapper formats depending on visibility:
 * - `{ __typename: "Tweet", ... }` - Normal public tweet
 * - `{ __typename: "TweetWithVisibilityResults", tweet: { ... } }` - Filtered tweet
 *
 * @param result - Raw tweet result from GraphQL
 * @returns Normalized tweet object or null if invalid
 *
 * @example
 * ```typescript
 * const raw = { __typename: "TweetWithVisibilityResults", tweet: { rest_id: "123" } };
 * const normalized = normalizeTweetResult(raw);
 * console.log(normalized?.rest_id); // "123"
 * ```
 */
export const normalizeTweetResult = (result: unknown) => {
    if (!result || typeof result !== 'object') {
        return null;
    }

    const candidate = result as {
        __typename?: string;
        tweet?: Record<string, unknown>;
    };

    if (candidate.__typename === 'Tweet') {
        return candidate as Record<string, unknown>;
    }
    if (candidate.__typename === 'TweetWithVisibilityResults') {
        return candidate.tweet ?? null;
    }

    return candidate as Record<string, unknown>;
};

/**
 * Extracts timeline instructions from nested GraphQL response structure.
 *
 * Twitter's GraphQL API has multiple endpoint formats:
 * - UserTweets: `data.user.result.timeline_v2.timeline.instructions`
 * - UserTweetsAndReplies: `data.user.result.timeline.timeline.instructions`
 * - SearchTimeline: `data.search_by_raw_query.search_timeline.timeline.instructions`
 *
 * This function handles all variants to extract the instructions array.
 *
 * @param data - Full GraphQL response object
 * @returns Array of timeline instructions (empty if not found)
 *
 * @example
 * ```typescript
 * const response = await fetch(graphqlUrl).then(r => r.json());
 * const instructions = getTimelineInstructions(response);
 *
 * for (const instruction of instructions) {
 *   if (instruction.type === "TimelineAddEntries") {
 *     // Process tweets...
 *   }
 * }
 * ```
 */
export const getTimelineInstructions = (data: unknown) => {
    if (!data || typeof data !== 'object') {
        return [];
    }

    const payload = data as {
        data?: {
            user?: {
                result?: {
                    timeline_v2?: { timeline?: { instructions?: TimelineInstruction[] } };
                    timeline?: { timeline?: { instructions?: TimelineInstruction[] } };
                };
            };
            search_by_raw_query?: {
                search_timeline?: {
                    timeline?: {
                        instructions?: TimelineInstruction[];
                    };
                };
            };
        };
    };

    return (
        payload.data?.user?.result?.timeline_v2?.timeline?.instructions ??
        payload.data?.user?.result?.timeline?.timeline?.instructions ??
        payload.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ??
        []
    );
};

const isPromotedTweet = (entryId: string) => {
    return entryId.startsWith('promoted-tweet-');
};

const isTweetEntry = (entryId: string) => {
    return entryId.startsWith('tweet-');
};

const isConversationEntry = (entryId: string) => {
    return entryId.startsWith('profile-conversation-');
};

const isCursorEntry = (entryId: string) => {
    return entryId.startsWith('cursor-bottom-');
};

const determineItemType = (normalized: Record<string, unknown>) => {
    const hasRetweet = Boolean(
        (normalized as { legacy?: { retweeted_status_result?: { result?: unknown } } }).legacy?.retweeted_status_result
            ?.result,
    );
    return hasRetweet ? 'Retweet' : 'Tweet';
};

const processTweetEntry = <T>(entry: TimelineEntry, buildRow: TimelineRowBuilder<T>) => {
    const normalized = normalizeTweetResult(entry.content?.itemContent?.tweet_results?.result);
    if (!normalized) {
        return null;
    }

    const type = determineItemType(normalized);
    return buildRow(normalized, type);
};

const processConversationItems = <T>(entry: TimelineEntry, buildRow: TimelineRowBuilder<T>) => {
    const items: T[] = [];
    const conversationItems = entry.content?.items ?? [];

    for (const convoItem of conversationItems) {
        const normalized = normalizeTweetResult(convoItem.item?.itemContent?.tweet_results?.result);
        if (!normalized) {
            continue;
        }
        const row = buildRow(normalized, 'Tweet');
        if (row) {
            items.push(row);
        }
    }

    return items;
};

const extractCursorFromEntry = (entry: TimelineEntry) => {
    return entry.content?.cursorType === 'Bottom' ? (entry.content.value ?? null) : null;
};

const isAddOrReplaceInstruction = (instruction: TimelineInstruction) => {
    return instruction.type === 'TimelineAddEntries' || instruction.type === 'TimelineReplaceEntry';
};

const getEntriesFromInstruction = (instruction: TimelineInstruction) => {
    return instruction.entries ?? (instruction.entry ? [instruction.entry] : []);
};

const processTimelineEntry = <T>(entry: TimelineEntry, buildRow: TimelineRowBuilder<T>, items: T[]) => {
    const entryId = entry.entryId ?? '';

    if (isPromotedTweet(entryId)) {
        return null;
    }

    if (isTweetEntry(entryId)) {
        const row = processTweetEntry(entry, buildRow);
        if (row) {
            items.push(row);
        }
        return null;
    }

    if (isConversationEntry(entryId)) {
        const conversationItems = processConversationItems(entry, buildRow);
        items.push(...conversationItems);
        return null;
    }

    if (isCursorEntry(entryId)) {
        return extractCursorFromEntry(entry);
    }

    return null;
};

/**
 * Extracts tweets and pagination cursor from a Twitter GraphQL timeline response.
 *
 * This is the main entry point for processing intercepted GraphQL responses.
 * It handles:
 * - Multiple timeline structures (user timelines, search results)
 * - Promoted tweets (filtered out automatically)
 * - Retweets vs original tweets
 * - Conversation threads (profile-conversation-* entries)
 * - Pagination cursors for fetching next pages
 *
 * @template T - The type of processed items (defined by buildRow function)
 * @param data - Full GraphQL response object from intercepted fetch/XHR
 * @param buildRow - Function to transform raw tweet data into application format
 * @returns Extracted tweets and next page cursor
 *
 * @example
 * ```typescript
 * // Intercepted GraphQL response:
 * const graphqlResponse = {
 *   data: {
 *     user: {
 *       result: {
 *         timeline_v2: {
 *           timeline: {
 *             instructions: [
 *               {
 *                 type: "TimelineAddEntries",
 *                 entries: [
 *                   { entryId: "tweet-1", content: { ... } },
 *                   { entryId: "cursor-bottom-0", content: { cursorType: "Bottom", value: "ABC123" } }
 *                 ]
 *               }
 *             ]
 *           }
 *         }
 *       }
 *     }
 *   }
 * };
 *
 * // Extract tweets:
 * const result = extractTimeline(graphqlResponse, (tweet, type) => ({
 *   id: tweet.rest_id,
 *   text: tweet.legacy?.full_text,
 *   type
 * }));
 *
 * console.log(result.items.length); // Number of tweets extracted
 * console.log(result.nextCursor);   // "ABC123" for next page fetch
 * ```
 *
 * @remarks
 * Promoted tweets (entryId starts with "promoted-tweet-") are automatically excluded.
 * Retweets are detected by checking for `legacy.retweeted_status_result.result`.
 */
export const extractTimeline = <T>(data: unknown, buildRow: TimelineRowBuilder<T>) => {
    const instructions = getTimelineInstructions(data);
    const items: T[] = [];
    let nextCursor: string | null = null;

    for (const instruction of instructions) {
        if (!isAddOrReplaceInstruction(instruction)) {
            continue;
        }

        const entries = getEntriesFromInstruction(instruction);

        for (const entry of entries) {
            const cursor = processTimelineEntry(entry, buildRow, items);
            if (cursor) {
                nextCursor = cursor;
            }
        }
    }

    return { items, nextCursor };
};
