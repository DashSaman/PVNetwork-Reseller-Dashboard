#!/usr/bin/env bash
set -euo pipefail

PVNET_INSTALL_DIR_FROM_ENV="${INSTALL_DIR+x}"
PVNET_APP_PORT_FROM_ENV="${APP_PORT+x}"
PVNET_PANEL_DOMAIN_FROM_ENV="${PANEL_DOMAIN+x}"

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
APACHE_SITE_BASENAME="pv-reseller"

log() { printf '\033[1;36m[PVNetwork]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

validate_domain() {
  local d="${1:-}"
  [[ "$d" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]]
}

validate_admin_username() {
  local u="${1:-}"
  [[ "$u" =~ ^[A-Za-z0-9._-]{3,32}$ ]]
}

read_env_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 1
  awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/, ""); print; exit}' "$file"
}

load_or_create_secrets() {
  mkdir -p "$INSTALL_DIR"
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    APP_SECRET="$(read_env_value "$INSTALL_DIR/.env" APP_SECRET || true)"
    ADMIN_USERNAME="$(read_env_value "$INSTALL_DIR/.env" ADMIN_USERNAME || true)"
    ADMIN_PASSWORD="$(read_env_value "$INSTALL_DIR/.env" ADMIN_PASSWORD || true)"
    [[ -n "$APP_SECRET" ]] || die "Existing .env is missing APP_SECRET"
    [[ -n "$ADMIN_USERNAME" ]] || ADMIN_USERNAME="admin"
    [[ -n "$ADMIN_PASSWORD" ]] || die "Existing .env is missing ADMIN_PASSWORD"
    chmod 600 "$INSTALL_DIR/.env"
    export APP_SECRET ADMIN_USERNAME ADMIN_PASSWORD
    return 0
  fi

  command -v openssl >/dev/null 2>&1 || die "openssl is required before generating secrets"
  APP_SECRET="$(openssl rand -hex 32)"
  ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
  ADMIN_PASSWORD="PV$(openssl rand -hex 12)A9!"
  SECRETS_CREATED=1
  export SECRETS_CREATED
  umask 077
  cat > "$INSTALL_DIR/.env" <<ENV
APP_SECRET=$APP_SECRET
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD
ENV
  chmod 600 "$INSTALL_DIR/.env"
  export APP_SECRET ADMIN_USERNAME ADMIN_PASSWORD
}

render_http_vhost() {
  local domain="$1" webroot="$2" output="$3"
  cat > "$output" <<EOFV
# Managed by PVNetwork Reseller Dashboard installer
<VirtualHost *:80>
    ServerName $domain

    Alias /.well-known/acme-challenge/ $webroot/.well-known/acme-challenge/
    <Directory "$webroot/.well-known/acme-challenge/">
        Options None
        AllowOverride None
        Require all granted
    </Directory>

    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/
    RewriteRule ^ https://$domain%{REQUEST_URI} [R=301,L]

    ErrorLog \${APACHE_LOG_DIR}/${APACHE_SITE_BASENAME}-$domain-error.log
    CustomLog \${APACHE_LOG_DIR}/${APACHE_SITE_BASENAME}-$domain-access.log combined
</VirtualHost>
EOFV
}

render_https_vhost() {
  local domain="$1" port="$2" output="$3"
  cat > "$output" <<EOFV
# Managed by PVNetwork Reseller Dashboard installer
<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName $domain

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/$domain/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/$domain/privkey.pem

    ProxyRequests Off
    ProxyPreserveHost On
    ProxyAddHeaders On
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"
    Header always set Cache-Control "no-store, no-cache, must-revalidate"

    ProxyPass        / http://127.0.0.1:$port/ retry=0 timeout=60
    ProxyPassReverse / http://127.0.0.1:$port/

    ErrorLog \${APACHE_LOG_DIR}/${APACHE_SITE_BASENAME}-$domain-ssl-error.log
    CustomLog \${APACHE_LOG_DIR}/${APACHE_SITE_BASENAME}-$domain-ssl-access.log combined
</VirtualHost>
</IfModule>
EOFV
}

load_installer_metadata() {
  local f="$INSTALL_DIR/.installer-env" v
  [[ -f "$f" ]] || return 0
  if [[ -z "$PVNET_PANEL_DOMAIN_FROM_ENV" ]]; then
    v="$(read_env_value "$f" PANEL_DOMAIN || true)"
    [[ -n "$v" ]] && PANEL_DOMAIN="$v"
  fi
  if [[ -z "$PVNET_APP_PORT_FROM_ENV" ]]; then
    v="$(read_env_value "$f" APP_PORT || true)"
    [[ -n "$v" ]] && APP_PORT="$v"
  fi
}

write_installer_metadata() {
  mkdir -p "$INSTALL_DIR"
  umask 077
  cat > "$INSTALL_DIR/.installer-env" <<META
PANEL_DOMAIN=$PANEL_DOMAIN
APP_PORT=$APP_PORT
INSTALL_DIR=$INSTALL_DIR
META
  chmod 600 "$INSTALL_DIR/.installer-env"
}

prompt_value() {
  local var="$1" prompt="$2" default="${3:-}" val=""
  [[ -n "${!var:-}" ]] && return 0
  if [[ -r /dev/tty ]]; then
    read -r -p "$prompt${default:+ [$default]}: " val </dev/tty || true
  fi
  printf -v "$var" '%s' "${val:-$default}"
}

resolve_inputs() {
  PANEL_DOMAIN="${PANEL_DOMAIN:-}"
  APP_PORT="${APP_PORT:-31080}"
  load_installer_metadata
  prompt_value PANEL_DOMAIN "Panel domain (e.g. npanel.example.com)" ""
  if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    prompt_value ADMIN_USERNAME "Admin username" "admin"
  fi
}

port_is_listening() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -lntH 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {found=1} END{exit !found}'
  elif command -v netstat >/dev/null 2>&1; then
    netstat -lnt 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {found=1} END{exit !found}'
  else
    local hex
    hex="$(printf '%04X' "$port")"
    awk -v p=":$hex" '$2 ~ p"$" && $4 == "0A" {found=1} END{exit !found}' /proc/net/tcp /proc/net/tcp6 2>/dev/null
  fi
}

recognized_container_owns_port() {
  command -v docker >/dev/null 2>&1 || return 1
  docker inspect "$CONTAINER_NAME" >/dev/null 2>&1 || return 1
  local binding
  binding="$(docker inspect --format '{{with (index .HostConfig.PortBindings "3000/tcp")}}{{(index . 0).HostIp}}:{{(index . 0).HostPort}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  [[ "$binding" == "127.0.0.1:$APP_PORT" ]]
}

port_is_available_for_install() {
  local rc
  if port_is_listening "$APP_PORT"; then
    recognized_container_owns_port
    return $?
  else
    rc=$?
    [[ $rc -eq 1 ]] && return 0
    [[ $rc -eq 2 ]] && die "Neither ss nor netstat is available for port preflight"
    return 1
  fi
}

free_bytes_for_path() {
  local probe="$1"
  while [[ ! -e "$probe" && "$probe" != "/" ]]; do probe="$(dirname "$probe")"; done
  df -PB1 "$probe" | awk 'NR==2 {print $4}'
}

preflight() {
  [[ "$(id -u)" -eq 0 ]] || die "Run as root"
  [[ -r /etc/os-release ]] || die "Cannot identify OS"
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in ubuntu|debian) ;; *) die "Only Ubuntu/Debian are supported" ;; esac
  PANEL_DOMAIN="${PANEL_DOMAIN,,}"
  validate_domain "$PANEL_DOMAIN" || die "Invalid PANEL_DOMAIN: $PANEL_DOMAIN"
  if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    validate_admin_username "${ADMIN_USERNAME:-admin}" || die "Invalid ADMIN_USERNAME (3-32 chars: letters, numbers, dot, underscore, hyphen)"
  fi
  [[ "$APP_PORT" =~ ^[0-9]+$ ]] && (( APP_PORT >= 1024 && APP_PORT <= 65535 )) || die "Invalid APP_PORT: $APP_PORT"
  [[ "$INSTALL_DIR" == /* ]] || die "INSTALL_DIR must be an absolute path"

  if [[ -e "$INSTALL_DIR" && ! -d "$REPO_DIR/.git" && ! -f "$INSTALL_DIR/.env" && ! -f "$INSTALL_DIR/.installer-env" ]]; then
    die "$INSTALL_DIR exists but is not recognized as a PVNetwork dashboard installation"
  fi

  local free
  free="$(free_bytes_for_path "$INSTALL_DIR")"
  if [[ ! -d "$REPO_DIR/.git" ]] && (( free < 4294967296 )); then
    die "At least 4 GiB free disk space is required for the first build"
  fi

  port_is_available_for_install || die "127.0.0.1:$APP_PORT is already owned by another process"

  if ! command -v apache2ctl >/dev/null 2>&1; then
    if port_is_listening 80 || port_is_listening 443; then
      die "Apache is not installed, but port 80 or 443 is already in use"
    fi
  fi
}

prepare_dependencies() {
  local pkgs=() cmd pkg
  while IFS=: read -r cmd pkg; do
    command -v "$cmd" >/dev/null 2>&1 || pkgs+=("$pkg")
  done <<'PKGS'
git:git
curl:curl
openssl:openssl
apache2ctl:apache2
certbot:certbot
sqlite3:sqlite3
PKGS
  [[ -s /etc/ssl/certs/ca-certificates.crt ]] || pkgs+=(ca-certificates)
  if ((${#pkgs[@]})); then
    log "Installing missing host packages: ${pkgs[*]}"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${pkgs[@]}"
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log "Installing Docker"
    curl -fsSL https://get.docker.com | sh
  fi
  docker info >/dev/null 2>&1 || die "Docker is installed but not operational"
  a2enmod proxy proxy_http headers ssl rewrite >/dev/null
}

backup_existing_install() {
  [[ -e "$INSTALL_DIR" ]] || return 0
  local stamp dest f
  stamp="$(date +%Y%m%d-%H%M%S)"
  dest="$BACKUP_DIR/$stamp"
  mkdir -p "$dest"
  chmod 700 "$BACKUP_DIR" "$dest"
  [[ -f "$INSTALL_DIR/.env" ]] && cp -a "$INSTALL_DIR/.env" "$dest/.env"
  [[ -f "$INSTALL_DIR/.installer-env" ]] && cp -a "$INSTALL_DIR/.installer-env" "$dest/.installer-env"
  if [[ -f "$DATA_DIR/custom.db" ]]; then
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$DATA_DIR/custom.db" ".backup '$dest/custom.db'"
    else
      cp -a "$DATA_DIR/custom.db" "$dest/custom.db"
    fi
  fi
  if [[ -n "${PANEL_DOMAIN:-}" ]]; then
    for f in "/etc/apache2/sites-available/$PANEL_DOMAIN.conf" "/etc/apache2/sites-available/$PANEL_DOMAIN-ssl.conf"; do
      [[ -f "$f" ]] && cp -a "$f" "$dest/$(basename "$f")"
    done
  fi
  LAST_BACKUP_DIR="$dest"
  export LAST_BACKUP_DIR
}

sync_repository() {
  mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$BACKUP_DIR"
  chmod 700 "$DATA_DIR" "$BACKUP_DIR"
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    log "Cloning dashboard repository"
    git clone --depth 1 "$REPO_URL" "$REPO_DIR"
    return 0
  fi
  if [[ -n "$(git -C "$REPO_DIR" status --porcelain)" ]]; then
    die "Repository has local changes; refusing to overwrite $REPO_DIR"
  fi
  log "Updating dashboard source"
  git -C "$REPO_DIR" fetch --depth 1 origin main
  git -C "$REPO_DIR" merge --ff-only FETCH_HEAD
}

current_container_image_id() {
  docker inspect --format '{{.Image}}' "$CONTAINER_NAME" 2>/dev/null || true
}

build_dashboard_image() {
  BUILD_STAMP="$(date +%Y%m%d%H%M%S)"
  CANDIDATE_IMAGE="pv-reseller-dashboard:candidate-$BUILD_STAMP"
  OLD_IMAGE_ID="$(current_container_image_id)"
  ROLLBACK_IMAGE=""
  if [[ -n "$OLD_IMAGE_ID" ]]; then
    ROLLBACK_IMAGE="pv-reseller-dashboard:rollback-$BUILD_STAMP"
    docker tag "$OLD_IMAGE_ID" "$ROLLBACK_IMAGE"
  fi
  export BUILD_STAMP CANDIDATE_IMAGE OLD_IMAGE_ID ROLLBACK_IMAGE
  log "Building dashboard image"
  docker build -f "$REPO_DIR/docker/Dockerfile" -t "$CANDIDATE_IMAGE" "$REPO_DIR"
}

ensure_network() {
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 || docker network create "$NETWORK_NAME" >/dev/null
}

remove_dashboard_container_if_present() {
  if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    docker stop -t 20 "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}

run_dashboard_container() {
  local image="$1"
  ensure_network
  remove_dashboard_container_if_present
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
    "$image" >/dev/null
}

local_health_check() {
  local tries="${1:-30}" i body
  for ((i=1; i<=tries; i++)); do
    if curl -fsS --max-time 4 "http://127.0.0.1:$APP_PORT/" >/dev/null 2>&1; then
      body="$(curl -fsS --max-time 4 "http://127.0.0.1:$APP_PORT/api/auth/me" 2>/dev/null || true)"
      [[ "$body" == *'"user"'* ]] && return 0
    fi
    sleep 1
  done
  return 1
}

rollback_dashboard() {
  [[ -n "${ROLLBACK_IMAGE:-}" ]] || return 1
  warn "New dashboard failed health checks; restoring previous image"
  run_dashboard_container "$ROLLBACK_IMAGE"
  local_health_check 30 || die "Rollback container also failed health checks"
  return 0
}

deploy_dashboard() {
  build_dashboard_image
  if ! run_dashboard_container "$CANDIDATE_IMAGE"; then
    rollback_dashboard || die "Failed to start dashboard container"
    die "New image could not be started; previous version restored"
  fi
  if ! local_health_check 45; then
    docker logs --tail 80 "$CONTAINER_NAME" >&2 || true
    rollback_dashboard || die "New dashboard failed health check and no rollback image was available"
    die "New dashboard failed health check; previous version restored"
  fi
  docker tag "$CANDIDATE_IMAGE" "$IMAGE_NAME"
  log "Dashboard passed local health checks"
}

write_initial_credentials_if_needed() {
  local f="$INSTALL_DIR/INITIAL_CREDENTIALS.txt"
  [[ "${SECRETS_CREATED:-0}" == "1" ]] || return 0
  [[ -f "$f" ]] && return 0
  umask 077
  cat > "$f" <<CREDS
PVNetwork Reseller Dashboard - initial credentials
Panel domain: $PANEL_DOMAIN
Username: $ADMIN_USERNAME
Initial password: $ADMIN_PASSWORD

IMPORTANT: this file records the initial credential only. If the password is
changed later inside the Dashboard, the current password is NOT written back here.
CREDS
  chmod 600 "$f"
  INITIAL_CREDENTIALS_CREATED=1
}

http_site_path() { printf '/etc/apache2/sites-available/%s.conf' "$PANEL_DOMAIN"; }
https_site_path() { printf '/etc/apache2/sites-available/%s-ssl.conf' "$PANEL_DOMAIN"; }

site_file_is_adoptable() {
  local file="$1" domain="$2"
  [[ ! -e "$file" ]] && return 0
  grep -Fq '# Managed by PVNetwork Reseller Dashboard installer' "$file" && return 0
  awk -v d="$domain" '$1 == "ServerName" && $2 == d { found=1 } END { exit !found }' "$file" || return 1
  grep -Fq "127.0.0.1:${APP_PORT}" "$file" && return 0
  if grep -Fq '/.well-known/acme-challenge/' "$file" && grep -Fq "https://$domain" "$file"; then
    return 0
  fi
  return 1
}

assert_site_file_safe() {
  local file="$1"
  site_file_is_adoptable "$file" "$PANEL_DOMAIN" || die "Refusing to overwrite unrelated Apache vhost: $file"
}

apache_validate_and_reload() {
  apache2ctl configtest
  systemctl reload apache2
}

install_http_vhost() {
  local site
  site="$(http_site_path)"
  assert_site_file_safe "$site"
  mkdir -p "$ACME_WEBROOT/.well-known/acme-challenge"
  render_http_vhost "$PANEL_DOMAIN" "$ACME_WEBROOT" "$site"
  a2ensite "$PANEL_DOMAIN.conf" >/dev/null
  apache_validate_and_reload
}

acme_path_is_reachable() {
  local token="pvnet-$(openssl rand -hex 6)" expected="PVNETWORK-ACME-$RANDOM" got=""
  printf '%s' "$expected" > "$ACME_WEBROOT/.well-known/acme-challenge/$token"
  got="$(curl -fsSL --max-time 20 "http://$PANEL_DOMAIN/.well-known/acme-challenge/$token" 2>/dev/null || true)"
  rm -f "$ACME_WEBROOT/.well-known/acme-challenge/$token"
  [[ "$got" == "$expected" ]]
}

certificate_is_usable() {
  local cert="/etc/letsencrypt/live/$PANEL_DOMAIN/fullchain.pem" key="/etc/letsencrypt/live/$PANEL_DOMAIN/privkey.pem"
  [[ -s "$cert" && -s "$key" ]] || return 1
  openssl x509 -checkend 2592000 -noout -in "$cert" >/dev/null 2>&1
}

issue_certificate() {
  if certificate_is_usable; then
    log "Existing Let's Encrypt certificate is still valid"
    return 0
  fi
  acme_path_is_reachable || die "ACME challenge URL is not reachable. Check DNS/Cloudflare and ensure HTTP reaches this server."
  log "Requesting Let's Encrypt certificate for $PANEL_DOMAIN"
  certbot certonly \
    --webroot -w "$ACME_WEBROOT" \
    -d "$PANEL_DOMAIN" \
    --preferred-challenges http \
    --agree-tos --non-interactive --register-unsafely-without-email
  certificate_is_usable || die "Certificate was issued but files are not usable"
}

install_https_vhost() {
  local site
  site="$(https_site_path)"
  assert_site_file_safe "$site"
  render_https_vhost "$PANEL_DOMAIN" "$APP_PORT" "$site"
  a2ensite "$PANEL_DOMAIN-ssl.conf" >/dev/null
  apache_validate_and_reload
}

install_certbot_deploy_hook() {
  local hook="/etc/letsencrypt/renewal-hooks/deploy/pv-reseller-apache-reload.sh"
  mkdir -p "$(dirname "$hook")"
  cat > "$hook" <<'HOOK'
#!/bin/sh
set -eu
apache2ctl configtest >/dev/null
systemctl reload apache2
HOOK
  chmod 755 "$hook"
}

origin_https_health_check() {
  local code body
  code="$(curl -sS --max-time 15 --resolve "$PANEL_DOMAIN:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$PANEL_DOMAIN/" 2>/dev/null || true)"
  [[ "$code" == "200" ]] || return 1
  body="$(curl -fsS --max-time 15 --resolve "$PANEL_DOMAIN:443:127.0.0.1" "https://$PANEL_DOMAIN/api/auth/me" 2>/dev/null || true)"
  [[ "$body" == *'"user"'* ]]
}

public_https_health_check() {
  local code
  code="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "https://$PANEL_DOMAIN/" 2>/dev/null || true)"
  [[ "$code" == "200" ]]
}

print_cloudflare_guidance() {
  local headers
  headers="$(curl -sSI --max-time 15 "https://$PANEL_DOMAIN/" 2>/dev/null || true)"
  if grep -Eqi '^server:[[:space:]]*cloudflare' <<<"$headers"; then
    cat <<'CF'

Cloudflare detected. Recommended settings for this dashboard:
  - Proxy status: Proxied (orange cloud)
  - SSL/TLS encryption mode: Full (strict)
  - Always Use HTTPS: On (after origin HTTPS is healthy)
  - Cache Rule for this hostname: Bypass cache
  - Rocket Loader: Off for this hostname if it causes UI/JS issues
CF
  fi
}

configure_apache_tls() {
  install_http_vhost
  issue_certificate
  install_https_vhost
  install_certbot_deploy_hook
  origin_https_health_check || die "Origin HTTPS health check failed"
  if public_https_health_check; then
    log "Public HTTPS health check passed"
  else
    warn "Origin HTTPS is healthy, but public HTTPS is not reachable yet. DNS/Cloudflare propagation may still be pending."
  fi
  print_cloudflare_guidance
}

main() {
  resolve_inputs
  preflight
  prepare_dependencies
  mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$BACKUP_DIR"
  chmod 700 "$DATA_DIR" "$BACKUP_DIR"
  load_or_create_secrets
  write_initial_credentials_if_needed
  backup_existing_install
  sync_repository
  write_installer_metadata
  deploy_dashboard
  configure_apache_tls

  echo
  log "Installation/update completed successfully"
  printf 'Panel:    https://%s\n' "$PANEL_DOMAIN"
  printf 'Username: %s\n' "$ADMIN_USERNAME"
  if [[ "${SECRETS_CREATED:-0}" == "1" && "${INITIAL_CREDENTIALS_CREATED:-0}" == "1" ]]; then
    printf 'Initial password: %s\n' "$ADMIN_PASSWORD"
    printf 'Credentials file: %s/INITIAL_CREDENTIALS.txt\n' "$INSTALL_DIR"
  else
    printf 'Password: unchanged (use the current password stored in the Dashboard)\n'
  fi
  printf 'Data:     %s\n' "$DATA_DIR"
  printf 'Backups:  %s\n' "$BACKUP_DIR"
  [[ -n "${LAST_BACKUP_DIR:-}" ]] && printf 'Latest backup: %s\n' "$LAST_BACKUP_DIR"
}

if [[ "${PVNET_INSTALLER_LIB_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
