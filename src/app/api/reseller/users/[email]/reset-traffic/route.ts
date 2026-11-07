import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess } from "@/lib/reseller-helpers";
import { resetUserByJournal, cancelUnstartedReset } from "@/lib/accounting-ops";

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
    const result = await resetUserByJournal(reseller.id, email);
    if (!result.ok) {
      return NextResponse.json({ error: result.msg, partial: result.partial === true }, { status: result.status });
    }
    return NextResponse.json({ ok: true, debitedGB: result.debitedGB, pending: result.pending === true, message: result.message }, { status: result.pending ? 202 : 200 });
  } catch (e) {
    console.error("reset traffic error:", e);
    return NextResponse.json({ error: "خطای داخلی در ریست ترافیک" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  try {
    const input = await req.json().catch(() => null);
    if (!input || typeof input.operationId !== 'string' || !input.operationId.trim() || input.operationId.length > 100) return NextResponse.json({ error: 'شناسهٔ دقیق درخواست ریست لازم است' }, { status: 400 });
    const { email } = await ctx.params;
    const result = await cancelUnstartedReset(session.uid, decodeURIComponent(email), input.operationId);
    return result.ok
      ? NextResponse.json({ ok: true, message: result.message })
      : NextResponse.json({ error: result.msg }, { status: result.status });
  } catch (error) {
    console.error('cancel unstarted reset:', error);
    return NextResponse.json({ error: 'لغو ریست تأیید نشد؛ صفحه را به‌روزرسانی کنید' }, { status: 500 });
  }
}
