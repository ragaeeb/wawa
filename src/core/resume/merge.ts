/**
 * Tweet merge and deduplication utilities for resume functionality.
 *
 * When users pause and resume exports, this module handles combining
 * previously collected tweets with newly collected tweets while:
 * - Removing duplicates (by tweet ID)
 * - Preferring richer tweet objects when duplicates found
 * - Maintaining chronological order (newest first)
 * - Tracking merge statistics for metadata
 */

import type { MergeInfo, TweetItem } from '../../types/domain';
import { parseTweetDate } from './payload';

/**
 * Result of merging two tweet collections.
 *
 * @example
 * ```typescript
 * const previous = [{ id: "1", text: "old" }, { id: "2", text: "older" }];
 * const newTweets = [{ id: "1", text: "old", likes: 100 }, { id: "3", text: "new" }];
 *
 * const result = mergeTweets(newTweets, previous);
 * // result.tweets: [{ id: "3" }, { id: "1", likes: 100 }, { id: "2" }]
 * // result.mergeInfo: { previous_count: 2, new_count: 2, duplicates_removed: 1, final_count: 3 }
 * ```
 */
export type MergeResult = {
    /**
     * Deduplicated tweets sorted by date descending (newest first).
     * When duplicates found, the "richer" object (more fields) is kept.
     */
    tweets: TweetItem[];

    /**
     * Merge statistics for metadata tracking.
     * Null if previous array was empty (no merge occurred).
     */
    mergeInfo: MergeInfo | null;
};

/**
 * Compares two tweet objects and returns the one with more data fields.
 *
 * When the same tweet appears in both previous and new collections
 * (e.g., collected at different times), this function picks the version
 * with more complete data.
 *
 * @param existing - Tweet already in the merged collection
 * @param candidate - Tweet being considered for inclusion
 * @returns The tweet object with more fields (richer data)
 *
 * @example
 * ```typescript
 * const tweet1 = { id: "1", text: "Hello" };
 * const tweet2 = { id: "1", text: "Hello", likes: 42, retweets: 7, author: {...} };
 *
 * const richer = pickRicherTweet(tweet1, tweet2);
 * // Returns tweet2 (has 4 fields vs 2 fields)
 * ```
 *
 * @remarks
 * This heuristic assumes more fields = more complete data, which holds true
 * for Twitter's API where different endpoints return varying detail levels.
 */
const pickRicherTweet = (existing: TweetItem, candidate: TweetItem): TweetItem => {
    const existingSize = Object.keys(existing).length;
    const candidateSize = Object.keys(candidate).length;
    return candidateSize > existingSize ? candidate : existing;
};

/**
 * Generates a unique key for a tweet to enable deduplication.
 *
 * Strategy:
 * 1. If tweet has an ID, use it (most reliable)
 * 2. If no ID, create composite key from source + index + timestamp + text
 *
 * The composite key handles edge cases where tweets lack IDs
 * (rare, but possible with malformed API responses).
 *
 * @param tweet - Tweet to generate key for
 * @param source - Origin of tweet ("new" or "previous" collection)
 * @param index - Position in source array (for uniqueness)
 * @returns Unique string key for this tweet
 *
 * @example
 * ```typescript
 * const tweet = { id: "1234567890", text: "Hello" };
 * const key = tweetKey(tweet, "new", 0);
 * // Returns: "id:1234567890"
 *
 * const noIdTweet = { text: "No ID tweet", created_at: "2020-01-01 00:00:00" };
 * const key2 = tweetKey(noIdTweet, "previous", 5);
 * // Returns: "previous:5:2020-01-01 00:00:00:No ID tweet"
 * ```
 */
const tweetKey = (tweet: TweetItem, source: 'new' | 'previous', index: number): string => {
    if (tweet.id) {
        return `id:${tweet.id}`;
    }
    return `${source}:${index}:${tweet.created_at ?? ''}:${tweet.text ?? ''}`;
};

/**
 * Sorts tweets by creation date in descending order (newest first).
 *
 * Creates a shallow copy of the input array to avoid mutation.
 * Handles various date formats (ISO 8601, Twitter's custom format).
 * Tweets with invalid/missing dates are sorted to the end.
 *
 * @param tweets - Unsorted array of tweets
 * @returns New array sorted by date descending
 *
 * @example
 * ```typescript
 * const tweets = [
 *   { id: "1", created_at: "2020-01-01 00:00:00" },
 *   { id: "2", created_at: "2021-01-01 00:00:00" },
 *   { id: "3", created_at: "2019-01-01 00:00:00" }
 * ];
 *
 * const sorted = sortTweetsByDateDesc(tweets);
 * // Returns: [id: "2" (2021), id: "1" (2020), id: "3" (2019)]
 * ```
 */
export const sortTweetsByDateDesc = (tweets: TweetItem[]): TweetItem[] => {
    return [...tweets].sort((a, b) => {
        const dateA = parseTweetDate(a.created_at) ?? new Date(0);
        const dateB = parseTweetDate(b.created_at) ?? new Date(0);
        return dateB.getTime() - dateA.getTime();
    });
};

/**
 * Merges new tweets with previously collected tweets, removing duplicates.
 *
 * This is the core function for resume functionality. When a user pauses
 * an export and resumes later, this function combines the old and new
 * tweet collections intelligently:
 *
 * 1. Creates a Map for O(1) duplicate detection
 * 2. Adds all new tweets first (prioritize fresh data)
 * 3. Adds previous tweets if not already present
 * 4. When duplicates found, keeps the "richer" object (more fields)
 * 5. Sorts final result by date descending
 * 6. Tracks deduplication statistics
 *
 * @param newTweets - Tweets collected in current session
 * @param previousTweets - Tweets from previous export session(s)
 * @returns Merged and deduplicated tweets with statistics
 *
 * @example
 * ```typescript
 * // Previous session collected 1000 tweets
 * const previous: TweetItem[] = [
 *   { id: "100", text: "old", created_at: "2020-01-01 00:00:00" },
 *   { id: "101", text: "older", created_at: "2020-01-02 00:00:00" }
 * ];
 *
 * // Current session collected 500 tweets (200 overlap with previous)
 * const newTweets: TweetItem[] = [
 *   { id: "101", text: "older", created_at: "2020-01-02 00:00:00", likes: 50 }, // Duplicate, but richer
 *   { id: "102", text: "newest", created_at: "2020-01-03 00:00:00" }
 * ];
 *
 * const result = mergeTweets(newTweets, previous);
 *
 * console.log(result.tweets.length); // 3 (100, 101, 102)
 * console.log(result.mergeInfo);
 * // {
 * //   previous_count: 2,
 * //   new_count: 2,
 * //   duplicates_removed: 1,
 * //   final_count: 3
 * // }
 *
 * // Verify richest duplicate was kept:
 * const tweet101 = result.tweets.find(t => t.id === "101");
 * console.log(tweet101?.likes); // 50 (from newTweets, not previous)
 * ```
 *
 * @remarks
 * - Time complexity: O(n + m) where n = new tweets, m = previous tweets
 * - Space complexity: O(n + m) for the Map
 * - If previousTweets is empty, returns newTweets sorted with null mergeInfo
 * - Preserves all unknown fields in tweet objects (flexible schema)
 */
export const mergeTweets = (newTweets: TweetItem[], previousTweets: TweetItem[]): MergeResult => {
    if (previousTweets.length === 0) {
        return { tweets: sortTweetsByDateDesc(newTweets), mergeInfo: null };
    }

    const merged = new Map<string, TweetItem>();
    let duplicates = 0;

    // Add new tweets first (prioritize fresh data)
    newTweets.forEach((tweet, index) => {
        merged.set(tweetKey(tweet, 'new', index), tweet);
    });

    // Merge in previous tweets, detecting duplicates
    previousTweets.forEach((tweet, index) => {
        const key = tweetKey(tweet, 'previous', index);
        const existing = merged.get(key);

        if (!existing) {
            // New unique tweet from previous session
            merged.set(key, tweet);
            return;
        }

        // Duplicate found - keep richer version
        duplicates += 1;
        merged.set(key, pickRicherTweet(existing, tweet));
    });

    const tweets = sortTweetsByDateDesc(Array.from(merged.values()));
    const mergeInfo: MergeInfo = {
        previous_count: previousTweets.length,
        new_count: newTweets.length,
        duplicates_removed: duplicates,
        final_count: tweets.length,
    };

    return { tweets, mergeInfo };
};
