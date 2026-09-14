import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/session";
import { getAllPanels, getPanelConnection } from "@/lib/panel-manager";
import { getServerStatus } from "@/lib/panel";

/**
 * سرعت لحظه‌ای شبکه و منابع سرور (سریع‌ترین پنل پاسخ‌ده — netIO از 3x-ui)
 * UI هر ۳ ثانیه poll می‌کند.
 */
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const panels = await getAllPanels();
    for (const p of panels) {
      if (!p.active) continue;
      const conn = await getPanelConnection(p.id);
      if (!conn.ok) continue;
      const r = await getServerStatus(conn.conn);
      if (r.ok && r.data) {
        return NextResponse.json({
          ok: true,
          up: r.data.up, // بایت/ثانیه
          down: r.data.down,
          cpu: r.data.cpu,
          memUsed: r.data.memUsed,
          memTotal: r.data.memTotal,
          tcpCount: r.data.tcpCount,
          xrayRunning: r.data.xrayRunning,
        });
      }
    }
    return NextResponse.json({ error: "هیچ پنلی در دسترس نیست" }, { status: 502 });
  } catch {
    return NextResponse.json({ error: "خطای داخلی سرور" }, { status: 500 });
  }
}
