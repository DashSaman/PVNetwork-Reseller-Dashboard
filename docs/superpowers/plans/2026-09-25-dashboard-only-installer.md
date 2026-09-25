# Dashboard-Only One-Line Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current full-stack installer with a safe one-line installer that deploys only PVNetwork Reseller Dashboard behind Apache + Let's Encrypt, preserves existing infrastructure, supports idempotent updates, and fixes stale inbound state in the Resellers tab.

**Architecture:** `install.sh` becomes a self-contained, function-based Bash installer because it must work when executed directly from `bash <(curl ...)` and therefore cannot rely on sibling files already being present. It clones/updates the repository into `/opt/pv-reseller/app`, preserves secrets/data outside the container, builds one Docker image, runs one loopback-bound container, integrates a dedicated Apache vhost, and obtains a certificate with Certbot webroot. The previous full-stack installer is preserved only as a clearly named legacy script.

**Tech Stack:** Bash, Docker CLI (no Compose requirement), Apache 2.4, Certbot webroot, Let's Encrypt, Next.js 16, React 19, Prisma/SQLite, Node/Bun build pipeline.

**Spec:** `docs/superpowers/specs/2026-09-25-dashboard-only-installer-design.md`

## Global Constraints

- Default installer installs **only** the PVNetwork Reseller Dashboard.
- Default installer must not provision or reconfigure 3x-ui, Xray, Caddy, VPN services, databases, or unrelated Docker containers.
- Default install root is `/opt/pv-reseller`.
- Default loopback application port is `31080` and binding is exactly `127.0.0.1:${APP_PORT}:3000`.
- Container name is `pv-reseller-dashboard` and restart policy is `unless-stopped`.
- Persistent SQLite data is `${INSTALL_DIR}/data:/app/data` and `DATABASE_URL=file:/app/data/custom.db`.
- Existing `.env`, `APP_SECRET`, `ADMIN_PASSWORD`, and SQLite data are preserved on rerun/update.
- Docker Compose is not required.
- Existing Apache is reused; generated vhosts are additive and Apache changes use `configtest` followed by `reload`, never a forced restart of unrelated services.
- TLS uses Certbot webroot and Let's Encrypt.
- Cloudflare API access is not required; Cloudflare account settings are reported as guidance only.
- Public installer remains one-line: `bash <(curl -fsSL https://raw.githubusercontent.com/DashSaman/PVNetwork-Reseller-Dashboard/main/install.sh)`.

## Review Focus

1. **Existing busy server:** installer must abort on an occupied `APP_PORT` owned by another process, but accept the port if the recognized existing `pv-reseller-dashboard` container owns it during an update.
2. **Rerun after admin changed password in UI:** installer must preserve `.env` and must not claim the stored initial password is necessarily the current UI password.
3. **Cloudflare-proxied hostname:** ACME HTTP challenge must remain reachable and certificate issuance must work without requiring the origin IP to appear in public DNS.
4. **Failed new image health check:** installer must restore the previous dashboard image/container while keeping the same database and secrets.
5. **Existing Apache vhosts on 80/443:** installer must add only `npanel`-style vhosts for the requested hostname and must never overwrite or disable unrelated site files.

---

## File Structure

- `install.sh` — self-contained default dashboard-only installer and updater; contains testable helper functions and the executable `main` flow.
- `scripts/install-full-stack-legacy.sh` — exact preservation of the old Caddy + 3x-ui + Xray-oriented installer, with a warning header that it is legacy and not the default.
- `update.sh` — convenience wrapper for an already-installed dashboard; reads installer metadata and delegates to the same safe `install.sh` update flow.
- `scripts/test-dashboard-installer.sh` — shell regression tests for validation, generated Apache configs, secret preservation, safety invariants, and update ownership rules.
- `src/components/panel/admin-view.tsx` — refreshes inbound state whenever the Resellers tab is entered.
- `scripts/test-inbound-refresh.mjs` — small source-level regression check for the refresh hook, followed by the real production build as integration validation.
- `README.md` — one-line installation, DNS/Cloudflare prerequisites, paths, update/backup/rollback, and external 3x-ui connection documentation.

---

### Task 1: Preserve the legacy installer and establish installer regression tests

**Files:**
- Create: `scripts/install-full-stack-legacy.sh`
- Create: `scripts/test-dashboard-installer.sh`
- Modify: `install.sh`

**Interfaces:**
- Consumes: current `install.sh` as the source for the legacy copy.
- Produces: testable installer helpers `validate_domain`, `render_http_vhost`, `render_https_vhost`, `load_or_create_secrets`, `port_is_available_for_install`, plus `PVNET_INSTALLER_LIB_ONLY=1` for sourcing without executing `main`.

- [ ] **Step 1: Copy the current installer verbatim to the legacy path and prepend a warning header**

The top of `scripts/install-full-stack-legacy.sh` must begin with:

```bash
#!/usr/bin/env bash
# LEGACY FULL-STACK INSTALLER
# This script provisions Caddy + 3x-ui/Xray-related resources and is NOT the
# recommended installer for existing infrastructure. Use ../install.sh for the
# dashboard-only deployment.
```

Append the complete pre-change `install.sh` body after that header and keep it executable.

- [ ] **Step 2: Write the failing shell regression test before replacing the default installer**

Create `scripts/test-dashboard-installer.sh` with this initial structure:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/install.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# Default installer must never provision infrastructure services.
if grep -Eqi 'ghcr\.io/mhsanaei/3x-ui|network_mode:[[:space:]]*host|caddy:2|x-ui setting|in-10000|XRAY_VMESS' "$INSTALLER"; then
  fail "default install.sh still contains full-stack provisioning"
fi

PVNET_INSTALLER_LIB_ONLY=1 source "$INSTALLER"

declare -a good_domains=("npanel.softarg.ir" "panel.example.com" "a-b.example.co.uk")
for d in "${good_domains[@]}"; do
  validate_domain "$d" || fail "valid domain rejected: $d"
done

declare -a bad_domains=("" "http://panel.example.com" "panel_example.com" "-bad.example.com" "bad..example.com")
for d in "${bad_domains[@]}"; do
  if validate_domain "$d"; then fail "invalid domain accepted: $d"; fi
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
render_http_vhost "npanel.softarg.ir" "/var/www/letsencrypt" "$TMP/http.conf"
grep -F 'ServerName npanel.softarg.ir' "$TMP/http.conf" >/dev/null || fail "HTTP vhost missing ServerName"
grep -F 'Alias /.well-known/acme-challenge/' "$TMP/http.conf" >/dev/null || fail "HTTP vhost missing ACME alias"

render_https_vhost "npanel.softarg.ir" "31080" "$TMP/https.conf"
grep -F 'ProxyPass        / http://127.0.0.1:31080/' "$TMP/https.conf" >/dev/null || fail "HTTPS vhost is not loopback proxied"
grep -F 'RequestHeader set X-Forwarded-Proto "https"' "$TMP/https.conf" >/dev/null || fail "HTTPS vhost missing forwarded proto"

TEST_INSTALL_DIR="$TMP/install"
INSTALL_DIR="$TEST_INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
load_or_create_secrets
FIRST_SECRET="$APP_SECRET"
FIRST_PASSWORD="$ADMIN_PASSWORD"
load_or_create_secrets
[[ "$APP_SECRET" == "$FIRST_SECRET" ]] || fail "APP_SECRET rotated on rerun"
[[ "$ADMIN_PASSWORD" == "$FIRST_PASSWORD" ]] || fail "ADMIN_PASSWORD rotated on rerun"
[[ "$(stat -c '%a' "$INSTALL_DIR/.env")" == "600" ]] || fail ".env permissions are not 600"

pass "dashboard-only installer regression checks"
```

- [ ] **Step 3: Run the test and verify it fails against the old installer**

Run:

```bash
bash scripts/test-dashboard-installer.sh
```

Expected: FAIL because the current default `install.sh` still contains 3x-ui/Caddy/full-stack provisioning and does not expose the helper functions.

- [ ] **Step 4: Replace `install.sh` with a function-based dashboard-only skeleton sufficient to make helper tests runnable**

Start the new `install.sh` with:

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/pv-reseller}"
REPO_DIR="$INSTALL_DIR/app"
DATA_DIR="$INSTALL_DIR/data"
BACKUP_DIR="$INSTALL_DIR/backup"
APP_PORT="${APP_PORT:-31080}"
CONTAINER_NAME="pv-reseller-dashboard"
IMAGE_NAME="pv-reseller-dashboard:local"
NETWORK_NAME="pv_reseller_net"
REPO_URL="https://github.com/DashSaman/PVNetwork-Reseller-Dashboard.git"
ACME_WEBROOT="/var/www/letsencrypt"

log() { printf '\033[1;36m[PVNetwork]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

validate_domain() {
  local d="${1:-}"
  [[ "$d" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]]
}

load_or_create_secrets() {
  mkdir -p "$INSTALL_DIR"
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    # shellcheck disable=SC1090
    source "$INSTALL_DIR/.env"
    export APP_SECRET ADMIN_USERNAME ADMIN_PASSWORD
    return
  fi
  APP_SECRET="$(openssl rand -hex 32)"
  ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
  ADMIN_PASSWORD="PV$(openssl rand -hex 12)A9!"
  umask 077
  cat > "$INSTALL_DIR/.env" <<EOF
APP_SECRET=$APP_SECRET
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF
  chmod 600 "$INSTALL_DIR/.env"
  export APP_SECRET ADMIN_USERNAME ADMIN_PASSWORD
}
```

Implement `render_http_vhost` and `render_https_vhost` exactly from the approved spec: HTTP serves ACME and redirects other paths; HTTPS proxies only to loopback and adds forwarded HTTPS headers.

End the script with:

```bash
if [[ "${PVNET_INSTALLER_LIB_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
```

`main` may temporarily emit `die "installer implementation incomplete"` until later tasks; this task only establishes the tested helper boundary.

- [ ] **Step 5: Run the regression test again**

Run:

```bash
bash scripts/test-dashboard-installer.sh
bash -n install.sh
bash -n scripts/install-full-stack-legacy.sh
```

Expected: all PASS / no syntax output.

- [ ] **Step 6: Commit**

```bash
git add install.sh scripts/install-full-stack-legacy.sh scripts/test-dashboard-installer.sh
git commit -m "refactor: make dashboard-only installer the default"
```

---

### Task 2: Implement safe first-install and idempotent update lifecycle

**Files:**
- Modify: `install.sh`
- Modify: `scripts/test-dashboard-installer.sh`
- Modify: `update.sh`

**Interfaces:**
- Consumes: helper functions from Task 1.
- Produces: `main`, `preflight`, `backup_existing_install`, `sync_repository`, `build_dashboard_image`, `run_dashboard_container`, `local_health_check`, `rollback_dashboard`, and installer metadata at `${INSTALL_DIR}/.installer-env`.

- [ ] **Step 1: Add failing tests for port ownership, metadata preservation, and forbidden side effects**

Append to `scripts/test-dashboard-installer.sh`:

```bash
# install metadata must be deterministic and non-secret.
PANEL_DOMAIN="npanel.softarg.ir"
write_installer_metadata
[[ -f "$INSTALL_DIR/.installer-env" ]] || fail "installer metadata not written"
grep -F 'PANEL_DOMAIN=npanel.softarg.ir' "$INSTALL_DIR/.installer-env" >/dev/null || fail "domain missing from installer metadata"
grep -F "APP_PORT=$APP_PORT" "$INSTALL_DIR/.installer-env" >/dev/null || fail "app port missing from installer metadata"

# Static safety invariants on default installer.
! grep -Eqi 'docker[[:space:]]+restart[[:space:]]+(?!\$?CONTAINER_NAME)|systemctl[[:space:]]+restart|ufw|iptables|nft[[:space:]]' "$INSTALLER" || fail "installer contains broad service/firewall restart logic"
grep -F '127.0.0.1:${APP_PORT}:3000' "$INSTALLER" >/dev/null || fail "loopback Docker publish invariant missing"
```

If portable grep rejects the negative lookahead, implement this test as explicit positive checks for allowed `docker rm/stop` lines and separate rejects for known unrelated service names; do not weaken the invariant.

- [ ] **Step 2: Run tests and verify the new lifecycle tests fail**

Run:

```bash
bash scripts/test-dashboard-installer.sh
```

Expected: FAIL on missing `write_installer_metadata` and lifecycle implementation.

- [ ] **Step 3: Implement interactive input and metadata reuse**

`main` must resolve inputs in this order:

```bash
# 1. explicit environment value
# 2. existing $INSTALL_DIR/.installer-env value
# 3. interactive /dev/tty prompt
```

Persist only:

```text
PANEL_DOMAIN=<domain>
APP_PORT=<port>
INSTALL_DIR=<absolute path>
```

Do not persist Cloudflare tokens because none are required.

On first install print the generated initial admin credential once and write `${INSTALL_DIR}/INITIAL_CREDENTIALS.txt` mode `0600` with a prominent note that a later UI password change makes this file historical only. On update, do not print the stored password as if it were current.

- [ ] **Step 4: Implement preflight checks before mutations**

`preflight` must enforce:

```bash
[[ "$(id -u)" -eq 0 ]] || die "Run as root"
[[ -r /etc/os-release ]] || die "Cannot identify OS"
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) die "Only Ubuntu/Debian are supported" ;; esac
validate_domain "$PANEL_DOMAIN" || die "Invalid PANEL_DOMAIN"
[[ "$APP_PORT" =~ ^[0-9]+$ ]] && (( APP_PORT >= 1024 && APP_PORT <= 65535 )) || die "Invalid APP_PORT"
```

Disk safety: require at least 4 GiB free on the filesystem containing `INSTALL_DIR` before first build. If `INSTALL_DIR` does not exist yet, check its parent filesystem.

Port safety: if `127.0.0.1:${APP_PORT}` is listening and `docker inspect pv-reseller-dashboard` does not show the recognized bind for that port, abort instead of killing the owner.

Apache safety: if Apache is absent, ports 80 and 443 must be free before installing it. If Apache exists/runs, existing listeners on 80/443 are acceptable.

- [ ] **Step 5: Implement host dependency preparation without Compose**

Install only missing packages needed by the flow: `git`, `curl`, `ca-certificates`, `openssl`, `apache2`, `certbot` and Docker when absent.

For Docker:

```bash
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker info >/dev/null 2>&1 || die "Docker is installed but not operational"
```

Do not restart Docker if it is already operational.

For Apache, enable only:

```bash
a2enmod proxy proxy_http headers ssl rewrite
```

Do not disable any existing module or site.

- [ ] **Step 6: Implement repository sync and backups**

First install:

```bash
git clone --depth 1 "$REPO_URL" "$REPO_DIR"
```

Update:

```bash
git -C "$REPO_DIR" fetch origin main
git -C "$REPO_DIR" reset --hard origin/main
```

Before an update create a timestamped directory under `${BACKUP_DIR}/YYYYmmdd-HHMMSS/` and copy, when present:

```text
data/custom.db
.env
.installer-env
/etc/apache2/sites-available/${PANEL_DOMAIN}.conf
/etc/apache2/sites-available/${PANEL_DOMAIN}-ssl.conf
```

Never remove older backups automatically in this change.

- [ ] **Step 7: Implement image build, rollback tag, container replacement, and local health check**

Build first while the existing container remains running:

```bash
docker build -f "$REPO_DIR/docker/Dockerfile" -t pv-reseller-dashboard:candidate "$REPO_DIR"
```

If an existing `pv-reseller-dashboard:local` image exists, tag it:

```bash
docker tag pv-reseller-dashboard:local pv-reseller-dashboard:rollback
```

Promote candidate:

```bash
docker tag pv-reseller-dashboard:candidate pv-reseller-dashboard:local
```

Create the network only if absent:

```bash
docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 || docker network create "$NETWORK_NAME"
```

Remove/recreate **only** `pv-reseller-dashboard`, then run exactly one application container with:

```bash
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --network "$NETWORK_NAME" \
  --env-file "$INSTALL_DIR/.env" \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e HOSTNAME=0.0.0.0 \
  -e DATABASE_URL=file:/app/data/custom.db \
  -v "$DATA_DIR:/app/data" \
  -p "127.0.0.1:${APP_PORT}:3000" \
  "$IMAGE_NAME"
```

Health polling must retry for up to 30 seconds:

```bash
curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null
curl -fsS "http://127.0.0.1:${APP_PORT}/api/auth/me" | grep -q '"user"'
```

If health fails and `pv-reseller-dashboard:rollback` exists, remove only the failed dashboard container, retag rollback to local, recreate the dashboard with the same `.env`, data mount, network and loopback port, then report update failure.

- [ ] **Step 8: Replace `update.sh` with a safe convenience wrapper**

Use:

```bash
#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/pv-reseller}"
META="$INSTALL_DIR/.installer-env"
[[ -f "$META" ]] || { echo "PVNetwork install metadata not found: $META" >&2; exit 1; }
# shellcheck disable=SC1090
source "$META"
exec env PANEL_DOMAIN="$PANEL_DOMAIN" APP_PORT="$APP_PORT" INSTALL_DIR="$INSTALL_DIR" \
  bash "$INSTALL_DIR/app/install.sh"
```

The canonical update remains rerunning the one-line installer; `update.sh` is only a convenience.

- [ ] **Step 9: Run lifecycle regression checks and syntax checks**

Run:

```bash
bash scripts/test-dashboard-installer.sh
bash -n install.sh
bash -n update.sh
```

Expected: PASS / no syntax output.

- [ ] **Step 10: Commit**

```bash
git add install.sh update.sh scripts/test-dashboard-installer.sh
git commit -m "feat: add safe dashboard install and update lifecycle"
```

---

### Task 3: Implement additive Apache + Certbot HTTPS automation

**Files:**
- Modify: `install.sh`
- Modify: `scripts/test-dashboard-installer.sh`

**Interfaces:**
- Consumes: `PANEL_DOMAIN`, `APP_PORT`, `ACME_WEBROOT`, running local dashboard from Task 2.
- Produces: `/etc/apache2/sites-available/${PANEL_DOMAIN}.conf`, `/etc/apache2/sites-available/${PANEL_DOMAIN}-ssl.conf`, enabled vhosts, valid Let's Encrypt certificate.

- [ ] **Step 1: Add failing vhost isolation and ACME tests**

Append assertions that generated HTTP config contains only the requested `ServerName`, has an ACME `Alias`, excludes ACME from redirect, and does not contain wildcard `VirtualHost` routing beyond normal `*:80`. Append HTTPS assertions that certificate paths are exactly:

```text
/etc/letsencrypt/live/${PANEL_DOMAIN}/fullchain.pem
/etc/letsencrypt/live/${PANEL_DOMAIN}/privkey.pem
```

and backend target is only `127.0.0.1:${APP_PORT}`.

Also assert `install.sh` contains `apache2ctl configtest` before every `systemctl reload apache2` call and contains no `systemctl restart apache2`.

- [ ] **Step 2: Run tests and verify failure before wiring the host flow**

Run:

```bash
bash scripts/test-dashboard-installer.sh
```

Expected: FAIL because the helper output may exist but host installation flow is not yet connected.

- [ ] **Step 3: Implement Apache backup and HTTP bootstrap vhost**

Before writing site files, copy existing same-name vhost files into the current timestamped backup directory if they exist. Never touch other site files.

Write `${PANEL_DOMAIN}.conf`, enable it with:

```bash
a2ensite "${PANEL_DOMAIN}.conf"
apache2ctl configtest || die "Apache config test failed before HTTP activation"
systemctl reload apache2
```

Create `${ACME_WEBROOT}/.well-known/acme-challenge/` before the reload.

- [ ] **Step 4: Verify the ACME path through the public hostname**

Create a nonce file:

```bash
ACME_PROBE="pvnetwork-$(openssl rand -hex 6)"
printf '%s\n' "$ACME_PROBE" > "$ACME_WEBROOT/.well-known/acme-challenge/$ACME_PROBE"
```

Retry for up to 60 seconds:

```bash
curl -fsS "http://${PANEL_DOMAIN}/.well-known/acme-challenge/${ACME_PROBE}"
```

The response must equal the nonce. If DNS has not propagated or Cloudflare/another proxy blocks the path, stop with a clear message while leaving the local dashboard running and the HTTP vhost available for retry.

- [ ] **Step 5: Issue/reuse the certificate and create HTTPS vhost**

If `/etc/letsencrypt/live/${PANEL_DOMAIN}/fullchain.pem` and `privkey.pem` are valid files, reuse them. Otherwise run:

```bash
certbot certonly --webroot \
  -w "$ACME_WEBROOT" \
  -d "$PANEL_DOMAIN" \
  --agree-tos \
  --non-interactive \
  --register-unsafely-without-email
```

Then render `${PANEL_DOMAIN}-ssl.conf`, enable it, `configtest`, and `reload`.

Finally replace the bootstrap HTTP proxy behavior with ACME + 301 redirect to `https://${PANEL_DOMAIN}%{REQUEST_URI}`, preserving the ACME exception, then `configtest` and `reload` once more.

- [ ] **Step 6: Verify origin and public HTTPS**

Origin test, bypassing DNS/Cloudflare:

```bash
curl -fsS --resolve "${PANEL_DOMAIN}:443:127.0.0.1" "https://${PANEL_DOMAIN}/" >/dev/null
curl -fsS --resolve "${PANEL_DOMAIN}:443:127.0.0.1" "https://${PANEL_DOMAIN}/api/auth/me" | grep -q '"user"'
```

Public test:

```bash
curl -fsS "https://${PANEL_DOMAIN}/" >/dev/null
```

If origin HTTPS passes but public HTTPS does not, finish with a warning rather than altering unrelated network/firewall settings.

- [ ] **Step 7: Print Cloudflare guidance only when Cloudflare is detected**

Detection may use public response headers, for example:

```bash
if curl -sI "https://${PANEL_DOMAIN}/" | grep -qi '^server:[[:space:]]*cloudflare'; then
  warn "Cloudflare detected: use Full (strict), keep proxy enabled, bypass cache for this hostname, and disable Rocket Loader here if it interferes with Next.js."
fi
```

Do not call Cloudflare APIs.

- [ ] **Step 8: Run tests and syntax checks**

```bash
bash scripts/test-dashboard-installer.sh
bash -n install.sh
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add install.sh scripts/test-dashboard-installer.sh
git commit -m "feat: automate Apache and Let's Encrypt setup"
```

---

### Task 4: Fix stale inbound data when entering Resellers

**Files:**
- Modify: `src/components/panel/admin-view.tsx`
- Create: `scripts/test-inbound-refresh.mjs`

**Interfaces:**
- Consumes: existing `loadInbounds(): Promise<void>` callback inside `AdminView`.
- Produces: tab selection path that refreshes inbounds before/while displaying `ResellersTab`.

- [ ] **Step 1: Write the failing regression check**

Create `scripts/test-inbound-refresh.mjs`:

```js
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/components/panel/admin-view.tsx", import.meta.url), "utf8");

if (!src.includes('function selectTab(nextTab: Tab)')) {
  throw new Error("AdminView must use a named selectTab handler");
}
if (!src.includes('if (nextTab === "resellers") void loadInbounds();')) {
  throw new Error("Entering Resellers must refresh inbounds");
}
if (!src.includes('onClick={() => selectTab(t.id)}')) {
  throw new Error("Tab buttons must use selectTab");
}
console.log("PASS: reseller tab refreshes inbounds");
```

- [ ] **Step 2: Run it and verify it fails**

```bash
node scripts/test-inbound-refresh.mjs
```

Expected: FAIL because `selectTab` does not exist yet.

- [ ] **Step 3: Implement the minimal refresh handler**

Inside `AdminView`, after `loadInbounds` is defined, add:

```tsx
function selectTab(nextTab: Tab) {
  setTab(nextTab);
  if (nextTab === "resellers") void loadInbounds();
}
```

Change the tab button from:

```tsx
onClick={() => setTab(t.id)}
```

to:

```tsx
onClick={() => selectTab(t.id)}
```

Do not change `/api/admin/inbounds`; it already aggregates the backend panel inbounds correctly.

- [ ] **Step 4: Run the focused regression check**

```bash
node scripts/test-inbound-refresh.mjs
```

Expected: `PASS: reseller tab refreshes inbounds`.

- [ ] **Step 5: Run lint and production build**

```bash
bun install --frozen-lockfile
bun run lint
bun run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/panel/admin-view.tsx scripts/test-inbound-refresh.mjs
git commit -m "fix: refresh inbounds when opening resellers"
```

---

### Task 5: Rewrite installation documentation around dashboard-only deployment

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: finished behavior from Tasks 1-4.
- Produces: operator documentation that matches the default installer exactly.

- [ ] **Step 1: Replace the primary installation section with the exact one-line command**

Document:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/DashSaman/PVNetwork-Reseller-Dashboard/main/install.sh)
```

State explicitly near the command:

```text
The default installer installs only PVNetwork Reseller Dashboard.
It does not install or modify 3x-ui, Xray, or Caddy.
```

- [ ] **Step 2: Document prerequisites and prompts**

Required DNS prerequisite: a hostname controlled by the operator that resolves/proxies to the target server and allows HTTP `/.well-known/acme-challenge/` traffic.

Document prompts:

```text
Panel domain: npanel.example.com
Admin username [admin]:
```

Document Cloudflare settings after successful origin HTTPS:

```text
Proxy: Proxied (orange cloud)
SSL/TLS: Full (strict)
Always Use HTTPS: On
Cache Rule for panel hostname: Bypass cache
Rocket Loader: Off for the panel hostname if it causes client-side issues
```

- [ ] **Step 3: Document paths, update, backup, rollback, and external 3x-ui connection**

Document:

```text
/opt/pv-reseller/app
/opt/pv-reseller/data
/opt/pv-reseller/backup
/opt/pv-reseller/.env
```

Update is rerunning the same one-line command or executing `/opt/pv-reseller/app/update.sh`.

Explain that existing 3x-ui is connected **after** dashboard installation from `Settings and Panels`; the installer does not create a 3x-ui instance.

Document that backups are timestamped and that a failed container update automatically attempts image rollback while preserving SQLite data.

- [ ] **Step 4: Move old full-stack instructions under a clearly marked legacy section**

Link to:

```text
scripts/install-full-stack-legacy.sh
```

Include a warning that it provisions additional infrastructure and is not the recommended path for servers that already host services.

- [ ] **Step 5: Verify README no longer presents the legacy full-stack installer as default**

Run:

```bash
grep -n "bash <(curl -fsSL https://raw.githubusercontent.com/DashSaman/PVNetwork-Reseller-Dashboard/main/install.sh)" README.md
grep -n "does not install or modify 3x-ui\|3x-ui.*نصب نمی" README.md
```

Expected: the one-line installer and dashboard-only warning are present.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: document dashboard-only one-line install"
```

---

### Task 6: Release verification and final safety gate

**Files:**
- Verify all modified files; no new implementation files required.

**Interfaces:**
- Consumes: completed Tasks 1-5.
- Produces: evidence that the default installer is safe to publish on `main`.

- [ ] **Step 1: Run static safety suite**

```bash
bash scripts/test-dashboard-installer.sh
node scripts/test-inbound-refresh.mjs
bash -n install.sh
bash -n update.sh
```

Expected: all PASS.

- [ ] **Step 2: Verify forbidden provisioning is absent from the default installer**

```bash
! grep -Eqi 'ghcr\.io/mhsanaei/3x-ui|network_mode:[[:space:]]*host|caddy:2|x-ui setting|XRAY_VMESS|in-10000' install.sh
```

Expected exit code: 0.

- [ ] **Step 3: Verify the frontend production build**

```bash
bun install --frozen-lockfile
bun run lint
bun run build
```

Expected: exit 0.

- [ ] **Step 4: Verify Docker image build**

```bash
docker build -f docker/Dockerfile -t pv-reseller-dashboard:release-test .
```

Expected: image builds successfully.

- [ ] **Step 5: Run an isolated local container smoke test**

Use a temporary database directory and unused loopback port so no production container is touched:

```bash
TMP_DATA="$(mktemp -d)"
TEST_SECRET="$(openssl rand -hex 32)"
docker rm -f pv-reseller-release-test >/dev/null 2>&1 || true
docker run -d --name pv-reseller-release-test \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e HOSTNAME=0.0.0.0 \
  -e DATABASE_URL=file:/app/data/custom.db \
  -e APP_SECRET="$TEST_SECRET" \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD='ReleaseTest-Only-123!' \
  -v "$TMP_DATA:/app/data" \
  -p 127.0.0.1:31081:3000 \
  pv-reseller-dashboard:release-test
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:31081/api/auth/me | grep -q '"user"' && break
  sleep 1
done
curl -fsS http://127.0.0.1:31081/ >/dev/null
curl -fsS http://127.0.0.1:31081/api/auth/me | grep -q '"user"'
docker rm -f pv-reseller-release-test
rm -rf "$TMP_DATA"
```

Expected: all health checks pass; production services are untouched.

- [ ] **Step 6: Inspect git diff for accidental infrastructure changes or secrets**

```bash
git diff --check
git status --short
git diff -- install.sh update.sh src/components/panel/admin-view.tsx README.md scripts/
```

Expected: no generated credentials, tokens, certificates, IP-specific secrets, or unrelated service changes.

- [ ] **Step 7: Final commit if verification-only adjustments were needed**

```bash
git add -A
git commit -m "chore: finalize dashboard-only installer release"
```

Skip this commit if the working tree is already clean.

## Self-Review Results

- **Spec coverage:** Sections 1-18 of the approved design are covered by Tasks 1-6: deployment model/secrets/Docker/preflight in Tasks 1-2; Apache/TLS/Cloudflare in Task 3; inbound refresh in Task 4; legacy/README in Task 5; release validation in Task 6.
- **Placeholder scan:** No `TBD`, `TODO`, “implement later”, or unspecified error-handling steps remain.
- **Type consistency:** `PANEL_DOMAIN`, `APP_PORT`, `INSTALL_DIR`, `CONTAINER_NAME`, `IMAGE_NAME`, `NETWORK_NAME`, `loadInbounds`, and `selectTab(nextTab: Tab)` use consistent names throughout.
- **Review Focus coverage:** busy-port ownership and secret preservation are tested in Task 2; Cloudflare ACME and vhost isolation in Task 3; rollback in Task 2 and smoke-tested in Task 6; existing Apache vhost non-destructive behavior is constrained and verified in Task 3.
