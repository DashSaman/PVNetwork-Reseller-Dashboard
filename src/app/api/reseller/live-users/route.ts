import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess, canonicalUsageByEmail } from "@/lib/reseller-helpers";
import { getAllPanelInboundsForUi } from "@/lib/panel-manager";
import { publicPanelErrors } from "@/lib/reseller-presentation";

/**
 * Live user traffic data — with UI deadline (6s).
 * usedGB=null means "live value unavailable" — NOT zero.
 * dataComplete=false means at least one panel was unavailable.
 */
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  const tracked = await db.resellerUser.findMany({
    where: { resellerId: reseller.id },
    select: { email: true },
  });

  const snapshot = await getAllPanelInboundsForUi();
  const dataComplete = snapshot.errors.length === 0 && snapshot.ok;
  const trackedSet = new Set(tracked.map(t => t.email));
  const usage = snapshot.ok ? canonicalUsageByEmail(snapshot.panels.map((b) => ({ panelId: b.panelId, inbounds: b.inbounds }))) : new Map();

  const liveByEmail = new Map<string, { usedBytes: number | null; totalBytes: number | null; expiryTime: number; enable: boolean }>();
  for (const bundle of snapshot.panels) {
    for (const inb of bundle.inbounds) {
      for (const st of inb.clientStats) {
        if (!trackedSet.has(st.email)) continue;
        const live = usage.get(st.email);
        const cur = {
          usedBytes: live ? live.usedBytes : null,
          totalBytes: st.total || null,
          expiryTime: st.expiryTime || 0,
          enable: st.enable ?? true,
        };
        const prev = liveByEmail.get(st.email);
        if (!prev) liveByEmail.set(st.email, cur);
        else {
          if (cur.totalBytes != null) prev.totalBytes = Math.max(prev.totalBytes ?? 0, cur.totalBytes);
          prev.expiryTime = Math.max(prev.expiryTime, cur.expiryTime);
          prev.enable = prev.enable && cur.enable;
        }
      }
    }
  }

  const GIB = 1024 * 1024 * 1024;
  const users = tracked.map((t) => {
    const live = dataComplete ? liveByEmail.get(t.email) : undefined;
    const usedBytes = live?.usedBytes;
    return {
      email: t.email,
      // null = پنل در دسترس نیست → مقدار قبلی را نگه دار (0 جعل نکن)
      usedGB: usedBytes != null ? Math.round((usedBytes / GIB) * 100) / 100 : null,
      totalGB: live ? Math.round((live.totalBytes ?? 0) / GIB * 100) / 100 : null,
      expiryTime: live?.expiryTime ?? null,
      enable: live?.enable ?? null,
    };
  });

  const res = NextResponse.json({
    users,
    panelConnected: snapshot.ok,
    dataComplete,
    panelErrors: snapshot.errors.length ? publicPanelErrors(snapshot.errors) : undefined,
    observedAt: snapshot.observedAt,
    pending: snapshot.pending || false,
    stale: snapshot.stale || false,
  });
  res.headers.set("Cache-Control", "private, no-store, max-age=0");
  return res;
}
