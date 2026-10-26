import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, sessionExpiry, setDashboardSessionCookie } from "@/lib/session";
import { encryptSecret, decryptSecret, verifyPassword, signAccountSession } from "@/lib/crypto";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "@/lib/totp";
import { getSystemBrand } from "@/lib/whitelabel";
import { logActivity } from "@/lib/logger";

/**
 * ورود دومرحله‌ای (TOTP) ادمین
 * GET               → وضعیت فعلی { totpEnabled }
 * POST action=setup → ساخت رمز جدید + آدرس otpauth (تا فعال‌سازی غیرفعال می‌ماند)
 * POST action=enable { code } → فعال‌سازی با تأیید کد
 * DELETE { password } → خاموش‌سازی (رمز فعلی الزامی)
 */
export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const admin = await db.adminUser.findUnique({ where: { id: session.uid }, select: { totpEnabled: true } });
  if (!admin) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  return NextResponse.json({ totpEnabled: admin.totpEnabled });
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const body = (await req.json()) as { action?: string; code?: string };
    const admin = await db.adminUser.findUnique({ where: { id: session.uid } });
    if (!admin) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });

    if (body.action === "setup") {
      if (admin.totpEnabled) return NextResponse.json({ error: "ابتدا ورود دومرحله‌ای فعلی را با رمز عبور غیرفعال کنید" }, { status: 409 });
      const secret = generateTotpSecret();
      const saved = await db.adminUser.updateMany({ where: { id: admin.id, password: admin.password, totpSecret: admin.totpSecret, totpEnabled: false }, data: { totpSecret: encryptSecret(secret) } });
      if (saved.count !== 1) return NextResponse.json({ error: "تنظیمات امنیتی تغییر کرده؛ دوباره وارد شوید" }, { status: 409 });
      const issuer = await getSystemBrand();
      return NextResponse.json({ otpauth: otpauthUrl(secret, admin.username, issuer) });
    }

    if (body.action === "enable") {
      if (!admin.totpSecret) return NextResponse.json({ error: "ابتدا رمز جدید بسازید" }, { status: 400 });
      const secret = decryptSecret(admin.totpSecret);
      if (!secret) return NextResponse.json({ error: "رمز ذخیره‌شده خوانده نشد — دوباره بسازید" }, { status: 400 });
      if (!body.code || !verifyTotp(secret, body.code)) {
        return NextResponse.json({ error: "کد ۶ رقمی اشتباه است" }, { status: 400 });
      }
      const saved = await db.adminUser.updateMany({ where: { id: admin.id, password: admin.password, totpSecret: admin.totpSecret, totpEnabled: false }, data: { totpEnabled: true } });
      if (saved.count !== 1) return NextResponse.json({ error: "تنظیمات امنیتی تغییر کرده؛ دوباره بررسی کنید" }, { status: 409 });
      await logActivity({ actorType: "ADMIN", actorName: admin.username, action: "فعال‌سازی ورود دومرحله‌ای" });
      const res = NextResponse.json({ ok: true });
      setDashboardSessionCookie(res, signAccountSession("ADMIN", { ...admin, totpEnabled: true }, "dashboard", sessionExpiry()));
      return res;
    }

    return NextResponse.json({ error: "عملیات نامشخص" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "خطای داخلی سرور" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const { password } = (await req.json()) as { password?: string };
    const admin = await db.adminUser.findUnique({ where: { id: session.uid } });
    if (!admin) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
    if (!password || !verifyPassword(password, admin.password)) {
      return NextResponse.json({ error: "رمز عبور اشتباه است" }, { status: 403 });
    }
    const saved = await db.adminUser.updateMany({ where: { id: admin.id, password: admin.password, totpSecret: admin.totpSecret, totpEnabled: admin.totpEnabled }, data: { totpSecret: null, totpEnabled: false } });
    if (saved.count !== 1) return NextResponse.json({ error: "تنظیمات امنیتی تغییر کرده؛ دوباره وارد شوید" }, { status: 409 });
    await logActivity({ actorType: "ADMIN", actorName: admin.username, action: "خاموش‌سازی ورود دومرحله‌ای" });
    const res = NextResponse.json({ ok: true });
    setDashboardSessionCookie(res, signAccountSession("ADMIN", { ...admin, totpSecret: null, totpEnabled: false }, "dashboard", sessionExpiry()));
    return res;
  } catch {
    return NextResponse.json({ error: "خطای داخلی سرور" }, { status: 500 });
  }
}
