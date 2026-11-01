import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { adminManagedResellers } from "@/lib/reseller-ownership";
import { buildSubLink, getAllPanelInboundsForUi, getPrimaryPanel } from "@/lib/panel-manager";
import { canonicalUserUsage, parseInboundRefs } from "@/lib/reseller-helpers";

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const [tracked, transferred, primary] = await Promise.all([
    db.resellerUser.findMany({ include: { reseller: true }, orderBy: { createdAt: "desc" } }),
    adminManagedResellers(), getPrimaryPanel(),
  ]);
  // Bootstrap is local only. A separate live request never fabricates missing counters.
  const snapshot = req.nextUrl.searchParams.get("live") === "1" ? await getAllPanelInboundsForUi() : null;
  const users = await Promise.all(tracked.map(async user => {
    const refs = parseInboundRefs(user.inboundIds, user.panelId || primary?.id || "");
    const required = new Set(refs.map(r => r.panelId || primary?.id || ""));
    const panels = snapshot?.panels.filter(p => required.has(p.panelId)).map(p => ({ ...p,
      inbounds: p.inbounds.map(i => ({ ...i, clientStats: i.clientStats.filter(s =>
        Number.isFinite(s.up) && s.up >= 0 && Number.isFinite(s.down) && s.down >= 0) })),
    })) ?? [];
    const stats = panels.flatMap(p => p.inbounds.flatMap(i => i.clientStats.filter(s => s.email === user.email)));
    const complete = !!snapshot?.ok && !snapshot.pending && !snapshot.stale && required.size > 0
      && [...required].every(id => panels.some(p => p.panelId === id && p.inbounds.some(i => i.clientStats.some(s => s.email === user.email))));
    const adminManaged = transferred.has(user.resellerId);
    return {
      id: user.id, email: user.email, name: user.name, trafficGB: user.trafficGB,
      ownerId: user.resellerId, ownerName: adminManaged ? "ادمین" : user.reseller.name || user.reseller.username,
      sourceUsername: transferred.get(user.resellerId)?.sourceUsername || user.reseller.username,
      adminManaged, subLink: await buildSubLink(user.subId || "", user.reseller, user.panelId || primary?.id || ""),
      usedGB: complete ? Math.round(canonicalUserUsage(panels, user.email).usedBytes / 1073741824 * 100) / 100 : null,
      expiryTime: complete ? Math.max(...stats.map(s => s.expiryTime || 0)) : null,
      enable: complete ? stats.every(s => s.enable ?? true) : null,
    };
  }));
  return NextResponse.json({ users, live: snapshot !== null, pending: snapshot?.pending || false, stale: snapshot?.stale || false }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
