#!/bin/bash
# اتصال دوباره پنل نمایندگی به 3x-ui — ابزار عملیاتی سرور
# همه مقادیر از /opt/pvnet/CREDENTIALS.txt (خروجی install.sh) یا env خوانده می‌شود
set -euo pipefail
cd /opt/pvnet

[ -f CREDENTIALS.txt ] || { echo "ERROR: CREDENTIALS.txt not found (run install.sh first)" >&2; exit 1; }
[ -f .env ] || { echo "ERROR: .env not found" >&2; exit 1; }

export $(grep -E '^(ADMIN_USERNAME|ADMIN_PASSWORD)=' .env | xargs)

# خواندن مقادیر 3x-ui از CREDENTIALS.txt (env اگر باشد مقدم است)
XUI_USER="${XUI_USER:-$(grep '3x-ui login' CREDENTIALS.txt | awk '{print $NF}' | cut -d/ -f1 | tr -d ' ')}"
XUI_PASS="${XUI_PASS:-$(grep '3x-ui login' CREDENTIALS.txt | awk '{print $NF}' | cut -d/ -f2)}"
XUI_BASEPATH="${XUI_BASEPATH:-$(grep 'basePath' CREDENTIALS.txt | awk '{print $NF}')}"
XUI_WEB_PORT="${XUI_WEB_PORT:-2087}"
PANEL_URL="${PANEL_URL:-$(grep 'Panel URL' CREDENTIALS.txt | awk '{print $NF}')}"

[ -n "${XUI_PASS:-}" ] || { echo "ERROR: 3x-ui password not found in CREDENTIALS.txt" >&2; exit 1; }
echo "panel : $PANEL_URL"
echo "3x-ui : host.docker.internal:$XUI_WEB_PORT$XUI_BASEPATH (user: $XUI_USER)"

# ورود به پنل
curl -s -c /tmp/pv-adm.txt -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}"
echo ""

# ذخیره پیکربندی پنل 3x-ui
jq -n --arg u "$XUI_USER" --arg p "$XUI_PASS" --arg b "$XUI_BASEPATH" --arg w "$XUI_WEB_PORT" --arg s "$PANEL_URL" \
  '{baseUrl:("http://host.docker.internal:" + $w + $b), username:$u, password:$p, apiToken:"", subBase:$s, subPath:"sub"}' > /tmp/panelcfg.json

curl -s -b /tmp/pv-adm.txt -X PUT http://127.0.0.1:3001/api/admin/panel-config \
  -H 'Content-Type: application/json' \
  -d @/tmp/panelcfg.json
echo " <- saved"

sleep 1
curl -s -b /tmp/pv-adm.txt -X POST http://127.0.0.1:3001/api/admin/panel-test-saved
echo " <- test"
