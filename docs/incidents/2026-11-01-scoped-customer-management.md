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

## Deployment and final acceptance

Runtime commit `4e60b216c5bba75b41b4bfc2c365d0eabf1c77c4` is pushed and deployed as
`pv-reseller-dashboard:customers-20261101`, image
`sha256:9f874f712fe7eb8933897a26c211b63df1e9d3bacab4d4499c8a859a5055230b`.
Accepted container:
`68dd72558ad610766f5f050d49d7d5652f15ca9c5ea6a9c965ba31cf9e18777f`.
Immediate retained rollback: `pv-reseller-dashboard-rollback-customers-20261101`.
Earlier rollbacks and cached dependency/runtime bases remain intact. Host script
follow-up `169dbbec10022d50e608ab6e90230063e65d1bdc` handles partial collection exit2;
it did not rebuild/restart the accepted runtime container.

Actual Linux image passed47 new API+25 handover+45 audit checks and all24Python
tests with no skips. Containers used network none, published no ports and mounted
only synthetic fixture scripts, never production data. Production read-only
acceptance checked admin/global users, both active resellers (55users), inactive
owner rejection, metadata isolation, stale credentials/audience denial, static PWA
assets and fresh-target restore protection. Final live read returned finite
traffic/expiry/status for all57 tracked accounts. No real test user/status change,
native mutation, transfer or restore was performed.

All non-log dashboard rows matched exactly across deployment. Existing settings
were retained; subsequent observation changed only its own history/lease settings.
Customer/representative rows, accounting,33inbound mappings and151existing journals
were compared unchanged again after the job. Other running container IDs/start
times, unrelated service PIDs/listeners and native inbound configuration matched.
Original runtime key/environment, data mount/network and127.0.0.1:31080 binding were
preserved. Both the existing backup timer and new half-hour observation timer are
active; no listening port was added. Build receipt had1.78GB free; no global Docker
prune or unrelated cleanup was performed.

Private evidence: `/opt/pv-reseller/backup/customers-20261101/` contains immutable
build/test receipts and full logs, consistent pre-deploy DB, private runtime env,
before/after host snapshots, deployment and schedule acceptance. Do not publish
those private database/credential/identifier files.

Complete final archive:
`/opt/pv-reseller/data/backups/pvnet-20261101T144046Z-967ac40c5117.zip`,83484bytes,
SHA256 `c498b17d158f27dca309b18a8a0bf46a76f07e21811f19378a209f93a2852066`.
All8 archived tables were compared with live data, including57users,3retained owner
rows,33inbound maps,151journals and59settings; recovery key verified. Existing logs
were preserved (380archived rows; creation appends a later log). Native panel DBs
were not exported, consistent with the user's narrowed backup scope.

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
