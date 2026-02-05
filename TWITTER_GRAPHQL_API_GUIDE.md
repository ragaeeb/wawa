# Twitter GraphQL API Guide for AI Agents

> **Purpose:** This document provides AI coding agents with comprehensive knowledge about Twitter's internal GraphQL API, specifically the UserTweets endpoint. This knowledge is derived from reverse-engineering the API used by x.com's web interface.

## 📋 Table of Contents

1. [API Overview](#api-overview)
2. [Endpoint Structure](#endpoint-structure)
3. [Request Parameters](#request-parameters)
4. [Response Structure](#response-structure)
5. [Data Extraction Patterns](#data-extraction-patterns)
6. [Pagination & Cursors](#pagination--cursors)
7. [Tweet Types & Variants](#tweet-types--variants)
8. [Parsing Strategies](#parsing-strategies)
9. [Common Gotchas](#common-gotchas)
10. [Example Code](#example-code)

---

## API Overview

### What is UserTweets?

The `UserTweets` GraphQL endpoint is Twitter's internal API for fetching a user's timeline (their tweets and retweets). It's used by x.com when you visit a profile page like `https://x.com/username`.

**Key Characteristics:**
- **Protocol:** GraphQL over HTTPS GET
- **Authentication:** Session cookies (must be logged in)
- **Rate Limiting:** Standard Twitter API limits apply
- **Pagination:** Cursor-based (forward/backward)
- **Response Size:** ~20 tweets per request by default

**What It Returns:**
- User's tweets (original posts)
- Retweets (with original tweet data)
- Quote tweets (with quoted tweet data)
- Replies (if part of user's timeline)
- Promoted tweets (can be filtered)

---

## Endpoint Structure

### URL Pattern

```
https://x.com/i/api/graphql/{QUERY_ID}/UserTweets
```

**Components:**
- `{QUERY_ID}`: A hashed identifier for the specific GraphQL query (e.g., `a3SQAz_VP9k8VWDr9bMcXQ`)
  - This changes periodically when Twitter updates their API
  - Not user-specific; same for all users
  - Can be extracted from x.com's JavaScript bundles

### Full Example URL

```
https://x.com/i/api/graphql/a3SQAz_VP9k8VWDr9bMcXQ/UserTweets?variables=%7B%22userId%22%3A%22329668265%22%2C%22count%22%3A20%2C%22includePromotedContent%22%3Atrue%2C%22withQuickPromoteEligibilityTweetFields%22%3Atrue%2C%22withVoice%22%3Atrue%7D&features=%7B%22rweb_video_screen_enabled%22%3Afalse%2C...%7D&fieldToggles=%7B%22withArticlePlainText%22%3Afalse%7D
```

**URL-Decoded Query Parameters:**
```
variables={"userId":"329668265","count":20,"includePromotedContent":true,...}
features={"rweb_video_screen_enabled":false,"profile_label_improvements_pcf_label_in_post_enabled":true,...}
fieldToggles={"withArticlePlainText":false}
```

---

## Request Parameters

### 1. Variables (Required)

The `variables` parameter controls the core query logic.

**Structure:**
```json
{
  "userId": "329668265",           // Target user's numeric ID
  "count": 20,                      // Number of tweets to return (default: 20)
  "cursor": "DAABCgAB...",          // Pagination cursor (optional, for subsequent pages)
  "includePromotedContent": true,   // Include ads/promoted tweets
  "withQuickPromoteEligibilityTweetFields": true,
  "withVoice": true,                // Include voice tweet data
  "withV2Timeline": true            // Use v2 timeline structure (usually true)
}
```

**Key Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | String | ✅ Yes | Numeric user ID (NOT @username) |
| `count` | Integer | ✅ Yes | Number of tweets per page (max ~100) |
| `cursor` | String | ❌ No | For pagination; omit on first request |
| `includePromotedContent` | Boolean | ⚠️ Optional | Include promoted tweets (usually `true`) |
| `withVoice` | Boolean | ⚠️ Optional | Include voice tweet metadata |

**How to Get User ID:**
- Not directly visible in URLs (only @username is)
- Can be extracted from the first UserTweets response (`user.rest_id`)
- Or use the UserByScreenName GraphQL endpoint first

### 2. Features (Required)

The `features` parameter is a large object of boolean flags that enable/disable various API features.

**Structure (abbreviated):**
```json
{
  "rweb_video_screen_enabled": false,
  "profile_label_improvements_pcf_label_in_post_enabled": true,
  "responsive_web_graphql_timeline_navigation_enabled": true,
  "view_counts_everywhere_api_enabled": true,
  "longform_notetweets_consumption_enabled": true,
  "responsive_web_twitter_article_tweet_consumption_enabled": true,
  "tweet_awards_web_tipping_enabled": false,
  "creator_subscriptions_quote_tweet_preview_enabled": false,
  "responsive_web_enhance_cards_enabled": false
  // ... 30+ more flags
}
```

**Common Important Flags:**

| Flag | Value | Purpose |
|------|-------|---------|
| `view_counts_everywhere_api_enabled` | `true` | Include view counts |
| `longform_notetweets_consumption_enabled` | `true` | Support for long-form tweets |
| `responsive_web_twitter_article_tweet_consumption_enabled` | `true` | Article tweets |
| `responsive_web_graphql_timeline_navigation_enabled` | `true` | Timeline navigation |

**Best Practice:**
- Copy the entire `features` object from a real browser request
- Twitter expects ~40+ feature flags
- Missing flags may cause incomplete data or errors

### 3. Field Toggles (Optional)

```json
{
  "withArticlePlainText": false
}
```

Controls additional field inclusions. Rarely needs modification.

---

## Response Structure

### High-Level Overview

The response is a deeply nested JSON object with this hierarchy:

```
Root
└── data
    └── user
        └── result
            ├── __typename: "User"
            ├── id: "VXNlcjozMjk2NjgyNjU="  (Base64 encoded)
            ├── rest_id: "329668265"
            └── timeline
                └── timeline
                    ├── instructions[]
                    │   ├── [0] { type: "TimelineClearCache" }
                    │   └── [1] { type: "TimelineAddEntries", entries: [...] }
                    └── metadata
                        └── scribeConfig
```

**Key Insight:** The actual tweets are buried deep in `instructions[1].entries[]`.

### Instructions Array

The `instructions` array contains different directive types:

**Common Instruction Types:**

1. **TimelineClearCache**
   ```json
   { "type": "TimelineClearCache" }
   ```
   - Tells client to clear existing timeline cache
   - No data payload
   - Usually the first instruction

2. **TimelineAddEntries**
   ```json
   {
     "type": "TimelineAddEntries",
     "entries": [
       { "entryId": "tweet-2018670639188722113", ... },
       { "entryId": "tweet-2018651303514358197", ... },
       { "entryId": "cursor-bottom-...", ... }
     ]
   }
   ```
   - Contains the actual tweets and cursors
   - Most important instruction for data extraction

3. **TimelineReplaceEntry** (rare)
   - Replaces a specific entry (e.g., updating a tweet)

### Entries Array Structure

Each entry in `TimelineAddEntries.entries[]` can be:

**Entry Types:**

1. **Tweet Entry** (`entryId: "tweet-{tweet_id}"`)
2. **Promoted Tweet** (`entryId: "promoted-tweet-{id}"`)
3. **Cursor Entry** (`entryId: "cursor-top-{id}"` or `"cursor-bottom-{id}"`)
4. **Profile Conversation** (threads)
5. **Who To Follow** (suggestions)

**Entry Structure (Tweet):**

```json
{
  "entryId": "tweet-2018670639188722113",
  "sortIndex": "2018719303452327936",
  "content": {
    "entryType": "TimelineTimelineItem",
    "__typename": "TimelineTimelineItem",
    "itemContent": {
      "itemType": "TimelineTweet",
      "__typename": "TimelineTweet",
      "tweet_results": {
        "result": {
          "__typename": "Tweet",  // or "TweetWithVisibilityResults"
          "rest_id": "2018670639188722113",
          "core": { ... },
          "legacy": { ... },
          "views": { ... }
        }
      }
    }
  }
}
```

---

## Data Extraction Patterns

### Pattern 1: Basic Tweet Data Path

To get to a tweet's core data:

```javascript
const entry = entries[i];

// Check if it's a tweet entry
if (entry.entryId?.startsWith('tweet-')) {
  // Navigate to tweet object
  let tweet = entry.content?.itemContent?.tweet_results?.result;
  
  // Handle wrapper type
  if (tweet?.__typename === 'TweetWithVisibilityResults') {
    tweet = tweet.tweet;  // Unwrap
  }
  
  // Now access tweet data
  const tweetId = tweet.rest_id;
  const legacy = tweet.legacy;
  const user = tweet.core?.user_results?.result;
}
```

**Why the wrapper?**
- `TweetWithVisibilityResults` wraps tweets that have visibility restrictions
- Age-gated content, sensitive media warnings, etc.
- Always unwrap by accessing `.tweet` property

### Pattern 2: User Information

User data is nested within the tweet:

```javascript
const user = tweet.core?.user_results?.result;

if (user) {
  const userId = user.rest_id;              // "329668265"
  const username = user.core?.screen_name;   // "ZubayrAbbasi"
  const displayName = user.core?.name;       // "Zubayr Abbasi"
  const verified = user.is_blue_verified;    // true/false
  const avatar = user.avatar?.image_url;     // Profile pic URL
  
  // Legacy fields (more complete data)
  const legacy = user.legacy;
  const followers = legacy.followers_count;
  const bio = legacy.description;
  const createdAt = user.core?.created_at;  // "Tue Jul 05 12:57:53 +0000 2011"
}
```

### Pattern 3: Tweet Content (Legacy Object)

The `legacy` object contains the actual tweet data:

```javascript
const legacy = tweet.legacy;

// Text content
const fullText = legacy.full_text;  // ⭐ The actual tweet text
const displayRange = legacy.display_text_range;  // [0, 280]

// Timestamps
const createdAt = legacy.created_at;  // "Tue Feb 03 12:59:20 +0000 2026"

// Engagement stats
const stats = {
  retweets: legacy.retweet_count,
  replies: legacy.reply_count,
  likes: legacy.favorite_count,
  quotes: legacy.quote_count,
  bookmarks: legacy.bookmark_count
};

// Flags
const isRetweet = legacy.retweeted_status_result !== undefined;
const isQuote = legacy.is_quote_status;
const isReply = legacy.in_reply_to_status_id_str !== null;

// Language
const lang = legacy.lang;  // "en", "es", "ja", etc.
```

### Pattern 4: Entities (Links, Mentions, Hashtags)

The `entities` object contains structured metadata:

```javascript
const entities = legacy.entities;

// URLs
const urls = entities.urls || [];
for (const url of urls) {
  const shortened = url.url;          // "https://t.co/abc123"
  const expanded = url.expanded_url;  // "https://example.com/full-url"
  const display = url.display_url;    // "example.com/full-url"
  const indices = url.indices;        // [10, 33] - position in text
}

// Mentions
const mentions = entities.user_mentions || [];
for (const mention of mentions) {
  const username = mention.screen_name;  // "elonmusk"
  const name = mention.name;             // "Elon Musk"
  const userId = mention.id_str;         // "44196397"
  const indices = mention.indices;       // [0, 10]
}

// Hashtags
const hashtags = entities.hashtags || [];
for (const tag of hashtags) {
  const text = tag.text;        // "AI" (without #)
  const indices = tag.indices;  // [15, 18]
}

// Media (basic info)
const media = entities.media || [];
for (const m of media) {
  const type = m.type;              // "photo", "video", "animated_gif"
  const url = m.media_url_https;    // High-res URL
  const shortUrl = m.url;           // "https://t.co/xyz"
  const displayUrl = m.display_url; // "pic.x.com/xyz"
}
```

### Pattern 5: Extended Entities (Full Media Data)

For complete media information, use `extended_entities`:

```javascript
const extendedMedia = legacy.extended_entities?.media || [];

for (const media of extendedMedia) {
  const type = media.type;  // "photo", "video", "animated_gif"
  
  if (type === 'photo') {
    const url = media.media_url_https;
    const sizes = media.sizes;  // { large, medium, small, thumb }
    const largeUrl = `${url}?name=large`;
  }
  
  if (type === 'video' || type === 'animated_gif') {
    const variants = media.video_info?.variants || [];
    
    // Find highest quality video
    const mp4Variants = variants.filter(v => v.content_type === 'video/mp4');
    const bestQuality = mp4Variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    const videoUrl = bestQuality?.url;
    
    // Video metadata
    const duration = media.video_info?.duration_millis;
    const aspectRatio = media.video_info?.aspect_ratio;  // [16, 9]
  }
}
```

### Pattern 6: View Counts

View counts are in a separate top-level property:

```javascript
const views = tweet.views;

if (views) {
  const count = views.count;        // "213" (string, not number!)
  const state = views.state;        // "EnabledWithCount" or "Disabled"
}

// Convert to number
const viewCount = views?.count ? parseInt(views.count, 10) : 0;
```

**Important:** View counts are strings, not numbers. Always parse.

### Pattern 7: Retweets

When a tweet is a retweet, the original tweet is nested:

```javascript
const retweetedStatus = legacy.retweeted_status_result?.result;

if (retweetedStatus) {
  // This is a retweet
  const originalTweet = retweetedStatus.legacy;
  const originalAuthor = retweetedStatus.core?.user_results?.result;
  
  const rtText = originalTweet.full_text;
  const rtAuthorUsername = originalAuthor?.core?.screen_name;
  const rtCreatedAt = originalTweet.created_at;
  
  // The retweeter's info is in the outer tweet's user
  const retweeterUsername = tweet.core?.user_results?.result?.core?.screen_name;
}
```

**Retweet Pattern:**
```
Outer Tweet (Retweet)
├── legacy.full_text: "RT @original: ..."
├── core.user_results: (Retweeter info)
└── legacy.retweeted_status_result
    └── result (Original Tweet)
        ├── legacy.full_text: (Original text)
        └── core.user_results: (Original author)
```

### Pattern 8: Quote Tweets

Quote tweets reference another tweet:

```javascript
if (legacy.is_quote_status) {
  const quotedStatusId = legacy.quoted_status_id_str;
  const quotedStatus = legacy.quoted_status_result?.result;
  
  if (quotedStatus) {
    const quotedLegacy = quotedStatus.legacy;
    const quotedAuthor = quotedStatus.core?.user_results?.result;
    
    const quotedText = quotedLegacy.full_text;
    const quotedAuthorUsername = quotedAuthor?.core?.screen_name;
  } else {
    // Quoted tweet may be deleted or unavailable
    console.log('Quoted tweet unavailable');
  }
}
```

### Pattern 9: Threads/Replies

Reply tweets have reference IDs:

```javascript
if (legacy.in_reply_to_status_id_str) {
  const replyToTweetId = legacy.in_reply_to_status_id_str;
  const replyToUserId = legacy.in_reply_to_user_id_str;
  const replyToUsername = legacy.in_reply_to_screen_name;
  
  // Note: The tweet being replied to is NOT included in the response
  // You'd need to fetch it separately
}
```

---

## Pagination & Cursors

### Cursor Entries

Pagination is handled via cursor entries in the `entries` array:

```json
{
  "entryId": "cursor-bottom-2018719303452327916",
  "sortIndex": "2018719303452327916",
  "content": {
    "entryType": "TimelineTimelineCursor",
    "__typename": "TimelineTimelineCursor",
    "value": "DAAHCgABHAPugsd__-wLAAIAAAATMjAxNjg1NzcxMzQ5MDE2NjA5MAgAAwAAAAIAAA",
    "cursorType": "Bottom"
  }
}
```

**Cursor Types:**

| Type | Purpose |
|------|---------|
| `Top` | Previous tweets (older) |
| `Bottom` | Next tweets (newer) |
| `ShowMoreThreads` | Expand threads |
| `ShowMoreThreadsPrompt` | Thread expansion UI |

**How to Use:**

1. Extract bottom cursor from response:
   ```javascript
   const bottomCursor = entries.find(e => 
     e.entryId?.startsWith('cursor-bottom-') &&
     e.content?.cursorType === 'Bottom'
   );
   
   const cursorValue = bottomCursor?.content?.value;
   ```

2. Use in next request:
   ```javascript
   const variables = {
     userId: "329668265",
     count: 20,
     cursor: cursorValue  // Add this
   };
   ```

3. Repeat until no bottom cursor is returned (end of timeline)

**Pagination Example:**

```javascript
async function fetchAllTweets(userId) {
  const allTweets = [];
  let cursor = null;
  
  do {
    const response = await fetchUserTweets(userId, cursor);
    const tweets = extractTweets(response);
    allTweets.push(...tweets);
    
    cursor = extractBottomCursor(response);
  } while (cursor);
  
  return allTweets;
}
```

---

## Tweet Types & Variants

### 1. Regular Tweet

```javascript
{
  __typename: "Tweet",
  legacy: {
    full_text: "This is a regular tweet!",
    retweeted_status_result: undefined,
    is_quote_status: false,
    in_reply_to_status_id_str: null
  }
}
```

### 2. Retweet

```javascript
{
  __typename: "Tweet",
  legacy: {
    full_text: "RT @original: This is the original tweet",
    retweeted_status_result: {
      result: {
        legacy: {
          full_text: "This is the original tweet"
        }
      }
    }
  }
}
```

**Detection:**
```javascript
const isRetweet = tweet.legacy?.retweeted_status_result !== undefined;
```

### 3. Quote Tweet

```javascript
{
  __typename: "Tweet",
  legacy: {
    full_text: "Check out this great tweet!",
    is_quote_status: true,
    quoted_status_id_str: "123456789",
    quoted_status_result: {
      result: { /* quoted tweet data */ }
    }
  }
}
```

### 4. Reply Tweet

```javascript
{
  __typename: "Tweet",
  legacy: {
    full_text: "@someone This is a reply",
    in_reply_to_status_id_str: "987654321",
    in_reply_to_user_id_str: "123",
    in_reply_to_screen_name: "someone"
  }
}
```

### 5. Thread Tweet

```javascript
{
  __typename: "Tweet",
  legacy: {
    full_text: "1/ This is a thread...",
    self_thread: {
      id_str: "2018670639188722113"
    }
  }
}
```

### 6. Long-form Tweet (Note)

```javascript
{
  __typename: "Tweet",
  note_tweet: {
    note_tweet_results: {
      result: {
        id: "123",
        text: "This is a very long tweet that exceeds 280 characters...",
        entity_set: { /* entities for long text */ }
      }
    }
  }
}
```

**Detection:**
```javascript
const isLongForm = tweet.note_tweet?.note_tweet_results?.result?.text !== undefined;
if (isLongForm) {
  const fullText = tweet.note_tweet.note_tweet_results.result.text;
} else {
  const fullText = tweet.legacy.full_text;
}
```

### 7. Tombstone Tweet (Deleted/Restricted)

```javascript
{
  __typename: "TweetTombstone",
  tombstone: {
    text: {
      text: "This Tweet is unavailable"
    }
  }
}
```

**Detection:**
```javascript
if (tweet.__typename === 'TweetTombstone') {
  console.log('Tweet deleted or restricted');
  return null;
}
```

---

## Parsing Strategies

### Strategy 1: Recursive Safe Navigation

Use optional chaining extensively:

```javascript
function safeParse(entry) {
  const tweet = entry?.content?.itemContent?.tweet_results?.result;
  
  if (!tweet) return null;
  
  // Unwrap if needed
  const actualTweet = tweet.__typename === 'TweetWithVisibilityResults' 
    ? tweet.tweet 
    : tweet;
  
  return {
    id: actualTweet?.rest_id,
    text: actualTweet?.legacy?.full_text,
    author: actualTweet?.core?.user_results?.result?.core?.screen_name
  };
}
```

### Strategy 2: Type Guards

Create TypeScript type guards for safety:

```typescript
function isTweetEntry(entry: any): boolean {
  return entry?.entryId?.startsWith('tweet-') &&
         entry?.content?.itemContent?.tweet_results?.result !== undefined;
}

function isCursorEntry(entry: any): boolean {
  return entry?.entryId?.startsWith('cursor-') &&
         entry?.content?.cursorType !== undefined;
}

function isPromotedTweet(entry: any): boolean {
  return entry?.entryId?.startsWith('promoted-');
}
```

### Strategy 3: Defensive Extraction

Always provide fallbacks:

```javascript
function extractTweetData(tweet) {
  const legacy = tweet?.legacy || {};
  const user = tweet?.core?.user_results?.result || {};
  const userLegacy = user?.legacy || {};
  const userCore = user?.core || {};
  
  return {
    id: tweet?.rest_id || 'unknown',
    text: legacy.full_text || '',
    author: {
      username: userCore.screen_name || 'unknown',
      name: userCore.name || 'Unknown User',
      verified: user.is_blue_verified || false
    },
    stats: {
      retweets: legacy.retweet_count || 0,
      likes: legacy.favorite_count || 0,
      replies: legacy.reply_count || 0,
      quotes: legacy.quote_count || 0
    },
    created: legacy.created_at || new Date().toISOString()
  };
}
```

### Strategy 4: Filter Pipeline

Process entries through a filter pipeline:

```javascript
function extractTweets(response) {
  const entries = response?.data?.user?.result?.timeline?.timeline
    ?.instructions?.find(i => i.type === 'TimelineAddEntries')
    ?.entries || [];
  
  return entries
    .filter(isTweetEntry)           // Only tweet entries
    .filter(e => !isPromotedTweet(e)) // No ads
    .map(extractTweetFromEntry)     // Extract data
    .filter(t => t !== null);       // Remove nulls
}
```

---

## Common Gotchas

### Gotcha 1: String vs Number Types

**Problem:** IDs and view counts are strings, not numbers.

```javascript
// ❌ Wrong
if (tweet.rest_id === 2018670639188722113) { }

// ✅ Correct
if (tweet.rest_id === "2018670639188722113") { }

// View counts
const views = parseInt(tweet.views?.count || "0", 10);
```

### Gotcha 2: TweetWithVisibilityResults Wrapper

**Problem:** Some tweets are wrapped in an extra layer.

```javascript
// ❌ Wrong - assumes direct Tweet
const text = tweet.legacy.full_text;  // Error if wrapped

// ✅ Correct - handle both cases
const actualTweet = tweet.__typename === 'TweetWithVisibilityResults' 
  ? tweet.tweet 
  : tweet;
const text = actualTweet.legacy.full_text;
```

### Gotcha 3: Missing User Data

**Problem:** User data might be incomplete or missing.

```javascript
// ❌ Wrong - crashes if user is null
const username = tweet.core.user_results.result.core.screen_name;

// ✅ Correct - safe navigation
const username = tweet?.core?.user_results?.result?.core?.screen_name || 'unknown';
```

### Gotcha 4: Deleted Quoted Tweets

**Problem:** Quoted tweets may be deleted.

```javascript
if (legacy.is_quote_status) {
  // ❌ Wrong - assumes quote exists
  const quotedText = legacy.quoted_status_result.result.legacy.full_text;
  
  // ✅ Correct - check existence
  if (legacy.quoted_status_result?.result) {
    const quotedText = legacy.quoted_status_result.result.legacy.full_text;
  } else {
    console.log('Quoted tweet unavailable');
  }
}
```

### Gotcha 5: Retweet Text Prefix

**Problem:** Retweet text includes "RT @username: " prefix.

```javascript
const legacy = tweet.legacy;

if (legacy.retweeted_status_result) {
  // ❌ Wrong - uses prefixed text
  const text = legacy.full_text;  // "RT @user: original text"
  
  // ✅ Correct - use original tweet text
  const originalText = legacy.retweeted_status_result.result.legacy.full_text;
}
```

### Gotcha 6: Multiple Media vs Single Photo

**Problem:** `entities.media` only shows first item.

```javascript
// ❌ Wrong - only gets first photo
const media = legacy.entities.media;

// ✅ Correct - use extended_entities for all media
const allMedia = legacy.extended_entities?.media || legacy.entities?.media || [];
```

### Gotcha 7: Cursor Exhaustion

**Problem:** Not checking if cursor exists before next request.

```javascript
// ❌ Wrong - infinite loop if no cursor
do {
  const response = await fetch(url);
  cursor = extractCursor(response);
} while (true);

// ✅ Correct - check cursor existence
do {
  const response = await fetch(url);
  cursor = extractCursor(response);
} while (cursor);  // Stops when cursor is null/undefined
```

### Gotcha 8: Tombstone Tweets

**Problem:** Deleted tweets return tombstone objects.

```javascript
// ❌ Wrong - tries to parse tombstone
const text = tweet.legacy.full_text;  // Error: tombstones have no legacy

// ✅ Correct - check typename first
if (tweet.__typename === 'TweetTombstone') {
  return null;  // Skip deleted tweets
}
const text = tweet.legacy.full_text;
```

### Gotcha 9: Rate Limiting

**Problem:** No explicit error for rate limits.

```javascript
// Response when rate limited (status 429):
{
  "errors": [
    {
      "message": "Rate limit exceeded",
      "code": 88
    }
  ]
}

// ✅ Check for errors first
if (response.errors) {
  const rateLimited = response.errors.some(e => e.code === 88);
  if (rateLimited) {
    console.log('Rate limited, wait 15 minutes');
    return;
  }
}
```

### Gotcha 10: Long-form Tweet Text

**Problem:** Long tweets have text in different location.

```javascript
// ❌ Wrong - misses long-form tweets
const text = tweet.legacy.full_text;  // Truncated for long tweets

// ✅ Correct - check both locations
const text = tweet.note_tweet?.note_tweet_results?.result?.text 
  || tweet.legacy?.full_text 
  || '';
```

---

## Example Code

### Complete Tweet Parser

```typescript
interface SimplifiedTweet {
  id: string;
  text: string;
  createdAt: string;
  author: {
    id: string;
    username: string;
    name: string;
    verified: boolean;
  };
  stats: {
    retweets: number;
    likes: number;
    replies: number;
    quotes: number;
    views: number;
  };
  media: Array<{
    type: string;
    url: string;
  }>;
  type: 'tweet' | 'retweet' | 'quote' | 'reply';
}

function parseUserTweetsResponse(data: any): SimplifiedTweet[] {
  // Navigate to instructions
  const instructions = data?.data?.user?.result?.timeline?.timeline?.instructions || [];
  
  // Find TimelineAddEntries instruction
  const addEntriesInstruction = instructions.find(
    (i: any) => i.type === 'TimelineAddEntries'
  );
  
  if (!addEntriesInstruction) {
    return [];
  }
  
  const entries = addEntriesInstruction.entries || [];
  
  // Filter and parse tweets
  const tweets: SimplifiedTweet[] = [];
  
  for (const entry of entries) {
    // Skip non-tweet entries
    if (!entry.entryId?.startsWith('tweet-')) {
      continue;
    }
    
    // Skip promoted content
    if (entry.entryId?.startsWith('promoted-')) {
      continue;
    }
    
    const parsedTweet = parseTweetEntry(entry);
    if (parsedTweet) {
      tweets.push(parsedTweet);
    }
  }
  
  return tweets;
}

function parseTweetEntry(entry: any): SimplifiedTweet | null {
  try {
    // Navigate to tweet result
    let tweet = entry?.content?.itemContent?.tweet_results?.result;
    
    if (!tweet) {
      return null;
    }
    
    // Unwrap TweetWithVisibilityResults
    if (tweet.__typename === 'TweetWithVisibilityResults') {
      tweet = tweet.tweet;
    }
    
    // Handle tombstones (deleted tweets)
    if (tweet.__typename === 'TweetTombstone') {
      return null;
    }
    
    const legacy = tweet.legacy;
    const user = tweet.core?.user_results?.result;
    
    if (!legacy || !user) {
      return null;
    }
    
    // Determine tweet type
    let type: 'tweet' | 'retweet' | 'quote' | 'reply' = 'tweet';
    if (legacy.retweeted_status_result) {
      type = 'retweet';
    } else if (legacy.is_quote_status) {
      type = 'quote';
    } else if (legacy.in_reply_to_status_id_str) {
      type = 'reply';
    }
    
    // Extract text (check for long-form)
    const text = tweet.note_tweet?.note_tweet_results?.result?.text 
      || legacy.full_text 
      || '';
    
    // Extract media
    const mediaArray = legacy.extended_entities?.media 
      || legacy.entities?.media 
      || [];
    
    const media = mediaArray.map((m: any) => ({
      type: m.type,
      url: m.media_url_https
    }));
    
    // Parse view count
    const viewCount = tweet.views?.count 
      ? parseInt(tweet.views.count, 10) 
      : 0;
    
    return {
      id: tweet.rest_id,
      text: text,
      createdAt: legacy.created_at,
      author: {
        id: user.rest_id,
        username: user.core?.screen_name || 'unknown',
        name: user.core?.name || 'Unknown',
        verified: user.is_blue_verified || false
      },
      stats: {
        retweets: legacy.retweet_count || 0,
        likes: legacy.favorite_count || 0,
        replies: legacy.reply_count || 0,
        quotes: legacy.quote_count || 0,
        views: viewCount
      },
      media: media,
      type: type
    };
  } catch (error) {
    console.error('Failed to parse tweet entry:', error);
    return null;
  }
}

function extractBottomCursor(data: any): string | null {
  const instructions = data?.data?.user?.result?.timeline?.timeline?.instructions || [];
  
  const addEntriesInstruction = instructions.find(
    (i: any) => i.type === 'TimelineAddEntries'
  );
  
  if (!addEntriesInstruction) {
    return null;
  }
  
  const entries = addEntriesInstruction.entries || [];
  
  const cursorEntry = entries.find((e: any) => 
    e.entryId?.startsWith('cursor-bottom-') &&
    e.content?.cursorType === 'Bottom'
  );
  
  return cursorEntry?.content?.value || null;
}
```

### Pagination Example

```typescript
async function fetchAllUserTweets(
  userId: string,
  maxTweets: number = 1000
): Promise<SimplifiedTweet[]> {
  const allTweets: SimplifiedTweet[] = [];
  let cursor: string | null = null;
  
  while (allTweets.length < maxTweets) {
    // Build variables
    const variables = {
      userId: userId,
      count: 20,
      includePromotedContent: false,
      withVoice: true,
      withV2Timeline: true
    };
    
    if (cursor) {
      variables.cursor = cursor;
    }
    
    // Fetch data
    const response = await fetchUserTweetsAPI(variables);
    
    // Check for errors
    if (response.errors) {
      console.error('API Error:', response.errors);
      break;
    }
    
    // Parse tweets
    const tweets = parseUserTweetsResponse(response);
    
    if (tweets.length === 0) {
      console.log('No more tweets');
      break;
    }
    
    // Add to collection
    allTweets.push(...tweets);
    
    // Get next cursor
    cursor = extractBottomCursor(response);
    
    if (!cursor) {
      console.log('Reached end of timeline');
      break;
    }
    
    // Rate limit protection
    await sleep(1000);
  }
  
  return allTweets;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Summary

### Key Takeaways for AI Agents

1. **Deep Nesting:** Twitter's GraphQL responses are heavily nested. Always use optional chaining.

2. **Type Variants:** Tweets can be wrapped in `TweetWithVisibilityResults`. Always unwrap.

3. **String IDs:** All IDs are strings, never numbers. Don't use strict equality with numbers.

4. **Legacy Object:** The `legacy` property contains the actual tweet data (text, stats, entities).

5. **Extended Entities:** Use `extended_entities` for complete media arrays, not `entities`.

6. **Cursor Pagination:** Bottom cursors are for forward pagination. Check existence to avoid loops.

7. **Retweet Structure:** Original tweet is nested in `retweeted_status_result.result`.

8. **Tombstones:** Check `__typename === 'TweetTombstone'` before parsing.

9. **Rate Limits:** Response code 88 in errors array means rate limited.

10. **Features Object:** Copy the entire features object from browser requests; Twitter expects ~40 flags.

### Best Practices

- ✅ Always use optional chaining (`?.`)
- ✅ Provide fallback values (`|| ''`, `|| 0`)
- ✅ Check `__typename` before accessing properties
- ✅ Filter out promoted content (`promoted-tweet-`)
- ✅ Handle both regular and long-form tweet text
- ✅ Parse view counts as integers
- ✅ Use `extended_entities` for media
- ✅ Implement rate limit backoff
- ✅ Deduplicate tweets by ID
- ✅ Log errors for debugging

### Anti-Patterns

- ❌ Assuming fixed structure without optional chaining
- ❌ Using number comparisons for IDs
- ❌ Ignoring `TweetWithVisibilityResults` wrapper
- ❌ Using `entities.media` instead of `extended_entities`
- ❌ Not checking for tombstones
- ❌ Infinite pagination loops
- ❌ Missing long-form tweet text
- ❌ Not handling rate limits
- ❌ Storing duplicate tweets

---

**Document Version:** 1.0  
**Last Updated:** February 2026  
**API Version:** GraphQL (Reverse-engineered from x.com web client)
