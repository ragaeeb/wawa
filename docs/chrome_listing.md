# Chrome Web Store Listing

## Short Description (132 characters max)

Export your X/Twitter history and download videos locally. No servers, no tracking, just private tools that run on your machine.

## Detailed Description (16,000 characters max)

**Take Control of Your Twitter/X Data**

Wawa is a privacy-focused Chrome extension that lets you export your complete X/Twitter history and download X/Twitter videos directly to your own computer. No cloud uploads, no third-party servers, no tracking. Your data stays yours.

🔒 **100% Local & Private**
• All processing happens in your browser
• No data sent to external servers
• No analytics, no telemetry, no tracking
• Open source and auditable: https://github.com/ragaeeb/wawa

📊 **Complete Exports (Not Just 3,200 Tweets)**
• Captures replies that official APIs miss
• Exports threads and conversations
• Includes all engagement metrics
• Uses the same data Twitter's own web UI shows

🎬 **Direct Video Downloads**
• Adds a Download button on detected X/Twitter videos
• Saves the MP4 directly from Twitter's own media host
• Works on tweet detail pages and in-feed videos
• No external downloader service involved

⏸️ **Pause & Resume for Large Accounts**
• Export 10,000+ tweets without time pressure
• Resume exactly where you left off
• Automatic checkpoint saving every 1,000 tweets
• Handles rate limits intelligently

💾 **Smart Storage Management**
• Chunked storage for 100MB+ exports
• Automatic cleanup after completion
• IndexedDB primary + chrome.storage fallback
• No quota worries for large accounts

**How It Works**

1. **Install** the extension from Chrome Web Store
2. **Navigate** to any X/Twitter profile (including your own)
3. **Click** the "📜 Export Tweets" button that appears
4. **Wait** for collection (or pause and resume later)
5. **Download** your data as a clean JSON file
6. **Click** the `Download` button on videos when you want the MP4 file

**What Gets Exported**

Your export includes:
• Tweet text and timestamps
• Author information (username, display name, verified status)
• Engagement counts (likes, retweets, replies, views)
• Media URLs (images, videos, links)
• Conversation threads
• Quote tweets and retweets

**Why Wawa vs. Official Archive?**

| Feature | Wawa | Twitter Archive Request |
|---------|------|-------------------------|
| Speed | Minutes | 24-48 hours |
| Frequency | Unlimited | Once/week |
| Format | Clean JSON | Complex ZIP |
| Replies | ✅ Complete | ⚠️ Limited |
| Resume | ✅ Yes | ❌ No |
| Privacy | 100% Local | Uploaded to Twitter servers |

**Technical Features**

• **Zero Dependencies**: No external libraries or trackers
• **Manifest V3**: Future-proof Chrome extension architecture
• **TypeScript**: Type-safe, maintainable codebase
• **80%+ Test Coverage**: Thoroughly tested core logic
• **Open Source**: MIT licensed, community-driven

**Privacy Commitment**

We take your privacy seriously:

✅ **No Data Collection**: We don't see, store, or transmit your data
✅ **No Analytics**: No usage tracking or telemetry
✅ **No Remote Code**: All code bundled with extension
✅ **No Third Parties**: No external services or APIs called
✅ **Transparent**: Fully open source for auditing

Read our full Privacy Policy: https://github.com/ragaeeb/wawa/blob/main/PRIVACY_POLICY.md

**Use Cases**

• **Personal Archive**: Back up your tweet history before deactivation
• **Research**: Analyze your posting patterns and engagement
• **Migration**: Move your data to other platforms
• **Content Creators**: Archive your threads and viral tweets
• **Compliance**: Retain records for professional/legal purposes
• **Deletion Planning**: Review what you've posted before bulk deletion

**Rate Limit Friendly**

Wawa respects Twitter's API limits:
• Monitors rate limit headers in real-time
• Auto-pauses when limits approached
• Shows countdown to limit reset
• Resume with one click when ready

**System Requirements**

• Chrome, Edge, Brave, or any Chromium-based browser
• Minimum version: Chrome 88+ (Manifest V3 support)
• Works on: Windows, macOS, Linux, Chrome OS

**Support & Development**

• **Report Issues**: https://github.com/ragaeeb/wawa/issues
• **Request Features**: GitHub Discussions
• **Source Code**: https://github.com/ragaeeb/wawa
• **License**: MIT (free and open source)

**Developer**: Ragaeeb Haq (https://github.com/ragaeeb)

**Disclaimer**

Wawa is not affiliated with X Corp or Twitter, Inc. This is an independent tool built for data portability and user privacy. By using this extension, you agree to comply with X/Twitter's Terms of Service.

---

**Made with ❤️ for privacy-conscious users who believe data should belong to its creator.**

---

## Single Purpose Statement

**Single Purpose**: Enable users to save their own X/Twitter content locally from the X/Twitter web app, including tweet-history exports and direct video downloads, without relying on external servers.

**Narrow Description**: This extension serves one specific function: local-first capture and download of a user's own visible X/Twitter content from the X/Twitter web app. It intercepts X/Twitter responses already loaded in the page, stores export data locally in the browser, observes Twitter-hosted video media requests so users can save those videos, and provides local downloads. It does not:
- Send data to remote servers
- Track user behavior
- Modify X/Twitter's interface beyond adding export and video-download buttons
- Interact with other websites or services

---

## Permission Justifications

### 1. `storage`

**Purpose**: Store user preferences and temporary export progress.

**Justification**: 
- **User Settings**: Persists export preferences (minimal data mode, include replies, max tweet count) selected by users in the extension popup
- **Resume Functionality**: Stores in-progress exports so users can pause and resume large exports (critical for accounts with 10,000+ tweets that take 30+ minutes)
- **Fallback Storage**: When IndexedDB is unavailable (e.g., incognito mode), `chrome.storage.local` serves as the fallback for temporary export data

**Without This Permission**: 
- Users would lose all progress if the browser crashes or is closed
- Export preferences would reset on every browser restart
- Large accounts (25k+ tweets) would be impossible to export in one session

**Data Stored**:
```json
{
  "minimalData": true,
  "includeReplies": false,
  "maxCount": 0,
  "wawa_resume_payload": {
    "username": "johndoe",
    "tweets": [...],
    "saved_at": 1707350400000
  }
}
```

**Security**: 
- All data stored is generated by the extension itself (no external data)
- Automatically cleared when export completes or after 6 hours of inactivity
- User can manually clear via extension popup

---

### 2. `unlimitedStorage`

**Purpose**: Store large tweet export datasets that exceed Chrome's default storage quota.

**Justification**:
- **Default Quota Insufficient**: Chrome's standard storage quota is ~10MB for extensions
- **Real-World Export Sizes**:
  - 1,000 tweets ≈ 2-5 MB JSON
  - 10,000 tweets ≈ 20-50 MB JSON
  - 25,000+ tweets ≈ 100 MB+ JSON
- **Resume Requirement**: Must store complete partial exports to enable pause/resume functionality

**Without This Permission**:
- Users with >5,000 tweets would hit quota limits
- Exports would fail mid-process with "quota exceeded" errors
- Resume functionality would be impossible for any meaningful export

**How It's Used**:
- Stores temporary export payloads in IndexedDB (`wawa_resume_db`)
- Data is chunked into 512KB pieces for efficient storage
- Automatically deleted after export completion or 6-hour expiry

**Not Used For**:
- Permanent data storage (only temporary during active exports)
- Caching web content
- Storing user browsing history

---

### 3. Host Permissions: `*://*.x.com/*`

**Purpose**: Inject export functionality and intercept GraphQL API responses on X/Twitter pages.

**Justification**:

**Content Script Injection** (`content.ts`):
- Adds "📜 Export Tweets" button to X/Twitter profile pages
- Listens for intercepted API responses via `window.postMessage`
- Orchestrates export workflow (start, pause, resume, download)

**Interceptor Script** (`interceptor.inject.ts`):
- Patches `window.fetch` and `XMLHttpRequest` to capture GraphQL responses
- Monitors these specific endpoints:
  - `UserTweets`: User's main timeline
  - `UserTweetsAndReplies`: Includes replies
  - `UserMedia`: Media-only tweets
  - `SearchTimeline`: Advanced search (captures more complete data)
- Forwards intercepted data to content script
- Extracts rate limit headers to prevent excessive requests

**Why Twitter Domains Only**:
- Extension has no functionality on other websites
- Does not track browsing across the web
- Cannot access data from other services

**Without This Permission**:
- Cannot inject export button into X/Twitter pages
- Cannot intercept API responses (extension would be non-functional)
- No way to collect tweet data

**Security & Privacy**:
- Does not modify X/Twitter's UI beyond adding export button
- Does not alter API requests (read-only interception)
- Does not send intercepted data to external servers
- All processing happens locally in the browser

---

### 4. `downloads`

**Purpose**: Save export files and X/Twitter video files directly to the user's device.

**Justification**:
- **Export Files**: Wawa already needs to save collected JSON exports to disk.
- **Video Files**: The new downloader saves MP4 files from X/Twitter videos when the user explicitly clicks `Download`.
- **User Control**: Chrome's download flow lets the user choose where files go.

**Without This Permission**:
- Export completion could not trigger a file save through the extension APIs
- Video download buttons would not be able to start actual downloads

---

### 5. `webRequest`

**Purpose**: Observe X/Twitter video media requests so the extension can resolve the best downloadable MP4 URL for the current tab.

**Justification**:
- X/Twitter videos are served from `video.twimg.com`
- The content script can detect a `<video>` element, but the best downloadable MP4 URL is often only visible when the browser requests it
- `webRequest` lets the background service map those media requests to the active tab and selected tweet video

**Without This Permission**:
- The extension would see the page video element but often would not know which Twitter-hosted MP4 URL to download
- The download feature would be unreliable on many tweet pages

---

### 6. Host Permission: `*://video.twimg.com/*`

**Purpose**: Allow the extension to observe and download X/Twitter-hosted video assets.

**Justification**:
- X/Twitter serves video files from `video.twimg.com`, not from `x.com`
- The background service watches requests to this host to capture the active MP4 variant
- The download API then saves that same Twitter-hosted URL locally for the user

**Without This Permission**:
- Video download would not function reliably because the extension could not observe or resolve the Twitter video asset URL

---

## Remote Code Declaration

**Does this extension use remote code?** 

**NO**

**Explanation**:

Wawa does **not** use remote code. All code is:

✅ **Bundled**: All JavaScript, TypeScript, HTML, and CSS is compiled and packaged during build time
✅ **Static**: No dynamic `eval()`, `Function()`, or `new Function()` calls
✅ **No External Scripts**: No `<script src="https://...">` loading from CDNs or external servers
✅ **No WebAssembly Loading**: No dynamically loaded `.wasm` modules
✅ **No Remote API Calls**: Extension makes zero network requests to external servers

**Build Process**:
1. TypeScript source code in `src/` directory
2. Compiled by WXT + Vite bundler
3. Output to `dist/chrome-mv3/` directory
4. All code is static and reviewable in the submitted ZIP

**Verification**:
You can verify this by inspecting the built extension:
- `dist/chrome-mv3/content-scripts/content.js` - all code is inline
- `dist/chrome-mv3/background.js` - all code is inline
- `dist/chrome-mv3/interceptor.js` - all code is inline

**Content Security Policy**:
Our manifest CSP implicitly enforces:
```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self';"
  }
}
```

This prevents loading any remote code even if we wanted to.

**Network Activity**:
The extension intercepts existing network requests made by X/Twitter's web interface but does not initiate any new requests to external servers. All intercepted data is processed locally.

---

## Additional Information

### Screenshots Recommended

1. **Extension popup** showing logs and controls
2. **Export button** on a Twitter profile page
3. **Export in progress** with progress indicator
4. **Downloaded JSON file** example
5. **Settings interface** (if applicable)

### Promotional Tile Suggestions

**Small Tile (440x280)**:
- Wawa logo/icon
- Text: "Your Data, Your Device"
- Subtext: "100% Local Twitter Exports"

**Large Tile (920x680)**:
- Split screen: Twitter profile → JSON file
- Arrow indicating data flow (staying on device)
- Text: "Export Twitter History Locally"

**Marquee (1400x560)**:
- Timeline illustration with tweets flowing into local storage
- Icons: Lock (privacy) + Download (ownership)
- Tagline: "Own Your Twitter Archive"

### Category

**Productivity** - Helps users manage and archive their social media data

### Language Support

- English (primary)
- Internationalization ready (UI strings can be externalized)

---

**Version**: 1.0.0  
**Last Updated**: February 8, 2026
