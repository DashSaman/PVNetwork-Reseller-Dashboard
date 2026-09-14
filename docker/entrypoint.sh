#!/bin/sh
# راه‌اندازی پنل: آماده‌سازی دیتابیس و اجرای سرور
set -e

mkdir -p /app/data

# بار اول: دیتابیس قالب (اسکیمای کامل) را در volume کپی کن
if [ ! -f /app/data/custom.db ]; then
  cp /app/prisma-template/custom.db /app/data/custom.db
  echo "[pvnet-panel] database initialized"
fi

exec node server.js
