#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/install.sh"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }
if grep -Eqi 'ghcr\.io/mhsanaei/3x-ui|network_mode:[[:space:]]*host|caddy:2|x-ui setting|in-10000|XRAY_VMESS' "$INSTALLER"; then
  fail "default install.sh still contains full-stack provisioning"
fi
PVNET_INSTALLER_LIB_ONLY=1 source "$INSTALLER"
declare -a good_domains=("npanel.softarg.ir" "panel.example.com" "a-b.example.co.uk")
for d in "${good_domains[@]}"; do validate_domain "$d" || fail "valid domain rejected: $d"; done
declare -a bad_domains=("" "http://panel.example.com" "panel_example.com" "-bad.example.com" "bad..example.com")
for d in "${bad_domains[@]}"; do if validate_domain "$d"; then fail "invalid domain accepted: $d"; fi; done
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
render_http_vhost "npanel.softarg.ir" "/var/www/letsencrypt" "$TMP/http.conf"
grep -F 'ServerName npanel.softarg.ir' "$TMP/http.conf" >/dev/null || fail "HTTP vhost missing ServerName"
grep -F 'Alias /.well-known/acme-challenge/' "$TMP/http.conf" >/dev/null || fail "HTTP vhost missing ACME alias"
render_https_vhost "npanel.softarg.ir" "31080" "$TMP/https.conf"
grep -F 'ProxyPass        / http://127.0.0.1:31080/' "$TMP/https.conf" >/dev/null || fail "HTTPS vhost is not loopback proxied"
grep -F 'RequestHeader set X-Forwarded-Proto "https"' "$TMP/https.conf" >/dev/null || fail "HTTPS vhost missing forwarded proto"
TEST_INSTALL_DIR="$TMP/install"; INSTALL_DIR="$TEST_INSTALL_DIR"; mkdir -p "$INSTALL_DIR"
load_or_create_secrets
FIRST_SECRET="$APP_SECRET"; FIRST_PASSWORD="$ADMIN_PASSWORD"
load_or_create_secrets
[[ "$APP_SECRET" == "$FIRST_SECRET" ]] || fail "APP_SECRET rotated on rerun"
[[ "$ADMIN_PASSWORD" == "$FIRST_PASSWORD" ]] || fail "ADMIN_PASSWORD rotated on rerun"
[[ "$(stat -c '%a' "$INSTALL_DIR/.env")" == "600" ]] || fail ".env permissions are not 600"
pass "dashboard-only installer regression checks"

PANEL_DOMAIN="npanel.softarg.ir"
write_installer_metadata
[[ -f "$INSTALL_DIR/.installer-env" ]] || fail "installer metadata not written"
grep -F 'PANEL_DOMAIN=npanel.softarg.ir' "$INSTALL_DIR/.installer-env" >/dev/null || fail "domain missing from installer metadata"
grep -F "APP_PORT=$APP_PORT" "$INSTALL_DIR/.installer-env" >/dev/null || fail "app port missing from installer metadata"
if grep -Eq 'APP_SECRET|ADMIN_PASSWORD' "$INSTALL_DIR/.installer-env"; then
  fail "installer metadata leaked secrets"
fi

if grep -Eqi 'systemctl[[:space:]]+restart|ufw|iptables|(^|[[:space:]])nft([[:space:]]|$)' "$INSTALLER"; then
  fail "installer contains broad service/firewall restart logic"
fi
if grep -Eqi 'ghcr\.io/mhsanaei/3x-ui|network_mode:[[:space:]]*host|caddy:2|x-ui setting|in-10000|XRAY_VMESS' "$INSTALLER"; then
  fail "default installer contains 3x-ui/Xray/Caddy provisioning"
fi
grep -F '127.0.0.1:${APP_PORT}:3000' "$INSTALLER" >/dev/null || fail "loopback Docker publish invariant missing"

for fn in preflight backup_existing_install sync_repository build_dashboard_image run_dashboard_container local_health_check rollback_dashboard; do
  declare -F "$fn" >/dev/null || fail "missing lifecycle function: $fn"
done
pass "safe lifecycle surface checks"

for fn in site_file_is_adoptable install_http_vhost issue_certificate install_https_vhost origin_https_health_check configure_apache_tls; do
  declare -F "$fn" >/dev/null || fail "missing Apache/TLS function: $fn"
done

grep -F 'RewriteRule ^ https://npanel.softarg.ir%{REQUEST_URI} [R=301,L]' "$TMP/http.conf" >/dev/null || fail "HTTP vhost missing HTTPS redirect"
if grep -F 'ProxyPass        / http://' "$TMP/http.conf" >/dev/null; then fail "HTTP vhost should not proxy application traffic"; fi

grep -F 'SSLCertificateFile /etc/letsencrypt/live/npanel.softarg.ir/fullchain.pem' "$TMP/https.conf" >/dev/null || fail "HTTPS vhost missing Lets Encrypt certificate"
grep -F 'SSLCertificateKeyFile /etc/letsencrypt/live/npanel.softarg.ir/privkey.pem' "$TMP/https.conf" >/dev/null || fail "HTTPS vhost missing Lets Encrypt key"

cat > "$TMP/adoptable.conf" <<'VHOST'
<VirtualHost *:80>
ServerName npanel.softarg.ir
Alias /.well-known/acme-challenge/ /var/www/letsencrypt/.well-known/acme-challenge/
RewriteRule ^ https://npanel.softarg.ir%{REQUEST_URI} [R=301,L]
</VirtualHost>
VHOST
site_file_is_adoptable "$TMP/adoptable.conf" "npanel.softarg.ir" || fail "existing compatible vhost was not adoptable"
cat > "$TMP/unrelated.conf" <<'VHOST'
<VirtualHost *:80>
ServerName other.example.com
DocumentRoot /var/www/other
</VirtualHost>
VHOST
if site_file_is_adoptable "$TMP/unrelated.conf" "npanel.softarg.ir"; then fail "unrelated vhost considered adoptable"; fi
cat > "$TMP/same-domain-unrelated-ssl.conf" <<'VHOST'
<VirtualHost *:443>
ServerName npanel.softarg.ir
SSLCertificateFile /etc/letsencrypt/live/npanel.softarg.ir/fullchain.pem
DocumentRoot /var/www/unrelated-app
</VirtualHost>
VHOST
if site_file_is_adoptable "$TMP/same-domain-unrelated-ssl.conf" "npanel.softarg.ir"; then fail "same-domain unrelated SSL vhost considered adoptable"; fi
pass "Apache/TLS additive safety checks"

UPDATE_SCRIPT="$ROOT/update.sh"
if grep -Eqi 'docker[[:space:]]+compose|/opt/pvnet|pvnet-panel' "$UPDATE_SCRIPT"; then
  fail "update.sh still uses legacy full-stack paths/Compose"
fi
grep -F 'raw.githubusercontent.com/DashSaman/PVNetwork-Reseller-Dashboard/main/install.sh' "$UPDATE_SCRIPT" >/dev/null || fail "update.sh does not delegate to latest one-line installer"
grep -F 'INSTALL_DIR="${INSTALL_DIR:-/opt/pv-reseller}"' "$UPDATE_SCRIPT" >/dev/null || fail "update.sh missing dashboard install dir"
pass "update wrapper safety checks"

HIST="$TMP/historical-install"
mkdir -p "$HIST"
cat > "$HIST/.env" <<'ENV'
APP_SECRET=existing-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=historical-bootstrap-password
ENV
chmod 600 "$HIST/.env"
OLD_INSTALL_DIR="$INSTALL_DIR"
INSTALL_DIR="$HIST"
unset SECRETS_CREATED INITIAL_CREDENTIALS_CREATED || true
load_or_create_secrets
write_initial_credentials_if_needed
[[ ! -e "$HIST/INITIAL_CREDENTIALS.txt" ]] || fail "rerun recreated historical credentials file from existing .env"
INSTALL_DIR="$OLD_INSTALL_DIR"
pass "rerun does not expose historical bootstrap password"

grep -F 'Header always set Cache-Control "no-store, no-cache, must-revalidate"' "$TMP/https.conf" >/dev/null || fail "HTTPS vhost does not disable edge/browser caching"
pass "HTTPS vhost prevents stale dashboard caching"

declare -F validate_admin_username >/dev/null || fail "missing validate_admin_username"
for u in admin pv_admin admin.user user-01; do validate_admin_username "$u" || fail "valid admin username rejected: $u"; done
for u in '' 'ab' 'bad user' 'bad@user'; do if validate_admin_username "$u"; then fail "invalid admin username accepted: $u"; fi; done

grep -F '/etc/letsencrypt/renewal-hooks/deploy/pv-reseller-apache-reload.sh' "$INSTALLER" >/dev/null || fail "Certbot deploy hook path missing"
grep -F 'install_certbot_deploy_hook' "$INSTALLER" >/dev/null || fail "Certbot deploy hook function missing"
pass "admin validation and certificate renewal hook checks"
