#!/bin/sh
# راه‌اندازی پنل: آماده‌سازی دیتابیس و اجرای سرور
set -e

mkdir -p /app/data

# Only this dashboard's data is touched. Fail closed before Node on interrupted restore.
python3 /app/scripts/dashboard-restore.py apply /app/data /app/prisma-template/custom.db
APP_SECRET="$(node -e 'process.stdout.write(require("/app/scripts/runtime-secret.cjs").runtimeSecret())')"
export APP_SECRET

# بار اول: دیتابیس قالب (اسکیمای کامل) را در volume کپی کن
if [ ! -f /app/data/custom.db ]; then
  cp /app/prisma-template/custom.db /app/data/custom.db
  echo "[pvnet-panel] database initialized"
fi

exec node server.js
