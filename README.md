# Wawa

[![wakatime](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/ebf7bc77-8963-4111-a529-44493103d104.svg)](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/ebf7bc77-8963-4111-a529-44493103d104)
[![codecov](https://codecov.io/gh/ragaeeb/wawa/graph/badge.svg?token=U3L07NUFHW)](https://codecov.io/gh/ragaeeb/wawa)
[![CI](https://github.com/ragaeeb/wawa/actions/workflows/ci.yml/badge.svg)](https://github.com/ragaeeb/wawa/actions/workflows/ci.yml)
[![Release](https://github.com/ragaeeb/wawa/actions/workflows/release.yml/badge.svg)](https://github.com/ragaeeb/wawa/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.9-black.svg)](https://bun.sh)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://chrome.google.com/webstore)

> **Wawa** (formerly Wawa Minimal) is a privacy-focused Chrome extension for complete local exports of your X/Twitter data—no telemetry, no server uploads, just your data on your machine.

## ✨ Features

- 🔒 **100% Local**: All data stays on your device, never sent to external servers
- 📊 **Complete Exports**: Captures replies and threads that official APIs miss
- ⏸️ **Pause & Resume**: Export large accounts (25k+ tweets) with automatic resume capability
- 🚦 **Rate Limit Aware**: Intelligent handling of Twitter's rate limits with auto-cooldowns
- 💾 **Smart Storage**: Chunked IndexedDB storage with automatic fallback for large datasets
- 🎯 **Minimal Permissions**: Only requests necessary permissions for core functionality
- 🧪 **80%+ Test Coverage**: Core business logic thoroughly tested

## 🚀 Quick Start

### Installation

#### From Source

```bash
# Clone the repository
git clone https://github.com/ragaeeb/wawa.git
cd wawa

# Install dependencies (requires Bun 1.3.9+)
bun install

# Build the extension
bun run build

# Load in Chrome:
# 1. Navigate to chrome://extensions
# 2. Enable "Developer mode" (top-right toggle)
# 3. Click "Load unpacked"
# 4. Select the .output/chrome-mv3 directory
```

#### From Release

1. Download the latest `.zip` from [Releases](https://github.com/ragaeeb/wawa/releases)
2. Extract the archive
3. Follow steps 1-4 above, selecting the extracted directory

### Usage

1. **Navigate** to any X/Twitter profile (e.g., `https://x.com/username`)
2. **Click** the "📜 Export Tweets" button injected into the page
3. **Wait** for the export to complete (or pause and resume later)
4. **Download** your data as a JSON file

The extension popup shows real-time logs and export status.

## 📖 Documentation

- **[AGENTS.md](AGENTS.md)**: Comprehensive guide for AI agents and developers
- **[Release Checklist](docs/release-checklist.md)**: Pre-release validation steps
- **[Smoke Tests](docs/smoke-checklist.md)**: Manual testing checklist

## 🏗️ Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         User's Browser                       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Popup UI   │  │   Content    │  │  Background  │      │
│  │  (HTML/CSS)  │  │   Script     │  │Service Worker│      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                            │                                 │
│                   ┌────────▼────────┐                        │
│                   │  Interceptor    │                        │
│                   │  (Fetch/XHR)    │                        │
│                   └────────┬────────┘                        │
│                            │                                 │
│                   ┌────────▼────────┐                        │
│                   │ X/Twitter Page  │                        │
│                   │  GraphQL API    │                        │
│                   └─────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
         │                                          │
         ▼                                          ▼
  ┌─────────────┐                          ┌──────────────┐
  │  IndexedDB  │                          │chrome.storage│
  │   (Primary) │                          │  (Fallback)  │
  └─────────────┘                          └──────────────┘
```

### Component Breakdown

#### 1. **Interceptor Script** (`entrypoints/interceptor.inject.ts`)

**Purpose**: Intercepts Twitter's GraphQL API responses in real-time.

**How it works**:
- Patches `window.fetch` and `XMLHttpRequest.prototype`
- Listens for specific GraphQL endpoints:
  - `UserTweets`: User's main timeline
  - `UserTweetsAndReplies`: Includes replies
  - `UserMedia`: Media-only tweets
  - `SearchTimeline`: Advanced search results
- Forwards responses via `window.postMessage` to content script
- Captures rate limit headers (`x-rate-limit-*`)

**Why this approach**:
```javascript
// Official API often misses replies:
GET /api/1.1/statuses/user_timeline.json?user_id=123
// Returns: ~3200 tweets max, incomplete replies

// Our approach captures SearchTimeline:
POST /graphql/SearchTimeline
// Payload: { "rawQuery": "from:username" }
// Returns: More complete data, including elusive replies
```

Twitter's REST API v1.1 and v2 have documented limitations:
- Maximum 3,200 tweets via `user_timeline`
- Replies often excluded from results
- High-engagement threads fragmented

By intercepting `SearchTimeline`, we capture the same data Twitter's own web UI uses, ensuring completeness.

#### 2. **Content Script** (`src/content/`)

**Purpose**: Orchestrates export workflow on X/Twitter pages.

**Responsibilities**:
- Injects "Export Tweets" UI button
- Listens for intercepted GraphQL responses
- Manages export state machine (idle → running → paused → completed)
- Handles resume logic from IndexedDB
- Triggers file downloads

**State Machine**:
```typescript
type ExportState = 
  | "idle"               // No export in progress
  | "running"            // Actively collecting tweets
  | "cooldown"           // Waiting for rate limit window
  | "paused_rate_limit"  // User intervention needed (429 error)
  | "pending_done"       // Awaiting user confirmation
  | "cancelled"          // Export stopped by user
  | "completed";         // Export finished

// Transitions:
idle → running → cooldown → running
              → paused_rate_limit → running (manual resume)
              → pending_done → completed
```

#### 3. **Background Service Worker** (`src/background/`)

**Purpose**: Central message hub and persistent state manager.

**Responsibilities**:
- Routes messages between popup, content script, and storage
- Maintains log buffer (last 500 entries)
- Tracks export summaries
- Manages extension settings

**Message Flow**:
```typescript
// Content script logs activity:
sendMessage({ type: 'log', entry: { level: 'info', message: '...' } });

// Popup requests logs:
const { logs } = await sendMessage({ type: 'getLogs' });

// Background maintains logs in memory (no disk I/O for logs)
```

#### 4. **Storage Layer** (`src/core/resume/storage.ts`)

**Purpose**: Persist large export payloads across sessions.

**Two-Tier Strategy**:

1. **Primary: IndexedDB**
   - **Database**: `wawa_resume_db`
   - **Store**: `resume_payloads`
   - **Advantages**: Unlimited storage (with user permission), async API
   - **Challenges**: Can fail in incognito mode, quota prompts

2. **Fallback: chrome.storage.local**
   - **Key**: `wawa_resume_payload`
   - **Advantages**: Always available, no quota prompts for extensions
   - **Limitations**: 10MB total limit for entire extension

**Chunking Mechanism**:

```typescript
// Large export example:
const exportData = {
  tweets: [...], // 25,000 tweets ≈ 100MB JSON
  meta: { /* metadata */ }
};

// Serialized size: ~100MB
const serialized = JSON.stringify(exportData);

// Split into 512KB chunks:
const chunks = [
  serialized.slice(0, 524288),      // Chunk 0
  serialized.slice(524288, 1048576), // Chunk 1
  // ... ~195 more chunks
];

// Store with manifest:
await indexedDB.put('active:manifest', {
  version: 2,
  chunkCount: chunks.length
});

await Promise.all(
  chunks.map((chunk, i) => 
    indexedDB.put(`active:chunk:${i}`, chunk)
  )
);

// Reconstruction:
const manifest = await indexedDB.get('active:manifest');
const allChunks = await Promise.all(
  Array.from({ length: manifest.chunkCount }, (_, i) =>
    indexedDB.get(`active:chunk:${i}`)
  )
);
const reconstructed = JSON.parse(allChunks.join(''));
```

**Why 512KB chunks?**
- `chrome.storage.local` allows ~8KB per key (chrome.storage.sync)
- `chrome.storage.local` has 10MB total limit
- 512KB balances:
  - Fewer DB transactions (< 200 for 100MB export)
  - Fits comfortably within Chrome's item size limits
  - Fast sequential reads during resume

#### 5. **Resume & Merge Logic** (`src/core/resume/`)

**Purpose**: Enable pause/resume for long-running exports.

**Workflow**:

1. **Initial Export**:
   ```typescript
   const payload: ResumePayload = {
     username: 'johndoe',
     saved_at: Date.now(),
     meta: {
       export_started_at: '2026-02-08T10:00:00Z',
       collected_count: 5000,
       scroll_responses_captured: 25
     },
     tweets: [/* 5000 tweets */]
   };
   await resumeStorage.persist(payload);
   ```

2. **Resume (Next Session)**:
   ```typescript
   const previous = await resumeStorage.restore('johndoe');
   // Returns payload if username matches and age < 6 hours
   
   // User resumes export, collects 3000 more tweets
   const newTweets = [/* 3000 additional tweets */];
   
   // Merge with deduplication:
   const { tweets, mergeInfo } = mergeTweets(newTweets, previous.tweets);
   // tweets: [/* 7800 unique tweets (200 duplicates removed) */]
   ```

3. **Deduplication Strategy**:
   ```typescript
   function tweetKey(tweet: TweetItem): string {
     if (tweet.id) return `id:${tweet.id}`;
     // Fallback for tweets without IDs:
     return `${tweet.created_at}:${tweet.text}`;
   }
   
   // Prefer richer object in duplicates:
   function pickRicherTweet(a: TweetItem, b: TweetItem): TweetItem {
     const aSize = Object.keys(a).length;
     const bSize = Object.keys(b).length;
     return bSize > aSize ? b : a;
   }
   ```

**Why this matters**:
- Large accounts (50k+ tweets) take 30+ minutes to export
- Rate limits may pause exports mid-way
- Browser crashes shouldn't lose hours of work
- Resumes preserve all previous progress

#### 6. **Rate Limit Handling** (`src/core/rate-limit/`)

**Purpose**: Gracefully handle Twitter's API rate limiting.

**Detection**:
```typescript
// Interceptor catches 429 responses:
if (response.status === 429) {
  const rateLimitInfo = {
    limit: response.headers.get('x-rate-limit-limit'),        // e.g., "150"
    remaining: response.headers.get('x-rate-limit-remaining'), // e.g., "0"
    reset: response.headers.get('x-rate-limit-reset')          // Unix timestamp
  };
  
  window.postMessage({
    type: 'WAWA_RATE_LIMIT',
    payload: { rateLimitInfo }
  }, '*');
}
```

**State Transitions**:
```typescript
// Normal operation:
running → activity detected → running

// Rate limit hit:
running → pause_rate_limit (wait for reset)

// Auto-cooldown (proactive):
running → enter_cooldown (after N requests)
        → exit_cooldown (after delay)
        → running

// Manual intervention:
paused_rate_limit → resume_manual → running
```

**Example Timeline**:
```
10:00 - Export starts (limit: 150/15min)
10:05 - 50 requests made (remaining: 100)
10:10 - 120 requests made (remaining: 30)
10:12 - 149 requests made (remaining: 1)
10:12 - Enter cooldown (proactive)
10:27 - Exit cooldown (15min elapsed, limit reset)
10:27 - Resume export
```

**Why proactive cooldowns?**
- Avoids hard 429 errors
- Better user experience (no sudden stops)
- Maintains Twitter account health

## 🧬 Core Design Decisions

### Why Not Use Official Twitter API?

**Official API Limitations**:

| Feature | REST API v1.1 | REST API v2 | GraphQL (Our Approach) |
|---------|---------------|-------------|------------------------|
| Max Tweets | 3,200 | 3,200 | Unlimited (rate-limited) |
| Replies Included | ❌ Unreliable | ⚠️ Partial | ✅ Complete |
| Rate Limit | 900/15min | 1,500/15min | 150/15min |
| Authentication | OAuth 1.0a | OAuth 2.0 | Existing session |
| User Burden | API keys required | Developer account | None |

**Our approach**:
- Uses Twitter's own GraphQL endpoints (same as web UI)
- Leverages user's existing session (no API keys)
- Captures `SearchTimeline` for complete reply coverage
- Trades rate limit strictness for data completeness

**Example of missed replies**:

```javascript
// Official API call:
GET https://api.twitter.com/1.1/statuses/user_timeline.json
    ?screen_name=johndoe&count=200

// Response:
{
  "statuses": [
    { "id": "1", "text": "Main tweet" },
    { "id": "2", "text": "Another main tweet" }
    // Missing: Reply to @otherperson
    // Missing: Threaded replies
  ]
}

// Our intercepted GraphQL call:
POST https://x.com/i/api/graphql/ABC123/SearchTimeline
{
  "rawQuery": "from:johndoe",
  "count": 20
}

// Response includes:
{
  "data": {
    "search_by_raw_query": {
      "search_timeline": {
        "timeline": {
          "instructions": [
            { "entries": [
              { "tweet": "Main tweet" },
              { "tweet": "Reply to @otherperson" }, // ✅ Captured
              { "tweet": "Thread continuation" }    // ✅ Captured
            ]}
          ]
        }
      }
    }
  }
}
```

### Why IndexedDB + chrome.storage.local Fallback?

**Problem**: Chrome extensions have storage constraints.

**Option 1: chrome.storage.local Only**
- ❌ 10MB total limit
- ❌ Accounts with 10k+ tweets exceed limit
- ✅ Always available

**Option 2: IndexedDB Only**
- ✅ Unlimited storage (with user permission)
- ❌ Fails in incognito mode
- ❌ Quota prompts can scare users

**Our Solution: Hybrid**
1. **Try IndexedDB first** (for large exports)
2. **Fall back to chrome.storage.local** (for reliability)
3. **Chunk both** (for consistency)

**Real-World Scenario**:
```javascript
// User exports 30k tweets in normal mode:
// → Uses IndexedDB (~120MB), no issues

// User switches to incognito, resumes export:
// → IndexedDB fails (privacy restriction)
// → Falls back to chrome.storage.local
// → Warns user if export exceeds 10MB
// → Suggests completing in normal mode
```

### Why Chunked Storage?

**Without Chunking**:
```javascript
// Attempt to store 100MB export:
const exportData = JSON.stringify({ tweets: [...] }); // 100MB string
await chrome.storage.local.set({ 'export': exportData });
// ❌ Error: QUOTA_BYTES_PER_ITEM quota exceeded
```

**With Chunking**:
```javascript
// Split into 512KB chunks:
const chunks = splitIntoChunks(exportData, 512 * 1024);
// chunks.length === 195

// Store manifest:
await chrome.storage.local.set({
  'manifest': { version: 2, chunkCount: 195 }
});

// Store chunks:
await Promise.all(
  chunks.map((chunk, i) =>
    chrome.storage.local.set({ [`chunk:${i}`]: chunk })
  )
);
// ✅ Success: Each item < 512KB
```

**Benefits**:
- Works around Chrome's per-item size limits
- Enables progressive loading (stream chunks)
- Shared implementation between IndexedDB and chrome.storage

### Why State Machine for Export Lifecycle?

**Problem**: Export workflow has complex, asynchronous transitions.

**Naive Approach (Boolean Flags)**:
```javascript
let isExporting = false;
let isPaused = false;
let isRateLimited = false;
let isWaitingForConfirmation = false;

// Leads to:
// - Race conditions (simultaneous state changes)
// - Impossible states (isExporting && isPaused && isRateLimited)
// - Hard to test
```

**State Machine Approach**:
```typescript
type ExportState = 
  | "idle" | "running" | "cooldown" 
  | "paused_rate_limit" | "pending_done" 
  | "cancelled" | "completed";

function transition(
  state: ExportState, 
  action: ExportAction
): ExportState {
  // Single source of truth
  // Explicit transitions
  // Testable
}
```

**Benefits**:
- **Explicit**: Only valid transitions allowed
- **Testable**: Pure functions, easy to unit test
- **Debuggable**: Logs show exact state progression
- **Predictable**: No unexpected state combinations

**Example Test**:
```typescript
it('should transition from cooldown to running on exit', () => {
  let state = { status: 'cooldown', lastActivityAt: 1000 };
  state = reduceExportLifecycle(state, { 
    type: 'exit_cooldown', 
    at: 5000 
  });
  
  expect(state.status).toBe('running');
  expect(state.lastActivityAt).toBe(5000); // Reset activity timer
});
```

## 🛠️ Development

### Prerequisites

- **Bun** 1.3.9 or later
- **Node.js** 24 or later (for compatibility)
- **Chrome/Chromium** latest stable

### Setup

```bash
# Clone repository
git clone https://github.com/ragaeeb/wawa.git
cd wawa

# Install dependencies
bun install

# Run development mode (auto-reload on changes)
bun run dev
```

### Project Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start development server with hot reload |
| `bun run build` | Production build |
| `bun run zip` | Create distributable `.zip` archive |
| `bun run typecheck` | Validate TypeScript types |
| `bun run lint` | Lint code with Biome |
| `bun run format` | Auto-format code |
| `bun test` | Run test suite |
| `bun run test:coverage` | Run tests with coverage check |
| `bun run check` | Full validation (typecheck + lint + test) |

### Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test src/core/resume/merge.test.ts

# Watch mode
bun test --watch

# Coverage report
bun run test:coverage
```

**Coverage Requirements**:
- Core modules (`src/core/**`): ≥80% line and function coverage
- Enforced in CI/CD pipeline
- Script: `scripts/check-core-coverage.ts`

### Code Quality

**TypeScript Configuration**:
```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true,
  "useUnknownInCatchVariables": true
}
```

**Linting**:
- **Tool**: Biome
- **Config**: `.biome.json` (not shown, WXT defaults)
- **Auto-fix**: `bun run format`

### Debugging

**Console Logs**:
```typescript
// All logs use structured logging:
import { buildLogEntry, emitConsoleLog } from './src/core/ui/logger';

const entry = buildLogEntry('info', 'Export started', { username: 'johndoe' });
emitConsoleLog(entry); // Logs to console
sendMessage({ type: 'log', entry }); // Sends to background for popup display
```

**View Logs**:
1. **Browser Console**: DevTools → Console → Filter `[Wawa]`
2. **Extension Popup**: Click extension icon → Debug Logs section

**Inspect Storage**:
1. **IndexedDB**: DevTools → Application → IndexedDB → `wawa_resume_db`
2. **Chrome Storage**: DevTools → Application → Storage → Extension → `chrome.storage.local`

## 📦 Release Process

### Versioning

Automated semantic versioning based on commit messages:

| Commit Type | Version Bump | Example |
|-------------|--------------|---------|
| `feat:` | Minor (0.1.0 → 0.2.0) | `feat(export): add profile metadata` |
| `fix:`, `perf:` | Patch (0.1.0 → 0.1.1) | `fix(storage): handle quota errors` |
| `BREAKING CHANGE:` | Major (0.1.0 → 1.0.0) | `feat!: change export format` |
| `docs:`, `chore:` | None | `docs: update README` |

### Workflow

1. **Commit** with conventional commit message:
   ```bash
   git commit -m "feat(resume): add auto-save every 1000 tweets"
   ```

2. **Push** to `main` branch:
   ```bash
   git push origin main
   ```

3. **CI Pipeline** (automatic):
   - Determines version bump from commits since last release
   - Runs `bun run check` (typecheck + lint + tests)
   - Updates `package.json` and `wxt.config.ts` versions
   - Creates Git tag (`v0.5.0`)
   - Builds extension
   - Creates GitHub release with `.zip` artifact

4. **Manual Steps** (see `docs/release-checklist.md`):
   - Run smoke tests
   - Verify extension installs in Chrome
   - Test core workflows (export, resume, rate limit)

### Pre-Release Checklist

Before pushing to `main`:

1. ✅ `bun run check` passes
2. ✅ Core coverage ≥80%
3. ✅ Manual smoke tests pass (see `docs/smoke-checklist.md`)
4. ✅ Extension installs without errors
5. ✅ Test export on real Twitter profile
6. ✅ Test resume with existing payload

## 🤝 Contributing

Contributions are welcome! Please read [AGENTS.md](AGENTS.md) for detailed development guidelines.

### Quick Contribution Guide

1. **Fork** the repository
2. **Create** a feature branch:
   ```bash
   git checkout -b feat/my-feature
   ```
3. **Make** changes with conventional commits:
   ```bash
   git commit -m "feat(export): add option to export media URLs"
   ```
4. **Test** your changes:
   ```bash
   bun run check
   ```
5. **Push** and create a Pull Request
6. **Wait** for CI checks to pass

### Code Style

- **Formatter**: Biome (auto-fix: `bun run format`)
- **Naming**: camelCase for variables/functions, PascalCase for types
- **Imports**: Relative within directory, absolute from root
- **Tests**: `it('should...')` convention

## 📄 License

[MIT](LICENSE) © 2026 Ragaeeb Haq

## 🙏 Acknowledgments

- **WXT**: Modern web extension framework
- **Bun**: Blazing fast JavaScript runtime and test runner
- **Biome**: Lightning-fast linter and formatter
- **Twitter/X**: For the GraphQL API (reverse-engineered)

## 📬 Contact

- **Author**: Ragaeeb Haq
- **GitHub**: [@ragaeeb](https://github.com/ragaeeb)
- **Issues**: [GitHub Issues](https://github.com/ragaeeb/wawa/issues)

---

**Built with ❤️ for privacy-conscious Twitter users.**
