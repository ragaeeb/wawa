# Release Checklist

1. Run `bun run check`.
2. Verify `bun run check` completed with core module coverage >= 99%.
3. Run `bun run build` and `bun run zip`.
4. Execute manual smoke checklist in `docs/smoke-checklist.md`.
5. Validate extension installs in latest Chrome stable.
6. Confirm manifest permissions are correct for export plus video download (`storage`, `unlimitedStorage`, `downloads`, `webRequest`, X/Twitter hosts, `video.twimg.com`).
7. Confirm release versioning will be handled by CI from conventional commits.
8. Tag release and attach zipped artifact from `.output`.
