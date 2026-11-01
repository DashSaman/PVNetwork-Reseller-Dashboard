# Scoped customer management

User authorized implementing the capability comparison with this role boundary:
native 3x-ui administrators alone change routing, protocols, ports, host rules,
nodes and inbound configuration. Dashboard administrators assign existing inbound
access. Resellers manage only their own customers within those assignments.

## Approach

Extend the existing dashboard and its verified client mutation adapter. Do not
proxy native bulk/infrastructure APIs or add dependencies. Keep metadata and
bounded usage observations in Setting so the existing full backup/restore includes
them without a schema migration. Local labels avoid native cross-tenant groups.

## Deliverables

- Private per-customer labels, filter/search, and last connection (unknown stays
  unknown; native data unavailable must not imply never used).
- Selected-customer enable/disable, explicit preview, per-customer results and
  durable retry. Mutate only enable, preserve quota/counters/expiry/membership.
- Optional first-connection validity in single/bulk creation; negative duration
  preserved in retries, native node copies and all displays. Existing users stay
  untouched unless explicitly edited.
- Daily usage observations and operation history per customer. First observation
  establishes baseline; no fabricated historical consumption. Resets account for
  committed debit exactly once. Keep 90 days; show collection coverage.
- Installable mobile manifest with static-only offline shell; never cache API,
  dashboard HTML, authentication or subscriptions.
- Independent bounded observation/threshold job, existing Telegram delivery with
  configurable thresholds, no new listening ports. Backup/restore covers settings.

## Safety and acceptance

Existing finite-pool accounting, durable journals, reseller locks, permission
rechecks and handover ownership remain authoritative. No automatic native resets,
host-rule editor, protocol/routing/port controls or infrastructure upgrade.
Test tenant isolation, forbidden fields/routes, unknown data, failed partial writes,
retries, first-use expiry and reset-aware history against synthetic fixtures.
Deploy only dashboard and its own observation timer after immutable-image checks;
preserve real customer rows/native configuration, runtime secret, mount, binding,
unrelated service identities and ports. Capture rollback and complete backup.
