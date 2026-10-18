# Admin backup restore verification — 2026-10-18

The approved feature adds upload, validated preview and explicit administrator
confirmation to the main admin Backup tab. It restores only a fresh dashboard;
it does not merge databases or restore native VPN servers. See the
[migration runbook](dashboard-migration-restore.fa.md) for operator steps.

## Implemented safeguards

- All six domain tables must be empty: Reseller, ResellerUser, ResellerInbound,
  PanelConfig, OperationJournal and Setting. Bootstrap admins/login logs are allowed.
  Freshness is checked during upload, confirmation and cold-start installation.
- Uploads are streamed into private files, capped at 64 MiB with a 512 MiB expanded
  archive cap. One upload/confirmation owns staging at a time. Preview tokens expire
  in 15 minutes and are bound to the uploading administrator and archive SHA-256.
- ZIP paths/hashes, complete flag, SQLite integrity/FKs, schema/index contracts and
  encrypted credentials/TOTP/peer settings are checked before acceptance. Historical
  SQLite BOOLEAN defaults 0/1 are compatible with equivalent Prisma false/true.
- Current destination admin password and enabled 2FA are required at confirmation;
  anonymous/reseller/foreign-origin requests are denied. A pending marker prevents
  other API traffic during restart. The upload endpoint enforces that marker itself
  and avoids Next proxy's default 10 MiB request-body buffer.
- Only this dashboard process exits. Existing Docker restart policy runs the offline
  installer before Node. Interrupted installation reapplies the hash-bound archive
  until both database and key are durable; Node never starts between those writes.
- The effective data-volume key is used consistently by application crypto, the
  backup API, daily backup runner, direct Python backup CLI and peer configuration
  CLI, even when the container's original APP_SECRET differs from the restored key.
- No Docker socket, native-panel writes, firewall/network/port changes or host-env
  rewrites are part of restore. Private node addresses/CA must still be checked on
  a different host; restore does not guess routes or recreate external VPN servers.

## Local verification completed

| Check | Result |
|---|---|
| Cold-start restore Python suite | 11 passed |
| Portable backup Python suite | 8 passed, 1 Windows symlink-privilege skip |
| Node sync/bulk/cache/restore-crypto unit tests | 21 passed |
| Restore API + desktop/mobile browser flow, including >10 MiB valid ZIP | 31 passed |
| Existing bulk/backup API regression | 34 passed |
| Existing node sync API regression | 10 passed |
| Existing live-statistics regression | 10 passed |
| TypeScript, targeted ESLint and production build | Passed |

The restore fixture uses synthetic records, different source/destination keys,
real SQLite and actual dashboard routes. It checks current-password/2FA gates,
concurrency, expiry/hash/owner/replay rejection, populated-target refusal, restored
admin/reseller login, accounting/identity preservation and working backups/peer CLI
after restore. Desktop/mobile screenshots are private test artifacts.

The previously verified healthy archive was additionally checked with the new
validator inside a network-disabled container using a read-only archive mount:
48 users, four resellers, three encrypted fields and one peer validated. This was
archive inspection in ephemeral staging, not replacement of the production DB.

## Release acceptance

The production image passed the same restore fixture inside a container with
`--network none`, no published ports and no production-data mount: **29 checks
passed**, including the >10 MiB archive and restart through the actual entrypoint.
Both Python suites also passed in that image: **20 tests**, including the symlink
case skipped on Windows. The local browser variant also clicked the final restore
button with password/2FA, then verified the recovered accounts after restart.

Tested runtime source: `9b1fc6fd3a2bb049930f2405ddbdd29db4f68889`.
Deployed image:

```text
pv-reseller-dashboard:admin-restore-20261018
sha256:3291772fbca95501478ba2a964455088a57ff26a80add8d8315d2134261bad41
```

Production acceptance passed after replacing only the dashboard container:

- Existing loopback binding `127.0.0.1:31080 -> 3000`, network, volume and existing
  environment were preserved. Original container/image retained for rollback.
- All protected dashboard table contents matched the immediate pre-deploy snapshot:
  49 users, four resellers, one admin, one panel, one Setting and 107 journal rows.
  The earlier reference archive's 48-user count reflects its earlier creation time.
- Authenticated main-admin availability returned disabled on the populated target;
  upload was rejected with HTTP 409 and anonymous access with HTTP 401. No restore
  staging/key file was created and no archive was applied to production.
- Native inbound configuration, other running containers, service PIDs and service
  port listeners stayed unchanged. Daily backup timer remained active; public HTTPS
  health check succeeded. Temporary test containers were removed.

Private host/service/DB snapshots and detailed fixture logs stay outside Git;
credentials and subscriber identities are never published here. These checks cover
this release and tested failure modes; destination routing/TLS and cutover checks
in the migration guide remain necessary on a genuinely different host.
