# گزارش فاز ۱.۳ — اصلاح کد واقعی (نه گزارش): بستن شکاف‌های پیاده‌سازی

نسخه: `5b6ef7a ← 3fac723` — سپتامبر ۲۰۲۶. شواهد: تست فاز ۱.۳ (۲۰ چک) + رگرسیون فاز ۱.۱ (۱۹ چک) — هر دو ۰ شکست، و استقرار production با مقایسه BEFORE/AFTER.

## راستی‌آزمایی (هر ۲۱ یافته ابتدا در سورس واقعی بررسی شد — همه تأیید)

| # | یافته تأییدشده | اصلاح |
|---|---|---|
| ۱ | bulk فرمول دستی داشت و رزروها را نادیده می‌گرفت (getEffectiveRemainingGB فقط import شده بود) | `getQuotaState()` — تابع مرجع واحد؛ bulk/single/PUT/پل همه از آن |
| ۲-۳ | PUT و پل update فقط allocated+consumed اعتبارسنجی می‌کردند | همان تابع مرجع با `availableForThis = pool − othersAllocated − reserved − consumed` |
| ۴ | ژورنال/رزرو قبل از اتمام validation ساخته می‌شد (نشت رزرو در 400/409) | کل validation بدون عارضه ریموت قبل از ژورنال؛ تست: ایمیل نامعتبر/duplicate/اینباند بد ← بدون رزرو |
| ۵ | هویت crash-recoverable نبود (email="pending") | ایمیل نهایی/subId/targets/quota قبل از اولین addClient در ژورنال ماندگار |
| ۶-۷ | finalize دو نوشتن جدا (create سپس SUCCESS) | `finishCreateAtomically` — یک تراکنش: ResellerUser (اگر نیست) + SUCCESS + reservedGB=0 + completedPanels؛ مسیر بازیابی duplicate همان تراکنش را idempotent تمام می‌کند |
| ۸-۱۰ | UPDATE فقط «ژورنال می‌ساخت»؛ retry ژورنال دوم می‌ساخت | `updateUserByJournal` مشترک داشبورد+پل — resumable واقعی: retry همان ژورنال (PARTIAL→RUNNING→SUCCESS)؛ اثبات رفتاری: DELETE پس از retry موفق (بدون 409) |
| ۱۱-۱۴ | canonical تک‌منبع نبود (پل/پرتال منطق خودشان) | users list (`canonicalUsageByEmail`)، پرتال، clientList و getClientTraffics (`canonicalUserUsage`) — تست برابری ۱۲=۱۲=۱۲ و رکورد-برنده نامتقارن |
| ۱۵ | `debitUsedTraffic` و `canonicalUserUsageBytes` هنوز موجود بودند (گزارش ۱.۲ نادرست بود) | هر دو حذف — جستجوی repo: دقیقاً یک پیاده‌سازی حسابداری تخریبی |
| ۱۶-۱۸ | تست tenant دارای `check(true)`؛ گارد DB ناکافی؛ بدون cleanup | چک واقعی (ژورنال PARTIAL زندهٔ A + عملیات مستقل B با بدهکاری خودش)؛ گارد مسیر DB (رد production، الزام مسیر تست)؛ cleanup در finally |
| ۱۹-۲۰ | تست رزرو در برابر bulk/PUT/پل و crash windows نبود | ماتریس کامل + بازیابی crash-after-remote با تکرار همان درخواست |
| ۲۱ | گزارش جلوتر از کد بود | این سند پس از کد+تست+استقرار |

## اصلاح جانبی مهم

**Deadlock قفل تودرتو** کشف و رفع شد: wrapperهای قدیمی `withResellerLock` در PUT داشبورد و پل-update، با قفل داخلی سرویس‌های جدید زنجیره را منتظر خودش می‌کردند (در تست C خودش را نشان داد — HeadersTimeout).

## شواهد تست (خروجی واقعی فاز ۱.۳ — ۲۰/۲۰)

- رزرو ۲۰ فعال: single ۴۰→403، bulk ۴×۱۰→403، PUT→۴۵→403، پل +۴۰→رد؛ remaining=۳۰ ✓
- UNKNOWN→رزرو؛ تکرار همان ساخت→بازیابی stale موفق (رزرو آزاد، کاربر ثبت)؛ تکرار با نام یکسان→کاربر دوم با رزرو یتیم همچنان قفل (rem=۵) ✓
- validation: ایمیل کوتاه→۴۰۰، duplicate→«تکراری»، اینباند بد→رد — بدون نشت (rem=۲۵) ✓
- UPDATE: PARTIAL→retry موفق→DELETE بدون 409 (همان ژورنال بسته شد) ✓
- canonical: داشبورد=پرتال=getClientTraffics=۱۲ (۷+۵ دو پنل) ✓
- isolation: ژورنال PARTIAL زندهٔ A؛ B مستقل ساخت+ریست با بدهکاری ۳ خودش ✓

TypeScript بدون خطا · ESLint ۰ خطا · بیلد موفق · رگرسیون ۱.۱: ۱۹/۱۹ · مایگریشن این فاز: هیچ (فقط کد) — اسکیمای قبلی idempotent.

## استقرار production

بکاپ `phase13-*` (`.backup` + integrity ok + image/commit) → تعویض فقط داشبورد → سلامت 200 → **AFTER = BEFORE** (ardalan 512/0/۱؛ Mobin 1024/0/۵؛ ۶ کاربر؛ ۶ subId یکتا؛ ۰ ژورنال فعال) → لاگ بدون خطا → sentinelx-worker (Up ۱۲ روز) و 3x-ui/Xray دست‌نخورده → پل و راهنما زنده.

## ریسک‌های باقی‌مانده

Repair خودکار NEEDS_REPAIR (فعلاً ثبت+قفل+لاگ) · cleanup دوره‌ای ژورنال‌های SUCCESS · قفل درون-پروسه‌ای (تک‌نمونه) · حسابداری GB اعشاری (فاز ۳) · تغییر refs کاربر (attach/detach) هنوز داخل applyRemote است و ژورنال آن plan-level کامل ندارد (per-action جزئی ← فاز ۲).
