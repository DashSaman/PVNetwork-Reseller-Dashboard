# Mirza 0.8.1 sales API integration — 2026-11-05

## Confirmed cause

The installed Mirza `x-ui_single` driver sends `password_panel` as a Bearer API
key. The previous guide described dashboard-password login, whose bridge session
expires after 24 hours. The Telegram notification credential is a third, separate
credential and is not needed for sales. The bridge was also missing the driver's
new client-read, traffic-read and attach routes. Negative first-use expiry was
being converted to zero, which means unlimited validity in the native API.

The existing pilot connection also had no inbound array and used a different
subscription base. Its reseller sales integration was disabled. These are
connection settings, not customer repairs or infrastructure configuration.

## Implemented contract

- Reseller-owned API key generation, rotation and revocation under Account
  settings → Mirza sales connection. Only its SHA-256 digest, credential version
  and creation timestamp are stored. The raw 256-bit key is returned once, masked
  in the UI, and never persisted in browser storage or activity logs.
- Keys require an active, unarchived owner, enabled sales access and the matching
  reseller URL. Rotation, revocation, disabling sales and account credential/TOTP
  changes invalidate the old key. Dashboard session authentication remains separate.
- `GET panel/api/clients/get/{email}` returns the nested client, memberships and
  verified canonical usage; `GET .../traffic/{email}` returns byte counters and
  bounded last-seen data. Missing live data returns an error, never fabricated
  zero traffic or unlimited validity.
- `POST panel/api/clients/{email}/attach` only attaches an existing owned account
  with verified identity and quota to permitted, available memberships. It preserves
  traffic, UUID, expiry and existing memberships. Its journal intent is isolated
  from ordinary edits and different attach targets. Retrying a committed attach
  closes its original pending journal once native synchronization completes.
- Creation/renewal preserve negative first-use milliseconds. Dotted native emails
  remain exact. Byte quotas must represent whole GiB, including before rounding;
  configure Mirza products/trials with whole-GB plans of at least 1 GB for limited
  resellers. No existing trial, price or financial setting is changed automatically.
- The customer subscription base is the dashboard's `/api/s`, not a native-panel
  endpoint. Legacy session clients remain supported. No routing, protocol or native
  server administration permission is exposed to a reseller or its bot.

Native controller/node outages still require service recovery by the main admin.
The bridge does not advertise unavailable locations or falsely report queued work
as fully synchronized. API creation replay cannot reserve or charge twice; reset
and delete retain permanently spent traffic in the existing accounting ledger.

## Verification before release

- Mirza API plus desktop/mobile key UI: **49/49**; includes the original failing
  contract cases, partial attach isolation/retry, synchronized retry, offline
  rejection, exact quotas, one-time key display, rotation and revocation.
- Existing unit regressions: **55/55**; lifecycle API: **41/41**; customer management
  plus browser: **101/101**; permission/accounting audit API: **45/45**.
- Fresh TypeScript check and targeted ESLint: exit 0.
- The installed PHP source SHA-256
  `e750cd42bfc30cd9f8b989c664042f3d5cee72af1bd766d0fa28a7d614f9f587`
  produced all **8/8** expected request shapes in a private temporary fixture.
  HTTP, database and Telegram calls were stubbed. Original files, service PIDs and
  listeners were unchanged; temporary fixture files were removed.

The local fixture databases are synthetic. No real customer was created, renewed,
reset or deleted to prove this integration. Private evidence and encrypted access
material are kept outside tracked files under the ignored task evidence directory.

## Release record

- Accepted runtime commit: `823fe004a4e16954eea8b2900668f9789fec8e1f`.
  Image `pv-reseller-dashboard:mirza-api-20261105`, SHA-256
  `d8b20b4b59ab47c7e2894e759b2861c15290d6857dfbe56785433dff8fe088f1`.
- The exact standalone image passed **206/206** checks: customer API 79, lifecycle
  41, permission/accounting audit 45 and Mirza API 41. Containers used no network,
  published no host ports and mounted no production data.
- Dashboard replacement preserved every real database row; activity logging was
  append-only. The runtime encryption key, network, port binding and data mount
  were preserved. Post-deployment acceptance read all **65/65** customers, including
  both active reseller scopes and the archived reseller's admin-managed customers.
  Main-admin restore remained blocked on this populated installation. Five saved
  update queues and all other paid journals/reservations were left intact.
- The pilot was then explicitly provisioned: only its sales-enable flag and first
  hashed API key were added to the dashboard. Customers, balances, grants, pending
  journals, other resellers and notification credentials remained unchanged.
- The installed Mirza PHP HTTP client passed six read-only live checks, including
  owned client/traffic reads, a **10-location** authorized catalog, cross-owner
  rejection and a nonempty public subscription with **12** configurations. The
  same checks passed using the connection values actually saved in its database.
  No real customer was created, renewed, reset or deleted; no Telegram message
  was sent.
- Only the existing pilot connection's `url_panel`, `username_panel`,
  `password_panel`, `linksubx` and `inbounds` fields changed. Every other connection
  field, user, invoice, product, price and general/admin setting was verified
  unchanged. Its original source files, Apache/MariaDB processes and listeners
  were unchanged. No global Mirza admin API key was created.
- Final production acceptance again read **65/65** customers. Other container
  identities, service PIDs, native inbound configuration and ports matched the
  baseline. Both backup and observation timers remained active. The temporary
  plaintext issued-key handoff file was removed after encrypted local handoff;
  only this build's untagged intermediate stages were retired.
- Final verified dashboard archive: `pvnet-20261105T125928Z-284796e23a4d.zip`,
  93,151 bytes, SHA-256
  `8782c5eca80dd17004d8d2ef7a03e472d5fc4bbef38d85cbd1b9bd1d0478807a`.
  All eight tables and the recovery key were verified. It contains 65 customers,
  3 owner records, 33 grants, 64 settings and 165 journals. Native panels exported:
  **0**, as required by the dashboard-only backup scope.

The release's private receipts are under `mirza-api-20261105`; local encrypted
pilot evidence is under the ignored `mirza-integration-20261105` task directory.
Do not blindly replay provisioning scripts: rotating a key breaks the old bot
credential, and customer operation journals can contain paid reservations.

For reseller setup, see [the Persian guide](../guide-mirza-bot.fa.md).
