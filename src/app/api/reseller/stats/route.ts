import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess, getAllocatedGB, bytesToGB } from "@/lib/reseller-helpers";
import { getAllPanelInbounds } from "@/lib/panel-manager";

/** آمار کلی نماینده + داده‌های نمودارها (چندپنلی + پول ترافیک) */
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  const usersCount = await db.resellerUser.count({ where: { resellerId: reseller.id } });
  const allocatedGB = await getAllocatedGB(reseller.id);
  const primaryPanel = await db.panelConfig.findFirst({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
  const primaryPanelId = primaryPanel?.id || "";

  const panelResult = await getAllPanelInbounds().catch(() => ({ ok: false as const, msg: "", panels: [], errors: [] }));

  let activeUsers = 0;
  let expiredUsers = 0;
  let disabledUsers = 0;
  let totalUsedGB = 0;
  let totalQuotaGB = 0;

  const trafficByInbound: { tag: string; usedGB: number; totalGB: number }[] = [];
  const topUsers: { email: string; name: string | null; usedGB: number; totalGB: number }[] = [];
  const usersPerInbound: { tag: string; users: number }[] = [];

  if (panelResult.ok) {
    const tracked = await db.resellerUser.findMany({ where: { resellerId: reseller.id } });
    const trackedMap = new Map(tracked.map((t) => [t.email, t]));
    const emails = new Set(tracked.map((t) => t.email));

    // مصرف واقعی هر کاربر = جمع مصرف به تفکیک پنل (داخل پنل: بیشینه بین اینباندها)
    const usagePerEmail = new Map<string, { used: number; total: number }>();
    const multiPanel = panelResult.panels.length > 1;

    for (const bundle of panelResult.panels) {
      const panelStatByEmail = new Map<string, { used: number; total: number }>();
      for (const inb of bundle.inbounds) {
        let inboundUsed = 0;
        let inboundUsers = 0;
        for (const stat of inb.clientStats) {
          if (!emails.has(stat.email)) continue;
          const usedBytes = (stat.up || 0) + (stat.down || 0);
          inboundUsed += usedBytes;
          const prev = panelStatByEmail.get(stat.email);
          if (!prev || usedBytes > prev.used) {
            panelStatByEmail.set(stat.email, { used: usedBytes, total: 0 });
          }
          const client = inb.clients.find((c) => c.email === stat.email);
          if (client && !panelStatByEmail.get(stat.email)!.total) {
            panelStatByEmail.get(stat.email)!.total = client.totalGB || 0;
          }
          inboundUsers++;
          const expired = client ? client.expiryTime > 0 && client.expiryTime < Date.now() : false;
          const limited = client ? (client.totalGB || 0) > 0 && usedBytes >= (client.totalGB || 0) : false;
          if (client && !client.enable) disabledUsers++;
          else if (expired || limited) expiredUsers++;
          else if (client) activeUsers++;
        }
        if (inboundUsers > 0) {
          trafficByInbound.push({
            tag: multiPanel ? `${bundle.panelName} · ${inb.remark || inb.tag}` : inb.remark || inb.tag,
            usedGB: Math.round((inboundUsed / 1073741824) * 100) / 100,
            totalGB: 0,
          });
          usersPerInbound.push({
            tag: multiPanel ? `${bundle.panelName} · ${inb.remark || inb.tag}` : inb.remark || inb.tag,
            users: inboundUsers,
          });
        }
      }
      // جمع بین پنل‌ها
      for (const [email, s] of panelStatByEmail) {
        const prev = usagePerEmail.get(email) || { used: 0, total: 0 };
        usagePerEmail.set(email, { used: prev.used + s.used, total: Math.max(prev.total, s.total) });
      }
    }

    for (const [email, u] of usagePerEmail) {
      totalQuotaGB += u.total ? u.total / 1073741824 : 0;
      topUsers.push({
        email,
        name: trackedMap.get(email)?.name || null,
        usedGB: Math.round((u.used / 1073741824) * 100) / 100,
        totalGB: Math.round((u.total / 1073741824) * 100) / 100,
      });
    }
    topUsers.sort((a, b) => b.usedGB - a.usedGB);
    totalUsedGB = topUsers.reduce((s, u) => s + u.usedGB, 0);
  }

  return NextResponse.json({
    stats: {
      usersCount,
      activeUsers,
      expiredUsers,
      disabledUsers,
      totalUsedGB: Math.round(totalUsedGB * 100) / 100,
      totalQuotaGB: Math.round(totalQuotaGB * 100) / 100,
      multiLocation: reseller.multiLocation,
      trafficPoolGB: reseller.trafficPoolGB,
      allocatedGB,
      remainingGB: reseller.trafficPoolGB > 0 ? Math.max(0, reseller.trafficPoolGB - allocatedGB) : 0,
      inboundsCount: reseller.inbounds.length,
      panelConnected: panelResult.ok,
    },
    charts: {
      trafficByInbound,
      usersPerInbound,
      topUsers: topUsers.slice(0, 6),
      statusBreakdown: [
        { name: "فعال", value: activeUsers },
        { name: "منقضی/پر", value: expiredUsers },
        { name: "غیرفعال", value: disabledUsers },
      ],
    },
  });
}
