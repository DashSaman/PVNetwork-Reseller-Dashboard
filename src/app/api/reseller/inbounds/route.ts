import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getSelectableInboundCatalog } from '@/lib/inbound-catalog';
import { getResellerWithAccess, getAllocatedGB, getConsumedGB } from "@/lib/reseller-helpers";
import { getQuotaState } from "@/lib/accounting-ops";
import { PUBLIC_SERVICE_NAME, PUBLIC_SERVICE_ERROR, publicLocationLabel } from "@/lib/reseller-presentation";

/**
 * اینباندهای مجاز نماینده (از همه پنل‌ها) + پول ترافیک او
 * نمایش فقط با تأیید زنده؛ مجوزهای ذخیره‌شده با قطع موقت حذف نمی‌شوند.
 */
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const { getResellerWithAccess } = await import("@/lib/reseller-helpers");
  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  const primaryPanel = await db.panelConfig.findFirst({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
  const primaryPanelId = primaryPanel?.id || "";

  const panelResult = await getSelectableInboundCatalog();
  const allowed = new Map(reseller.inbounds.map((i) => [`${i.panelId || primaryPanelId}::${i.inboundId}`, i]));

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

  let inbounds: Row[] = [];
  let panelError: string | null = null;

  if (panelResult.panels.length) {
    const live: Row[] = [];
    for (const bundle of panelResult.panels) {
      for (const i of bundle.inbounds) {
        const key = `${bundle.panelId}::${i.id}`;
        if (!allowed.has(key) || !panelResult.available.has(key)) continue;
        live.push({
          inboundId: i.id,
          panelId: bundle.panelId,
          panelName: PUBLIC_SERVICE_NAME,
          tag: publicLocationLabel(i.tag, bundle.panelName),
          remark: publicLocationLabel(i.remark, bundle.panelName),
          protocol: i.protocol,
          port: i.port,
          clientsCount: i.clients.length,
        });
      }
    }
    inbounds = live;
  } else {
    panelError = PUBLIC_SERVICE_ERROR;
  }

  const allocatedGB = await getAllocatedGB(reseller.id);
  const consumedGB = await getConsumedGB(reseller.id);

  return NextResponse.json({
    inbounds,
    panelError,
    observedAt: panelResult.observedAt,
    permissions: {
      multiLocation: reseller.multiLocation,
      allowIpLimit: reseller.allowIpLimit,
      trafficPoolGB: reseller.trafficPoolGB,
      allocatedGB,
      consumedGB,
      remainingGB: (await getQuotaState(reseller.id, reseller)).remaining,
    },
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
}
