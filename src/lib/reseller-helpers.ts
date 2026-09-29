export type CanonicalUsage = { upBytes: number; downBytes: number; usedBytes: number };

/**
 * تجمیع کانونی مصرف یک کاربر — تنها مرجع محاسبه در داشبورد، پل و پرتال.
 * داخل هر پنل: یک رکورد برنده (بیشینه up+down — شمارنده یکتای ایمیل که در چند اینباند تکرار نمایش داده می‌شود)
 * بین پنل‌ها: جمع مقادیر برنده.
 */
export function canonicalUserUsage(
  panels: { panelId: string; inbounds: { clientStats: { email: string; up?: number; down?: number }[] }[] }[],
  email: string
): CanonicalUsage {
  let upBytes = 0, downBytes = 0;
  for (const bundle of panels) {
    let winner: { up: number; down: number } | null = null;
    for (const inb of bundle.inbounds) {
      const st = inb.clientStats.find((c) => c.email === email);
      if (st && (st.up || 0) + (st.down || 0) > (winner ? winner.up + winner.down : -1)) {
        winner = { up: st.up || 0, down: st.down || 0 };
      }
    }
    if (winner) { upBytes += winner.up; downBytes += winner.down; }
  }
  return { upBytes, downBytes, usedBytes: upBytes + downBytes };
}

import { db } from "@/lib/db";
import type { Reseller, ResellerInbound } from "@prisma/client";

export type ResellerWithInbounds = Reseller & { inbounds: ResellerInbound[] };

/** ارجاع به یک اینباند در یک پنل مشخص */
export type InboundRef = { panelId: string; inboundId: number };

export async function getResellerWithAccess(uid: string): Promise<ResellerWithInbounds | null> {
  const r = await db.reseller.findUnique({ where: { id: uid }, include: { inbounds: true } });
  return r && r.active ? r : null;
}

export function bytesToGB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100;
}

export function gbToBytes(gb: number): number {
  return Math.round(gb * 1024 * 1024 * 1024);
}

/** پاکسازی نام کاربری برای استفاده به عنوان ایمیل کلاینت (حروف بزرگ/کوچک مجاز) */
export function sanitizeName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

/**
 * اعتبارسنجی نام کاربری: حروف انگلیسی (بزرگ و کوچک)، عدد، خط تیره و آندرلاین.
 * (به درخواست کارفرما، حروف بزرگ هم مجاز شد)
 */
export function validateUsername(name: string): { ok: true } | { ok: false; msg: string } {
  if (!name) return { ok: false, msg: "نام کاربری را وارد کنید" };
  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(name)) {
    return { ok: false, msg: "نام کاربری فقط می‌تواند شامل حروف انگلیسی (بزرگ/کوچک)، عدد، خط تیره (-) و آندرلاین (_) باشد (۲ تا ۳۲ کاراکتر)" };
  }
  return { ok: true };
}

/** خواندن refs اینباندها از JSON — سازگار با فرمت قدیمی (آرایه عددی = پنل اصلی) */
export function parseInboundRefs(json: string, primaryPanelId: string): InboundRef[] {
  try {
    const arr = JSON.parse(json || "[]");
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => {
        if (typeof x === "number") return { panelId: primaryPanelId, inboundId: x };
        if (x && typeof x === "object" && Number.isFinite(Number(x.inboundId))) {
          return { panelId: String(x.panelId || primaryPanelId), inboundId: Number(x.inboundId) };
        }
        return null;
      })
      .filter((x): x is InboundRef => x !== null);
  } catch {
    return [];
  }
}

export function stringifyInboundRefs(refs: InboundRef[]): string {
  return JSON.stringify(refs.map((r) => ({ panelId: r.panelId, inboundId: r.inboundId })));
}

/** کلید یکتای ref برای مقایسه */
export function refKey(r: InboundRef): string {
  return `${r.panelId}::${r.inboundId}`;
}

/**
 * اعتبارسنجی اینباندهای انتخابی نسبت به دسترسی‌های نماینده + قانون مولتی‌لوکیشن.
 * panelId خالی در داده‌های قدیمی به پنل اصلی ترجمه می‌شود.
 * (محدودیت تک‌کاربرِ ادمین حذف شده — نماینده آزاد است، فقط پول ترافیک اعمال می‌شود)
 */
export async function validateInboundSelection(
  reseller: ResellerWithInbounds,
  refs: InboundRef[]
): Promise<{ ok: true } | { ok: false; msg: string }> {
  if (refs.length === 0) {
    return { ok: false, msg: "حداقل یک اینباند (لوکیشن) انتخاب کنید" };
  }
  const { getPrimaryPanel } = await import("./panel-manager");
  const primaryPanelId = (await getPrimaryPanel())?.id || "";
  const allowed = new Set(
    reseller.inbounds.map((i) => refKey({ panelId: i.panelId || primaryPanelId, inboundId: i.inboundId }))
  );
  for (const ref of refs) {
    if (!allowed.has(refKey(ref))) {
      return { ok: false, msg: "شما به این اینباند دسترسی ندارید" };
    }
  }
  if (!reseller.multiLocation) {
    const distinct = new Set(refs.map(refKey));
    if (distinct.size > 1) {
      return { ok: false, msg: "حساب شما اجازه مولتی‌لوکیشن (چند اینباند برای یک کاربر) ندارد" };
    }
  }
  return { ok: true };
}

/** جمع سهمیه تخصیص‌یافته به کاربران فعال نماینده (به گیگ) */
export async function getAllocatedGB(resellerId: string, excludeUserId?: string): Promise<number> {
  const rows = await db.resellerUser.findMany({
    where: { resellerId, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { trafficGB: true },
  });
  return rows.reduce((s, r) => s + (r.trafficGB || 0), 0);
}

/** مصرف قطعی ثبت‌شده (کاربران حذف/ریست‌شده) — با حذف کاربر آزاد نمی‌شود */
export async function getConsumedGB(resellerId: string): Promise<number> {
  const r = await db.reseller.findUnique({ where: { id: resellerId }, select: { consumedGB: true } });
  return Number(r?.consumedGB || 0);
}

// ---------- قفل اتمیک سهمیه (Phase 1) ----------
// یک نمونه اپ (تک‌کانتینر) — ترتیب‌دهی check-then-act برای جلوگیری از race دو درخواست همزمان.
// نکته: عملیات واقعی نوشتن SQLite خودش سریال است؛ این قفل فاصلهٔ «بررسی ← نوشتن» را اتمیک می‌کند.
type LockStore = Map<string, Promise<unknown>>;
const lockStore: LockStore = ((globalThis as { __pvnetQuotaLocks?: LockStore }).__pvnetQuotaLocks ??= new Map());

export async function withResellerLock<T>(resellerId: string, fn: () => Promise<T>): Promise<T> {
  const prev = lockStore.get(resellerId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  lockStore.set(resellerId, run);
  try {
    return await run;
  } finally {
    if (lockStore.get(resellerId) === run) lockStore.delete(resellerId);
  }
}

/** باقیماندهٔ مؤثر = پول − تخصیص فعال − رزروهای فعال CREATE − مصرف قطعی (محاسبهٔ مرجع همهٔ مسیرها) */
export async function getEffectiveRemainingGB(reseller: { id: string; trafficPoolGB: number }): Promise<number> {
  if (reseller.trafficPoolGB <= 0) return 0;
  const { getAllocatedGB, getConsumedGB } = await import("./reseller-helpers");
  const { getActiveReservationsGB } = await import("./accounting-ops");
  const [allocated, consumed, reserved] = await Promise.all([
    getAllocatedGB(reseller.id),
    getConsumedGB(reseller.id),
    getActiveReservationsGB(reseller.id),
  ]);
  return Math.max(0, reseller.trafficPoolGB - allocated - reserved - consumed);
}

/** باقیمانده واقعی پول = پول − تخصیص فعال − مصرف قطعی (۰ = بی‌نهایت برای پول نامحدود) */
export async function getRemainingGB(reseller: { id: string; trafficPoolGB: number }): Promise<number> {
  if (reseller.trafficPoolGB <= 0) return 0;
  const [allocated, consumed] = await Promise.all([getAllocatedGB(reseller.id), getConsumedGB(reseller.id)]);
  return Math.max(0, reseller.trafficPoolGB - allocated - consumed);
}

/**
 * محاسبهٔ کانونی برای همهٔ ایمیل‌های snapshot — نسخهٔ bulk همان منطق تک‌منبع
 * (برندهٔ هر پنل = رکورد با بیشینهٔ up+down؛ بین پنل‌ها جمع برنده‌ها)
 */
export function canonicalUsageByEmail(
  panels: { panelId: string; inbounds: { clientStats: { email: string; up?: number; down?: number }[] }[] }[]
): Map<string, CanonicalUsage> {
  const winners = new Map<string, { up: number; down: number }>();
  for (const bundle of panels) {
    for (const inb of bundle.inbounds) {
      for (const st of inb.clientStats) {
        const cur = { up: st.up || 0, down: st.down || 0 };
        const prev = winners.get(st.email);
        if (!prev || cur.up + cur.down > prev.up + prev.down) winners.set(st.email, cur);
      }
    }
  }
  const out = new Map<string, CanonicalUsage>();
  for (const [email, v] of winners) out.set(email, { upBytes: v.up, downBytes: v.down, usedBytes: v.up + v.down });
  return out;
}

/**
 * اعتبارسنجی تخصیص از پول ترافیک:
 * - پول نامحدود (0) → هر مقداری مجاز (شامل ۰ = نامحدود برای کاربر)
 * - پول محدود → سهمیه کاربر باید صریح و داخل باقیمانده پول باشد
 *   باقیمانده = پول − تخصیص فعال + سهمیه خودِ همین کاربر (در ویرایش) − مصرف قطعی (حذف/ریست‌شده)
 */
export function validatePoolAllocation(
  poolGB: number,
  allocatedGB: number,
  requestedGB: number,
  currentOwnGB = 0, // در ویرایش، سهمیه فعلی همین کاربر (که آزاد می‌شود)
  consumedGB = 0 // مصرف قطعی ثبت‌شده — با حذف کاربر به پول برنمی‌گردد
): { ok: true } | { ok: false; msg: string } {
  if (poolGB <= 0) return { ok: true }; // پول نامحدود
  if (requestedGB <= 0) {
    return { ok: false, msg: "پول ترافیک شما محدود است — برای هر کاربر باید سهمیه مشخص تعیین کنید (۰ = نامحدود مجاز نیست)" };
  }
  const remaining = poolGB - allocatedGB + currentOwnGB - consumedGB;
  if (requestedGB > remaining) {
    return {
      ok: false,
      msg: `پول ترافیک کافی نیست — باقیمانده پول شما: ${Math.max(0, Math.round(remaining * 100) / 100)} گیگ (درخواست: ${requestedGB} گیگ)`,
    };
  }
  return { ok: true };
}

/** تبدیل تاریخ انتخابی به timestamp انقضا (پایان روز) */
export function expiryDateToTimestamp(dateStr: string): number {
  const d = new Date(dateStr + "T23:59:59");
  return d.getTime();
}

export function timestampToDaysLeft(expiryTime: number): number {
  const diff = expiryTime - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
