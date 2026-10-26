#!/bin/bash
# اتصال دوباره پنل نمایندگی به 3x-ui — ابزار عملیاتی سرور
# همه مقادیر از /opt/pvnet/CREDENTIALS.txt (خروجی install.sh) یا env خوانده می‌شود
set -euo pipefail
umask 077
cd "${PVNET_DIRECTORY:-/opt/pvnet}"
TASK_TMP="$(mktemp -d "${TMPDIR:-/tmp}/pvnet-connect.XXXXXXXX")"
trap 'rm -rf -- "$TASK_TMP"' EXIT

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
export ADMIN_USERNAME ADMIN_PASSWORD XUI_USER XUI_PASS XUI_BASEPATH XUI_WEB_PORT PANEL_URL
jq -n '{username:env.ADMIN_USERNAME,password:env.ADMIN_PASSWORD}' > "$TASK_TMP/login.json"
curl -s -c "$TASK_TMP/admin-cookie" -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  --data-binary @"$TASK_TMP/login.json"
echo ""

# ذخیره پیکربندی پنل 3x-ui
jq -n '{baseUrl:("http://host.docker.internal:" + env.XUI_WEB_PORT + env.XUI_BASEPATH), username:env.XUI_USER, password:env.XUI_PASS, apiToken:"", subBase:env.PANEL_URL, subPath:"sub"}' > "$TASK_TMP/panelcfg.json"

curl -s -b "$TASK_TMP/admin-cookie" -X PUT http://127.0.0.1:3001/api/admin/panel-config \
  -H 'Content-Type: application/json' \
  --data-binary @"$TASK_TMP/panelcfg.json"
echo " <- saved"

sleep 1
curl -s -b "$TASK_TMP/admin-cookie" -X POST http://127.0.0.1:3001/api/admin/panel-test-saved
echo " <- test"
