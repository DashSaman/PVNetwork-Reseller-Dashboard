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

## Verification

Red tests reproduced the 403/409 ordering, stale inherited quota, pending commit,
double-reservation risk and inability to disable an over-quota account. A separate
adapter test rejected an unverified queued acknowledgment. Browser testing caught
and fixed a continuation button that appeared clickable before live data was ready.

Verified locally: 29 lifecycle/accounting API checks, 61 customer-management
API/browser checks (47 API + 14 browser), 45 existing audit/auth/bridge checks and
45 unit checks. TypeScript and ESLint for all changed source files pass. Desktop
and mobile screenshots inspected; no client errors or page overflow. All test
writes use isolated SQLite databases and loopback native-panel fixtures.

Production image, deployment and scoped recovery acceptance are recorded after
execution. Client identifiers, credentials, snapshots and private operator evidence
must not be committed to this repository. Do not blindly replay older repairs or
release unrelated CREATE/RESET/DELETE reservations.
