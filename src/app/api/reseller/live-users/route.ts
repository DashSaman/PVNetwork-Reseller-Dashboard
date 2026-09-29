import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess, canonicalUsageByEmail } from "@/lib/reseller-helpers";
import { getAllPanelInboundsForUi } from "@/lib/panel-manager";

/**
 * Live user traffic data — with short UI deadline (3s).
 * After the local bootstrap renders, this endpoint supplies live values.
 * Slow panel → unavailable; healthy panels return data.
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

  const liveByEmail = new Map<string, { usedBytes: number; totalBytes: number; expiryTime: number; enable: boolean }>();
  for (const bundle of snapshot.panels) {
    for (const inb of bundle.inbounds) {
      for (const st of inb.clientStats) {
        if (!tracked.some((t) => t.email === st.email)) continue;
        const prev = liveByEmail.get(st.email);
        const cur = {
          usedBytes: usage.get(st.email)?.usedBytes ?? 0,
          totalBytes: st.total || 0,
          expiryTime: st.expiryTime || 0,
          enable: st.enable ?? true,
        };
        if (!prev) liveByEmail.set(st.email, cur);
        else {
          prev.totalBytes = Math.max(prev.totalBytes, cur.totalBytes);
          prev.expiryTime = Math.max(prev.expiryTime, cur.expiryTime);
          prev.enable = prev.enable && cur.enable;
        }
      }
    }
  }

  const GIB = 1024 * 1024 * 1024;
  const users = tracked.map((t) => ({
    email: t.email,
    usedGB: Math.round(((liveByEmail.get(t.email)?.usedBytes ?? 0) / GIB) * 100) / 100,
    totalGB: Math.round(((liveByEmail.get(t.email)?.totalBytes ?? 0) / GIB) * 100) / 100,
    expiryTime: liveByEmail.get(t.email)?.expiryTime ?? 0,
    enable: liveByEmail.get(t.email)?.enable ?? true,
  }));

  return NextResponse.json({
    users,
    panelConnected: snapshot.ok,
    panelErrors: snapshot.errors.length ? snapshot.errors : undefined,
  });
}
