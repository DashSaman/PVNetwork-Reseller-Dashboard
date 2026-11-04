import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess, parseInboundRefs } from "@/lib/reseller-helpers";
import { getQuotaState } from "@/lib/accounting-ops";
import { buildSubLink } from "@/lib/panel-manager";

/**
 * بوت‌استرپ اولین صفحهٔ نماینده («کاربران من») — فقط دادهٔ لوکال DB، بدون هیچ تماس با 3x-ui.
 * مصرف زنده و وضعیت پنل از /api/reseller/live-users جداگانه می‌آید (async بعد از رندر اولیه).
 */
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  const primaryPanel = await db.panelConfig.findFirst({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
  const primaryPanelId = primaryPanel?.id || "";

  const trackedUsers = await db.resellerUser.findMany({ where: { resellerId: reseller.id } });

  // ساخت ردیف‌ها از دادهٔ DB — locations از refs خود هر کاربر (نه همهٔ اینباندهای نماینده)
  const rows: {
    email: string; name: string | null; inboundTags: string[]; inboundRefs: { panelId: string; inboundId: number }[]; protocol: string;
    totalGB: number; usedGB: number | null; expiryTime: number | null; enable: boolean | null;
    subId: string | null; subLink: string | null; trafficGB: number; createdAt: Date;
  }[] = [];
  for (const tracked of trackedUsers) {
    const subPanelId = tracked.panelId || primaryPanelId;
    const subLink = await buildSubLink(tracked.subId || "", reseller, subPanelId);

    rows.push({
      email: tracked.email,
      name: tracked.name,
      inboundTags: [], // Only the separate verified live catalog supplies visible labels.
      inboundRefs: parseInboundRefs(tracked.inboundIds, tracked.panelId || primaryPanelId),
      protocol: "-",
      totalGB: tracked.trafficGB || 0,
      usedGB: null,
      expiryTime: null,
      enable: null,
      subId: tracked.subId || null,
      subLink,
      trafficGB: tracked.trafficGB,
      createdAt: tracked.createdAt,
    });
  }
  rows.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));

  const quota = await getQuotaState(reseller.id, reseller);

  const res = NextResponse.json({
    users: rows,
    inbounds: [],
    // bootstrap هیچ بررسی زنده انجام نمی‌دهد — خطای اتصال نمی‌گوید؛ وضعیت زنده live-users تعیین می‌کند
    panelError: "",
    liveStatus: "loading",
    permissions: {
      multiLocation: reseller.multiLocation,
      allowIpLimit: reseller.allowIpLimit,
      trafficPoolGB: reseller.trafficPoolGB,
      allocatedGB: quota.allocated,
      consumedGB: quota.consumed,
      remainingGB: quota.remaining,
    },
    brand: {
      allowWhitelabel: reseller.allowWhitelabel,
      brandName: reseller.brandName,
      customDomain: reseller.customDomain,
      domainVerified: reseller.domainVerified,
    },
  });
  res.headers.set("Cache-Control", "private, no-store, max-age=0");
  return res;
}
