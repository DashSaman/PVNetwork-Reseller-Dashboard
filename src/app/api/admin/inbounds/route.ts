import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { getAllPanelInbounds } from "@/lib/panel-manager";

/** لیست اینباندهای همه پنل‌ها (برای ادمین) — هر اینباند با panelId و نام پنل */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const r = await getAllPanelInbounds();
  if (!r.ok) return NextResponse.json({ error: r.msg || "هیچ پنلی در دسترس نیست" }, { status: 502 });

  const inbounds = r.panels.flatMap((p) =>
    p.inbounds.map((i) => ({
      inboundId: i.id,
      panelId: p.panelId,
      panelName: p.panelName,
      tag: i.tag,
      remark: i.remark,
      protocol: i.protocol,
      port: i.port,
      clientsCount: i.clients.length,
    }))
  );
  const panelErrors = r.errors.length ? r.errors : undefined;

  return NextResponse.json({ inbounds, panelErrors });
}
