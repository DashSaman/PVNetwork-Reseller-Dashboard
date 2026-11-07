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
- Confirming many saved queues repeatedly downloaded the entire native inbound
  catalog. Production acceptance caught a metadata timeout. A13-account fixture
  reproduced20,257ms; sharing a short-lived snapshot within each confirmation
  batch reduced the same read to1,579ms. Metadata confirmation now has a shared
  cancellation deadline; unknown results stay guarded when that budget expires.
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

Local validation covers111customer/API/browser checks,50lifecycle checks,
59Mirza/API/browser checks,45audit checks and27unit checks. The browser test aborts
only the response after a successful fixture creation, reloads the entire page,
and verifies the same request ID, one customer and one allocation. Native
configuration parameters are checked through the actual copy-all button. Offline
target recovery, intervening consumption, restored-queue consent, ordinary manual
disable, expiration, a false reset acknowledgement, many queued accounts and a
slow confirmation exceeding its metadata budget are included.

Linux image validation also includes the default container entrypoint and a fresh
temporary database. Shell scripts are exported with LF endings through
`.gitattributes`, including when Git creates the build archive on Windows.

The installed PHP driver plus connector passed paid/trial request construction,
per-create live selection, unavailable/deleted/unassigned exclusion, no-target
rejection and other-panel preservation checks in a private isolated fixture.
Slow native sample reads were also exercised; no additional reader change was
needed. TypeScript, targeted ESLint, and whitespace validation passed.

Accepted production application revision:
`37de2be1a4a7afaf2c2629c050ff5fd66e0754e6`, including the earlier functional
fixes in `ab3496d5de63445198ed9c5cc6bca66ec3c913e5` and LF archive protection in
`7a336a3ea23baf79eae181f6c0c089285b6b22fc`.

The exact Linux image passed226 isolated API checks (87customer,50lifecycle,
45audit,44Mirza), with external networking disabled, no published host ports and
no production database mounted. The default entrypoint also initialized and ran
against a fresh temporary database. Acceptance against a private fresh copy of
the production database passed before the final live replacement.

Accepted runtime tag: `pv-reseller-dashboard:customer-reliability-20261107-r3`.
Its amd64 manifest is
`sha256:e3c00cf7e6d24cf95432cb65307c8445311b5f3d15df06de7a99e7306c72a129`.
The live dashboard retained its existing environment, signing key, data volume,
network and loopback binding `127.0.0.1:31080`. The previous accepted image remains
available for rollback. A bounded server build had stopped at its own memory cap;
the accepted image was built locally from public source and official base images.
Earlier rejected deployment attempts automatically restored the previous runtime
without restoring a database over live changes.

Live acceptance checked all69 tracked customers, administrator views, both active
reseller scopes,11 distinct assigned available locations, and canonical copied
links in both scopes. Existing offline-target queues remained protected. The
subsequent final comparison confirmed that administrator accounts, reseller
profiles/balances, permissions, all69 customer records and native panel settings
were unchanged by the tests. Native inbound configuration, unrelated service PIDs,
running containers and listeners matched the deployment baseline. Existing backup
and observation timers remained active; no service or port was added.

The configured Mirza connection was updated using a new owner-scoped sales key
and the dashboard subscription base. Only its five connection fields and the two
verified connector files changed; bot customers, wallets, orders, products,
pricing, trial size/duration and other settings were preserved. Saved-connection
status, owned customer/traffic, permitted catalog, subscription and wrong-owner
denial all passed through the installed PHP driver.

The installed driver also performed two real1GB creations, one paid-mode and one
trial-mode, under a temporary reseller with an independent pool and no notification
tokens. Both became usable, with nonempty subscriptions and memberships matching
their actual submitted selection. Live selection changed between calls: the paid
request used10 available locations and the trial used7; unavailable locations were
excluded before each request. An initial test incorrectly compared both with one
earlier catalog; journal and native records confirmed complete membership for each
actual request. Creation was not replayed to resolve that test mismatch.

Copied configurations for those synthetic customers were also compared with the
native subscription. The two customers were deleted through the normal dashboard
path, their full unused allocations were returned, and the temporary reseller and
test journals were removed. No real invoice, wallet charge or Telegram message was
generated. Normal concurrent owner intent and session-revocation cleanup were
preserved during final verification, rather than overwritten from a snapshot.

A final complete dashboard archive was verified against all eight live tables and
its recovery key after test cleanup. It contains69 customers,3 reseller records
(including the archived reseller), permissions, settings and operation journals;
no native infrastructure database was exported. Private evidence, connection
credentials, client identifiers, archive names and database copies remain outside
Git. Future operators must verify the current state and must not replay completed
test, repair or provisioning scripts.
