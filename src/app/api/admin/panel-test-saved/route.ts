import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { getAllPanelInbounds } from "@/lib/panel-manager";

/** تست اتصال همه پنل‌های ذخیره‌شده در دیتابیس */
export async function POST() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const r = await getAllPanelInbounds();
  if (!r.ok) return NextResponse.json({ ok: false, msg: r.msg || "هیچ پنلی در دسترس نیست" });

  const totalInbounds = r.panels.reduce((s, p) => s + p.inbounds.length, 0);
  const okNames = r.panels.map((p) => p.panelName).join("، ");
  let msg = `اتصال موفق! ${r.panels.length} پنل و ${totalInbounds} اینباند دریافت شد (${okNames}).`;
  if (r.errors.length) {
    const bad = r.errors.map((e) => `${e.panelName}: ${e.msg}`).join(" | ");
    msg += ` هشدار — پنل‌های قطع: ${bad}`;
  }
  return NextResponse.json({ ok: true, msg });
}
