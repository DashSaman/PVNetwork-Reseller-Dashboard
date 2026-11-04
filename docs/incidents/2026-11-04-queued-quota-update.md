# Queued quota edits and activation after an exhausted quota

## Confirmed cause

A reseller increased a customer's quota from 20 to 50 GB. The native controller
accepted 50 GB, but returned `nodePending` because one selected node was offline.
The dashboard retained the old 20 GB allocation and a 30 GB UPDATE reservation.
An enable-only request inherited 20 GB, then failed the usage check before looking
up the unfinished 50 GB edit. Live usage exceeded 20 GB but was below 50 GB.

Read-only investigation found five ordinary partial UPDATE operations across two
active resellers waiting on native synchronization. One of five native nodes was
offline/dirty; the other four were online/clean. There was no discrepancy between
the verified controller usage and the displayed per-panel consumption in this audit.
Offline nodes are not repaired by changing routing, credentials or service ports.

## Behavior after the fix

- Check the unfinished UPDATE target before validating a stale inherited quota.
  An enable-only continuation uses the same funded quota; it cannot change an
  unfinished target or hijack bulk/status/subscription-rotation operations.
- Read back native identity and all supplied mutable fields before classifying an
  update as accepted but queued. An acknowledgment alone is insufficient.
- If all required controller records confirm a funded increase, atomically move
  its reservation into the tracked allocation. Retain the UPDATE as PARTIAL with
  `localCommitted`/`nativePending` metadata until node synchronization completes.
  Repeating the same edit does not charge the increase again or reset consumption.
- Return HTTP202 plus `pending:true` for that verified queued state; the UI and bot
  bridge distinguish it from complete success and from an unverified failure.
- Keep the larger allocation for queued decreases, including unlimited-to-finite
  transitions. Do not release usable quota while an offline copy may retain it.
  Unverified or mixed-error updates keep their reservations and do not commit local
  allocation. Creation with `nodePending` still does not publish a ready account.
- Display an owner-scoped unfinished-edit marker and continuation button. The form
  opens the original target quota. Disable that button until live fields are ready.
  Admin views receive a read-only marker, with no infrastructure details exposed.
- Disabling an exhausted customer or editing its metadata without lowering quota
  is allowed. Enabling an exhausted quota or reducing it below usage remains denied.
  Existing delete/reset conflicts, durable reservations and ownership checks remain.

No dependency, database schema, listener, infrastructure editor or scheduled job
was added. Stored history and the previous removal of the per-customer chart remain.

Final review also found that the single-customer endpoint accepted non-boolean
`enable` inputs: native writes coerced truthy values while the usage guard compared
strictly with `true`. The endpoint now rejects such values with HTTP400 before any
native request or journal write. A red/green regression covers strings, a number,
an object and null, while retaining the exhausted customer's disabled state.

## Verification

Red tests reproduced the 403/409 ordering, stale inherited quota, pending commit,
double-reservation risk and inability to disable an over-quota account. A separate
adapter test rejected an unverified queued acknowledgment. Browser testing caught
and fixed a continuation button that appeared clickable before live data was ready.

Verified locally: 30 lifecycle/accounting API checks, 61 customer-management
API/browser checks (47 API + 14 browser), 45 existing audit/auth/bridge checks and
45 unit checks. TypeScript and ESLint for all changed source files pass. Desktop
and mobile screenshots inspected; no client errors or page overflow. All test
writes use isolated SQLite databases and loopback native-panel fixtures.

## Production acceptance

Runtime commit `c61e3e35261fedf235299841905b28bd49a9ee98` was pushed and deployed
as `pv-reseller-dashboard:quota-renewal-20261104`, image
`sha256:f953511bc01c7fc2c8759f08c1d9d0ea5d23d06e32209b0198cb0fabda5190c0`.
The actual final Linux image passed 47 customer-management, 29 lifecycle/accounting
and 45 audit/auth/bridge checks with network disabled, no production mount and no
published ports. Build, TypeScript and targeted ESLint passed.

The container replacement preserved every non-log dashboard table. Read-only
acceptance verified all 58 live customers and both active reseller bootstraps
(56 customers, plus 2 retained admin-managed customers). Existing environment,
encryption key, data mount, network and `127.0.0.1:31080` binding were retained.
Unrelated container identities/start times, service PIDs/listeners and native
configuration matched across deployment; the previous dashboard is retained.

After a separate consistent database snapshot and read-only preflight, five
previously funded ordinary increases were resumed through the shared dashboard
API. Their controller quotas already matched the journal targets. Reservations
moved into tracked allocation without changing either reseller's remaining pool
or consumed balance. Only the reported customer's enable state was changed.
Every customer's subscription, identity, expiration, memberships and counters
were checked; unrelated tracked rows and journals were retained unchanged.

A subsequent read confirmed the reported account remained enabled at 50 GB with
its prior usage retained. One native node still reports offline and four report
online; queued operations remain visibly pending. This deployment does not repair
that node's connectivity or claim that offline locations have synchronized.
Backup and observation timers remain active. A final complete dashboard archive
was verified against all eight tables, including all 58 users, 3 retained reseller
rows, 33 inbound assignments, 159 journals and 61 settings; recovery key verified.
No native database export or production restore was performed.

The final validation follow-up is commit
`60a24a87bfae4d1486a9c70d0c64797f0f37988a`, deployed as
`pv-reseller-dashboard:quota-status-guard-20261104`, image
`sha256:9d6dc6f8493de53ef17c8a290db8b385ee70427d49d70a453efff2fafb90c691`.
Its actual Linux image passes 47 customer-management, 30 lifecycle/accounting and
45 audit/auth/bridge checks. Replacement again preserved all dashboard data and
unrelated services/listeners; the five recoveries were not replayed. Final
read-only verification found the reported account still enabled more than 28
minutes after recovery, its prior usage and expiry retained, and a nonempty
subscription returning 12 links. All five funded settlements remain visibly
pending, with zero duplicate reservation, while one native node remains offline.

Only untagged intermediate stages identified from this dashboard's own completed
build logs were removed to recover build space; runtime/rollback images, protected
dependency bases, other images/volumes/services and listeners were retained.

Client identifiers, credentials, snapshots and private operator evidence must not
be committed to this repository. Do not blindly replay older repairs or release
unrelated CREATE/RESET/DELETE reservations.
