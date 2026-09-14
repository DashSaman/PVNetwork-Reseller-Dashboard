# syntax=docker/dockerfile:1
# ============================================================================
# PVNetWork Reseller Panel — بیلد چندمرحله‌ای از سورس (برای نصب روی سرور تازه)
#   مرحله ۱ (builder): bun install → prisma generate/db push → next build
#   مرحله ۲ (runtime): node:22-slim فقط با خروجی standalone
# ============================================================================

# ---------- builder ----------
FROM oven/bun:1 AS builder
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=file:/tmp/build.db

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# کش وابستگی‌ها: اول package/lock بعد بقیه سورس
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

COPY . .

# کلاینت prisma + دیتابیس قالب (اسکیمای کامل روی sqlite خالی)
RUN bunx prisma generate \
 && mkdir -p /app/prisma-template \
 && bunx prisma db push --skip-generate --accept-data-loss \
 && cp /tmp/build.db /app/prisma-template/custom.db

# بیلد next (standalone) + ادغام استاتیک + public — مسیر standalone خودکار پیدا می‌شود
RUN bunx next build
RUN set -e; ROOT=$(dirname "$(find .next/standalone -maxdepth 3 -name server.js | head -1)") \
 && cp -r .next/static "$ROOT/.next/" \
 && cp -r public "$ROOT/" \
 && echo "standalone root: $ROOT"

# هک معروف externalized prisma client: هر جا next به @prisma/client-<hash> اشاره
# کرده، یک پکیج alias می‌سازیم که به @prisma/client اصلی وصل شود
RUN set -e; ROOT=$(dirname "$(find .next/standalone -maxdepth 3 -name server.js | head -1)"); \
    HASHES=$(grep -rhoE '@prisma/client-[a-z0-9]+' "$ROOT/.next/server" 2>/dev/null | sort -u | sed 's|@prisma/client-||'); \
    for h in $HASHES; do \
      D="$ROOT/node_modules/@prisma/client-$h"; \
      mkdir -p "$D"; \
      printf '{"name":"@prisma/client-%s","version":"1.0.0","description":"alias to real prisma client","main":"index.js"}' "$h" > "$D/package.json"; \
      printf 'module.exports = require("@prisma/client");\n' > "$D/index.js"; \
    done

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/prisma-template ./prisma-template
COPY docker/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh && mkdir -p /app/data

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "/app/entrypoint.sh"]
