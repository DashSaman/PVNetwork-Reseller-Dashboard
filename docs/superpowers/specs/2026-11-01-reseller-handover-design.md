# Remove a reseller while keeping their users with the administrator

The user chose viewing existing users and handing them to the main administrator
until their current quota or expiry is reached. Deployment must not perform the
handover; the administrator initiates it later from the panel.

## Approach

Hard deletion of a reseller with users would cascade away dashboard ownership and
leave working native clients unmanaged. Deleting native clients is incompatible
with the requested continuity. Keep the closed reseller's accounting/history as an
internal ownership group, mark that group administrator-managed in Setting, and
disable reseller authentication. Hide it from the reseller list and active counts;
show its users in an administrator users tab. No schema migration is required.
Retain its username to prevent identity reuse. Historical traffic accounting remains
intact and identifies the group as transferred to administrator management.

## Behavior and constraints

- The remove dialog fetches the current users and a signed preview token. It lists
  the accounts and requires the reseller username to confirm the handover.
- Recheck the preview and unfinished operations inside the existing reseller lock.
  Reject a stale user list or any unfinished operation, including NEEDS_REPAIR.
- Atomically disable the reseller, record administrator ownership and audit it.
  Retrying a completed handover returns the original outcome. Preserve every user
  row, native identity, subscription URL, quota, expiry, status, consumption and
  accounting reservation. Never call a native mutation endpoint during handover.
- Login, sessions, bridge authentication and reseller edit/reactivation reject a
  transferred group even if an active flag is accidentally re-enabled.
- Existing subscription delivery and native quota/expiry enforcement continue;
  no reset, renewal, automatic deletion or new timer is introduced.
- The admin users tab lists all users with owner/source, current quota and live
  consumption/expiry/status. Missing live values are unknown, never fabricated zero.
- Preserve real production data during tests and deployment, runtime secrets,
  loopback binding 127.0.0.1:31080, existing network/data mount, other services/ports.

Separately compare official 3x-ui features with this repository and record useful
addition candidates; do not install an upstream upgrade or add those features now.
