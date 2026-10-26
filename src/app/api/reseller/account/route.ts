import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller, sessionExpiry, setDashboardSessionCookie } from "@/lib/session";
import { hashPassword, verifyPassword, signAccountSession } from "@/lib/crypto";
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
    const password = hashPassword(newPassword);
    const saved = await db.reseller.updateMany({ where: { id: reseller.id, password: reseller.password, totpSecret: reseller.totpSecret, totpEnabled: reseller.totpEnabled, active: true }, data: { password } });
    if (saved.count !== 1) return NextResponse.json({ error: "حساب هنگام ویرایش تغییر کرده؛ دوباره وارد شوید" }, { status: 409 });
    await logActivity({
      actorType: "RESELLER",
      actorName: reseller.username,
      action: "تغییر رمز عبور",
      resellerId: reseller.id,
    });
    const res = NextResponse.json({ ok: true });
    setDashboardSessionCookie(res, signAccountSession("RESELLER", { ...reseller, password }, "dashboard", sessionExpiry()));
    return res;
  } catch {
    return NextResponse.json({ error: "خطای داخلی سرور" }, { status: 500 });
  }
}
