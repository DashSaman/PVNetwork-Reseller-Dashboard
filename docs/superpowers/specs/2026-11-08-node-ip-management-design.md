# Management of native nodes without external DNS

The controller remains authoritative for users and quota. Remote node copies must
still receive updates and confirmed deletion; a network failure must never mean a
successful deletion or a refund. The user requested removal of external-domain
dependence and has opted out of repeated routine design questions.

The chosen transport uses literal management IPs. Four existing, authenticated
WireGuard paths provide private addresses and an independent way to provision the
node's TLS public-key fingerprint. The fifth node's key is verified through its
existing pinned administrative SSH connection. No new service, tunnel, listener,
DNS record, routing rule or representative permission is required.

The initial four private-path checks passed. During longer observation the
existing Turkish tunnel timed out while the physical IP remained reachable with
the same independently provisioned key and native GUID. The final static routes
therefore use three existing private paths and two authenticated physical IPs.
Only that management proxy was restarted again; no tunnel or global route was
changed. This is a verified configuration change, not automatic retry/fallback.

Compared with repairing public DNS, this removes name resolution and CDN routing
from the management connection. Replacing HTTPS with unauthenticated TLS or HTTP
would not preserve node identity and is rejected. Public-key pinning authenticates
the provisioned node before any API credential or request is transmitted, even
when its certificate uses a private/self-signed identity. Certificate renewal with
the same key preserves that identity; a changed key requires explicit, independently
authenticated reprovisioning. No automatic acceptance of a newly observed key.

The existing ownership proxy, authorization, fresh attribution filter, absolute
deadlines and no-retry rule for writes stay in place. Optional per-socket interface
and mark select an already configured path and fail closed when unavailable.
Connections cannot fall back to DNS or another peer after an uncertain write.

Deploy only after isolated TLS tests and read-only live tests with DNS disabled.
Save the original source/configurations, dashboard database and native snapshots;
replace each management proxy one at a time with rollback. Check customer identity,
quota, expiry, deliberate status and monotonic usage; distinguish previously queued
changes from new changes. Preserve unrelated service processes, listeners and
inbound transports. Keep all real addresses, pins, credentials and customer data
in private operational records, outside the public repository.
