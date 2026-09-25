# PVNetwork — Reseller Dashboard for 3x-ui

PVNetwork is a self-hosted reseller dashboard for one or more existing 3x-ui servers. It gives the system owner a central admin panel for resellers, traffic pools, inbound permissions, users, white-label domains, 2FA, activity logs, subscription links, QR codes and related operations.

> The default one-line installer is **dashboard-only**. It does not install 3x-ui, Xray, or Caddy, and it does not replace unrelated services already running on the server.

## Quick start

Run as `root` on Ubuntu or Debian:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/DashSaman/PVNetwork-Reseller-Dashboard/main/install.sh)
```

The installer asks for the panel hostname, for example:

```text
npanel.example.com
```

and optionally the admin username. It then:

- checks the target port and existing installation state before destructive changes;
- installs only missing host dependencies;
- reuses an existing working Docker installation, or installs Docker if it is absent;
- clones the application to `/opt/pv-reseller/app`;
- stores persistent SQLite data in `/opt/pv-reseller/data`;
- stores backups in `/opt/pv-reseller/backup`;
- creates one Docker container named `pv-reseller-dashboard`;
- publishes the app only on `127.0.0.1:31080`;
- reuses Apache when it already exists, or installs Apache when it is absent;
- adds a dedicated Apache vhost without disabling unrelated vhosts;
- obtains a Let's Encrypt certificate with Certbot webroot validation;
- redirects HTTP to HTTPS after keeping the ACME challenge path reachable;
- verifies local HTTP, origin HTTPS and API health before reporting completion.

No Docker Compose plugin is required.

## Requirements

- Ubuntu or Debian
- root access
- at least 4 GiB free disk space for the first image build
- a hostname such as `npanel.example.com`
- DNS for that hostname must reach this server, directly or through Cloudflare
- ports 80 and 443 must be available to Apache, or already be owned by the existing Apache service

The application itself is not published directly to the Internet. Docker binds only:

```text
127.0.0.1:31080 -> pv-reseller-dashboard:3000
```

Apache is the public HTTPS entry point.

## Architecture

```text
Browser / Cloudflare
        |
        v
   Apache :80/:443
        |
        v
 127.0.0.1:31080
        |
        v
 pv-reseller-dashboard
        |
        +---- API ----> existing external 3x-ui server(s)
        |
        +---- SQLite --> /opt/pv-reseller/data/custom.db
```

The dashboard does not manage the lifecycle of your 3x-ui/Xray servers. Add them from the dashboard after installation.

## Cloudflare

Cloudflare proxying is supported and no Cloudflare API token is required by the installer.

Recommended settings for the dashboard hostname after origin HTTPS is healthy:

- Proxy status: **Proxied** (orange cloud)
- SSL/TLS encryption mode: **Full (strict)**
- Always Use HTTPS: On
- Cache rule for the dashboard hostname: **Bypass cache**
- Rocket Loader: Off for this hostname if it interferes with dashboard JavaScript

If certificate issuance fails while the hostname is proxied, verify that HTTP requests to `/.well-known/acme-challenge/` can reach the origin. A Cloudflare configuration that redirects the ACME request into an unavailable strict-HTTPS origin can block HTTP-01 validation.

## First-login credentials

On first install the script generates a cryptographically random `APP_SECRET` and admin password.

They are stored in:

```text
/opt/pv-reseller/.env
```

with mode `0600`. The initial credential is also recorded in:

```text
/opt/pv-reseller/INITIAL_CREDENTIALS.txt
```

That file is historical only. If the admin password is later changed inside the dashboard, the current UI password is **not** written back into `INITIAL_CREDENTIALS.txt` or `.env`.

## Update

Re-run the same one-line installer:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/DashSaman/PVNetwork-Reseller-Dashboard/main/install.sh)
```

or, from an existing installation:

```bash
bash /opt/pv-reseller/app/update.sh
```

An update preserves:

- `/opt/pv-reseller/.env`
- `APP_SECRET`
- the initial installer password value
- the SQLite database
- the selected panel domain and app port

Before replacing the running dashboard, the installer backs up the database and installer configuration. It builds the candidate image while the current container is still running, then replaces only `pv-reseller-dashboard`. If the new container fails local health checks and a previous image exists, the installer restores the previous dashboard image.

It does not restart unrelated Docker containers, Xray, 3x-ui, databases, or VPN services.

## Backup and rollback

Backups are created under:

```text
/opt/pv-reseller/backup/YYYYMMDD-HHMMSS/
```

They can contain:

- `custom.db`
- `.env`
- `.installer-env`
- the dashboard Apache vhost files

To restore a database manually, stop only the dashboard container, replace `/opt/pv-reseller/data/custom.db` with the desired backup, and start/recreate the dashboard container with the same `.env` and loopback binding.

## Connect an external 3x-ui server

After logging in to the dashboard:

1. Open **Settings / Panels**.
2. Choose **Add panel**.
3. Enter a display name for the server.
4. Enter the complete existing 3x-ui web address, including its base path when one is configured.
5. Enter either the 3x-ui API token or its administrator username/password.
6. Optionally set the subscription base URL and subscription path.
7. Run **Test connection**.
8. Save the panel.
9. Open **Resellers** and create/edit a reseller. The inbound list is refreshed when the Resellers tab is opened, so newly connected panel inbounds are available without requiring a manual dashboard refresh.

Multiple external 3x-ui servers can be added. The API endpoint `/api/admin/inbounds` aggregates their inbounds and the reseller dialog groups them by panel.

## Main features

- multiple 3x-ui panels
- inbound permissions per reseller
- reseller traffic pools
- multi-location user creation
- white-label brand and domain settings
- end-user subscription portal and QR codes
- bulk user creation
- traffic and expiry visibility
- CSV export
- reseller Telegram notifications
- admin and reseller TOTP 2FA
- login rate limiting
- activity logs

## Install layout

```text
/opt/pv-reseller/
├── app/                    # Git checkout
├── data/
│   └── custom.db           # persistent SQLite database
├── backup/                 # timestamped update backups
├── .env                    # APP_SECRET/admin bootstrap values (0600)
├── .installer-env          # non-secret installer metadata
└── INITIAL_CREDENTIALS.txt # first-install record (0600)
```

Docker resources created by the default installer:

```text
container: pv-reseller-dashboard
network:   pv_reseller_net
image:     pv-reseller-dashboard:local
bind:      127.0.0.1:31080:3000
```

## Non-interactive install

For automation, provide values as environment variables:

```bash
PANEL_DOMAIN=npanel.example.com \
ADMIN_USERNAME=admin \
APP_PORT=31080 \
bash <(curl -fsSL https://raw.githubusercontent.com/DashSaman/PVNetwork-Reseller-Dashboard/main/install.sh)
```

Supported installer overrides:

| Variable | Default | Meaning |
|---|---:|---|
| `PANEL_DOMAIN` | prompted | public dashboard hostname |
| `ADMIN_USERNAME` | `admin` | initial admin username on first install |
| `APP_PORT` | `31080` | loopback-only Docker host port |
| `INSTALL_DIR` | `/opt/pv-reseller` | installation root |

## Application environment

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `file:/app/data/custom.db` | SQLite database inside the container |
| `APP_SECRET` | generated | session/secret encryption key |
| `ADMIN_USERNAME` | `admin` | bootstrap admin username |
| `ADMIN_PASSWORD` | generated | bootstrap password used only when the first admin row is created |
| `PORT` | `3000` | internal Next.js port |

## Troubleshooting

### Dashboard is healthy locally but public URL fails

Check:

```bash
curl -I http://127.0.0.1:31080/
apache2ctl configtest
curl -I https://your-panel-hostname.example/
```

Also verify DNS and Cloudflare SSL mode.

### Panel connection succeeds but inbounds are not shown for resellers

Open the **Resellers** tab again. Current versions refresh `/api/admin/inbounds` whenever that tab is entered. If the list is still empty, test the saved 3x-ui panel from **Settings / Panels** and check the dashboard container logs.

### Existing port conflict

The installer refuses to kill the owner of `APP_PORT`. Choose another loopback port instead:

```bash
APP_PORT=31081 bash <(curl -fsSL https://raw.githubusercontent.com/DashSaman/PVNetwork-Reseller-Dashboard/main/install.sh)
```

### Logs

```bash
docker logs -f pv-reseller-dashboard
```

## Legacy full-stack installer

The old installer that provisioned Caddy, a local 3x-ui/Xray instance and related resources is preserved only for historical/manual use at:

```text
scripts/install-full-stack-legacy.sh
```

It is **not** the recommended installer for a server that already has infrastructure and is not used by the one-line command above.

## Development

The production image is built from `docker/Dockerfile` using Bun for dependency/build stages and Node.js for the standalone runtime. Prisma uses SQLite for dashboard state.

Useful checks before release:

```bash
bash scripts/test-dashboard-installer.sh
node scripts/test-inbound-refresh.mjs
bash -n install.sh
bash -n update.sh
```
