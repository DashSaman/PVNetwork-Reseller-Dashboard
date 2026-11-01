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

Candidate-image tests and production acceptance are recorded after completion.
Production acceptance only reads the removal preview and account lists; it never
confirms a real handover or changes customer/native data.

The independent upstream feature comparison is in
[the capability comparison](../3x-ui-capability-comparison-2026-11-01.fa.md).
