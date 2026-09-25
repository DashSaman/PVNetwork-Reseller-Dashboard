# PVNetwork Reseller Dashboard — Dashboard-Only One-Line Installer Design

Date: 2026-09-25
Status: Approved design, pending implementation plan

## 1. Goal

Replace the current full-stack installer with a safe, production-oriented installer that installs **only the PVNetwork Reseller Dashboard**.

The default installer must **not** create, install, reconfigure, restart, or replace:

- 3x-ui
- Xray
- Caddy
- any existing VPN service
- any existing database service
- any unrelated Docker container

The intended operator experience is a one-line install:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/DashSaman/PVNetwork-Reseller-Dashboard/main/install.sh)
```

The script then asks only for the values that cannot be inferred safely, especially the panel domain and admin username.

## 2. Deployment model

The installer deploys one application container only:

```text
Internet / Cloudflare
        |
        v
Apache :80/:443
        |
        v
127.0.0.1:31080
        |
        v
pv-reseller-dashboard:3000
```

Persistent application state lives outside the container:

```text
/opt/pv-reseller/
├── app/       # git checkout
├── data/      # SQLite database
├── backup/    # database/config backups
└── .env       # application secrets, mode 0600
```

The Dashboard container uses a dedicated Docker bridge network and must never use host networking.

## 3. Inputs

Interactive defaults:

- `PANEL_DOMAIN` — required, e.g. `npanel.example.com`
- `ADMIN_USERNAME` — optional, defaults to `admin`

Optional environment overrides may be supported for unattended deployment:

- `PANEL_DOMAIN`
- `ADMIN_USERNAME`
- `APP_PORT` — defaults to `31080`
- `INSTALL_DIR` — defaults to `/opt/pv-reseller`

The installer must not require a Cloudflare API token.

## 4. Secrets

On first install the installer generates:

- `APP_SECRET` using cryptographically secure random bytes
- `ADMIN_PASSWORD` using a strong random value

These are written to `/opt/pv-reseller/.env` with mode `0600`.

On re-run or update:

- existing `APP_SECRET` must be preserved
- existing `ADMIN_PASSWORD` must be preserved
- existing database must be preserved

The installer must never silently rotate authentication secrets on update.

## 5. Docker behavior

### Existing Docker

If Docker is already installed and working, use it as-is.

Do not restart the Docker daemon.

### Missing Docker

If Docker is absent, install Docker using the supported Docker installation flow for the host OS.

### No Docker Compose dependency

The default installer must not depend on `docker compose`.

Use plain `docker build`, `docker network create`, and `docker run` commands so the installer also works on hosts where the Compose plugin is not installed.

### Container runtime

The container must:

- be named `pv-reseller-dashboard`
- expose only `127.0.0.1:${APP_PORT}:3000`
- use `restart=unless-stopped`
- mount `${INSTALL_DIR}/data:/app/data`
- read secrets from `${INSTALL_DIR}/.env`
- use `DATABASE_URL=file:/app/data/custom.db`
- run on a dedicated bridge network

It must not expose public Docker ports directly.

## 6. Preflight safety checks

Before changing the host, the installer must validate:

- running as root
- supported Debian/Ubuntu family host
- required commands or ability to install them
- enough free disk space
- target port is not already occupied
- target install directory is either absent or recognized as an existing PVNetwork installation
- Apache configuration can be used safely
- domain syntax is valid

If a conflict is detected, stop with a clear error before destructive changes.

The installer must not stop or restart unrelated services to resolve conflicts automatically.

## 7. Apache integration

Apache is the default reverse proxy for this installer.

### Existing Apache

If Apache exists:

- back up relevant Apache configuration before editing
- enable only required modules: `proxy`, `proxy_http`, `headers`, `ssl`, `rewrite`
- create dedicated vhosts for the requested panel domain
- run `apache2ctl configtest` before activation
- use `systemctl reload apache2`, not restart

### Missing Apache

If Apache is not installed, install it and then configure it.

### HTTP vhost

Port 80 must:

- serve `/.well-known/acme-challenge/` from a local webroot
- redirect all other requests to HTTPS after certificate issuance

### HTTPS vhost

Port 443 must:

- use the issued Let's Encrypt certificate
- reverse proxy to `http://127.0.0.1:${APP_PORT}`
- preserve the original Host header
- send `X-Forwarded-Proto: https`
- send `X-Forwarded-Port: 443`

No existing vhost may be replaced or removed.

## 8. TLS / Certbot

The installer uses Let's Encrypt through Certbot webroot validation.

It must:

1. create the ACME challenge webroot
2. verify the challenge path is reachable
3. request a certificate for `PANEL_DOMAIN`
4. configure the HTTPS vhost only after successful certificate issuance
5. leave Certbot's normal automatic renewal enabled

The flow must work when the DNS record is proxied through Cloudflare, provided Cloudflare forwards HTTP correctly.

## 9. Cloudflare behavior

The installer must not require account-level Cloudflare access.

When Cloudflare is detected from response headers or DNS behavior, the installer should print post-install guidance:

- Proxy status: Proxied / orange cloud
- SSL/TLS mode: Full (strict)
- Always Use HTTPS: enabled after origin HTTPS is working
- Cache Rule for panel hostname: Bypass cache
- Rocket Loader: disabled for the panel hostname if it causes client-side issues

The installer must not claim that Cloudflare fully hides the origin IP when other DNS/services can still reveal it.

## 10. Build and deployment flow

First install:

1. preflight checks
2. create install directories
3. clone repository into `/opt/pv-reseller/app`
4. create/preserve `.env`
5. build `pv-reseller-dashboard:local`
6. create dedicated Docker network if absent
7. start dashboard container bound to loopback only
8. verify local `HTTP 200`
9. configure Apache HTTP vhost
10. issue Let's Encrypt certificate
11. configure HTTPS vhost and HTTP redirect
12. verify public HTTPS and API health
13. print credentials and final paths

## 11. Idempotent update behavior

Re-running `install.sh` on an existing installation acts as a safe update.

Before update:

- back up SQLite database
- back up `.env`
- back up generated Apache vhost files

Then:

1. fetch/pull current `main`
2. build a new image
3. stop/remove only `pv-reseller-dashboard`
4. recreate only that container using the preserved data and secrets
5. run local health check
6. verify Apache config remains valid

If the new container fails health checks, the script should stop and preserve enough state to allow rollback.

Unrelated containers and services must remain untouched.

## 12. Health checks

Installation is successful only if all applicable checks pass:

- `pv-reseller-dashboard` container is running
- `http://127.0.0.1:${APP_PORT}/` returns HTTP 200
- `/api/auth/me` returns valid JSON
- Apache `configtest` passes
- origin HTTPS returns HTTP 200
- public panel URL returns HTTP 200 when DNS is already active

The installer should display clear warnings instead of reporting success if public DNS has not propagated yet.

## 13. Inbound refresh bug fix

Current behavior loads admin inbounds when `AdminView` first mounts. If a 3x-ui panel is configured afterward in the Settings tab, the Resellers tab may still receive the old empty inbounds array until a manual refresh is triggered.

Required behavior:

- entering the `resellers` tab triggers `loadInbounds()`
- the reseller creation dialog therefore receives the latest inbounds from `/api/admin/inbounds`
- no manual dashboard refresh is required

This change is limited to refreshing state; the backend `/api/admin/inbounds` behavior remains unchanged.

## 14. Legacy full-stack installer

The existing installer contains behavior for creating Caddy, 3x-ui, host networking, and default Xray/VLESS resources.

That behavior must not remain the default `install.sh`.

To avoid deleting history/functionality outright, preserve the old script under a clearly named legacy path such as:

```text
scripts/install-full-stack-legacy.sh
```

The README must clearly state that this legacy script is not the recommended installer for hosts that already have infrastructure.

## 15. README changes

README must document:

- one-line dashboard-only install
- required DNS prerequisites
- first-run prompts
- install paths
- update by rerunning the same one-line command
- backup location
- rollback notes
- Cloudflare recommended settings
- how to connect an external existing 3x-ui panel after installation
- explicit statement that the default installer does not install 3x-ui, Xray, or Caddy

## 16. Validation before release

Before changes are considered complete:

- `bash -n install.sh` passes
- installer contains no `network_mode: host`
- installer contains no 3x-ui image or Xray provisioning commands
- installer contains no Caddy provisioning
- frontend build passes
- inbound refresh behavior is verified
- Docker image builds successfully
- generated Apache configuration passes syntax validation in a test environment or through deterministic config checks
- re-run/update path preserves `.env` and database

## 17. Non-goals

This change does not:

- install or manage external 3x-ui servers
- create Xray inbounds
- configure VPN routing
- configure Cloudflare through its API
- migrate existing external 3x-ui data
- replace Apache with another reverse proxy

## 18. Success criteria

The design is complete when a user on a clean or already-used Ubuntu/Debian server can run one command, enter the desired panel domain, and receive a working HTTPS PVNetwork Reseller Dashboard without affecting unrelated services or installing 3x-ui/Xray/Caddy.
