# Scoped Customer Management Implementation Plan

> Implementation is direct in this session under the user's explicit instruction.

**Goal:** Implement the safe customer-management proposals without granting any
infrastructure configuration permission.

**Architecture:** Existing Next routes and durable per-reseller client operations;
Setting-backed metadata/history, read-only native last-online and one bounded
dashboard-owned observation job. No schema/dependency change.

**Tech Stack:** Next, React, TypeScript, Prisma/SQLite, existing native adapter.

**Spec:** ../specs/2026-11-01-user-management-design.md

## Constraints and review focus

- Preserve ownership, assigned inbound access, accounting and all real data.
- Reject unknown mutation fields; never pass arbitrary payloads to native API.
- Partial bulk operations retry without replaying successful customers.
- Unknown native counters/timestamps never become misleading zero/never values.
- History cannot double count after resets; first-use expiry cannot become unlimited.
- Installability never caches private data; jobs cannot overlap or send duplicates.

## Tasks

- [x] Add failing synthetic API/unit tests for scoped labels, last-online, bulk
  status, forbidden payloads and first-use creation/retry. Implement focused
  `customer-management` helpers/routes using existing locks and node-safe adapter.
- [x] Add failing observation tests for baseline, reset, missing data and retention;
  implement bounded history and authenticated internal collection route/script.
- [x] Add customer controls/dialogs, first-use creation, admin inspection and mobile
  installation. Browser-check selection, filters, partial errors and narrow layouts.
- [x] Integrate configurable existing threshold delivery and dashboard-owned timer;
  test isolated scheduler runs without real recipients or native mutation.
- [x] Run fresh regression suites, lint/types/build and immutable Linux-image tests.
  Commit/push, deploy with dashboard-only rollback, compare protected data and
  unrelated host state, create/verify full backup, update repo incident and memory.
