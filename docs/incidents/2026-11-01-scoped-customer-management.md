# 2026-11-01 customer-management capabilities and permission boundary

The user authorized the proposed customer-management capabilities while explicitly
keeping routing, protocol, port, host-rule, node and inbound configuration in native
3x-ui under its main administrator. Dashboard ADMIN assigns existing inbound access;
RESELLER manages only owned customers. No native infrastructure endpoint was added.

## Changes

- Local owner-scoped labels (10/customer,40 characters/label), search and filters;
  read-only last-online map normalized from seconds/milliseconds. Missing data is
  unknown, not “never used”. Both reseller and global admin views show support data.
- Selected-user status actions, maximum50, preview and per-user results. Immutable
  target/identity and per-panel progress use existing Setting/OperationJournal and
  reseller lock. A successful retry never rewrites a completed customer. Only enable
  changes; existing identity/subscription/quota/expiry/device/reset fields survive
  through the node-safe native adapter. Enable rechecks inbound permissions; a
  revoked assignment cannot be recovered through this action. Disable stays possible
  for an owned account. Conflicting journal operations block each other.
- Incomplete batches reappear after reload. Unattempted failures can be closed;
  native partial/unknown changes must be continued, never silently abandoned.
- Single/bulk creation supports positive first-use days serialized as a negative
  duration. Mode is part of idempotency matching; zero/fractional/conflicting inputs
  cannot become unlimited. Existing customer records are not rewritten by deployment.
- Daily usage observations and latest durable operation history, retained90days.
  First sample establishes baseline. Committed reset debit plus current consumption
  forms a continuous lifetime counter; unexplained native reset marks a gap. Intervals
  spanning collection outages are assigned to the end day, not invented historical
  buckets. This is sampled support history, not a precise native billing time series.
- Dashboard-owned half-hour timer calls its existing container/loopback route with
  short-lived credential-bound ADMIN authentication. A lease prevents overlapping
  collectors. It changes only observation/settings/log rows; no native client writes
  or new listening port. Existing Telegram channels and12hour repetition limit are
  reused with configurable1..100percent and0..30day thresholds. Current active owner
  is rechecked under lock before delivery. Empty installs do not create a lease,
  preserving fresh-target restore eligibility.
- Install manifest, icons and offline shell. Fixed static cache allowlist only;
  dashboard HTML/auth/API/subscriptions never enter offline cache. Registration UI
  is limited to dashboard root. No dependency/schema change.

## Decisions and regression evidence

Ruling: groups are local metadata, not native groups — prevents cross-reseller group
visibility and native bulk bypass — native group names remain independent.

Ruling: periodic traffic resets remain excluded — native automatic reset without
accounting debit can give free traffic — requires a separate accounting design.
User explicitly excluded protocol/routing/host/infrastructure controls.

API tests first reproduced404 missing tools, positive absolute expiry for first-use,
and idempotent mode confusion. Red/green pure tests cover baseline/reset/retention,
labels, durations and unknown timestamps. A separate regression reproduced a
read-only last-online POST aborting the traffic display cache. Read-only online/IP/
last-online calls no longer invalidate traffic snapshots; actual mutations still do.

Synthetic API/browser fixtures exercise owned/foreign users, forbidden fields,
authenticated bridge infrastructure rejection, partial status/reload/retry/conflict,
revoked permission, finite first-use single/bulk creation, independent signer job,
reset-aware history, empty-target safety, labels after status, mobile overflow and
static-only offline behavior. No synthetic test calls a real panel or recipient.

Backup Setting/OperationJournal already include labels/history/preferences/batches.
A dedicated portable-backup regression compares the restored values exactly.
New-server restoration instructions remain fresh-install-only. Install this panel's
observation timer after restore; it never migrates native infrastructure.

Deployment and final acceptance evidence will be recorded after the immutable
candidate passes Linux tests and the production data/service comparison.

Local verified results:44 unit checks;54 new API/browser checks (47 API+7browser),
25 handover API,45 existing audit API,34 bulk/backup API. Full source ESLint,
TypeScript and production build passed. Python24 passed with3 Windows-only skips
(POSIX helper permissions and symlink privilege); final Linux image must run all24
without skips. The backup regression initially exposed its own unclosed SQLite
fixture handle on Windows; explicit connection closing fixed cleanup and the whole
suite passed. One older fixture initially stopped at the local CLI's interactive
notice; rerun with the established unattended CI environment passed all34checks.

The real first collection observed55/57 accounts and safely skipped2 because they
have protected pre-existing unfinished journals. These are not new customer writes
or lost traffic. Do not replay/release those old operations to satisfy a graph
count. The collector reports its partial result with exit2; the dashboard-owned
systemd unit recognizes that code as a completed partial run, retains the journal
counts and runs again on schedule. It must not mark unknown usage as zero. Actual
operation identifiers and account mappings remain in private evidence only.
