import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess, refKey, parseInboundRefs } from "@/lib/reseller-helpers";
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
  const panelNameById = new Map<string, string>();
  for (const p of await db.panelConfig.findMany()) panelNameById.set(p.id, p.name);

  // نقشهٔ اینباندهای مجاز از DB — برای پیدا کردن tags هر کاربر
  const allowedById = new Map(reseller.inbounds.map((i) => [`${i.panelId || primaryPanelId}::${i.inboundId}`, i]));

  const trackedUsers = await db.resellerUser.findMany({ where: { resellerId: reseller.id } });

  // ساخت ردیف‌ها از دادهٔ DB — locations از refs خود هر کاربر (نه همهٔ اینباندهای نماینده)
  const rows: {
    email: string; name: string | null; inboundTags: string[]; protocol: string;
    totalGB: number; usedGB: number; expiryTime: number; enable: boolean;
    subId: string | null; subLink: string | null; trafficGB: number; createdAt: Date;
  }[] = [];
  for (const tracked of trackedUsers) {
    const subPanelId = tracked.panelId || primaryPanelId;
    const subLink = await buildSubLink(tracked.subId || "", reseller, subPanelId);

    // locations: از refs ذخیره‌شدهٔ «همین کاربر» تطبیق با اینباندهای مجاز DB
    let inboundTags: string[] = [];
    try {
      const refs = parseInboundRefs(tracked.inboundIds, tracked.panelId || primaryPanelId);
      inboundTags = refs
        .map((r) => {
          const meta = allowedById.get(`${r.panelId}::${r.inboundId}`);
          const panelName = panelNameById.get(r.panelId) || "";
          const tag = meta?.inboundTag || meta?.remark || `#${r.inboundId}`;
          return panelName ? `${panelName} · ${tag}` : tag;
        })
        .filter(Boolean);
    } catch { /* refs نامعتبر → خالی */ }

    rows.push({
      email: tracked.email,
      name: tracked.name,
      inboundTags,
      protocol: allowedById.get(inboundTags.length ? "" : "")?.protocol || "-", // live-users آپدیت می‌کند
      totalGB: tracked.trafficGB || 0,
      usedGB: 0, // live-users آپدیت می‌کند
      expiryTime: 0, // live-users آپدیت می‌کند
      enable: true, // live-users آپدیت می‌کند
      subId: tracked.subId || null,
      subLink,
      trafficGB: tracked.trafficGB,
      createdAt: tracked.createdAt,
    });
  }
  rows.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));

  // اینباندهای مجاز — از DB ResellerInbound (بدون 3x-ui)
  const inbounds = reseller.inbounds.map((i) => ({
    inboundId: i.inboundId,
    panelId: i.panelId || primaryPanelId,
    panelName: panelNameById.get(i.panelId || primaryPanelId) || "پنل",
    tag: i.inboundTag,
    remark: i.remark || i.inboundTag,
    protocol: i.protocol,
    port: i.port,
    clientsCount: 0, // live آپدیت می‌کند
  }));

  const quota = await getQuotaState(reseller.id, reseller);

  const res = NextResponse.json({
    users: rows,
    inbounds,
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
