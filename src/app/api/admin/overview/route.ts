import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { getAllPanelInbounds } from "@/lib/panel-manager";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const [resellers, users, logs, panel] = await Promise.all([
    db.reseller.count(),
    db.resellerUser.count(),
    db.activityLog.count(),
    getAllPanelInbounds().catch(() => ({ ok: false as const, msg: "پنل در دسترس نیست", panels: [], errors: [] })),
  ]);

  const activeResellers = await db.reseller.count({ where: { active: true } });

  let panelInfo: {
    connected: boolean;
    inbounds: number;
    clients: number;
    totalUp: number;
    totalDown: number;
    panelsCount: number;
  } = { connected: false, inbounds: 0, clients: 0, totalUp: 0, totalDown: 0, panelsCount: 0 };

  // داده نمودارها
  const trafficByInbound: { tag: string; usedGB: number }[] = [];
  const usersPerInbound: { tag: string; users: number }[] = [];

  if (panel.ok) {
    const multiPanel = panel.panels.length > 1;
    let clients = 0;
    let totalUp = 0;
    let totalDown = 0;
    let inboundsCount = 0;
    for (const bundle of panel.panels) {
      for (const i of bundle.inbounds) {
        clients += i.clients.length;
        totalUp += i.up || 0;
        totalDown += i.down || 0;
        inboundsCount++;
        const usedBytes = (i.up || 0) + (i.down || 0);
        const tag = multiPanel ? `${bundle.panelName} · ${i.remark || i.tag}` : i.remark || i.tag;
        if (i.clients.length > 0 || usedBytes > 0) {
          trafficByInbound.push({ tag, usedGB: Math.round((usedBytes / 1073741824) * 100) / 100 });
          usersPerInbound.push({ tag, users: i.clients.length });
        }
      }
    }
    panelInfo = { connected: true, inbounds: inboundsCount, clients, totalUp, totalDown, panelsCount: panel.panels.length };
  }

  // روند ساخت کاربران در ۱۴ روز گذشته
  const since = new Date(Date.now() - 13 * 86400000);
  since.setHours(0, 0, 0, 0);
  const recentUsers = await db.resellerUser.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true },
  });
  const dayMap = new Map<string, number>();
  for (let d = 0; d < 14; d++) {
    const dt = new Date(since.getTime() + d * 86400000);
    dayMap.set(dt.toISOString().slice(0, 10), 0);
  }
  for (const u of recentUsers) {
    const key = new Date(u.createdAt).toISOString().slice(0, 10);
    if (dayMap.has(key)) dayMap.set(key, (dayMap.get(key) || 0) + 1);
  }
  const usersSeries = Array.from(dayMap.entries()).map(([date, count]) => {
    const label = new Intl.DateTimeFormat("fa-IR", { month: "short", day: "numeric" }).format(new Date(date));
    return { date, label, count };
  });

  // تفکیک کاربران به تفکیک نماینده
  const resellersData = await db.reseller.findMany({
    select: { username: true, name: true, _count: { select: { users: true } } },
  });
  const resellersBreakdown = resellersData
    .map((r) => ({ name: r.name || r.username, users: r._count.users }))
    .sort((a, b) => b.users - a.users)
    .slice(0, 8);

  const recentLogs = await db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 });

  return NextResponse.json({
    stats: { resellers, activeResellers, users, logs, panel: panelInfo },
    recentLogs,
    charts: { usersSeries, resellersBreakdown, trafficByInbound, usersPerInbound },
  });
}
