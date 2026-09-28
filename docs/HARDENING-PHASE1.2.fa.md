# گزارش فاز ۱.۲ — بستن کامل صحت حسابداری و Crash-Safety

نسخه: `991ff9a/261fbbc ← 5b6ef7a` — سپتامبر ۲۰۲۶. سند مبتنی بر شواهد تست خودکار: فاز ۱.۲ (۲۰ چک) + رگرسیون فاز ۱.۱ (۱۹ چک) — هر دو بدون شکست.

## یافته‌ها (هر ۲۱ مورد ابتدا در کد راستی‌آزمایی شد — همه تأیید)

| # | یافته | اصلاح |
|---|---|---|
| ۱ | NEEDS_REPAIR سهمیه رزرو نمی‌کرد (فقط metadata) | ستون `reservedGB` + `getActiveReservationsGB` + `getEffectiveRemainingGB` در همه محاسبات remaining (users/inbounds/stats/bulk/create) — یتیم، سهمیه را قفل نگه می‌دارد |
| ۲ | CREATE قبل از اثر ریموت ژورنال نداشت (crash-window) | ژورنال CREATE + رزرو «قبل از اولین addClient»؛ SUCCESS→تبدیل به تخصیص؛ FAILED→آزادسازی |
| ۳ | خطای شبکه ≠ عدمِ ساخت (UNKNOWN) | `verifyRemoteAbsent`: PRESENT→جبران؛ ABSENT→ادامه؛ UNKNOWN→NEEDS_REPAIR با حفظ رزرو |
| ۴ | commit حسابداری اتمیک نبود | `db.$transaction` واحد: increment + accountingCommitted (یا هر دو یا هیچ) — retry صرفاً no-op |
| ۵ | lookup ژورنال tenant-unsafe (email+type) | scope با `resellerId+email+type` |
| ۶ | کلید reset می‌توانست collide کند (`reset:id:usageGB`) | شناسه چرخه‌ای یکتا (`opKey`) — مقدار مصرف هرگز هویت عملیات نیست |
| ۷ | recompute پنل‌ها هنگام retry + تداخل عملیات | `targetPanels` تغییرناپذیر از ژورنال؛ تداخل DELETE/RESET ↔ UPDATE با 409 بلاک |
| ۸ | tracked قدیمی قبل از قفل | ورودی سرویس `resellerId+email`؛ reload reseller+tracked داخل قفل |
| ۹ | UPDATE بدون ژورنال | ژورنال UPDATE در PUT داشبورد و پل + per-panel + PARTIAL + retry |
| ۱۰-۱۲ | تجمیع غیرکانونی (max جدا up/down) | برنده از «یک رکورد» (بیشینه up+down) — داشبورد/پل/پرتال یکسان؛ تست نامتقارن ۱۰ نه ۱۹ |
| ۱۳ | refs خالی → عملیات | fail-closed با خطای تعمیر (409) |
| ۱۴ | مسیر حسابداری قدیمی | `debitUsedTraffic` حذف شد — تنها مسیر: accounting-ops |
| ۱۵-۲۱ | تست‌های ناکافی | ماتریس ۲۰ چک جدید با fault-injection (mid-op failureهای واقعی، UNKNOWN، چرخه‌های هم‌مقدار، isolation، رزرو) + گاردهای اجرا |

## طراحی‌ها

**رزرو:** `reservedGB` ژورنال CREATE فعال (PENDING/RUNNING/PARTIAL/NEEDS_REPAIR) در remaining لحاظ می‌شود؛ آزادسازی فقط با FAILED-با-جبران-تأییدشده یا SUCCESS (تبدیل به ResellerUser).

**تراکنش:** بدهکاری نهایی حذف/ریست داخل `db.$transaction` با re-read شرطی — double-debit ساختاری ناممکن.

**Idempotency:** کلید عملیات یکتا در ایجاد؛ retry = resume همان ژورنال (snapshot/پنل‌های کامل‌شده حفظ).

## شواهد تست (خلاصه)

- UNKNOWN → NEEDS_REPAIR → remaining = پول − رزرو (۳۰ از ۵۰) → ساخت ۴۰ رد (403)
- شکست mid-op ریست (بعد از preflight) → PARTIAL بدون بدهکاری → retry → بدهکاری دقیقاً ۵
- شکست mid-op حذف → PARTIAL + حفظ رکورد → retry → بدهکاری ۲
- دو چرخه ریست هم‌مقدار (۳+۳) → دو عملیات مستقل، consumed=۶
- isolation: ساخت هم‌نام برای نماینده دیگر رد؛ عملیات B روی کاربر A رد (نه resume)
- نامتقارن: داشبورد=پرتال=۱۰ (نه ۱۹)
- UPDATE mid-op → PARTIAL (بدون موفقیت کاذب) → retry موفق
- چرخه عمر رزرو: موفق → allocated=30/remaining=10

TypeScript بدون خطا · ESLint بدون خطای جدید · بیلد موفق · مایگریشن idempotent (بار دوم بی‌اثر).

## استقرار

بکاپ `.backup` + integrity ok + SHA256 (`backup/phase12-*`) → مایگریشن افزودنی (۱ ستون reservedGB؛ جدول از قبل) → تعویض فقط داشبورد → سلامت 200 → **AFTER = BEFORE دقیقاً** (ardalan: 512/0/۱کاربر، Mobin: 1024/0/۵کاربر، ۶ subId یکتا) → بدون ژورنال PARTIAL/NEEDS_REPAIR معلق → پل میرزا و راهنما زنده → sentinelx-worker دست‌نخورده (Up ۱۱ روز) → لاگ اپ بدون خطا. 3x-ui/Xray هرگز ری‌استارت نشدند.

## ریسک‌های باقی‌مانده

Repair خودکار NEEDS_REPAIRها (فعلاً ثبت + قفل سهمیه + لاگ برای ادمین) · قفل درون-پروسه‌ای (تک‌نمونه) · حسابداری GB اعشاری (بایت در فاز ۳) · cleanup دوره‌ای ژورنال‌های SUCCESS قدیمی.
