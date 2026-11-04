# Registered creation waiting on a native node

## Cause and safe distinction

A reseller retried creation and received HTTP409 saying the previous creation was
incomplete. The controller already contained the same UUID, subscription, quota
and every selected membership. One native node was offline/dirty and returned
HTTP503. The dashboard kept a CREATE reservation without a tracked customer, and
each retry unconditionally called attach again. A node waiting for propagation
was treated as a failed creation. Reloading could produce another request identity
and another hidden, separately reserved native account.

This is separate from the earlier queued UPDATE incident. Do not replay its quota
or activation repairs, and do not mark an unreachable node synchronized.

## Behavior

- Verify the controller identity, exact quota, validity, enable state, device limit
  and every selected membership before accepting a new queued creation. Read back
  an attach acknowledgment even when it reports `nodePending`. A success response
  with wrong stored fields is rejected.
- When all required controllers confirm the account, atomically register its
  owner and references and transfer the existing reservation into allocation.
  A queued creation remains PARTIAL with zero reservation and explicit saved/
  native-pending metadata. The API returns HTTP202, `pending:true`, `ready:false`;
  the UI shows a saved account waiting for some locations, and avoids the ready
  notification/link dialog. Bulk output separates ready, pending and failed rows.
- Repeating the same request preserves UUID/subscription and funding. Saved
  accounts are verified read-only; they are never recreated, re-enabled or reset.
  Complete memberships do not cause another attach. Pending CREATEs block
  destructive refunds, status/rotation and conflicting quota changes.
- Once a saved account has legitimately started first-use validity or become
  exhausted/disabled, confirmation preserves its current expiry, status and
  consumption. Immutable identity, funded quota and membership remain guards.
  Original birth fields stay strict for an untracked legacy account.
- Metadata refresh confirms already registered creations. The existing collector
  can also register legacy creations only after full read-only verification,
  current inbound permission checks, known pending outcome, original reservation
  and journal target checks. Unknown outcomes, missing records and identity
  conflicts retain their reservations. No native mutation is replayed by either
  path. Node readiness is explicit, authenticated and rechecked; unsupported or
  unreadable readiness never means success.
- An admin-only POST to `/api/admin/customer-observations?reconcileCreations=1`
  performs the same reconciliation without observation leases or notification
  delivery. It is idempotent and creates an activity record only when progress is
  made. Ordinary observation jobs retain their existing behavior.

No new listener, timer, dependency, database schema or infrastructure editor is
introduced. Native node connectivity, routing and protocols are not changed.
Private identifiers, database copies, keys and recovery plans stay outside Git.

## Regression verification

The original API reproduced the reported HTTP409, repeated attach calls and a
wrong stored quota being accepted. Tests cover pending single/bulk creation,
one-time funding, destructive guards, read-only recovery, conflicting identity,
unknown legacy outcomes, first-use activation, native disable, metadata polling,
mobile UI and scoped admin reconciliation. All test writes use isolated SQLite
databases and loopback native mocks. Accepted runtime details are recorded after
the final image is tested and deployed.

Local verification passes 49 unit, 41 lifecycle/accounting, 81 customer/API/browser
and 45 audit/auth/bridge checks (216 total), plus TypeScript and targeted ESLint.
The browser includes a pending creation on mobile and read-only automatic
completion. An independent accounting review found a first-use/auto-disable
confirmation regression; it was reproduced with the API and fixed while retaining
identity/quota guards. A crash-after-commit fixture also verifies that old SUCCESS
journals do not depend on a separately written `done` flag.
