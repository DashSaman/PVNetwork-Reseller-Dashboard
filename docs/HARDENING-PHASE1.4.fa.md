# گزارش فاز ۱.۴ — ضد-بایپس نهایی، Idempotency، کارایی صفحهٔ اول

نسخه: `3fac723 ← 212b154` — شواهد: ۳۲ چک فاز ۱.۴ + ۱۹ چک رگرسیون ۱.۱ — هر دو ۰ شکست.

## خلاصه

۱۷ یافتهٔ بازبینی مستقل در سورس 3fac723 راستی‌آزمایی شد (همه تأیید) و اصلاح گردید. مهم‌ترین‌ها:
1. **نمایندهٔ محدود هرگز کاربر نامحدود نمی‌سازد** — `validateRequestedUserQuota` در هستهٔ ساخت/ویرایش/پل
2. **دلتای UPDATE رزرو می‌شود** — افزایش سهمیه از پول دیگر قابل سرقت نیست
3. **Idempotency-Key ساخت** — retry همان email/subId برمی‌گرداند، payload متفاوت → 409
4. **canonicalUsageByEmail per-panel** — Bridge clientList هم کانونی شد (7+5=12)
5. **صفحهٔ اول ۵۰٪+ سریع‌تر** — bootstrap endpoint + concurrent panels + single-flight + lazy stats

## مایگریشن

`reservedGB` (ستون افزودنی) + `subId` UNIQUE index (با گارد duplicate-check در installer). هر دو idempotent.

## استقرار

بکاپ `phase14-*` (integrity ok) → AFTER = BEFORE دقیق (ardalan 512/0/1 · Mobin 1024/0/5 · 6 users · 6 subId · 0 journals) — 3x-ui/Xray دست‌نخورده.
