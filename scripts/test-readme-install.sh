#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
README="$ROOT/README.md"
fail(){ echo "FAIL: $*" >&2; exit 1; }
grep -F 'bash <(curl -fsSL https://raw.githubusercontent.com/DashSaman/PVNetwork-Reseller-Dashboard/main/install.sh)' "$README" >/dev/null || fail "one-line command missing"
grep -F '/opt/pv-reseller' "$README" >/dev/null || fail "new install path missing"
grep -Fi 'does not install 3x-ui, Xray, or Caddy' "$README" >/dev/null || fail "dashboard-only guarantee missing"
grep -F 'Full (strict)' "$README" >/dev/null || fail "Cloudflare strict TLS guidance missing"
grep -Fi 'external 3x-ui' "$README" >/dev/null || fail "external 3x-ui connection docs missing"
echo 'PASS: README documents dashboard-only deployment'
