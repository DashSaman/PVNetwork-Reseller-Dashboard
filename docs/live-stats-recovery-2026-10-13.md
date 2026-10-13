# Live statistics recovery — 2026-10-13

The production native panel returned a valid 25,132,154-byte JSON response after 22.9 seconds. The adapter's 20-second timeout included body consumption, and a swallowed JSON error made this appear as an invalid HTTP 200 response. The UI timeout argument was ignored. Bootstrap fabricated zero usage, unlimited expiry, and enabled status before live data arrived; admin statistics did not retry a pending read.

Display routes now share one bounded background snapshot per active panel/configuration version. Cold UI requests wait at most one second. Native snapshots have a 60-second deadline; successful snapshots are fresh for 30 seconds and retained for at most 120 seconds while refreshing. Failed reads back off for 15 seconds. Invalidating a panel or completing a panel mutation aborts/discards pending display work. Accounting and mutation preparation continue using authoritative reads, never the display cache. Write deadlines remain 20 seconds.

Unknown usage, expiration, and enabled state are nullable. The page displays pending values, preserves known values during refresh, retries visible pages automatically, and disables edits that would save unknown or stale defaults. Actual zero usage, unlimited expiry, and disabled status retain their meaning.

Validation: 3 display-cache tests, 10 live API regression checks (including a response body beyond 20 seconds), 10 bulk unit tests, 34 bulk/backup integration checks, TypeScript and scoped ESLint. Browser checks cover cold-to-live transitions for admin and representative at desktop and mobile sizes. Python backup tests: 8 passed, 1 platform-specific skip on Windows.

Deployment must retain the existing 127.0.0.1:31080 binding, network, environment and data mount. Check the candidate with an isolated SQLite copy and no network/published ports, preserve the previous container, then verify real admin totals and representative usage/expiration against the connected panel. Do not reset traffic, change native panel data, or alter unrelated services.
