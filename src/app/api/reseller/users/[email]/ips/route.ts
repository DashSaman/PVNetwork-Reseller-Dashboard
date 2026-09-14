import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess } from "@/lib/reseller-helpers";
import { getClientIpsAcrossPanels } from "@/lib/panel-manager";

type Ctx = { params: Promise<{ email: string }> };

/** IPهای ثبت‌شده/متصل یک کاربر در پنل‌های ثنایی */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const { email: rawEmail } = await ctx.params;
  const email = decodeURIComponent(rawEmail);

  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  const tracked = await db.resellerUser.findUnique({
    where: { resellerId_email: { resellerId: reseller.id, email } },
  });
  if (!tracked) return NextResponse.json({ error: "کاربر پیدا نشد" }, { status: 404 });

  const r = await getClientIpsAcrossPanels(email);
  return NextResponse.json({ email, ips: r.ips, count: r.ips.length, msg: r.msg || null });
}
