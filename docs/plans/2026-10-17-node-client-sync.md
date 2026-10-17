# Preserve client state on unlinked node copies

The native master updates clients through its client/inbound links. An imported
node inbound with foreign origin metadata can contain a matching client without
that link. Its old quota/expiry then disables an otherwise valid account.

Implement an explicit, encrypted node-peer configuration on the existing panel
connection. Before an update succeeds, preflight matching identities, update
existing unlinked node copies using their own complete client record, then update
the master. Never create placements, import snapshots, reset counters, count peer
traffic twice, or alter node origin metadata. Keep TLS certificate verification.

Cover reset/delete through the same adapter with durable journal progress. An
ambiguous reset must require repair, never automatically reset a second time.
Linked node copies stay under the native master's own fan-out.

Verify with local HTTP fixtures: stale quota/expiry/enable, intentional disable,
identity conflict, missing/unreachable peers, partial retry and subscription
rotation. Run existing quota, bulk and live-stat checks. Build an isolated image,
preserve the live bind/network/volume/environment, retain rollback, then repair
only audited dashboard-owned differences with API writes and compare counters,
identities, unrelated rows and service state. Observe beyond the reported delay.
