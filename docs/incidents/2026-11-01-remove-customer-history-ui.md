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
- Production build/deployment acceptance is recorded below after execution. Tests
  use synthetic SQLite data and loopback panel mocks, never real customer writes.
