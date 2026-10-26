import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller, sessionExpiry, setDashboardSessionCookie } from "@/lib/session";
import { encryptSecret, decryptSecret, verifyPassword, signAccountSession } from "@/lib/crypto";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "@/lib/totp";
import { logActivity } from "@/lib/logger";

/**
 * ورود دومرحله‌ای (TOTP) نماینده
 * GET               → وضعیت فعلی { totpEnabled }
 * POST action=setup → ساخت رمز جدید + آدرس otpauth
 * POST action=enable { code } → فعال‌سازی
 * DELETE { password } → خاموش‌سازی
 */
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const reseller = await db.reseller.findUnique({ where: { id: session.uid }, select: { totpEnabled: true } });
  if (!reseller) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  return NextResponse.json({ totpEnabled: reseller.totpEnabled });
}

export async function POST(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const body = (await req.json()) as { action?: string; code?: string };
    const reseller = await db.reseller.findUnique({ where: { id: session.uid } });
    if (!reseller) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });

    if (body.action === "setup") {
      if (reseller.totpEnabled) return NextResponse.json({ error: "ابتدا ورود دومرحله‌ای فعلی را با رمز عبور غیرفعال کنید" }, { status: 409 });
      const secret = generateTotpSecret();
      const saved = await db.reseller.updateMany({ where: { id: reseller.id, password: reseller.password, totpSecret: reseller.totpSecret, totpEnabled: false }, data: { totpSecret: encryptSecret(secret) } });
      if (saved.count !== 1) return NextResponse.json({ error: "تنظیمات امنیتی تغییر کرده؛ دوباره وارد شوید" }, { status: 409 });
      const brand = reseller.brandName || "PvNetWork";
      return NextResponse.json({ otpauth: otpauthUrl(secret, reseller.username, brand) });
    }

    if (body.action === "enable") {
      if (!reseller.totpSecret) return NextResponse.json({ error: "ابتدا رمز جدید بسازید" }, { status: 400 });
      const secret = decryptSecret(reseller.totpSecret);
      if (!secret) return NextResponse.json({ error: "رمز ذخیره‌شده خوانده نشد — دوباره بسازید" }, { status: 400 });
      if (!body.code || !verifyTotp(secret, body.code)) {
        return NextResponse.json({ error: "کد ۶ رقمی اشتباه است" }, { status: 400 });
      }
      const saved = await db.reseller.updateMany({ where: { id: reseller.id, password: reseller.password, totpSecret: reseller.totpSecret, totpEnabled: false }, data: { totpEnabled: true } });
      if (saved.count !== 1) return NextResponse.json({ error: "تنظیمات امنیتی تغییر کرده؛ دوباره بررسی کنید" }, { status: 409 });
      await logActivity({ actorType: "RESELLER", actorName: reseller.username, action: "فعال‌سازی ورود دومرحله‌ای", resellerId: reseller.id });
      const res = NextResponse.json({ ok: true });
      setDashboardSessionCookie(res, signAccountSession("RESELLER", { ...reseller, totpEnabled: true }, "dashboard", sessionExpiry()));
      return res;
    }

    return NextResponse.json({ error: "عملیات نامشخص" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "خطای داخلی سرور" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const { password } = (await req.json()) as { password?: string };
    const reseller = await db.reseller.findUnique({ where: { id: session.uid } });
    if (!reseller) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
    if (!password || !verifyPassword(password, reseller.password)) {
      return NextResponse.json({ error: "رمز عبور اشتباه است" }, { status: 403 });
    }
    const saved = await db.reseller.updateMany({ where: { id: reseller.id, password: reseller.password, totpSecret: reseller.totpSecret, totpEnabled: reseller.totpEnabled }, data: { totpSecret: null, totpEnabled: false } });
    if (saved.count !== 1) return NextResponse.json({ error: "تنظیمات امنیتی تغییر کرده؛ دوباره وارد شوید" }, { status: 409 });
    await logActivity({ actorType: "RESELLER", actorName: reseller.username, action: "خاموش‌سازی ورود دومرحله‌ای", resellerId: reseller.id });
    const res = NextResponse.json({ ok: true });
    setDashboardSessionCookie(res, signAccountSession("RESELLER", { ...reseller, totpSecret: null, totpEnabled: false }, "dashboard", sessionExpiry()));
    return res;
  } catch {
    return NextResponse.json({ error: "خطای داخلی سرور" }, { status: 500 });
  }
}
