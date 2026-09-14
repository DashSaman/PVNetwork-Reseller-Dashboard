/**
 * محدودکننده نرخ ورود (ضد بشکن) — درون‌حافظه‌ای، پنجره لغزان
 * برای استقرار تک‌نمونه‌ای پنل کافی است؛ کلیدها: «نام‌کاربری» و «IP»
 */

type Bucket = { hits: number[]; blockedUntil?: number };

const MAX_PER_USERNAME = 10; // حداکثر خطای رمز برای هر نام کاربری
const MAX_PER_IP = 30; // حداکثر خطای رمز برای هر IP (حمله روی همه نام‌ها)
const WINDOW_MS = 15 * 60 * 1000; // پنجره ۱۵ دقیقه‌ای
const BLOCK_MS = 15 * 60 * 1000; // مدت مسدودسازی

const store = (() => {
  const g = globalThis as unknown as { __pvnetRateLimit?: Map<string, Bucket> };
  if (!g.__pvnetRateLimit) g.__pvnetRateLimit = new Map();
  return g.__pvnetRateLimit;
})();

function prune(bucket: Bucket, now: number) {
  bucket.hits = bucket.hits.filter((t) => now - t < WINDOW_MS);
}

/** آیا این کلید مسدود است؟ */
export function isBlocked(key: string): { blocked: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const bucket = store.get(key);
  if (!bucket) return { blocked: false };
  prune(bucket, now);
  if (bucket.blockedUntil && bucket.blockedUntil > now) {
    return { blocked: true, retryAfterSec: Math.ceil((bucket.blockedUntil - now) / 1000) };
  }
  if (bucket.blockedUntil && bucket.blockedUntil <= now) {
    bucket.blockedUntil = undefined;
    bucket.hits = [];
  }
  return { blocked: false };
}

/** ثبت یک تلاش ناموفق — در صورت عبور از حد، مسدودسازی فعال می‌شود */
export function recordFailure(key: string, max: number): { nowBlocked: boolean } {
  const now = Date.now();
  let bucket = store.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    store.set(key, bucket);
  }
  prune(bucket, now);
  bucket.hits.push(now);
  if (bucket.hits.length >= max) {
    bucket.blockedUntil = now + BLOCK_MS;
    bucket.hits = [];
    return { nowBlocked: true };
  }
  return { nowBlocked: false };
}

/** پاک‌سازی خطاهای یک کلید (پس از ورود موفق) */
export function clearFailures(key: string) {
  store.delete(key);
}

/** استخراج IP واقعی از هدرها (پشت Caddy) */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export const LIMITS = { MAX_PER_USERNAME, MAX_PER_IP, WINDOW_MS, BLOCK_MS };
