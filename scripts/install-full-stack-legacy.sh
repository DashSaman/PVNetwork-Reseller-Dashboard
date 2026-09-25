#!/usr/bin/env bash
# LEGACY FULL-STACK INSTALLER
# This script provisions Caddy + 3x-ui/Xray-related resources and is NOT the
# recommended installer for existing infrastructure. Use ../install.sh for the
# dashboard-only deployment.
#
# ============================================================================
#  PVNetWork Reseller System — نصب تک‌خطی روی سرور تازه (Ubuntu/Debian)
#
#  استفاده:
#    bash <(curl -fsSL <raw-url>/install.sh)
#  یا با پارامتر (غیرتعاملی):
#    PANEL_DOMAIN=panel.example.com ROOT_DOMAIN=example.com GITHUB_TOKEN=... \
#      bash install.sh
#
#  کاری که انجام می‌دهد:
#    1) Docker + Compose  2) کلون مخزن  3) ساخت ایمیج از سورس
#    4) پنل نمایندگی + 3x-ui + Caddy (پورت 2053)  5) اینباند پیش‌فرض
#    6) گواهی واقعی (در صورت دادن CF_API_TOKEN) یا self-signed
#    7) بکاپ روزانه دیتابیس + ذخیره رمزها در /opt/pvnet/CREDENTIALS.txt
#    سایر سرویس‌های سرور دست‌نخورده می‌مانند (فقط پورت 2053/2087)
# ============================================================================
set -euo pipefail

BASE_DIR="/opt/pvnet"
REPO_DIR="$BASE_DIR/repo"
PANEL_PORT="2053"        # پورت HTTPS عمومی (Caddy)
XUI_WEB_PORT="2087"      # پورت وب 3x-ui (فقط لوکال از طریق Caddy)
SUB_PORT="2096"          # پورت سرویس ساب 3x-ui (روی host)
REPO_URL_DEFAULT="https://github.com/DashSaman/PVNetwork-Reseller-Dashboard.git"

c_g="⬢"; c_y="⚠"; c_ok="✔"; c_no="✖"
log()  { echo -e "\033[1;36m[$c_g]\033[0m $*"; }
warn() { echo -e "\033[1;33m[$c_y]\033[0m $*"; }
err()  { echo -e "\033[1;31m[$c_no]\033[0m $*" >&2; }
trap 'err "نصب در خط $LINENO متوقف شد"; exit 1' ERR

ask() {
  local __var=$1 __prompt=$2 __def=${3:-} __val=""
  if [ -n "${!__var:-}" ]; then return; fi
  if [ -r /dev/tty ]; then
    read -r -p "$__prompt [$__def]: " __val </dev/tty || true
  fi
  export "$__var=${__val:-$__def}"
}

[ "$(id -u)" -eq 0 ] || { err "با root اجرا کنید"; exit 1; }

ask GITHUB_TOKEN   "GitHub Personal Access Token (فقط اگر مخزن خصوصی است؛ مخزن عمومی = خالی)" ""
ask PANEL_DOMAIN   "دامنه پنل نمایندگی (مثلاً panel.example.com)" ""
ask ROOT_DOMAIN    "دامنه ریشه برای وایلدکارد *. (خالی = همان دامنه پنل)" ""
ask XUI_SUBDOMAIN  "زیردامنه 3x-ui (پیش‌فرض: 3xpanel)" "3xpanel"
ask CF_API_TOKEN   "کلودفلر API Token (برای گواهی وایلدکارد؛ خالی = self-signed)" ""
ask ADMIN_USERNAME "نام کاربری ادمین پنل" "admin"

[ -n "$PANEL_DOMAIN" ] || { err "دامنه پنل الزامی است"; exit 1; }
[ -n "$ROOT_DOMAIN" ] || ROOT_DOMAIN="${PANEL_DOMAIN#*.}"
XUI_DOMAIN="${XUI_SUBDOMAIN}.${ROOT_DOMAIN}"

rnd() { openssl rand -hex "$1"; }
APP_SECRET="pvnetwork-$(rnd 24)"
ADMIN_PASSWORD="Pv$(rnd 5)A9!"
XUI_USER="pvadmin"
XUI_PASSWORD="Px$(rnd 10)K7"
XUI_BASEPATH="/pv$(rnd 3)-k$(rnd 2)/"

log "دامنه‌ها: پنل=$PANEL_DOMAIN | 3x-ui=$XUI_DOMAIN | وایلدکارد=*.$ROOT_DOMAIN"

if ! command -v docker >/dev/null 2>&1; then
  log "نصب Docker..."
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
fi
docker compose version >/dev/null 2>&1 || { err "docker compose plugin یافت نشد"; exit 1; }
log "Docker آماده است: $(docker --version)"

mkdir -p "$BASE_DIR"
if [ ! -d "$REPO_DIR/.git" ]; then
  log "کلون مخزن..."
  CLONE_URL="$REPO_URL_DEFAULT"
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    CLONE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/DashSaman/PVNetwork-Reseller-Dashboard.git"
  fi
  git clone --depth 1 "$CLONE_URL" "$REPO_DIR" \
    || { err "کلون ناموفق — اگر مخزن خصوصی است GITHUB_TOKEN را بررسی کنید"; exit 1; }
fi
cd "$REPO_DIR"

mkdir -p "$BASE_DIR"/{panel-data,3xui,3xui-cert,certs}

cat > "$BASE_DIR/.env" <<ENV
APP_SECRET="$APP_SECRET"
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD
CF_API_TOKEN=$CF_API_TOKEN
ENV
chmod 600 "$BASE_DIR/.env"

CERT_LINE="tls internal"
if [ -f "$BASE_DIR/certs/wildcard.$ROOT_DOMAIN.pem" ]; then
  CERT_LINE="tls /certs/wildcard.$ROOT_DOMAIN.pem /certs/wildcard.$ROOT_DOMAIN-key.pem"
fi
cat > "$BASE_DIR/Caddyfile" <<CADDY
{
  admin off
}

https://$PANEL_DOMAIN:$PANEL_PORT {
  $CERT_LINE
  reverse_proxy pvnet-panel:3000
}

https://$XUI_DOMAIN:$PANEL_PORT {
  $CERT_LINE
  reverse_proxy /$XUI_BASEPATH/* http://host.docker.internal:$XUI_WEB_PORT
  reverse_proxy /$XUI_BASEPATH http://host.docker.internal:$XUI_WEB_PORT
}

https://:$PANEL_PORT {
  $CERT_LINE
  reverse_proxy pvnet-panel:3000
}
CADDY

cat > "$BASE_DIR/docker-compose.yml" <<'COMPOSE'
services:
  pvnet-caddy:
    image: caddy:2-alpine
    container_name: pvnet-caddy
    restart: unless-stopped
    depends_on: [pvnet-panel]
    ports: ["2053:2053"]
    extra_hosts: ["host.docker.internal:host-gateway"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./certs:/certs:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [pvnet]

  pvnet-panel:
    build:
      context: ./repo
      dockerfile: docker/Dockerfile
    image: pvnet-panel:local
    container_name: pvnet-panel
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 3000
      HOSTNAME: 0.0.0.0
      DATABASE_URL: file:/app/data/custom.db
      APP_SECRET: ${APP_SECRET:?required}
      ADMIN_USERNAME: ${ADMIN_USERNAME:-admin}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:?required}
    volumes:
      - ./panel-data:/app/data
    ports:
      - "127.0.0.1:3001:3000"
    extra_hosts: ["host.docker.internal:host-gateway"]
    networks: [pvnet]

  pvnet-3xui:
    image: ghcr.io/mhsanaei/3x-ui:latest
    container_name: pvnet-3xui
    restart: unless-stopped
    network_mode: host
    environment:
      XRAY_VMESS_AEAD_FORCED: "false"
      X_UI_ENABLE_FAIL2BAN: "true"
    volumes:
      - ./3xui:/etc/x-ui
      - ./3xui-cert:/root/cert

volumes:
  caddy_data:
  caddy_config:
networks:
  pvnet:
    name: pvnet
COMPOSE

if [ -n "$CF_API_TOKEN" ]; then
  log "صدور گواهی وایلدکارد با acme.sh (DNS-01)..."
  curl -fsSL https://get.acme.sh | sh -s email="admin@$ROOT_DOMAIN" >/dev/null 2>&1 || true
  ~/.acme.sh/acme.sh --set-default-ca --server letsencrypt >/dev/null 2>&1 || true
  if ~/.acme.sh/acme.sh --issue --dns dns_cf -d "*.$ROOT_DOMAIN" -d "$ROOT_DOMAIN" \
       --keylength ec-256 >/var/log/acme-pvnet.log 2>&1; then
    ~/.acme.sh/acme.sh --install-cert -d "*.$ROOT_DOMAIN" --ecc \
      --key-file "$BASE_DIR/certs/wildcard.$ROOT_DOMAIN-key.pem" \
      --fullchain-file "$BASE_DIR/certs/wildcard.$ROOT_DOMAIN.pem" \
      --reloadcmd "docker restart pvnet-caddy" >/dev/null 2>&1 || true
    CERT_LINE="tls /certs/wildcard.$ROOT_DOMAIN.pem /certs/wildcard.$ROOT_DOMAIN-key.pem"
    sed -i "s|^  tls internal$|  $CERT_LINE|" "$BASE_DIR/Caddyfile"
    log "گواهی وایلدکارد صادر شد (تمدید خودکار فعال است)"
  else
    warn "صدور گواهی ناموفق بود — موقتاً self-signed استفاده می‌شود (لاگ: /var/log/acme-pvnet.log)"
  fi
else
  warn "بدون CF_API_TOKEN: گواهی self-signed ساخته می‌شود (مرورگر هشدار می‌دهد)"
fi

if [ "$(free -m | awk '/^Swap:/{print $2}')" -lt 1024 ] && [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 3000 ] && [ ! -f /swapfile ]; then
  log "RAM کم — ساخت ۲GB swap (مهم برای بیلد)..."
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "بیلد ایمیج پنل از سورس (۵ تا ۱۵ دقیقه — فقط بار اول)..."
cd "$BASE_DIR"
docker compose build pvnet-panel >/dev/null 2>&1 || docker compose build pvnet-panel | tail -5
docker compose up -d 2>&1 | tail -2

log "پیکربندی 3x-ui..."
sleep 5
docker exec pvnet-3xui x-ui setting -username "$XUI_USER" -password "$XUI_PASSWORD" >/dev/null 2>&1 \
  || warn "تنظیم رمز 3x-ui ناموفق — دستی انجام دهید"
docker exec pvnet-3xui x-ui setting -webPort "$XUI_WEB_PORT" >/dev/null 2>&1 || true
docker exec pvnet-3xui x-ui setting -webBasePath "$XUI_BASEPATH" >/dev/null 2>&1 || true
docker restart pvnet-3xui >/dev/null 2>&1 && sleep 5 || true

log "اتصال پنل به 3x-ui و ساخت اینباند پیش‌فرض..."
COOKIE=$(curl -sk -c - -X POST "http://127.0.0.1:3001/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | grep rp_session | awk '{print $NF}' || true)
if [ -n "$COOKIE" ]; then
  curl -sk -X PUT "http://127.0.0.1:3001/api/admin/panel-config" \
    -H 'Content-Type: application/json' -b "rp_session=$COOKIE" \
    -d "{\"baseUrl\":\"http://host.docker.internal:$XUI_WEB_PORT$XUI_BASEPATH\",\"username\":\"$XUI_USER\",\"password\":\"$XUI_PASSWORD\",\"apiToken\":\"\",\"subBase\":\"https://$PANEL_DOMAIN:$PANEL_PORT\",\"subPath\":\"sub\"}" >/dev/null || true
  curl -sk -X POST "http://127.0.0.1:3001/api/admin/panel-test-saved" -b "rp_session=$COOKIE" >/dev/null || true
  CSRF=$(curl -sk "http://host.docker.internal:$XUI_WEB_PORT$XUI_BASEPATH/csrf-token" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p' || true)
  curl -sk -c /tmp/xui-cookie -X POST "http://host.docker.internal:$XUI_WEB_PORT$XUI_BASEPATH/login" \
    -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$XUI_USER\",\"password\":\"$XUI_PASSWORD\"}" >/dev/null || true
  curl -sk -b /tmp/xui-cookie -X POST "http://host.docker.internal:$XUI_WEB_PORT$XUI_BASEPATH/panel/api/inbounds/add" \
    -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' \
    -d '{"up":0,"down":0,"total":0,"remark":"DE-VLESS-10000","enable":true,"expiryTime":0,"listen":"","port":10000,"protocol":"vless","sniffing":{"enabled":true,"destOverride":["http","tls"]},"settings":{"clients":[],"decryption":"none","fallbacks":[]},"streamSettings":{"network":"tcp","security":"none","tcpSettings":{"acceptProxyProtocol":false,"header":{"type":"none"}}},"tag":"in-10000-tcp"}' >/dev/null || true
  rm -f /tmp/xui-cookie
else
  warn "لاگین ادمین پنل ناموفق — پیکربندی 3x-ui را از تنظیمات پنل انجام دهید"
fi

cat > "$BASE_DIR/backup-db.sh" <<'BK'
#!/bin/bash
D=/opt/pvnet/panel-data
F=$D/custom.db.bak-$(date +%Y%m%d-%H%M)
sqlite3 $D/custom.db ".backup $F" 2>/dev/null || cp $D/custom.db $F
ls -1t $D/custom.db.bak-* 2>/dev/null | tail -n +8 | xargs -r rm -f
BK
chmod +x "$BASE_DIR/backup-db.sh"
(crontab -l 2>/dev/null | grep -v backup-db.sh; echo "30 4 * * * $BASE_DIR/backup-db.sh >> /var/log/pvnet-backup.log 2>&1") | crontab -

cat > "$BASE_DIR/CREDENTIALS.txt" <<CRED
=== PVNetWork — CREDENTIALS (confidential) ===
Panel URL      : https://$PANEL_DOMAIN:$PANEL_PORT
Panel admin    : $ADMIN_USERNAME / $ADMIN_PASSWORD
3x-ui URL      : https://$XUI_DOMAIN:$PANEL_PORT$XUI_BASEPATH
3x-ui login    : $XUI_USER / $XUI_PASSWORD
3x-ui basePath : $XUI_BASEPATH
Sub service    : https://$PANEL_DOMAIN:$PANEL_PORT/sub/<subId>
Wildcard cert  : $BASE_DIR/certs/wildcard.$ROOT_DOMAIN.pem
DB backups     : $BASE_DIR/panel-data/custom.db.bak-* (daily 04:30, keep 7)
CRED
chmod 600 "$BASE_DIR/CREDENTIALS.txt"

sleep 3
PANEL_HTTP=$(curl -sk -o /dev/null -w "%{http_code}" "https://$PANEL_DOMAIN:$PANEL_PORT/" || echo 000)
echo ""
log "=============================================================="
log " نصب کامل شد! $c_ok"
log " پنل نمایندگی : https://$PANEL_DOMAIN:$PANEL_PORT   (HTTP $PANEL_HTTP)"
log " ادمین        : $ADMIN_USERNAME / $ADMIN_PASSWORD"
log " 3x-ui        : https://$XUI_DOMAIN:$PANEL_PORT$XUI_BASEPATH"
log " رمزها        : $BASE_DIR/CREDENTIALS.txt (chmod 600)"
log " بکاپ روزانه  : ۰۴:۳۰ — آخرین ۷ نسخه"
log "--------------------------------------------------------------"
log " قدم بعدی: وارد پنل شوید → نماینده بسازید → نماینده کاربر می‌سازد"
log " تغییر رمز ادمین: پنل → تنظیمات و پنل‌ها → حساب مدیر اصلی"
log "=============================================================="
