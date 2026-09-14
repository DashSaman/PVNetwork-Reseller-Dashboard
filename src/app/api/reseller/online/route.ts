import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess } from "@/lib/reseller-helpers";
import { getOnlineAcrossPanels } from "@/lib/panel-manager";

/** کاربران آنلاین لحظه‌ای این نماینده (اجتماع همه پنل‌ها) */
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  const tracked = await db.resellerUser.findMany({
    where: { resellerId: reseller.id },
    select: { email: true },
  });
  const trackedSet = new Set(tracked.map((t) => t.email));

  const r = await getOnlineAcrossPanels();
  const online = r.online.filter((e) => trackedSet.has(e));

  return NextResponse.json({
    ok: true,
    online,
    onlineCount: online.length,
    totalUsers: tracked.length,
    panelErrors: r.ok ? [] : r.errors,
  });
}
