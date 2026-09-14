import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getPanelConnection } from "@/lib/panel-manager";
import { getResellerWithAccess } from "@/lib/reseller-helpers";
import { resetClientTraffic, type PanelAuth } from "@/lib/panel";
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

    // ریست روی همه پنل‌ها (کاربر می‌تواند بین پنل‌ها مشترک باشد)
    const panels = await db.panelConfig.findMany({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
    let anyOk = false;
    const errors: string[] = [];
    for (const panel of panels) {
      const conn = await getPanelConnection(panel.id);
      if (!conn.ok) continue;
      const r = await resetClientTraffic(conn.conn as PanelAuth, email);
      if (r.ok) anyOk = true;
    }
    if (!anyOk) {
      const conn = await getPanelConnection(panels[0]?.id);
      if (!conn.ok) return NextResponse.json({ error: conn.msg }, { status: 502 });
      const r = await resetClientTraffic(conn.conn as PanelAuth, email);
      if (!r.ok) errors.push(r.msg || "ریست ناموفق بود");
    }
    if (errors.length) {
      return NextResponse.json({ error: `ریست ترافیک ناموفق بود: ${errors.join(" | ")}` }, { status: 502 });
    }

    await logActivity({
      actorType: "RESELLER",
      actorName: reseller.username,
      action: "ریست ترافیک کاربر",
      detail: email,
      resellerId: reseller.id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("reset traffic error:", e);
    return NextResponse.json({ error: "خطای داخلی در ریست ترافیک" }, { status: 500 });
  }
}
