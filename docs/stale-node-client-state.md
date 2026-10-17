# A client becomes disabled again after being enabled

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
