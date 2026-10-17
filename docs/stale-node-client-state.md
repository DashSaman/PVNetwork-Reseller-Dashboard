# A client becomes disabled again after being enabled

For the confirmed cause, deployed fix, live observation and all three reseller
lifecycle results, start with the [2026-10-17 incident record](incidents/2026-10-17-stale-node-client-state.md).

An enabled client can be disabled by a node's traffic loop even when the central dashboard shows remaining quota and a future expiration. A stale copy on a node can retain an older, smaller quota. If that copy is already depleted, enabling the central record alone does not repair it.

## Diagnose before changing anything

1. Identify the exact owner and client from the dashboard ownership table and activity log. Read the authoritative central client, its usage, expiration and attached inbound IDs.
2. Compare every occurrence of that email/connection identity in inbound settings. A node copy can appear in an inbound snapshot without appearing among the central client's attached IDs.
3. Verify the corresponding node's own client record and traffic counters. Check quota and expiration as well as enabled state; an unavailable read is not evidence of zero usage.
4. Treat mutation responses as acknowledgements. Re-read the actual record: a successful central attach/detach response can leave a node-owned copy unchanged.

## Repair one account safely

- Make private database and client snapshots before the repair. Do not commit subscriber records, connection identities or credentials.
- Use the owning node's client API to reconcile only the affected account with its valid allocated quota and expiration. Preserve its UUID, subscription ID, protocol fields, reset policy, device limits and original inbound memberships. Do not reset traffic to work around a stale limit.
- The client update API replaces fields rather than patching them. Construct the complete payload appropriate for the protocol. A client-detail response can wrap the client in `client` and expose `usedTraffic`, rather than embedding a `traffic` object. Protocol-specific response values are not necessarily valid request types (for example an empty stored `allowedIPs` string versus a request array).
- Authenticate through an existing operator credential when available. A temporary local maintenance credential must have a short deadline, remain private, and be revoked in `finally`. Native API-token deadlines use Unix milliseconds; token creation timestamps use seconds. Never rotate or remove existing credentials as part of this repair.
- Enable the one account centrally after correcting its node copy. Re-read both copies, then observe them for longer than the reported recurrence interval.
- Verify consumption did not decrease, identities/memberships stayed intact, unrelated client configuration and authentication settings are unchanged, and service PIDs/container identities/port bindings stayed intact. No restart or network change is required for this data repair.

This procedure reconciles the affected account. It does not migrate nodes, alter inbound ownership, or replace a complete node configuration. If future central edits do not reach a node copy, inspect the node ownership/synchronization relationship separately before expanding the repair scope.

## Dashboard prevention for unlinked node copies

The dashboard adapter now supports explicit node repair peers. Before a client
update reports success, it reads the master and each existing unlinked peer copy,
requires the same UUID, writes the peer's complete client record with the intended
quota/expiry/enable changes, verifies it, then writes and verifies the master.
Per-node settings and traffic counters are preserved. Missing accounts are never
created by reconciliation. Copies linked to the configured master inbound IDs
remain under the native master's normal fan-out. This applies to single edits,
bulk extension, subscription rotation and bridge updates through `updateClient`.

Peer connections are **not** PanelConfig billing panels. Their traffic is not added
to canonical usage, and they do not change pool calculations. Reset/delete use
the existing operation journal with durable per-peer and master progress. A reset
whose response was lost is marked STARTED and requires administrator repair;
retry must never silently reset newly accrued traffic. A completed peer is skipped
on resume. Deliberately disabled accounts are not automatically re-enabled.

Provision through the root-only CLI:

```sh
docker exec -i pv-reseller-dashboard node scripts/configure-node-sync.cjs PANEL_ID < /root/private-peers.json
```

The input is a JSON array of `{key, baseUrl, token, masterInboundIds, tls?}`.
Use stable unique keys, the owning node's HTTPS API URL and a dedicated native
client-write credential. The native v3.10.2 API requires admin scope for these
client routes; monitor/node-sync scopes do not grant these operations. Optional
`tls: {connectHost, ca}` routes through a private address while retaining CA and
hostname verification. No listener or new port is created. Never use a token hash
as a bearer token, disable TLS verification, print credentials, or add the peer as
another billing panel. The entire peer document is AES-GCM encrypted in Setting
`nodeSyncPeers:PANEL_ID` with APP_SECRET and included in dashboard backups.

On server migration restore APP_SECRET and the encrypted settings together, then
verify the peer address, private gateway and CA on the destination. On certificate
renewal with a new self-signed CA, update the configured CA. If a peer is unavailable
or identity verification fails, writes stop with a partial-operation error; reserved
quota remains held. Do not drop peer configuration while operations are pending.

The [dashboard migration runbook (Persian)](dashboard-migration-restore.fa.md)
covers archive restore, destination port/network isolation, key installation,
peer routing checks, single-writer cutover, acceptance and rollback.

Rollback: keep the previous image/container and pre-deployment SQLite snapshot.
Reverting the image preserves the database, but removes peer protection, so pause
mutations until corrected. Revoke the dedicated native token and remove the
encrypted peer setting only when intentionally retiring this integration.

Regression checks:

```sh
node --test scripts/test-node-client-sync.mjs
node scripts/test-node-client-sync-api.mjs
```

The second fixture uses Python cryptography to create a temporary test CA. It
checks real Next routes, SQLite journals, HTTPS hostname validation, bulk edits,
intentional disable, partial retries, reset and delete without real VPN accounts.
