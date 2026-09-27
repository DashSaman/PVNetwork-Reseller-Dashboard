import { db } from "@/lib/db";
import { signSession, verifySession } from "./crypto";
import type { NextRequest } from "next/server";
import type { ResellerWithInbounds } from "./reseller-helpers";

/**
 * پل 3x-ui — اتصال ربات میرزا (یا هر ربات سازگار با 3x-ui) به همین داشبورد برای فروش.
 * ربات با نام کاربری/رمز خودِ نماینده وارد می‌شود و به همان اینباندها و سقف پول ترافیک
 * داشبورد محدود است؛ همه ساخت‌ها از createResellerUserCore عبور می‌کنند (قوانین یکسان).
 */

export const BRIDGE_COOKIE = "pv_bridge";
const BRIDGE_TTL = 1000 * 60 * 60 * 24; // ۲۴ ساعت

export function bridgeCookiePath(username: string): string {
  return `/api/bridge/${encodeURIComponent(username)}`;
}

/** صدور توکن نشست پل — همان امضای نشست داشبورد با نقش RESELLER */
export function issueBridgeToken(reseller: { id: string; username: string }): string {
  return signSession({ role: "RESELLER", uid: reseller.id, username: reseller.username, exp: Date.now() + BRIDGE_TTL });
}

/** نشست پل را از کوکی یا Bearer استخراج و اعتبارسنجی می‌کند (مطابقت با username مسیر) */
export async function getBridgeReseller(
  req: NextRequest,
  username: string
): Promise<{ ok: true; reseller: ResellerWithInbounds } | { ok: false; error: string }> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const payload = verifySession(bearer || req.cookies.get(BRIDGE_COOKIE)?.value);
  if (!payload || payload.role !== "RESELLER") {
    return { ok: false, error: "نشست معتبر نیست — دوباره وارد شوید" };
  }
  if (payload.username.toLowerCase() !== username.toLowerCase()) {
    return { ok: false, error: "نشست با این حساب مطابقت ندارد" };
  }
  const reseller = await db.reseller.findUnique({ where: { id: payload.uid }, include: { inbounds: true } });
  if (!reseller || !reseller.active) {
    return { ok: false, error: "حساب غیرفعال است" };
  }
  if (!reseller.mirzaEnabled) {
    return { ok: false, error: "اتصال ربات برای این حساب فعال نشده است — از تنظیمات حساب فعال کنید" };
  }
  return { ok: true, reseller: reseller as ResellerWithInbounds };
}

/** پاسخ استاندارد 3x-ui */
export function xui(ok: boolean, msg: string, obj?: unknown): Response {
  return Response.json({ success: ok, msg, ...(obj !== undefined ? { obj } : {}) }, { status: ok ? 200 : 400 });
}

/** تبدیل فرم/urlencoded/JSON بدنه به رکورد */
export async function parseBody(req: NextRequest): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") || "";
  try {
    if (type.includes("application/json")) {
      const j = (await req.json()) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? "")]));
    }
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text));
  } catch {
    return {};
  }
}
