import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, signAccountSession, decryptSecret, type SessionAccount } from "@/lib/crypto";
import { SESSION_COOKIE, sessionExpiry, setDashboardSessionCookie } from "@/lib/session";
import { verifyTotp } from "@/lib/totp";
import { logActivity } from "@/lib/logger";
import { isBlocked, recordFailure, clearFailures, clientIp, LIMITS } from "@/lib/rate-limit";

// اطمینان از وجود اکانت ادمین — هیچ رمز عبور پیش‌فرض ثابتی وجود ندارد.
// اگر ADMIN_PASSWORD تنظیم نشده باشد، یک رمز کاملاً تصادفی تولید می‌شود که
// فقط یک‌بار در لاگ سرور چاپ می‌شود (الگوی امن استاندارد، مشابه Grafana/Jenkins).
async function ensureAdmin() {
  const count = await db.adminUser.count();
  if (count === 0) {
    const { hashPassword } = await import("@/lib/crypto");
    const username = process.env.ADMIN_USERNAME || "admin";
    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
      password =
        globalThis.crypto.randomUUID().replace(/-/g, "") +
        globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      console.log("==============================================================");
      console.log("[SECURITY] حساب ادمین با رمز تصادفی ساخته شد — این پیام فقط یک‌بار نمایش داده می‌شود:");
      console.log(`[SECURITY] username: ${username}`);
      console.log(`[SECURITY] password: ${password}`);
      console.log("[SECURITY] آن را در جای امنی ذخیره کنید و این لاگ را حذف کنید.");
      console.log("==============================================================");
    }
    await db.adminUser.create({
      data: { username, password: hashPassword(password) },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const input = await req.json().catch(() => null);
    if (!input || typeof input !== "object" || Array.isArray(input)) return NextResponse.json({ error: "بدنهٔ ورود نامعتبر است" }, { status: 400 });
    const { username, password, totpCode } = input as {
      username?: string;
      password?: string;
      totpCode?: string;
    };
    if (typeof username !== "string" || !username.trim() || username.length > 128
      || typeof password !== "string" || !password || password.length > 4096
      || totpCode !== undefined && (typeof totpCode !== "string" || totpCode.length > 32)) {
      return NextResponse.json({ error: "نام کاربری و رمز عبور الزامی است" }, { status: 400 });
    }
    await ensureAdmin();

    // ---- ضد بشکن: مسدودسازی بر اساس نام کاربری و IP ----
    const ip = clientIp(req);
    const unameKey = `u:${username.trim().toLowerCase()}`;
    const ipKey = `ip:${ip}`;
    for (const [key, limit] of [
      [unameKey, LIMITS.MAX_PER_USERNAME],
      [ipKey, LIMITS.MAX_PER_IP],
    ] as const) {
      const st = isBlocked(key);
      if (st.blocked) {
        void logActivity({
          actorType: "ADMIN",
          actorName: username.trim(),
          action: `تلاش ورود مسدود شد (ضد بشکن) — تا ${st.retryAfterSec}s`,
          detail: `ip=${ip}`,
        });
        return NextResponse.json(
          { error: `تلاش‌های ناموفق زیاد بود. ${Math.ceil((st.retryAfterSec || 0) / 60)} دقیقه دیگر تلاش کنید.` },
          { status: 429 }
        );
      }
      void limit; // حد در recordFailure اعمال می‌شود
    }

    /** صدور نشست مشترک */
    const issue = (role: "ADMIN" | "RESELLER", account: SessionAccount) => {
      const token = signAccountSession(role, account, "dashboard", sessionExpiry());
      const res = NextResponse.json({ role, username: account.username });
      setDashboardSessionCookie(res, token);
      return { res };
    };

    /** گیت دومرحله‌ای — اگر فعال باشد و کد نباشد: need2fa */
    const totpGate = (
      totpEnabled: boolean,
      totpSecret: string | null,
      action: string,
      logCtx: { actorType: "ADMIN" | "RESELLER"; actorName: string; resellerId?: string }
    ): NextResponse | null => {
      if (!totpEnabled) return null;
      if (!totpCode) {
        return NextResponse.json({ need2fa: true }, { status: 200 });
      }
      const secret = totpSecret ? decryptSecret(totpSecret) : "";
      if (!secret || !verifyTotp(secret, totpCode)) {
        recordFailure(unameKey, LIMITS.MAX_PER_USERNAME);
        recordFailure(ipKey, LIMITS.MAX_PER_IP);
        void logActivity({
          ...logCtx,
          action: `${action} — کد دومرحله‌ای اشتباه`,
        });
        return NextResponse.json({ error: "کد ورود دومرحله‌ای اشتباه است", need2fa: true }, { status: 401 });
      }
      return null;
    };

    // بررسی ادمین (تطبیق دقیق + fallback بدون حساسیت به حروف بزرگ/کوچک)
    let admin = await db.adminUser.findUnique({ where: { username: username.trim() } });
    if (!admin) {
      const unameLower = username.trim().toLowerCase();
      const admins = await db.adminUser.findMany();
      admin = admins.find((a) => a.username.toLowerCase() === unameLower) || null;
    }
    if (admin && verifyPassword(password, admin.password)) {
      const gate = totpGate(!!admin.totpEnabled, admin.totpSecret, "ورود ادمین", {
        actorType: "ADMIN",
        actorName: admin.username,
      });
      if (gate) return gate;
      clearFailures(unameKey);
      clearFailures(ipKey);
      const issued = issue("ADMIN", admin);
      await logActivity({ actorType: "ADMIN", actorName: admin.username, action: "ورود ادمین" });
      return issued.res;
    }

    // بررسی نماینده (تطبیق دقیق + fallback بدون حساسیت به حروف بزرگ/کوچک)
    let reseller = await db.reseller.findUnique({ where: { username: username.trim() } });
    if (!reseller) {
      const unameLower = username.trim().toLowerCase();
      const resellers = await db.reseller.findMany();
      reseller = resellers.find((r) => r.username.toLowerCase() === unameLower) || null;
    }
    if (reseller && verifyPassword(password, reseller.password)) {
      if (!reseller.active) {
        return NextResponse.json({ error: "حساب شما غیرفعال شده است. با مدیر تماس بگیرید." }, { status: 403 });
      }
      const gate = totpGate(!!reseller.totpEnabled, reseller.totpSecret, "ورود نماینده", {
        actorType: "RESELLER",
        actorName: reseller.username,
        resellerId: reseller.id,
      });
      if (gate) return gate;
      clearFailures(unameKey);
      clearFailures(ipKey);
      const issued = issue("RESELLER", reseller);
      await logActivity({
        actorType: "RESELLER",
        actorName: reseller.username,
        action: "ورود نماینده",
        resellerId: reseller.id,
      });
      return issued.res;
    }

    // ---- ثبت تلاش ناموفق (ضد بشکن) ----
    const uSt = recordFailure(unameKey, LIMITS.MAX_PER_USERNAME);
    const ipSt = recordFailure(ipKey, LIMITS.MAX_PER_IP);
    const extra = uSt.nowBlocked || ipSt.nowBlocked ? " — دسترسی موقتاً مسدود شد" : "";
    return NextResponse.json(
      { error: "نام کاربری یا رمز عبور اشتباه است" + extra },
      { status: 401 }
    );
  } catch (e) {
    console.error("login error:", e);
    return NextResponse.json({ error: "خطای داخلی سرور" }, { status: 500 });
  }
}
