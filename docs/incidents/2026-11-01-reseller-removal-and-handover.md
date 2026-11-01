# Reseller removal and administrator handover

The remove action failed with HTTP 409 for a test reseller that still owned two
users. The backend guard was intentional: deleting its row would cascade dashboard
ownership while native VPN clients remained alive. The confirmation dialog still
described that unsafe legacy behavior and offered no supported resolution.

The user explicitly chose showing the users and handing their management to the
main administrator, keeping the current subscription, quota and expiry. They will
execute the actual handover later from the panel; deployment must not do it.

## Resulting behavior

- The removal dialog lists current users, obtains a signed snapshot and requires
  the exact reseller username to confirm. A changed list/quota/membership rejects
  the old preview. Unfinished work, including NEEDS_REPAIR, blocks the handover.
- The existing reseller lock and a single transaction close reseller access,
  persist administrator ownership and record the event. No native mutation call
  occurs. Retried confirmation returns the existing outcome.
- Users retain their exact rows, connection IDs, sub IDs, quota, expiry, status and
  counters. Existing subscription delivery remains available. Existing native
  enforcement stops service when quota or expiry is reached; nothing is renewed.
- Closed ownership groups retain accounting, logs and their unique username.
  They disappear from reseller management/counts, while the historical traffic
  ledger remains intact and labels them as administrator-managed. The user-count
  chart includes an administrator bucket. No balance is reset or refunded.
- All administrator users are visible in a new users tab with owner/source,
  search/filter, quota, live usage, expiry, status and subscription copy. Bootstrap
  is local; unavailable live values stay unknown or retain a prior received value.
- Login, old sessions and bridge login reject closed groups, including an
  accidental re-enabled active flag. Ordinary reseller edit cannot reactivate them.

This is logical closure with retained records, rather than physical deletion of
the billing/ownership history. No schema change, new service or new port is needed.

## Verification

`node scripts/test-reseller-handover-api.mjs` reproduced the missing path before
implementation. After implementation it passed 25 API checks; with
`PLAYWRIGHT_MODULE` it passed 31 checks including desktop/mobile browser execution,
typed confirmation, cancellation, actual handover and the administrator user list.
An invalid native counter was separately reproduced as a false zero, then fixed
to remain unknown. All customers, credentials, databases and native endpoints in the fixture are
synthetic, with loopback-only mocks. Never point it at production.

The existing 37 unit checks and 45 production audit API checks passed. Full source
ESLint, TypeScript and the production build passed. The local Windows test runner
resolves its canonical working path because the workspace now uses a C: to D:
junction; this avoids a Next development manifest path failure unrelated to the
deployed Linux panel. Browser screenshots were visually checked on both sizes.

## Candidate image and production acceptance

Runtime commit `5847d507f045ee23eefed18be707a07609e7f199` was pushed to main and
deployed as `pv-reseller-dashboard:handover-20261101`, image
`sha256:b89ded42c10f772b18f2cda647d292dc43849c2e0a801f759e2444fcef19e60b`.
The actual Linux image passed all 25 handover API checks, all 45 existing audit API
checks and all 23 Python backup/restore/helper checks, without skips. The synthetic
test containers had network disabled, no published ports and no live-data mount.
Existing production dependency versions were retained.

Production acceptance read the removal preview and the new account lists. It never
confirmed a real handover or changed customer/native data. The administrator view
returned all 57 tracked users with live usage, expiry and status. The admin and all
three active reseller bootstrap APIs passed, and unauthorized global-user access
remained denied. The real test reseller remains available for the user to hand over
through the new dialog.

The consistent pre-deployment snapshot and final database rows matched for every
non-log table. Existing activity logs remained present. Other container identities
and start times, service PIDs, listening ports and native inbound configuration
matched the baseline. The original loopback binding, network, data mount, runtime
secret and active daily-backup timer were preserved. Only the dashboard container
was replaced; its exact predecessor remains retained for rollback.

A final complete backup was generated and verified against all eight dashboard
tables, including 57 users, three resellers, 33 permission mappings, settings,
panel configuration and 151 journals. Its recovery key matched the current runtime
key. Independent native-panel databases were not exported. Private host evidence,
database snapshots, archive checksums and client identities are kept outside Git.

The independent upstream feature comparison is in
[the capability comparison](../3x-ui-capability-comparison-2026-11-01.fa.md).
