# TwExport Minimal

TwExport Minimal is a Chromium MV3 extension for local X/Twitter export workflows.

## Tech Stack

- WXT + Vite (build/runtime)
- TypeScript (strict)
- Bun (`bun:test` + Happy DOM)
- Biome (lint + formatting)

## Commands

- `bun install`
- `bun run dev`
- `bun run build`
- `bun run zip`
- `bun run typecheck`
- `bun run lint`
- `bun run test`
- `bun run test:coverage`
- `bun run check`

## Notes

- Browser target is latest Chromium-based browsers only.
- Resume payloads are persisted in IndexedDB with `chrome.storage.local` fallback.
- See `docs/smoke-checklist.md` and `docs/release-checklist.md` before release.
