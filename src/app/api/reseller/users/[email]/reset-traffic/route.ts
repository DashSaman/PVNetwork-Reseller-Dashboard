import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess } from "@/lib/reseller-helpers";
import { resetUserByJournal } from "@/lib/accounting-ops";
import { logActivity } from "@/lib/logger";

type Ctx = { params: Promise<{ email: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const { email: rawEmail } = await ctx.params;
  const email = decodeURIComponent(rawEmail);

  try {
    const reseller = await getResellerWithAccess(session.uid);
    if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

    const tracked = await db.resellerUser.findUnique({
      where: { resellerId_email: { resellerId: reseller.id, email } },
    });
    if (!tracked) return NextResponse.json({ error: "کاربر پیدا نشد" }, { status: 404 });

    // ریست از طریق سرویس متمرکز ژورنال‌دار (مشترک با پل ربات) — fail-closed و بدهکاری یک‌باره
    const result = await resetUserByJournal(reseller, tracked, reseller.username);
    if (!result.ok) {
      return NextResponse.json({ error: result.msg, partial: result.partial === true }, { status: result.status });
    }
    return NextResponse.json({ ok: true, debitedGB: result.debitedGB });
  } catch (e) {
    console.error("reset traffic error:", e);
    return NextResponse.json({ error: "خطای داخلی در ریست ترافیک" }, { status: 500 });
  }
}
