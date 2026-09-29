import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess, canonicalUsageByEmail } from "@/lib/reseller-helpers";
import { getAllPanelInboundsForUi } from "@/lib/panel-manager";

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
  const usage = snapshot.ok ? canonicalUsageByEmail(snapshot.panels.map((b) => ({ panelId: b.panelId, inbounds: b.inbounds }))) : new Map();

  const liveByEmail = new Map<string, { usedBytes: number | null; totalBytes: number | null; expiryTime: number; enable: boolean }>();
  for (const bundle of snapshot.panels) {
    for (const inb of bundle.inbounds) {
      for (const st of inb.clientStats) {
        if (!tracked.some((t) => t.email === st.email)) continue;
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
    const live = liveByEmail.get(t.email);
    const usedBytes = live?.usedBytes;
    return {
      email: t.email,
      // null = پنل در دسترس نیست → مقدار قبلی را نگه دار (0 جعل نکن)
      usedGB: usedBytes != null ? Math.round((usedBytes / GIB) * 100) / 100 : null,
      totalGB: live?.totalBytes != null ? Math.round((live.totalBytes / GIB) * 100) / 100 : 0,
      expiryTime: live?.expiryTime ?? 0,
      enable: live?.enable ?? true,
    };
  });

  const dataComplete = snapshot.errors.length === 0 && snapshot.ok;
  const res = NextResponse.json({
    users,
    panelConnected: snapshot.ok,
    dataComplete,
    panelErrors: snapshot.errors.length ? snapshot.errors : undefined,
    observedAt: Date.now(),
  });
  res.headers.set("Cache-Control", "private, no-store, max-age=0");
  return res;
}
