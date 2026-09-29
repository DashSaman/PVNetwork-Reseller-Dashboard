import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { getAllPanelInboundsForUi } from "@/lib/panel-manager";

// ---- Health hysteresis (DISPLAY ONLY) — یک timeout ≠ OFFLINE ----
type PanelHealth = {
  state: "ONLINE" | "DEGRADED" | "OFFLINE";
  lastSuccessAt: number;
  consecutiveFailures: number;
  lastLatencyMs: number;
};
const healthStore: Map<string, PanelHealth> = ((globalThis as { __pvnetHealth?: Map<string, PanelHealth> }).__pvnetHealth ??= new Map());

const OFFLINE_FAILURES = 3; // بعد از ۳ شکست متوالی
const OFFLINE_STALE_MS = 30000; // + ۳۰s از آخرین موفقیت

function updateHealth(panelId: string, success: boolean, latencyMs: number): PanelHealth {
  const h = healthStore.get(panelId) || { state: "ONLINE" as const, lastSuccessAt: 0, consecutiveFailures: 0, lastLatencyMs: 0 };
  if (success) {
    h.state = "ONLINE"; // موفقیت فوری → ONLINE
    h.lastSuccessAt = Date.now();
    h.consecutiveFailures = 0;
    h.lastLatencyMs = latencyMs;
  } else {
    h.consecutiveFailures++;
    if (h.consecutiveFailures >= OFFLINE_FAILURES && Date.now() - h.lastSuccessAt > OFFLINE_STALE_MS) {
      h.state = "OFFLINE";
    } else if (h.lastSuccessAt > 0) {
      h.state = "DEGRADED"; // موفقیت اخیر بوده → DEGRADED نه OFFLINE
    } else {
      h.state = "OFFLINE"; // هرگز موفق نبوده
    }
  }
  healthStore.set(panelId, h);
  return h;
}

/**
 * Live panel summary — تنها منبع وضعیت زندهٔ پنل برای داشبورد ادمین.
 * Admin overview 100% local است؛ این endpoint جداگانه صدا زده می‌شود.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const configured = (await db.panelConfig.count({ where: { active: true } })) > 0;
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

  // health state per panel
  const t0 = Date.now();
  for (const b of snapshot.panels) updateHealth(b.panelId, true, Date.now() - t0);
  for (const e of snapshot.errors) updateHealth(e.panelId || "?", false, 0);
  const allHealths = [...healthStore.values()];
  const overallState = allHealths.some((h) => h.state === "OFFLINE")
    ? "OFFLINE"
    : allHealths.some((h) => h.state === "DEGRADED")
      ? "DEGRADED"
      : snapshot.ok
        ? "ONLINE"
        : "OFFLINE";

  const res = NextResponse.json({
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
    // health hysteresis (display only)
    configured,
    state: configured ? overallState : "NOT_CONFIGURED",
    lastSuccessAt: allHealths.reduce((m, h) => Math.max(m, h.lastSuccessAt), 0) || null,
    latencyMs: allHealths.find((h) => h.lastLatencyMs > 0)?.lastLatencyMs ?? null,
  });
  res.headers.set("Cache-Control", "private, no-store, max-age=0");
  return res;
}
