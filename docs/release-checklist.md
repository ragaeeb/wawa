# Release Checklist

1. Run `bun run check`.
2. Run `bun run test:coverage` and verify core module coverage >= 80%.
3. Run `bun run build` and `bun run zip`.
4. Execute manual smoke checklist in `docs/smoke-checklist.md`.
5. Validate extension installs in latest Chrome stable.
6. Confirm manifest permissions are unchanged and minimal.
7. Bump version in `package.json` and `wxt.config.ts`.
8. Tag release and attach zipped artifact from `.output`.
