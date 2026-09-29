import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

/**
 * Admin overview — 100% LOCAL DB only، بدون هیچ تماس با 3x-ui.
 * وضعیت زندهٔ پنل از /api/admin/panel-summary جداگانه می‌آید.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const [resellers, users, logs, activeResellers] = await Promise.all([
    db.reseller.count(),
    db.resellerUser.count(),
    db.activityLog.count(),
    db.reseller.count({ where: { active: true } }),
  ]);

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

  const res = NextResponse.json({
    stats: { resellers, activeResellers, users, logs },
    recentLogs,
    charts: { usersSeries, resellersBreakdown },
  });
  res.headers.set("Cache-Control", "private, no-store, max-age=0");
  return res;
}
