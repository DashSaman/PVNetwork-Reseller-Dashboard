# Remove the optional per-customer consumption/history interface

The user reported an empty per-customer chart and a white hover surface, and
explicitly preferred removing this unnecessary interface. The shared row's
`مصرف و سابقه` button and its complete dialog/chart were removed from both the
administrator and reseller user tables.

The removed component displayed a chart whenever the observation had any days,
including zero-delta samples, and used an unthemed default Recharts tooltip. An
initial observation is only a baseline: past daily usage cannot be reconstructed
from the current counter. Removal avoids presenting that limited history as a
useful daily chart. This is a UI change, not a traffic reset or accounting repair.

Current usage/quota, expiry, status, last connection, labels, selection and group
actions remain in place. The aggregate quota charts remain. The observation job,
threshold alerts, history APIs, existing history settings and backup contents
remain compatible; no stored customer or journal data is deleted. No dependency,
schema, native-panel configuration or permission boundary changes.

## Validation

- A browser regression first failed against the previous reseller history button.
- The isolated customer-management suite now passes 58 checks: 47 API checks and
  11 browser checks. Both roles show current usage and labels without the removed
  control; reseller last connection and group/status actions remain available.
- Desktop row-hover screenshots and mobile screenshots were inspected. No page
  overflow or client errors; static-only offline behavior remains intact.
- TypeScript and ESLint for the changed components pass.
- Tests use synthetic SQLite data and loopback panel mocks, never real customer
  writes.

## Production acceptance

Runtime commit `8309e1cf06571874beef4b1acc75fbfc39640670` was pushed and deployed
as `pv-reseller-dashboard:history-ui-20261101`, image
`sha256:97f22173c873794405dae00f7faaa56f6d2ae1e69b01e48a49f4e63cbd6070c3`.
The production build passes. The actual image passes all 47 API checks with
`--network none`, synthetic data, no published ports and no production mount;
its 21 client JavaScript chunks were checked for absence of the removed interface.

Read-only acceptance verified all 57 live customers, both active reseller
bootstraps (55 customers), the administrator's complete view, authorization
boundaries and the fresh-install-only restore restriction. A consistent SQLite
snapshot was taken before replacement. Every non-log table was identical across
deployment: 57 users, 3 retained reseller rows, 33 inbound assignments, 153 journals
and 60 settings were preserved. Existing activity log rows were retained.

Unrelated container identities/start times, service PIDs/listeners and native
inbound configuration matched before and after. The existing loopback binding
`127.0.0.1:31080`, environment, encryption key, network and data mount were preserved.
Backup and observation timers remain active. The previous dashboard container is
retained for rollback; no native client mutation, restore or handover was executed.
