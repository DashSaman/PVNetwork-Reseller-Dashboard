import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { encryptSecret, decryptSecret, verifyPassword } from "@/lib/crypto";
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
      const secret = generateTotpSecret();
      await db.adminUser.update({ where: { id: admin.id }, data: { totpSecret: encryptSecret(secret), totpEnabled: false } });
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
      await db.adminUser.update({ where: { id: admin.id }, data: { totpEnabled: true } });
      await logActivity({ actorType: "ADMIN", actorName: admin.username, action: "فعال‌سازی ورود دومرحله‌ای" });
      return NextResponse.json({ ok: true });
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
    await db.adminUser.update({ where: { id: admin.id }, data: { totpSecret: null, totpEnabled: false } });
    await logActivity({ actorType: "ADMIN", actorName: admin.username, action: "خاموش‌سازی ورود دومرحله‌ای" });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "خطای داخلی سرور" }, { status: 500 });
  }
}
