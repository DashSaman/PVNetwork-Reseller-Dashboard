# Reseller handover implementation plan

> Execute directly with the existing isolated fixture pattern, one task at a time.

**Goal:** Let the administrator remove a reseller from the active list while their
users remain managed and keep their existing quota and expiry.

**Architecture:** Setting-backed closed ownership groups, no schema migration;
signed preview plus reseller lock and transaction. Existing native client lifecycle
is unchanged. Next/Prisma/SQLite, existing React dialogs and tables.

**Spec:** ../specs/2026-11-01-reseller-handover-design.md

## Tasks and validation

- [x] Reproduce the missing handover using `scripts/test-reseller-handover-api.mjs`
  with two synthetic users and loopback native endpoints; observe failure first.
- [x] Add `src/lib/reseller-ownership.ts`, the admin handover route, preview data,
  authentication/reactivation guards, filtered reseller listing/counts and retained
  historical ledger labels. Cover stale previews, incomplete operations, retries,
  disabled/archived authentication, unchanged native data and subscription delivery.
- [x] Add admin users API/tab and replace the misleading remove dialog with preview,
  explicit typed confirmation, retry/error state and the handover action. Verify
  actual desktop/mobile behavior using a disposable browser fixture.
- [ ] Run relevant regression suites, TypeScript, ESLint and production build. Test
  the actual candidate image without networking, host ports or production mounts.
- [x] Compare official native-panel capabilities and document current gaps and useful
  candidates, distinguishing installed-version observations from upstream features.
- [ ] Push, back up and replace only this dashboard. Compare all live customer and
  account rows and unrelated services/ports. Never execute the real handover.
  Record accepted revision, image, test results and backup in incident docs/memory.
