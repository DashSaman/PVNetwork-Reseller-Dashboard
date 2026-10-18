# Admin backup restore implementation plan

**Goal:** Ship the approved fresh-install-only restore flow in the repository and production.
**Spec:** ../specs/2026-10-17-admin-backup-restore-design.md
**Execution:** Native implementation in this chat, as explicitly requested by the user.
**Architecture:** Stream an authenticated upload to a private bounded staging area;
validate SQLite/schema/keys and return a secret-free preview. Confirm with current
admin credentials, then queue an offline restart-time install of DB and key.
**Tech stack:** Next route handlers, React, Python stdlib SQLite/ZIP, Node crypto, Docker.

## Invariants and review focus

- Fresh means no Reseller, ResellerUser, ResellerInbound, PanelConfig, OperationJournal or Setting rows.
- Max 64 MiB upload, 512 MiB expanded; token bound to admin and SHA, expires after 15 minutes.
- DB and effective secret never replaced under a running Prisma process.
- Startup retries an interrupted install from immutable staged files; no mixed-key Node startup.
- No native-panel calls, Docker socket, host env/ports/network/firewall changes in restore.
- Production only receives the feature; never run restore against its real data.

## Tasks

- [x] 1. Add failing Python tests: preview counts/integrity/schema, populated target refusal,
  corrupted archive, interrupted install retry and stable DB/key. Implement private staging
  inspection and idempotent cold-start installation in scripts/dashboard-restore.py.
- [x] 2. Add crypto/runtime-key tests. Validate all encrypted fields and peers with the archived
  key; support the persistent data-volume key in app, backup timer and peer CLI.
- [x] 3. Add API fixture tests for anonymous/reseller rejection, occupied target, streaming size,
  same-origin, credential/2FA confirmation, expired/foreign/reused token and no external writes.
  Implement restore helper/routes and pending-state request gate.
- [x] 4. Add upload/preview/confirm/restart UI in existing backup tab; test desktop/mobile.
- [x] 5. Verify startup and cross-key restore in isolated production-image containers with
  synthetic data and no production mounts or published ports; run backup/node/accounting regressions,
  TypeScript, lint and production build. Document actual results.
- [x] 6. Preserve production DB/env/image and unrelated service baseline; deploy just dashboard
  using same bind/network/volume/env. Verify fresh-only refusal on actual populated dashboard,
  unchanged real data and unrelated services/ports. Publish source, docs and local memory.

Verification record: ../../admin-backup-restore-verification-2026-10-18.md
Ruling: Equivalent legacy BOOLEAN defaults are normalized without altering data.
Ruling: Restore upload bypasses proxy body cloning; its own stream cap and pending gate remain enforced.
Ruling: Destination data directory must match the configured cold-start installer before enabling restore.
