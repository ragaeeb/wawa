/**
 * Core domain types for the Wawa Twitter/X export extension.
 *
 * These types define the data structures used throughout the application
 * for tweet storage, export metadata, and extension state management.
 *
 * @module types/domain
 */

/**
 * Represents a Twitter/X user's public profile information.
 *
 * Contains only publicly visible data extracted from Twitter's GraphQL API.
 * Fields are optional as different API endpoints return varying levels of detail.
 *
 * @example
 * ```typescript
 * const author: TweetAuthor = {
 *   id: "123456789",
 *   username: "johndoe",
 *   name: "John Doe",
 *   verified: true,
 *   followers_count: 1500
 * };
 * ```
 */
export type TweetAuthor = {
    /** Twitter's internal user ID (numeric string) */
    id?: string;

    /** Username without '@' prefix (e.g., "johndoe") */
    username?: string;

    /** Display name as shown in profile */
    name?: string;

    /** Whether the account has Twitter's verification checkmark */
    verified?: boolean;

    /** Number of followers at time of export */
    followers_count?: number;

    /** Number of accounts this user follows */
    following_count?: number;

    /** Additional fields from GraphQL response not explicitly typed */
    [key: string]: unknown;
};

/**
 * Represents a single tweet/post from Twitter/X.
 *
 * Core data structure for all exported content. Supports both tweets and retweets.
 * All fields are optional as API responses vary by endpoint and visibility settings.
 *
 * The flexible schema (`[key: string]: unknown`) allows preserving additional
 * GraphQL fields without requiring type updates.
 *
 * @example
 * ```typescript
 * const tweet: TweetItem = {
 *   id: "1234567890123456789",
 *   text: "Hello world!",
 *   created_at: "2026-02-08 10:30:00",
 *   author: { username: "johndoe", name: "John Doe" },
 *   favorite_count: 42,
 *   retweet_count: 7
 * };
 * ```
 */
export type TweetItem = {
    /** Twitter's unique tweet ID (snowflake ID as string) */
    id?: string;

    /** Author information (may be original author for retweets) */
    author?: TweetAuthor;

    /** Tweet text content (may be truncated at 280 chars for old API versions) */
    text?: string;

    /** Creation timestamp in "YYYY-MM-DD HH:MM:SS" format or ISO 8601 */
    created_at?: string;

    /** Tweet type: "Tweet", "Retweet", or custom classification */
    type?: string;

    /**
     * Additional tweet fields not explicitly typed.
     * Common fields include:
     * - favorite_count: number of likes
     * - retweet_count: number of retweets
     * - reply_count: number of replies
     * - quote_count: number of quote tweets
     * - view_count: impression count
     * - conversation_id: thread identifier
     * - in_reply_to_user_id: if this is a reply
     * - entities: hashtags, mentions, URLs
     * - media: attached images/videos
     */
    [key: string]: unknown;
};

/**
 * Metadata about a merge operation when resuming exports.
 *
 * Tracks deduplication statistics when combining a previous export
 * with newly collected tweets during resume.
 *
 * @example
 * ```typescript
 * const mergeInfo: MergeInfo = {
 *   previous_count: 5000,    // Tweets from last session
 *   new_count: 2000,         // Tweets collected this session
 *   duplicates_removed: 150, // Tweets appearing in both sets
 *   final_count: 6850        // Unique tweets after merge (5000 + 2000 - 150)
 * };
 * ```
 */
export type MergeInfo = {
    /** Number of tweets from previous export session */
    previous_count: number;

    /** Number of new tweets collected in current session */
    new_count: number;

    /** Number of duplicate tweets removed during merge (by tweet ID) */
    duplicates_removed: number;

    /** Total unique tweets after deduplication */
    final_count: number;
};

/**
 * Metadata describing an export operation.
 *
 * Includes timing information, collection statistics, and resume data.
 * Used both during active exports and stored with completed exports for audit trail.
 *
 * Fields marked with `?` are optional and may not be present in all exports
 * (e.g., merge_info only exists for resumed exports).
 *
 * @example
 * ```typescript
 * const meta: ExportMeta = {
 *   username: "johndoe",
 *   export_started_at: "2026-02-08T10:00:00.000Z",
 *   export_completed_at: "2026-02-08T10:45:00.000Z",
 *   collected_count: 7500,
 *   reported_count: 7800, // Twitter's count (may be higher due to privacy filters)
 *   collection_method: "scroll-interception-resumed",
 *   scroll_responses_captured: 150
 * };
 * ```
 */
export type ExportMeta = {
    /** Target username (normalized: lowercase, no '@' prefix) */
    username: string;

    /** Twitter's internal user ID */
    user_id?: string;

    /** Display name at time of export */
    name?: string;

    /** ISO 8601 timestamp of export start (earliest session if resumed) */
    export_started_at?: string;

    /** ISO 8601 timestamp of export completion (latest session if resumed) */
    export_completed_at?: string;

    /** Total unique tweets collected across all sessions */
    collected_count?: number;

    /** New tweets collected in most recent session (only for resumed exports) */
    new_collected_count?: number;

    /** Tweets from previous session (only for resumed exports) */
    previous_collected_count?: number;

    /**
     * Tweet count reported by Twitter's API.
     * May differ from collected_count due to:
     * - Privacy-filtered tweets (visible to you but not exported)
     * - Deleted tweets counted in API total
     * - API limitations (3,200 tweet cap)
     *
     * null if not available from API response.
     */
    reported_count?: number | null;

    /** Method used for collection (e.g., "scroll-interception", "scroll-interception-resumed") */
    collection_method?: string;

    /** Number of GraphQL API responses captured (for debugging rate limits) */
    scroll_responses_captured?: number;

    /** Start time of previous export session (only for resumed exports) */
    previous_export_started_at?: string;

    /** Completion time of previous export session (only for resumed exports) */
    previous_export_completed_at?: string;

    /** Merge statistics (only for resumed exports) */
    merge_info?: MergeInfo;

    /** Additional metadata fields not explicitly typed */
    [key: string]: unknown;
};

/**
 * Complete export payload ready for download.
 *
 * This is the final structure written to the JSON file when user downloads their export.
 * Combines metadata and tweet data in a single, self-contained document.
 *
 * @example
 * ```typescript
 * const payload: ExportPayload = {
 *   meta: {
 *     username: "johndoe",
 *     export_completed_at: "2026-02-08T11:00:00.000Z",
 *     collected_count: 5000
 *   },
 *   items: [
 *     { id: "1", text: "First tweet", created_at: "2020-01-01 00:00:00" },
 *     // ... 4,999 more tweets
 *   ]
 * };
 *
 * // Download as JSON:
 * const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
 * const url = URL.createObjectURL(blob);
 * // Trigger download...
 * ```
 */
export type ExportPayload = {
    /** Export metadata and statistics */
    meta: ExportMeta;

    /** Array of collected tweets, typically sorted by date descending (newest first) */
    items: TweetItem[];
};

/**
 * Temporary storage format for in-progress exports (resume capability).
 *
 * Stored in IndexedDB or chrome.storage.local to enable pause/resume.
 * Includes a saved_at timestamp for automatic expiry (default: 6 hours).
 *
 * @example
 * ```typescript
 * const resumePayload: ResumePayload = {
 *   username: "johndoe",
 *   saved_at: Date.now(),
 *   meta: {
 *     export_started_at: "2026-02-08T10:00:00.000Z",
 *     collected_count: 3000
 *   },
 *   tweets: [
 *     // ... 3,000 tweets collected so far
 *   ]
 * };
 *
 * // Store for later resume:
 * await resumeStorage.persist(resumePayload);
 *
 * // Later, in a new session:
 * const restored = await resumeStorage.restore("johndoe");
 * if (restored) {
 *   console.log(`Resuming export with ${restored.tweets.length} existing tweets`);
 * }
 * ```
 */
export type ResumePayload = {
    /** Target username (normalized: lowercase, no '@') */
    username: string;

    /** Unix timestamp (milliseconds) when payload was saved */
    saved_at: number;

    /** Export metadata at time of save (may be partial for in-progress exports) */
    meta: ExportMeta | null;

    /** Tweets collected so far (may be incomplete) */
    tweets: TweetItem[];
};

/**
 * Log severity levels following standard logging conventions.
 *
 * Used for filtering and displaying logs in the extension popup.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log entry with timestamp and optional context data.
 *
 * All logs generated by the extension use this format for consistency.
 * Logs are displayed in the extension popup and browser console.
 *
 * @example
 * ```typescript
 * const entry: LogEntry = {
 *   timestamp: "2026-02-08T10:30:45.123Z",
 *   level: "info",
 *   message: "Export started",
 *   data: { username: "johndoe", expectedCount: 5000 }
 * };
 *
 * // Send to background service:
 * chrome.runtime.sendMessage({
 *   type: 'log',
 *   entry
 * });
 * ```
 */
export type LogEntry = {
    /** ISO 8601 timestamp of log creation */
    timestamp: string;

    /** Severity level for filtering and display */
    level: LogLevel;

    /** Human-readable log message */
    message: string;

    /** Optional structured context data (will be JSON stringified in logs) */
    data?: unknown;
};

/**
 * Summary information for completed exports.
 *
 * Lightweight record stored by background service to track export history.
 * Used for display in extension popup ("Last export: @johndoe, 5000 tweets").
 *
 * @example
 * ```typescript
 * const summary: ExportSummary = {
 *   username: "johndoe",
 *   count: 5000,
 *   timestamp: "2026-02-08T11:00:00.000Z"
 * };
 *
 * // Store in background service:
 * chrome.runtime.sendMessage({
 *   type: 'exportComplete',
 *   username: summary.username,
 *   count: summary.count
 * });
 * ```
 */
export type ExportSummary = {
    /** Username of exported account */
    username: string;

    /** Number of tweets exported */
    count: number;

    /** ISO 8601 timestamp of export completion */
    timestamp: string;
};

/**
 * User-configurable extension settings.
 *
 * Persisted in chrome.storage.local and displayed in extension popup.
 * Settings affect export behavior and output format.
 *
 * @example
 * ```typescript
 * const settings: ExtensionSettings = {
 *   minimalData: true,      // Exclude extra metadata fields
 *   includeReplies: false,  // Skip replies to other users
 *   maxCount: 10000         // Stop after 10k tweets (0 = unlimited)
 * };
 *
 * // Save settings:
 * await chrome.storage.local.set(settings);
 * ```
 */
export type ExtensionSettings = {
    /**
     * If true, exports only essential tweet fields (id, text, created_at, author).
     * If false, includes all available GraphQL fields (engagement, entities, etc.).
     *
     * Minimal mode reduces file size by ~40% for large exports.
     */
    minimalData: boolean;

    /**
     * If true, exports include replies to other users.
     * If false, only exports main tweets and self-threads.
     *
     * Note: Twitter's API may still miss some replies even when enabled.
     */
    includeReplies: boolean;

    /**
     * Maximum number of tweets to collect before auto-stopping export.
     *
     * - 0: No limit (export all available tweets)
     * - >0: Stop after this many tweets collected
     *
     * Useful for testing or limiting export size on very large accounts.
     */
    maxCount: number;
};
