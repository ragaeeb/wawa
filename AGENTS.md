# AGENTS.md

This document provides comprehensive guidance for AI agents interacting with the Wawa codebase.

## Project Overview

**Wawa** is a Chrome Manifest V3 extension for local X/Twitter data export. It intercepts Twitter's GraphQL API responses to enable complete tweet exports without relying on official APIs, which often miss replies and have strict rate limits.

### Core Purpose

- **Local-first**: All data stays on the user's machine
- **Complete exports**: Captures replies that official APIs miss
- **Resume capability**: Large exports can be paused and resumed
- **Rate-limit aware**: Handles Twitter's rate limiting gracefully

## Technology Stack

- **Build System**: WXT + Vite
- **Language**: TypeScript (strict mode)
- **Runtime**: Bun (test runner + package manager)
- **Testing**: `bun:test` + Happy DOM
- **Linting**: Biome
- **Target**: Chromium-based browsers (Manifest V3)

## Project Structure

```
wawa/
├── .github/workflows/      # CI/CD pipelines
│   ├── ci.yml             # PR and push validation
│   └── release.yml        # Automated semantic releases
├── docs/                  # Documentation
│   ├── release-checklist.md
│   └── smoke-checklist.md
├── entrypoints/           # Extension entry points (WXT convention)
│   ├── background.ts      # Service worker
│   ├── content.ts         # Content script
│   ├── interceptor.inject.ts  # Fetch/XHR interceptor
│   └── popup/             # Extension popup UI
├── scripts/               # Build and release automation
│   ├── check-core-coverage.ts
│   └── semantic-version-bump.ts
├── src/
│   ├── core/              # Platform-agnostic business logic
│   │   ├── background/    # Background service logic
│   │   ├── export/        # Export metadata assembly
│   │   ├── rate-limit/    # Rate limit state machine
│   │   ├── resume/        # Resume/merge logic
│   │   ├── timeline/      # Tweet extraction from GraphQL
│   │   └── ui/            # UI utilities
│   ├── platform/chrome/   # Chrome-specific adapters
│   ├── content/           # Content script bootstrap
│   ├── legacy/            # Legacy content script (not shown)
│   └── types/             # TypeScript definitions
├── tests/setup/           # Test configuration
└── wxt.config.ts          # WXT build configuration
```

## Architecture Principles

### 1. Separation of Concerns

- **Core Logic** (`src/core/`): Pure business logic, no browser APIs
- **Platform Adapters** (`src/platform/`): Browser-specific implementations
- **Entry Points** (`entrypoints/`): WXT-managed extension contexts

### 2. Interception Strategy

The extension uses a **fetch/XMLHttpRequest interceptor** injected into the page context:

```typescript
// entrypoints/interceptor.inject.ts
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  
  // Intercept GraphQL responses
  if (url.includes('/graphql/') && url.includes('UserTweets')) {
    const data = await response.clone().json();
    window.postMessage({
      type: 'TWEXPORT_INTERCEPTED_RESPONSE',
      payload: { url, data, rateLimitInfo }
    }, '*');
  }
  
  return response;
};
```

**Why this approach?**
- Twitter's official API doesn't return all replies consistently
- Using `SearchTimeline` endpoint captures more complete conversation threads
- Interception allows resume capability without re-requesting data

### 3. Storage Strategy

**Two-tier storage system:**

1. **Primary**: IndexedDB (for large payloads)
   - Chunked storage (512KB chunks)
   - Version 2 manifest format with chunk metadata
   
2. **Fallback**: `chrome.storage.local`
   - Used when IndexedDB fails
   - Same chunking strategy

**Why chunking?**
- Chrome storage has size limits
- Large exports (25k+ tweets) exceed single-item limits
- Chunking enables progressive loading

### 4. State Machine

Export lifecycle uses a finite state machine:

```
idle → running → cooldown → running
              → paused_rate_limit → running
              → pending_done
              → cancelled
              → completed
```

See `src/core/rate-limit/state.ts` for implementation.

## Code Conventions

### TypeScript

- **Strict mode enabled** with additional checks:
  ```json
  {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true
  }
  ```
- **Explicit return types** for public functions
- **Avoid `any`**: Use `unknown` and type guards
- **Optional chaining**: Prefer `?.` over manual null checks
- **Type aliases over interfaces**: Prefer `type` for object/type definitions.
- **Arrow functions over function declarations**: Prefer `const fn = (...) => {}` style for module and local functions.

Legacy exception:
- `src/legacy/**` may retain function declarations until that code is fully migrated out; apply the above rules to all non-legacy TypeScript code.

### Testing

**Naming Convention:**
```typescript
describe('module name', () => {
  it('should perform expected behavior', () => {
    // Arrange
    const input = createTestData();
    
    // Act
    const result = functionUnderTest(input);
    
    // Assert
    expect(result).toBe(expected);
  });
});
```

**Always use `it('should...')`** - not `it('does...')` or `it('can...')`.

**Test File Naming:**
- `module.test.ts` - unit tests for `module.ts`
- Place tests next to implementation files

**Coverage Requirements:**
- **Core modules** (`src/core/**`): ≥99% line and function coverage
- Run: `bun run test:coverage`
- Enforced by: `scripts/check-core-coverage.ts`

### Package Management

**Always use `bun`:**
```bash
# ✅ Correct
bun install
bun run dev
bun test

# ❌ Incorrect
npm install
yarn dev
pnpm test
```

### Code Style

- **Biome** is the source of truth
- Run `bun run lint` before committing
- Auto-fix: `bun run format`

**Key style rules:**
- Tab width: 2 spaces
- Max line length: 100 chars
- Semicolons: required
- Quotes: double quotes
- Trailing commas: always (except ES5)

## Working with the Codebase

### Running Development

```bash
# Install dependencies
bun install

# Start development mode (auto-reload)
bun run dev

# Load unpacked extension in Chrome:
# 1. Navigate to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select .output/chrome-mv3 directory
```

### Building for Production

```bash
# Full validation pipeline
bun run check

# Build extension
bun run build

# Create distributable zip
bun run zip
# Output: .output/twexport-minimal-{version}-chrome.zip
```

### Testing

```bash
# Run all tests
bun test

# Run tests with coverage
bun run test:coverage

# Run specific test file
bun test src/core/resume/merge.test.ts

# Watch mode
bun test --watch
```

### Key Commands

| Command | Purpose |
|---------|---------|
| `bun run dev` | Development mode with hot reload |
| `bun run build` | Production build |
| `bun run zip` | Create distributable archive |
| `bun run typecheck` | TypeScript validation |
| `bun run lint` | Biome linting |
| `bun run format` | Auto-format code |
| `bun run test` | Run test suite |
| `bun run test:coverage` | Tests + coverage check |
| `bun run check` | Full validation (typecheck + lint + test) |

## Common Tasks

### Adding a New Feature

1. **Create core logic** in `src/core/`
   ```typescript
   // src/core/my-feature/processor.ts
   export function processData(input: unknown): Result {
     // Pure business logic
   }
   ```

2. **Add tests**
   ```typescript
   // src/core/my-feature/processor.test.ts
   import { describe, expect, it } from "bun:test";
   
   describe('data processor', () => {
     it('should process valid input correctly', () => {
       const result = processData({ valid: 'data' });
       expect(result.success).toBe(true);
     });
   });
   ```

3. **Create platform adapter** (if needed)
   ```typescript
   // src/platform/chrome/my-feature.ts
   import { processData } from '../../core/my-feature/processor';
   
   export async function chromeSpecificWrapper() {
     const data = await chrome.storage.local.get('key');
     return processData(data);
   }
   ```

4. **Integrate into entry point**
   ```typescript
   // entrypoints/background.ts or content.ts
   import { chromeSpecificWrapper } from '../src/platform/chrome/my-feature';
   ```

5. **Run validation**
   ```bash
   bun run check
   ```

### Modifying Storage

When changing stored data structures:

1. **Update TypeScript types** in `src/types/domain.ts`
2. **Increment storage version** if breaking changes
3. **Add migration logic** in storage adapters
4. **Update tests** to cover migration paths

Example:
```typescript
// src/core/resume/storage.ts
const SERIALIZED_CHUNK_VERSION = 3; // Increment

function migrate(oldData: OldFormat): NewFormat {
  // Migration logic
}
```

### Adding New Message Types

1. **Define message type** in `src/types/messages.ts`:
   ```typescript
   export interface MyNewMessage {
     type: 'myNewAction';
     payload: MyPayload;
   }
   
   export type RuntimeMessage = 
     | ExistingMessage
     | MyNewMessage;
   
   export interface RuntimeResponseMap {
     myNewAction: MyResponse;
   }
   ```

2. **Handle in background service**:
   ```typescript
   // src/core/background/service.ts
   async function handleMessage(message: RuntimeMessage) {
     switch (message.type) {
       case 'myNewAction':
         return await handleMyNewAction(message.payload);
     }
   }
   ```

3. **Add tests** for the handler

### Debugging

**Console Logs:**
- All logs use `buildLogEntry()` from `src/core/ui/logger.ts`
- Logs are visible in:
  - Browser console (with timestamps)
  - Extension popup (Debug Logs section)

**Common Issues:**

1. **"Interceptor not injecting"**
   - Check `web_accessible_resources` in manifest
   - Verify content script `matches` patterns
   - Look for CSP violations in console

2. **"Storage quota exceeded"**
   - Check chunk size in `src/core/resume/storage.ts`
   - Verify cleanup is running after exports
   - Test with smaller datasets

3. **"Rate limit not detected"**
   - Verify interceptor is capturing 429 responses
   - Check `x-rate-limit-*` headers are present
   - Confirm rate limit info reaches content script

## Important Design Decisions

### Why SearchTimeline over UserTweets?

Twitter's UserTweets GraphQL endpoint doesn't consistently return replies, even when they should appear on a user's profile. SearchTimeline (`from:username`) captures more complete data:

```typescript
// UserTweets misses these:
// - Some replies to others
// - Threads not starting with user's tweet
// - Certain visibility-filtered content

// SearchTimeline captures:
// - All tweets matching "from:username"
// - More reliable reply inclusion
// - Better for comprehensive exports
```

**Trade-off**: SearchTimeline has stricter rate limits, hence the careful rate-limit state machine.

### Why Chunked Storage?

Chrome's `chrome.storage.local` has a 10MB total limit (8KB per item in sync storage). A typical export:

- 1000 tweets ≈ 2-5MB JSON
- 10000 tweets ≈ 20-50MB JSON
- 25000+ tweets ≈ 100MB+ JSON

**Chunking strategy:**
- 512KB chunks (allows ~20 items in storage)
- Manifest tracks chunk count
- Sequential reads for reconstruction

### Why IndexedDB + Fallback?

**IndexedDB**:
- ✅ Unlimited storage (with user permission)
- ✅ Asynchronous, doesn't block UI
- ❌ Can fail in private/incognito modes
- ❌ Quota prompts can confuse users

**chrome.storage.local fallback**:
- ✅ Always available
- ✅ No quota prompts for extensions
- ❌ 10MB total limit
- ✅ Works in all modes

**Strategy**: Try IndexedDB first, fall back to chrome.storage if it fails.

### Why State Machine for Rate Limits?

Twitter's rate limiting is complex:
- 15-minute windows
- Different limits per endpoint
- Unpredictable resets
- Cooldown periods

State machine benefits:
- **Explicit states** prevent race conditions
- **Activity tracking** enables "looks done" detection
- **Cooldown → running** transition resets timers
- **Testable**: Pure state transitions

## Release Process

### Semantic Versioning

Automated via `scripts/semantic-version-bump.ts`:

**Commit Message → Version Bump:**
- `feat:` → minor bump (0.1.0 → 0.2.0)
- `fix:`, `perf:`, `refactor:`, `revert:` → patch (0.1.0 → 0.1.1)
- `!` suffix or `BREAKING CHANGE:` → major (0.1.0 → 1.0.0)
- Other types → no release

**Examples:**
```bash
# Minor bump
git commit -m "feat(export): add user profile metadata"

# Patch bump
git commit -m "fix(storage): handle quota exceeded errors"

# Major bump
git commit -m "feat(api)!: change export payload format"
git commit -m "refactor: remove legacy storage format

BREAKING CHANGE: Old payloads no longer compatible"

# No release
git commit -m "chore: update dependencies"
git commit -m "docs: fix typo in README"
```

### CI/CD Pipeline

**On every push/PR:**
1. Typecheck
2. Lint
3. Run tests with coverage
4. Build extension
5. Upload artifacts

**On main branch (release.yml):**
1. Determine semantic version bump
2. Validate project (`bun run check`)
3. Update `package.json` version
4. Commit and tag
5. Build and zip extension
6. Create GitHub release with artifact

**Manual checklist before release:**
See `docs/release-checklist.md` and `docs/smoke-checklist.md`.

## Type System Guide

### Key Type Patterns

**Runtime Message Types:**
```typescript
// Discriminated union for type safety
type RuntimeMessage = 
  | { type: 'log'; entry: LogEntry }
  | { type: 'getLogs' }
  | { type: 'exportComplete'; username: string; count: number };

// Response mapping
type RuntimeResponseFor<T extends RuntimeMessage> = 
  T extends { type: infer K }
    ? K extends keyof RuntimeResponseMap
      ? RuntimeResponseMap[K]
      : never
    : never;
```

**Timeline Extraction:**
```typescript
// Generic extraction with custom builders
type TimelineRowBuilder<T> = (
  tweetResult: Record<string, unknown>,
  type: TweetItemType
) => T | null;

extractTimeline(data, (tweet, type) => ({
  id: tweet.rest_id,
  type
}));
```

**Storage Interfaces:**
```typescript
// Abstraction for testing
interface SettingsStore {
  get(): Promise<ExtensionSettings>;
  set(settings: Partial<ExtensionSettings>): Promise<void>;
}

// Chrome implementation
function createChromeSettingsStore(): SettingsStore {
  return {
    get: () => chrome.storage.local.get(DEFAULT_SETTINGS),
    set: (s) => chrome.storage.local.set(s)
  };
}
```

### Type Guards

Use type guards for runtime validation:

```typescript
function isValidTweetResult(data: unknown): data is TweetResult {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as { __typename?: string };
  return candidate.__typename === 'Tweet';
}
```

## Testing Strategy

### Test Organization

```
src/core/
├── export/
│   ├── meta.ts            # Implementation
│   └── meta.test.ts       # Tests
├── resume/
│   ├── merge.ts
│   ├── merge.test.ts
│   ├── payload.ts
│   └── payload-parse.test.ts
```

### Test Fixtures

Create realistic fixtures based on actual Twitter responses:

```typescript
const mockTwitterResponse = {
  data: {
    user: {
      result: {
        timeline_v2: {
          timeline: {
            instructions: [/* ... */]
          }
        }
      }
    }
  }
};
```

### Testing Chrome APIs

Use mocks from `tests/setup/chrome-mocks.ts`:

```typescript
// Tests automatically have chrome.* mocked
it('should save settings to chrome storage', async () => {
  await saveSettings({ minimalData: true });
  
  // chrome.storage.local.set was called
  expect(chrome.storage.local.set).toHaveBeenCalledWith({
    minimalData: true,
    includeReplies: false,
    maxCount: 0
  });
});
```

### Coverage Enforcement

Core modules must maintain ≥80% coverage:

```bash
$ bun run test:coverage

[coverage] core lines: 87.23% (412/472), core funcs: 91.15% (104/114)
[coverage] threshold passed (>= 80.00%)
```

## Troubleshooting Guide

### Extension Not Loading

1. Check manifest version in `wxt.config.ts` matches `package.json`
2. Verify all entry points compile: `bun run build`
3. Look for errors in `.output/chrome-mv3/`

### Interceptor Not Capturing

1. **Verify injection**: Open DevTools → Sources → Content Scripts
2. **Check console** for "INTERCEPTOR READY" message
3. **Inspect network**: Ensure GraphQL requests are being made
4. **Check URL patterns**: `*://*.x.com/*` and `*://*.twitter.com/*`

### Resume Not Working

1. **Check IndexedDB**: DevTools → Application → IndexedDB → `twexport_resume_db`
2. **Verify fallback**: DevTools → Application → Storage → `chrome.storage.local`
3. **Test with smaller dataset**: <1000 tweets to isolate chunking issues
4. **Check age**: Payloads expire after 6 hours

### Rate Limit Issues

1. **Monitor headers**: Network tab → Response headers → `x-rate-limit-*`
2. **Check state machine**: Add console logs in `reduceExportLifecycle`
3. **Verify cooldown timing**: Ensure 15-minute windows are respected

### Build Failures

1. **TypeScript errors**: `bun run typecheck`
2. **Lint errors**: `bun run lint` (auto-fix: `bun run format`)
3. **Test failures**: `bun test` (verbose: `bun test --verbose`)
4. **Coverage**: `bun run test:coverage`

## Contributing Guidelines

### Before Committing

1. Run full validation:
   ```bash
   bun run check
   ```

2. Ensure tests pass:
   ```bash
   bun test
   ```

3. Format code:
   ```bash
   bun run format
   ```

### Commit Messages

Follow Conventional Commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, semicolons, etc.)
- `refactor`: Code change without adding features or fixing bugs
- `perf`: Performance improvement
- `test`: Adding or updating tests
- `chore`: Build process, dependencies, etc.

**Scopes:** `export`, `resume`, `storage`, `ui`, `interceptor`, `ci`, etc.

### Pull Requests

1. Create feature branch: `git checkout -b feat/my-feature`
2. Make changes with conventional commits
3. Push and create PR
4. CI will run validation automatically
5. Ensure all checks pass

## Resources

- **WXT Documentation**: https://wxt.dev
- **Chrome Extensions**: https://developer.chrome.com/docs/extensions/mv3/
- **Bun Documentation**: https://bun.sh/docs
- **Twitter API Reverse Engineering**: Inspect GraphQL requests in DevTools

## Quick Reference

### File Patterns

| Pattern | Purpose |
|---------|---------|
| `src/core/**/*.ts` | Business logic (platform-agnostic) |
| `src/core/**/*.test.ts` | Unit tests |
| `src/platform/chrome/**/*.ts` | Chrome API adapters |
| `entrypoints/*.ts` | Extension contexts (WXT) |
| `scripts/*.ts` | Build automation |
| `tests/setup/*.ts` | Test configuration |

### Import Patterns

```typescript
// ✅ Good: Relative imports within same directory
import { helper } from './utils';

// ✅ Good: Absolute from core
import { extractTimeline } from '../../core/timeline/extract';

// ✅ Good: Types
import type { TweetItem } from '../../types/domain';

// ❌ Bad: Don't import platform code in core
import { chrome } from '../../platform/chrome'; // NO!
```

### Constants

```typescript
// Storage
RESUME_DB.NAME = 'twexport_resume_db'
STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK = 'twexport_resume_payload'

// Limits
MAX_LOG_ENTRIES = 500
SERIALIZED_CHUNK_SIZE = 512 * 1024 // 512KB
DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000 // 6 hours

// Coverage
CORE_COVERAGE_THRESHOLD = 80 // percent
```

---

**Last Updated**: 2026-02-08  
**Project Version**: 0.4.0  
**Maintainer**: Ragaeeb Haq (@ragaeeb)
