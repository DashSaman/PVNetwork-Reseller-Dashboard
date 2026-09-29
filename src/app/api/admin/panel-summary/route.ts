import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { getAllPanelInboundsForUi } from "@/lib/panel-manager";

/**
 * Live panel summary — with short UI deadline (3s).
 * Admin overview returns local data immediately; this endpoint supplies live panel status separately.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const snapshot = await getAllPanelInboundsForUi();
  const GIB = 1024 * 1024 * 1024;
  let totalClients = 0;
  let totalUp = 0;
  let totalDown = 0;
  const inboundSummaries: { panelName: string; tag: string; clients: number; upGB: number; downGB: number }[] = [];

  for (const bundle of snapshot.panels) {
    for (const inb of bundle.inbounds) {
      totalClients += inb.clients.length;
      totalUp += inb.up;
      totalDown += inb.down;
      inboundSummaries.push({
        panelName: bundle.panelName,
        tag: inb.remark || inb.tag,
        clients: inb.clients.length,
        upGB: Math.round((inb.up / GIB) * 100) / 100,
        downGB: Math.round((inb.down / GIB) * 100) / 100,
      });
    }
  }

  return NextResponse.json({
    panel: {
      connected: snapshot.ok,
      panelsCount: snapshot.panels.length,
      inbounds: inboundSummaries.length,
      clients: totalClients,
      totalUp,
      totalDown,
    },
    trafficByInbound: inboundSummaries,
    panelErrors: snapshot.errors.length ? snapshot.errors : undefined,
  });
}
