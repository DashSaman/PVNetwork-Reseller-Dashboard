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

Deployment, actual-image test results and the pilot's read-only live API checks are
recorded here after acceptance. Do not treat the local results above as proof of
deployment or blindly replay provisioning scripts: token rotation breaks the old
bot credential, and customer operation journals can contain paid reservations.

For reseller setup, see [the Persian guide](../guide-mirza-bot.fa.md).
