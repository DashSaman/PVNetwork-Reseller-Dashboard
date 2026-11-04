# Reseller inbound availability

## Cause

The fast bootstrap used stored grants as selectable locations. The live catalog
also returned those grants as fallback rows when an inbound was deleted or its
controller could not be read. Creation checked permission and existence but did
not require the selected inbound's runtime to be healthy. A disconnected node
could therefore remain visible and receive a new, incomplete creation request.

## Selection policy

- Keep the administrator's grants intact. Offer only their intersection with a
  fresh native inbound list and verified runtime health. Never use database-only
  metadata or a last-known-good snapshot as availability evidence.
- Require an explicitly enabled inbound. Local inbounds require the controller's
  Xray state to be running. Remote inbounds require one unambiguous direct node
  with enabled/online/running state, no pending configuration, and a heartbeat
  within 120 seconds. Unknown, stale or malformed evidence fails closed.
- Use the native runtime's `nodeId` association. Child/transitive node IDs belong
  to another namespace and cannot override a direct node. An origin GUID alone
  is provenance, not sufficient evidence of the runtime destination.
- Read independent controllers concurrently with bounded requests. Share only
  concurrent catalog reads; do not retain a successful availability cache.
  The instant bootstrap remains local-only and returns no unverified choices.
- Refresh the visible catalog every 15 seconds while the page is visible and
  on focus, reconnection or return to the tab. Hide unavailable location labels,
  picker options, reseller direct links, and bridge catalog entries. A healthy
  location returns automatically without altering grants.
- Recheck health on the server before a new single/bulk/bridge creation or an
  added membership, before funding or native writes. A stale or crafted request
  cannot bypass the display filter. A failed creation retry cannot reserve new
  funds before this gate. A disappearing selection blocks submission until the
  user explicitly removes it or the location returns; do not silently create
  on fewer locations than requested.

Availability is an observation, not a guarantee of future connectivity. A node
can fail after the preflight; the existing verified queued-creation handling
still preserves identity, funding and an honest pending result in that race.
This check uses authenticated native health, without probing or opening ports.

## Data boundaries

Do not apply this filter to accounting or live-traffic snapshots. Hidden
locations must not reduce reported consumption, refund allocation, erase
memberships, or change expiry/status. Existing hidden references remain in the
customer's edit state; an ordinary quota/time edit does not select a new
location. Already saved creations can still be confirmed read-only, without
reattach, recreation, reactivation or another charge. Static grant validation
remains separate from the availability policy.

Public customer subscription output, administrator inbound grants, native
routing/protocol configuration, schemas and dependencies are unchanged. Tests
use disposable databases and loopback native mocks. No real customer repair or
native mutation is part of this change.

## Validation before publication

The prior implementation failed 13 new API assertions. With the fix, 54 unit,
41 lifecycle API, 101 customer/browser and 45 audit API checks passed (241 total).
These include deleted/disabled/offline/unknown/stale/stopped states, healthy
return, stale single/bulk/bridge requests, direct links, an unfunded failed retry,
and preserving existing usage/quota/memberships. Browser testing covers a form
already open during an outage, selection preservation, mobile layout, and no
client errors. TypeScript, targeted ESLint and whitespace checks passed.

Deployment evidence and all private identifiers belong in the private operating
memory/receipts, never in this public incident record.
