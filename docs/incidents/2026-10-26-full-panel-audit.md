# Full panel review and regression fixes

The review covered every application route, product-specific component and
business library, with an independent offline source review and isolated real
Next/Prisma/SQLite API fixtures. Supporting documents, stock UI wrappers and
binary assets did not all receive a full semantic security review. This is a
record of verified controls and fixes, not a guarantee that no defect remains.

## Confirmed problems and resulting behavior

- Dashboard and bot-bridge tokens had the same authentication scope. Tokens now
  carry distinct audiences and a credential binding. Guards check the current
  account, active status and credential state. Password/factor changes invalidate
  old tokens; logout persists a hash-only revocation. The current verified caller
  receives a fresh cookie after security changes. Conditional database updates
  prevent stale security-setting requests from overwriting intervening changes.
- Incorrect TOTP codes bypassed password-attempt limits. Both account roles now
  count second-factor failures. Malformed/oversized login fields are rejected
  before password work. Setup cannot replace an enabled factor; its existing
  password-confirmed removal flow must be used first.
- Production could use a public development signing key when configuration was
  missing. Production now refuses that state. Docker builds use an ephemeral key
  only for the build process; deployment retains the existing private runtime key.
- Bridge inbound responses forwarded server stream configuration. A public-field
  allowlist retains client connection parameters and excludes private server keys
  and certificates. Device-limit permissions are enforced in both update paths.
- Subscription rotation could overwrite a concurrent quota reduction with an
  old full-record snapshot. Rotation now shares the reseller accounting lock,
  persists one absolute target subscription and per-panel progress, writes only
  that field, verifies required targets and resumes a partial operation. Other
  mutations wait or refuse until reconciliation; usage and quota are preserved.
- Editing an unrelated user field could reset device limits. Omitted native
  fields are retained. The browser now leaves device limits blank until an
  explicit change and omits unchanged expiry/status/location fields. Actual saved
  location references replace label-based guesses. A pool-only reseller edit
  preserves its name, and creation persists an explicit whitelabel denial.
- Pending creation could bypass subsequently revoked location permissions.
  Creation reloads permissions inside the reseller lock, including retries, and
  revalidates funding/current quota policy. A completed request for a subsequently
  deleted or changed account cannot publish its old result as a ready new user.
  Administrative reseller edits/deletion use that same lock.
- The admin traffic ledger omitted active RESET reservations. Its remaining
  balance now uses the same reservation types as authoritative accounting.
  Fractional/nonfinite quotas and invalid expiration values fail before writes.
  Explicit unknown/inactive panel targets cannot silently fall back to primary.
- The legacy reconnection helper used predictable shared credential files. It
  now uses a private temporary directory, restrictive permissions and cleanup on
  success/failure; credentials are passed through private files rather than curl
  command arguments. It was not run against a real installation for this audit.

The backup timer's internal signer follows the new token contract. Only valid
hash-only session-revocation keys are ignored when deciding whether an otherwise
fresh destination can restore; real settings still block restore. Existing
archive/schema validation and dashboard-only backup scope remain in force.

## Reproducible validation

All mutation fixtures use synthetic customers, disposable databases and loopback
mock native APIs. Never point them at the live database or VPN panels.

```sh
node --test scripts/test-admin-traffic-ledger.mjs scripts/test-browser-api.mjs scripts/test-bulk-extension.mjs scripts/test-display-cache.mjs scripts/test-node-client-sync.mjs scripts/test-quota-chart.mjs scripts/test-restore-crypto.mjs
python -m unittest discover -s scripts -p 'test_*.py' -v
node scripts/test-panel-audit-api.mjs
node scripts/test-user-lifecycle-api.mjs
node scripts/test-bulk-extension-api.mjs
node scripts/test-node-client-sync-api.mjs
node scripts/test-live-ui.mjs
npx next build --webpack
node scripts/test-dashboard-restore-api.mjs
```

Run development API fixtures sequentially: they share Next's development build
directory. `AUDIT_FIXTURE_PRODUCTION=1` runs the audit fixture against a previously
built local production server. Optional `PLAYWRIGHT_MODULE` enables the existing
desktop/mobile browser checks in the live-UI fixture. POSIX permission/symlink
checks must also run on Linux, rather than treating Windows skips as passes.

Observed regressions were reproduced before their fixes. The API fixture covers
token audience, revocation, TOTP lockout/enrollment, disabled/deleted identities,
private-key filtering, subscription/quota races, lost replies, device permissions,
whitelabel persistence, RESET reservations and malformed input. Browser coverage
includes inspection of the actual unchanged-edit request payload.

Local acceptance: 37 unit checks, 45 production audit API checks, 34 bulk/backup
integration checks, 17 lifecycle checks, 10 node/TLS API checks, 28 production
restore checks and 26 browser/live-read checks passed. TypeScript, full source
ESLint and the production build passed. Python checks passed locally with the
platform-specific POSIX/symlink cases reserved for the isolated Linux image.

## Rollout and limitations

Existing dashboard and bot-bridge sessions must authenticate again once after
this release. Passwords, user connection identities, quotas and the runtime key
are not rotated by deployment. No schema migration is required.

Before deployment, test the actual candidate image with network disabled, no
published ports and no live-data mount. Retain a consistent private backup and
the exact previous container. Compare dashboard rows and unrelated container
identities, service PIDs, native configuration and listening ports after replacing
only the dashboard at its existing loopback binding. Never run a live restore,
replay old repair journals, globally prune Docker or change native VPN services.

Two conditional concerns remain explicit: sustained public-subscription request
load was not characterized, and a shared budget across multiple independent
billing panels was not certified. Production was observed to have one configured
billing panel; its managed nodes are not additional billing panels. No online
dependency-advisory clearance or exhaustive upstream-panel audit is claimed.

## Candidate image and production acceptance

Runtime commit `cb44a60a54360753ae31b3baae3efa0c05d52d4a` was pushed to main
and deployed as `pv-reseller-dashboard:audit-20261026`, image
`sha256:6774f29c56015d64ae28f70f69454c33c444b09ab6e552f02f3ac0e6e497fa67`.
The actual Linux image passed all 45 audit API checks and all 23 Python checks,
including the POSIX credential-file and symlink cases. Both containers had network
disabled, no published ports and no production-data mount. The cached dependency
and runtime bases retained the existing production dependency versions.

After replacing only the dashboard, read-only acceptance passed for the admin and
all three active resellers. All 57 tracked users were returned by bootstrap and had
live usage, expiry and status values. The populated installation still refused
restore uploads; no production restore or real-user mutation fixture was run.
Legacy sessions, stale credential-bound sessions, anonymous access and bridge-token
replay into dashboard routes were rejected.

A consistent private database snapshot was taken after gracefully stopping the
previous dashboard. Every non-log dashboard table matched after replacement;
existing log rows were preserved. Other container identities/start times, service
PIDs, listening ports and native inbound configuration matched the pre-deployment
snapshot. The original loopback binding, network, data mount, runtime key and active
backup timer were retained. The exact previous dashboard container remains available
for rollback; no schema migration or global Docker cleanup was performed.

The updated scheduled-backup signer also produced a complete, verified archive.
Its snapshot matched all eight dashboard tables, including 57 users, three resellers,
33 permission mappings, panel configuration, settings and 140 operation journals;
the original recovery key was verified. Independent native-panel databases were
not exported. Private database copies, client IDs, keys, archive hashes and host
evidence remain outside this public repository.
