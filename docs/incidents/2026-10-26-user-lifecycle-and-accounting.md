# User creation, location membership and destructive-operation accounting

## Report and confirmed causes

Resellers reported empty subscriptions, missing selected locations that appeared
much later, and deletions that did not complete. The dashboard accepted a native
write acknowledgment without verifying every selected inbound. Creation recovery
checked any matching inbound per panel and could generate another UUID. Native
`nodePending` acknowledgments were also treated as ready accounts. Display-cache
snapshots were used by subscription/link and bulk-creation paths; attach/detach
did not invalidate the display cache.

A read-only production audit found 59 tracked accounts and three resellers. Fifty
existing accounts had missing selected memberships; two other accounts were
already in partial deletion and were excluded from membership repair. The four
commonly missing inbounds still existed and the configured nodes were online.
Do not replace shadow IDs, clear origin GUIDs, or adopt a whole node snapshot.

The shared accounting service also allowed reset without enough free pool and
quota reduction below consumed traffic. Partial delete/reset retries reused an
old aggregate consumption snapshot. Broad `not found` matching could mistake a
missing API route for a deleted client. A no-peer reset lacked the durable
STARTED ambiguity guard used for node operations.

## Changes

- Verify central identity and every selected inbound after creation/attachment;
  complete missing memberships before declaring success. Preserve UUID and subId
  in the create journal, scope request IDs to the reseller, and keep the browser's
  request ID across retries. Relative-day retries use the original expiry.
- Keep a pending-node creation reserved and resumable instead of publishing a
  ready subscription. A retry continues the same account. Unavailable external
  nodes can still require operator intervention; this is not a guarantee of
  upstream availability.
- Read fresh panel data for subscription/link and bulk-create requests, invalidate
  cache after client writes, and return a non-cacheable temporary error instead
  of a successful empty subscription.
- Preserve complete native records during edits; omitted fields are retained.
  Missing required update targets fail closed. Verify final native quota before
  committing local allocation.
- Validate native and explicit-peer usage before reducing quota. Reset must fund
  previous consumption from free pool; its reservation survives partial failure.
- Journal destructive operations even without peers. Verify deletion by reading
  absence, retain identity and per-step progress, and never replay an ambiguous
  STARTED reset. Freeze a target before sampling the destructive-operation usage;
  retain per-panel consumption checkpoints and commit the debt exactly once.
  Restore a reset account's original enable state on success or quota rejection.
- An already-missing master can finish a pending deletion only after checking
  configured peer identities against the tracked subscription. Legacy multi-panel
  partial journals without reconstructable consumption require reconciliation.

## Verification and guarded production repair

The new isolated route/SQLite fixture reproduces partial adds, pending-node
responses, same-request retries, quota reduction abuse, exhausted-pool reset,
funded reset, orphan deletion, false deletion success, unrelated not-found
responses, lost reset replies, growing usage during partial deletion, and cold
subscription reads. It uses only loopback mock APIs and a disposable database.

Run sequentially (the API fixtures share Next's development build directory):

```sh
node --test scripts/test-node-client-sync.mjs scripts/test-bulk-extension.mjs scripts/test-display-cache.mjs
node scripts/test-user-lifecycle-api.mjs
node scripts/test-node-client-sync-api.mjs
npx tsc --noEmit
```

On 2026-10-26: the unit suites passed 20 checks; the new lifecycle fixture passed
16 checks; the existing node/TLS/API fixture passed 10 checks. TypeScript and the
targeted lint check passed. A production build is required before deployment.

A consistent private dashboard database backup and native client snapshots were
taken before repair. One guarded pilot and then 49 other accounts were completed
using only attach operations for their already-selected missing memberships.
Each was read back to verify all requested locations, retention of existing
locations, UUID/subId, quota, expiry, enable/device/reset settings, and a
non-decreasing usage counter. All 50 passed. Pending deletions and old untracked
CREATE repair journals were not replayed or refunded by this repair.

Client identifiers, subscription secrets, credentials, database copies and full
before/after evidence are private operational material; never commit them here.
Deployment must preserve the dashboard's existing loopback binding, data mount,
network and environment and verify unrelated containers/services/ports unchanged.
