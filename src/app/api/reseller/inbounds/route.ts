import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getAllPanelInbounds } from "@/lib/panel-manager";
import { getResellerWithAccess, getAllocatedGB } from "@/lib/reseller-helpers";

/**
 * اینباندهای مجاز نماینده (از همه پنل‌ها) + پول ترافیک او
 * حتی اگر پنلی قطع باشد، دسترسی‌ها و متادیتای اینباندها از دیتابیس برمی‌گردد.
 */
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const { getResellerWithAccess } = await import("@/lib/reseller-helpers");
  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  const primaryPanel = await db.panelConfig.findFirst({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
  const primaryPanelId = primaryPanel?.id || "";

  const panelResult = await getAllPanelInbounds();
  const allowed = new Map(reseller.inbounds.map((i) => [`${i.panelId || primaryPanelId}::${i.inboundId}`, i]));
  const panelNameById = new Map<string, string>();
  for (const p of await db.panelConfig.findMany()) panelNameById.set(p.id, p.name);

  const dbFallback = reseller.inbounds.map((i) => ({
    inboundId: i.inboundId,
    panelId: i.panelId || primaryPanelId,
    panelName: panelNameById.get(i.panelId || primaryPanelId) || "پنل اصلی",
    tag: i.inboundTag,
    remark: i.remark || i.inboundTag,
    protocol: i.protocol,
    port: i.port,
    clientsCount: 0,
    unavailable: true,
  }));

  type Row = {
    inboundId: number;
    panelId: string;
    panelName: string;
    tag: string;
    remark: string;
    protocol: string;
    port: number;
    clientsCount: number;
    unavailable?: boolean;
  };

  let inbounds: Row[] = dbFallback;
  let panelError: string | null = null;

  if (panelResult.ok) {
    const live: Row[] = [];
    for (const bundle of panelResult.panels) {
      for (const i of bundle.inbounds) {
        const key = `${bundle.panelId}::${i.id}`;
        if (!allowed.has(key)) continue;
        live.push({
          inboundId: i.id,
          panelId: bundle.panelId,
          panelName: bundle.panelName,
          tag: i.tag,
          remark: i.remark,
          protocol: i.protocol,
          port: i.port,
          clientsCount: i.clients.length,
        });
      }
    }
    const missing = reseller.inbounds
      .filter((i) => {
        const pid = i.panelId || primaryPanelId;
        const bundle = panelResult.panels.find((p) => p.panelId === pid);
        return !bundle || !bundle.inbounds.some((p) => p.id === i.inboundId);
      })
      .map((i) => ({
        inboundId: i.inboundId,
        panelId: i.panelId || primaryPanelId,
        panelName: panelNameById.get(i.panelId || primaryPanelId) || "پنل اصلی",
        tag: i.inboundTag,
        remark: i.remark || i.inboundTag,
        protocol: i.protocol,
        port: i.port,
        clientsCount: 0,
        unavailable: true,
      }));
    inbounds = [...live, ...missing];
  } else {
    panelError = panelResult.msg || "هیچ پنلی در دسترس نیست";
  }

  const allocatedGB = await getAllocatedGB(reseller.id);

  return NextResponse.json({
    inbounds,
    panelError,
    panelErrors: panelResult.ok && panelResult.errors.length ? panelResult.errors : undefined,
    permissions: {
      multiLocation: reseller.multiLocation,
      allowIpLimit: reseller.allowIpLimit,
      trafficPoolGB: reseller.trafficPoolGB,
      allocatedGB,
      remainingGB: reseller.trafficPoolGB > 0 ? Math.max(0, reseller.trafficPoolGB - allocatedGB) : 0,
    },
  });
}
