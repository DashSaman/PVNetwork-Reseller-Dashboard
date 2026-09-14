import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { logActivity } from "@/lib/logger";

/** تغییر رمز عبور نماینده — POST { currentPassword, newPassword } */
export async function POST(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const { currentPassword, newPassword } = (await req.json()) as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "رمز فعلی و رمز جدید الزامی است" }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: "رمز جدید باید حداقل ۶ کاراکتر باشد" }, { status: 400 });
    }
    const reseller = await db.reseller.findUnique({ where: { id: session.uid } });
    if (!reseller) return NextResponse.json({ error: "حساب یافت نشد" }, { status: 404 });
    if (!verifyPassword(currentPassword, reseller.password)) {
      return NextResponse.json({ error: "رمز عبور فعلی اشتباه است" }, { status: 403 });
    }
    if (verifyPassword(newPassword, reseller.password)) {
      return NextResponse.json({ error: "رمز جدید نباید با رمز فعلی یکسان باشد" }, { status: 400 });
    }
    await db.reseller.update({ where: { id: reseller.id }, data: { password: hashPassword(newPassword) } });
    await logActivity({
      actorType: "RESELLER",
      actorName: reseller.username,
      action: "تغییر رمز عبور",
      resellerId: reseller.id,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "خطای داخلی سرور" }, { status: 500 });
  }
}
