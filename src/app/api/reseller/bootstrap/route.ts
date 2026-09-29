import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess, bytesToGB, canonicalUsageByEmail, refKey, type InboundRef } from "@/lib/reseller-helpers";
import { getQuotaState } from "@/lib/accounting-ops";
import { getAllPanelInbounds } from "@/lib/panel-manager";
import { buildSubLink } from "@/lib/panel-manager";

/**
 * بوت‌استرپ اولین صفحهٔ نماینده («کاربران من») — «یک» snapshot پنل‌ها همهٔ داده‌های لازم را می‌سازد:
 * کاربران + مصرف کانونی، اینباندهای مجاز، مجوزها/سهمیه و برندِ سبک. آمار/نمودار عمداً جدا هستند (on-demand).
 */
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  const panelResult = { ok: false, panels: [] as { panelId: string; panelName: string; inbounds: { id: number; tag: string; remark: string; protocol: string; port: number; clientStats: { email: string; up?: number; down?: number; total?: number; expiryTime?: number; enable?: boolean }[]; clients: unknown[] }[] }[], errors: [] as { panelId: string; panelName: string; msg: string }[] };
  const primaryPanel = await db.panelConfig.findFirst({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
  const primaryPanelId = primaryPanel?.id || "";
  const allowed = new Set(reseller.inbounds.map((i) => refKey({ panelId: i.panelId, inboundId: i.inboundId })));

  const trackedUsers = await db.resellerUser.findMany({ where: { resellerId: reseller.id } });
  const trackedMap = new Map(trackedUsers.map((u) => [u.email, u]));
  const usage = canonicalUsageByEmail(panelResult.panels.map((b) => ({ panelId: b.panelId, inbounds: b.inbounds })));

  type Row = {
    email: string; name: string | null; inboundTags: string[]; protocol: string;
    totalGB: number; usedGB: number; expiryTime: number; enable: boolean;
    subId: string | null; subLink: string | null; trafficGB: number; createdAt?: Date;
  };
  const rows: Row[] = [];
  const tagsByEmail = new Map<string, string[]>();
  const protoByEmail = new Map<string, string>();
  const aggByEmail = new Map<string, { total: number; expiryTime: number; enable: boolean }>();
  for (const bundle of panelResult.panels) {
    for (const inb of bundle.inbounds) {
      for (const st of inb.clientStats) {
        if (!trackedMap.has(st.email)) continue;
        const tags = tagsByEmail.get(st.email) || [];
        tags.push(panelResult.panels.length > 1 ? `${bundle.panelName} · ${inb.tag}` : inb.tag);
        tagsByEmail.set(st.email, tags);
        if (!protoByEmail.has(st.email)) protoByEmail.set(st.email, inb.protocol);
        const prev = aggByEmail.get(st.email);
        const enable = st.enable ?? true;
        if (!prev) aggByEmail.set(st.email, { total: st.total || 0, expiryTime: st.expiryTime || 0, enable });
        else {
          prev.total = Math.max(prev.total, st.total || 0);
          prev.expiryTime = Math.max(prev.expiryTime, st.expiryTime || 0);
          prev.enable = prev.enable && enable;
        }
      }
    }
  }
  for (const [email, tracked] of trackedMap) {
    const agg = aggByEmail.get(email);
    const subPanelId = tracked.panelId || primaryPanelId;
    const subLink = await buildSubLink(tracked.subId || "", reseller, subPanelId);
    rows.push({
      email,
      name: tracked.name,
      inboundTags: tagsByEmail.get(email) || reseller.inbounds.map((i) => i.inboundTag || i.remark || "#" + i.inboundId).slice(0, 3),
      protocol: protoByEmail.get(email) || "-",
      totalGB: agg?.total ? bytesToGB(agg.total) : 0,
      usedGB: 0, // live-users جدا آپدیت می‌کند
      expiryTime: 0, // live-users جدا آپدیت می‌کند
      enable: true, // live-users جدا آپدیت می‌کند
      subId: tracked.subId || null,
      subLink,
      trafficGB: tracked.trafficGB,
      createdAt: tracked.createdAt,
    });
  }
  rows.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));

  // اینباندهای مجاز (همان شکل inbounds route)
  const panelNameById = new Map<string, string>();
  for (const p of await db.panelConfig.findMany()) panelNameById.set(p.id, p.name);
  const inbounds = panelResult.panels.flatMap((bundle) =>
    bundle.inbounds
      .filter((inb) => allowed.has(refKey({ panelId: bundle.panelId, inboundId: inb.id })))
      .map((inb) => ({
        inboundId: inb.id,
        panelId: bundle.panelId,
        panelName: panelNameById.get(bundle.panelId) || "پنل",
        tag: inb.tag,
        remark: inb.remark,
        protocol: inb.protocol,
        port: inb.port,
        clientsCount: inb.clients.length,
      }))
  );

  const quota = await getQuotaState(reseller.id, reseller);

  return NextResponse.json({
    users: rows,
    inbounds,
    panelError: panelResult.ok ? "" : (panelResult as { msg?: string }).msg || "هیچ پنلی در دسترس نیست",
    panelErrors: panelResult.errors.length ? panelResult.errors : undefined,
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
}
