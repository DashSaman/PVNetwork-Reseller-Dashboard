#!/usr/bin/env bash
# ============================================================================
#  PVNetWork — آپدیت پنل از مخزن (بیلد مجدد + ری‌استارت)
#  استفاده:  bash /opt/pvnet/repo/update.sh
# ============================================================================
set -euo pipefail
BASE_DIR="/opt/pvnet"
REPO_DIR="$BASE_DIR/repo"

log() { echo -e "\033[1;36m[⬢]\033[0m $*"; }
trap 'echo "آپدیت در خط $LINENO متوقف شد" >&2; exit 1' ERR

[ "$(id -u)" -eq 0 ] || { echo "با root اجرا کنید" >&2; exit 1; }
[ -d "$REPO_DIR/.git" ] || { echo "مخزن در $REPO_DIR نیست — install.sh را اجرا کنید" >&2; exit 1; }

cd "$REPO_DIR"
log "دریافت تغییرات..."
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
  log "همه‌چیز به‌روز است ($(git log --oneline -1))"
  exit 0
fi

log "بکاپ دیتابیس قبل از آپدیت..."
"$BASE_DIR/backup-db.sh" || true

log "اعمال تغییرات ($LOCAL → $REMOTE)..."
git pull --ff-only origin main

log "بیلد مجدد ایمیج..."
cd "$BASE_DIR"
docker compose build pvnet-panel >/dev/null 2>&1 || docker compose build pvnet-panel | tail -5

log "بازسازی کانتینر..."
docker compose up -d pvnet-panel 2>&1 | tail -1

sleep 5
HTTP=$(curl -sk -o /dev/null -w "%{http_code}" "https://$(grep -oP '(?<=https:\/\/)[^:]+' /opt/pvnet/Caddyfile | head -1):2053/" || echo 000)
log "آپدیت کامل شد — پنل پاسخ می‌دهد (HTTP $HTTP)"
log "اگر اسکیمای دیتابیس تغییر کرده باشد، با admin/overview چک کنید؛ بکاپ در $BASE_DIR/panel-data/"
