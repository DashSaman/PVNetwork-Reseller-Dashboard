import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { hashPassword, verifyPassword, signSession } from "@/lib/crypto";
import { SESSION_COOKIE, sessionExpiry } from "@/lib/session";
import { logActivity } from "@/lib/logger";

/**
 * حساب مدیر اصلی — تغییر نام کاربری و رمز عبور
 * POST { currentPassword, newUsername?, newPassword? }
 * برای امنیت، رمز فعلی الزامی است. پس از تغییر، نشست جدید صادر می‌شود.
 */
export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const body = (await req.json()) as { currentPassword?: string; newUsername?: string; newPassword?: string };
    const currentPassword = (body.currentPassword || "").trim();
    const newUsername = (body.newUsername || "").trim();
    const newPassword = body.newPassword || "";

    if (!currentPassword) {
      return NextResponse.json({ error: "رمز عبور فعلی الزامی است" }, { status: 400 });
    }
    if (!newUsername && !newPassword) {
      return NextResponse.json({ error: "حداقل یکی از نام کاربری یا رمز جدید را وارد کنید" }, { status: 400 });
    }

    const admin = await db.adminUser.findUnique({ where: { id: session.uid } });
    if (!admin) return NextResponse.json({ error: "حساب ادمین یافت نشد" }, { status: 404 });

    if (!verifyPassword(currentPassword, admin.password)) {
      await logActivity({
        actorType: "ADMIN",
        actorName: admin.username,
        action: "تلاش ناموفق تغییر حساب — رمز فعلی اشتباه",
      });
      return NextResponse.json({ error: "رمز عبور فعلی اشتباه است" }, { status: 403 });
    }

    // ---- اعتبارسنجی نام کاربری جدید ----
    let username = admin.username;
    if (newUsername && newUsername !== admin.username) {
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(newUsername)) {
        return NextResponse.json(
          { error: "نام کاربری: ۳ تا ۳۲ کاراکتر — فقط حروف انگلیسی، عدد، نقطه، خط تیره و آندرلاین" },
          { status: 400 }
        );
      }
      const taken = await db.adminUser.findFirst({
        where: { id: { not: admin.id } },
      });
      if (taken && taken.username.toLowerCase() === newUsername.toLowerCase()) {
        return NextResponse.json({ error: "این نام کاربری قبلاً گرفته شده است" }, { status: 409 });
      }
      username = newUsername;
    }

    // ---- اعتبارسنجی رمز جدید ----
    let password = admin.password;
    if (newPassword) {
      if (newPassword.length < 6) {
        return NextResponse.json({ error: "رمز جدید باید حداقل ۶ کاراکتر باشد" }, { status: 400 });
      }
      if (verifyPassword(newPassword, admin.password)) {
        return NextResponse.json({ error: "رمز جدید نباید با رمز فعلی یکسان باشد" }, { status: 400 });
      }
      password = hashPassword(newPassword);
    }

    await db.adminUser.update({ where: { id: admin.id }, data: { username, password } });
    const detailBits: string[] = [];
    if (username !== admin.username) detailBits.push(`نام کاربری: ${admin.username} → ${username}`);
    if (newPassword) detailBits.push("رمز عبور تغییر کرد");
    await logActivity({ actorType: "ADMIN", actorName: username, action: "تغییر حساب مدیر", detail: detailBits.join(" | ") });

    // صدور نشست تازه (نام کاربری ممکن است عوض شده باشد)
    const token = signSession({ role: "ADMIN", uid: admin.id, username, exp: sessionExpiry() });
    const res = NextResponse.json({ ok: true, username });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
    return res;
  } catch (e) {
    console.error("admin account error:", e);
    return NextResponse.json({ error: "خطای داخلی سرور" }, { status: 500 });
  }
}
