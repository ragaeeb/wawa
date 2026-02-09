# AGENTS.md

This file is the operational guide for AI agents working in this repository.

## Project Summary

**Wawa** is a Chromium Manifest V3 extension that exports X/Twitter timeline data locally.

Core constraints:
- Local-first only: no telemetry, no server uploads.
- Resume support for large exports.
- Rate-limit aware collection flow.
- Chromium only (no Firefox/polyfills).

## Source of Truth

Use these first:
1. `README.md`
2. `docs/smoke-checklist.md`
3. `docs/release-checklist.md`
4. Current implementation under `src/**` and `entrypoints/**`

If docs conflict with code, treat code + tests as source of truth and update docs.

## Stack

- Build: WXT + Vite
- Language: TypeScript (strict)
- Package manager / runtime: Bun
- Testing: `bun:test` + Happy DOM
- Lint/format: Biome

## Repo Map

- `entrypoints/` WXT extension entrypoints
- `src/content/` content-runtime orchestration and UI wiring
- `src/core/` platform-agnostic logic (resume, merge, timeline, rate-limit, metadata)
- `src/platform/chrome/` Chrome adapters
- `src/types/` shared domain + messaging types
- `tests/integration/` integration tests (storage/messaging/runtime)
- `tests/setup/` test preloads/mocks
- `public/icons/` extension icons bundled by WXT

## Non-Negotiable Engineering Rules

1. Use `bun` for all commands (`bun run ...`, `bun test`, etc.).
2. Keep imports using `@/*` alias for `src/*` (avoid long relative imports for src modules).
3. Prefer `type` over `interface`.
4. Prefer arrow functions over `function` declarations.
5. Prefer inferred return types unless explicit typing is required for correctness/narrowing.
6. Keep tests in `it('should ...')` style.
7. Keep unit tests adjacent to implementations when adding/changing core logic.
8. Do not introduce telemetry/branding/paid prompts.
9. Do not add Firefox/Safari compatibility work in this repo.

## Quality Gates

Before considering work complete, run:

```bash
bun run check
bun run build
```

`bun run check` enforces:
- TypeScript compile (`tsc --noEmit`)
- Biome lint
- Tests with coverage

Coverage gate:
- `src/core/**` must stay at **>= 99%** lines and functions
- Enforced by `scripts/check-core-coverage.ts`

## High-Risk Areas (Read Before Editing)

1. Resume persistence: `src/core/resume/storage.ts`
- IndexedDB is primary, chunked payloads are intentional.
- `chrome.storage.local` fallback must remain compatible.
- Username scoping + max-age expiration prevent cross-account stale resume issues.

2. Resume merge correctness: `src/core/resume/merge.ts`, `src/core/export/meta.ts`
- Final export must consolidate old + new tweets.
- Merge metadata fields must stay accurate (`previous_count`, `new_count`, `duplicates_removed`, `final_count`).

3. Lifecycle/rate-limit transitions: `src/core/rate-limit/state.ts`
- Avoid ad-hoc booleans; preserve FSM transitions.
- Prevent false "done" after cooldown/manual resume.

4. Message contracts: `src/types/messages.ts`, `src/core/background/service.ts`
- Update message unions and response map together.
- Add/update integration tests when changing contracts.

## Typical Change Workflow

1. Add/modify pure logic in `src/core/**` first.
2. Wire through `src/content/**` or `src/platform/chrome/**`.
3. Add/update tests (adjacent unit tests + integration test if boundary behavior changed).
4. Run `bun run check` and `bun run build`.
5. Update docs only if behavior/contracts changed.

## Release Notes / Versioning

- Releases are based on conventional commits via CI.
- `feat:` -> minor, `fix:`/`perf:`/`refactor:` -> patch, `!`/`BREAKING CHANGE` -> major.
- Version bumps are automated via `scripts/semantic-version-bump.ts`.

## Keep This File Lean

Only keep durable, repo-specific guidance here.
Remove duplicated tutorials or generic examples that can drift from reality.
