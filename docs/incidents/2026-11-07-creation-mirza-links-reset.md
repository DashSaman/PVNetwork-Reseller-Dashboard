# Creation, Mirza setup, copied configurations, and exhausted traffic reset

## Confirmed causes

Read-only production checks and isolated API/browser reproductions found separate
causes, rather than a single protocol configuration failure:

- The current Mirza connection had been replaced since the accepted setup. Its
  credential was invalid: even a status GET returned HTTP400. Its stored inbound
  selection included an unavailable location. The trial was already1024MB; no
  trial-size or price change was necessary.
- Saved creations and edits could remain guarded by a panel-wide node check. An
  unrelated offline node prevented confirmation of healthy selected targets.
  Some existing queues genuinely include the offline target and must remain
  guarded until its response can be verified.
- A creation request ID lived only in React memory. A lost response followed by
  a full page reload discarded it, allowing a second funded account on retry.
  The Mirza adapter also reported an already-saved queued creation as a failed
  sale, which could prompt an erroneous refund and another attempt.
- Direct configurations were rebuilt from inbound fields. They omitted native
  subscription parameters, including encryption/TLS fingerprint/host/ECH values.
  A working subscription and the displayed copies therefore differed.
- Reset preserved the disabled state of a quota-exhausted customer, even when its
  paid allowance was replenished. A pending saved edit could also block the reset.
  A successful native acknowledgement alone did not verify a counter decrease.

## Resulting behavior

Creation retries retain their owner-scoped request ID across tab reloads; double
clicks share one in-flight request. A registered queued Mirza account is accepted
once, with an explicit node-pending flag, rather than reported as a failed sale.
Read-only confirmation checks the selected targets and never repeats creation.

Copies, QR codes, and the dashboard subscription use the native subscription's
original URI bytes. The dashboard does not reconstruct TLS, ECH, public address,
port overrides, or passwords. Reseller direct links still intersect ownership,
administrator grants, and live location availability. Shared ports cannot reveal
an unavailable location. Failed, empty, redirected, or oversized native responses
produce an availability error rather than fabricated configurations.

An owner can replace a fully verified, already-paid saved CREATE/UPDATE queue with
an explicit delete/reset intent. Unknown outcomes, unpaid reservations, identity
conflicts, incomplete writes and bulk operations remain protected. Superseding
the old journal does not release any quota or claim remote completion.

Deletion credits **only unused allocation**, after required targets respond and
revocation is verified. An unused10GB account returns10GB; a10GB account with2GB
consumed returns8GB. Previously consumed/reset traffic remains permanently charged.
If a required target is offline, the intent returns202 and remains visible while
the full allocation stays guarded. The existing observation job can complete that
explicit intent after recovery; no extra service, timer or port is introduced.

Reset can restore a nonexpired quota-exhausted customer without increasing its
total quota. Ordinary manual disables below quota and expired customers stay
disabled. Previous consumption must still be funded by the reseller's pool. A
native counter must decrease; a lost or unverified reset is not repeated against
subsequent traffic.

Automatic destructive continuation is bound to the local installation marker
`.operation-installation`, outside the portable database archive. A restored
backup does not automatically replay old destructive requests against the old
infrastructure. Business data and pending journals remain available for explicit
owner continuation. Legacy repair journals are not automatically enrolled.

## Mirza connector

`integrations/mirza/pvnetwork-selection.php` refreshes the allowed live catalog
before each PVNetwork trial or paid creation and intersects it with the saved
selection. If no selected location is available, no creation request is sent.
Other panel types and native routing/protocol settings are unchanged.

The bounded installer supports the verified Mirza0.8.1 driver hash and refuses an
unknown/changed driver. It checks PHP syntax, keeps a private original outside the
web root, and updates only the two connector files. It does not restart services
or edit a bot's wallets, customers, invoices, products, pricing, or global settings.

```sh
python3 integrations/mirza/install-selection.py \
  --root /var/www/mirzabot --backup-dir /var/backups/pvnetwork-connector --check
# After validating the connection and taking its private backup, omit --check.
```

Use a persistent **sales API token**, the owner's own bridge URL, and the dashboard
subscription base. A Telegram bot token or an expired24-hour session is not the
sales API token. Products and trials continue to use whole GB for limited pools.

## Validation and deployment

Local validation covers109customer/API/browser checks,50lifecycle checks,
59Mirza/API/browser checks,45audit checks and27unit checks. The browser test aborts
only the response after a successful fixture creation, reloads the entire page,
and verifies the same request ID, one customer and one allocation. Native
configuration parameters are checked through the actual copy-all button. Offline
target recovery, intervening consumption, restored-queue consent, ordinary manual
disable, expiration, and a false reset acknowledgement are included.

The installed PHP driver plus connector passed paid/trial request construction,
per-create live selection, unavailable/deleted/unassigned exclusion, no-target
rejection and other-panel preservation checks in a private isolated fixture.
Slow native sample reads were also exercised; no additional reader change was
needed. TypeScript, targeted ESLint, and whitespace validation passed.

Production release identifiers and exact image/host acceptance are recorded here
after acceptance. Private evidence, connection credentials, client identifiers
and database copies remain outside Git.
