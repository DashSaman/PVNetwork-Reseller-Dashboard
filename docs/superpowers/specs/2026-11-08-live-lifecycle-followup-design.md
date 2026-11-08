# Follow-up from live customer lifecycle checks

The user requested real temporary-customer create, renew and delete tests for
both active representatives through the dashboard and Mirza, preserving real
customers and unrelated services/ports. Existing instructions authorize fixing
the recurring failures autonomously. Two failures were reproduced during those
tests; this document records the narrow implementation choices.

## Canonical subscription matching

A native subscription had all selected configurations, but the dashboard hid a
valid URI because an unrelated inbound had the same native remark and port.
Matching against every controller inbound overstates ambiguity. Matching against
only eligible inbounds would discard denied memberships and could expose links.

The chosen scope is the exact native customer email and nonempty subscription
identifier. Keep all of that customer's memberships in the ambiguity universe,
including unavailable, ungranted and unselected ones. Require the returned URI's
credential to match an eligible native client for VLESS, VMess and Trojan before
using that narrower universe. Keep the original global restrictions for other
credential formats. Reject native subscription identifiers shared with another
email. Preserve URI bytes and the existing every-match authorization condition.
Only the reseller links route opts into this context; native generation stays
authoritative and no client, protocol or inbound configuration changes.

## Completion after acknowledged deletion

A delete could finish remotely, then observe a briefly dirty node and return
pending. Local accounting would wait for the thirty-minute observation job even
after synchronization recovered. Retrying all destructive requests on reads
could dispatch unknown actions and repeat a reset; that approach is rejected.

The chosen fast path completes only an explicit DELETE from this installation
whose complete immutable panel target set is already acknowledged, whose native
steps are all DONE and whose usage ledger is valid. Recheck the exact journal,
customer and owner inside the existing lock before continuing in completion-only
mode. Existing fresh native-health gates and idempotent accounting remain in use;
all completed panel steps are skipped, so the read cannot dispatch another native
delete. Unknown, incomplete, restored and RESET operations stay protected.

Normal metadata polling can perform this local completion. Poll pending deletes
more frequently and refresh the authoritative customer list after a completed
deletion, so an old bootstrap row does not linger in the browser. Keep ordinary
polling at its existing interval.

## Verification and operational constraints

Use failing unit and real-handler regression cases before implementation. Cover
duplicate names, same-customer denied memberships, foreign credentials, shared
subscription keys, acknowledged delete completion without another native POST,
repeated reads without repeated debit/refund, and stale generation/owner races.
Build/test the production image away from the low-disk production server.

Repeat the four live paths using separately named disposable users. Verify every
selected native membership, identities, quota, expiry, canonical subscription and
complete removal; compare the original real customer records and host inventory.
Use the installed Mirza connector in a scratch caller without checkout, wallet,
order or Telegram-message execution. Restore any temporary bridge access exactly;
keep existing connection keys and saved bot choices intact. Do not restore a whole
database or alter routing, ports, protocols or another service to make a test pass.
