import { db } from "@/lib/db";
import { getAllPanelInbounds, getPanelById } from "./panel-manager";
import { buildV2rayLink, type BuiltLink } from "./links";

/**
 * پورتال عمومی کاربر (/s/<subId>) — داده‌ها بر اساس subId از همه پنل‌ها
 * شامل برند نماینده مالک، مصرف، انقضا و لینک‌های اتصال
 */

export type PortalLink = BuiltLink & { remark: string };

export type PortalData = {
  found: boolean;
  subId: string;
  email?: string;
  brandName: string;
  totalGB: number; // گیگ — ۰ = نامحدود
  usedGB: number;
  expiryTime: number; // ۰ = نامحدود
  enable: boolean;
  daysLeft?: number;
  usagePct?: number;
  links: PortalLink[];
  locations: string[];
};

export async function getPortalData(subIdRaw: string, requestHost: string): Promise<PortalData> {
  const subId = (subIdRaw || "").trim().replace(/[^a-zA-Z0-9]/g, "");
  const empty: PortalData = { found: false, subId, brandName: "PvNetWork", totalGB: 0, usedGB: 0, expiryTime: 0, enable: false, links: [], locations: [] };
  if (!subId || subId.length < 8) return empty;

  const tracked = await db.resellerUser.findFirst({ where: { subId } });
  const reseller = tracked ? await db.reseller.findUnique({ where: { id: tracked.resellerId } }) : null;

  const panelResult = await getAllPanelInbounds().catch(() => null);
  if (!panelResult?.ok) return empty;

  // ---- گذر ۱: پیدا کردن ایمیل کاربر از روی subId ----
  let email = "";
  for (const bundle of panelResult.panels) {
    for (const inb of bundle.inbounds) {
      const client = inb.clients.find((c) => c.subId === subId);
      if (client?.email) {
        email = client.email;
        break;
      }
    }
    if (email) break;
  }
  // fallback: از روی رکورد دیتابیس پنل
  if (!email && tracked) email = tracked.email;
  if (!email) return empty;

  // ---- گذر ۲: جمع‌آوری آمار و ساخت لینک‌ها ----
  let up = 0;
  let down = 0;
  let total = 0;
  let expiryTime = 0;
  let enable = false;
  const links: PortalLink[] = [];
  const locations: string[] = [];
  const seenInbound = new Set<string>();

  for (const bundle of panelResult.panels) {
    const panel = await getPanelById(bundle.panelId);
    let host = "";
    if (panel?.subBase) {
      try {
        host = new URL(panel.subBase.trim()).hostname;
      } catch {
        host = "";
      }
    }
    if (!host) host = requestHost;

    for (const inb of bundle.inbounds) {
      const key = `${bundle.panelId}::${inb.id}`;
      if (seenInbound.has(key)) continue;
      const client = inb.clients.find((c) => c.email === email);
      const stat = inb.clientStats.find((c) => c.email === email);
      if (!client && !stat) continue;
      seenInbound.add(key);

      up += stat?.up || 0;
      down += stat?.down || 0;
      total = Math.max(total, client?.totalGB || 0);
      expiryTime = Math.max(expiryTime, client?.expiryTime || 0);
      enable = enable || (client?.enable ?? true);
      locations.push(inb.remark || inb.tag);

      if (host && (client?.id || client?.password)) {
        const built = buildV2rayLink({
          protocol: inb.protocol,
          host,
          port: inb.port,
          remark: inb.remark || inb.tag,
          uuid: client?.id,
          password: client?.password,
          email,
          flow: client?.flow || "",
          stream: (inb.stream || null) as Record<string, unknown> | null,
        });
        links.push({ ...built, remark: inb.remark || inb.tag });
      }
    }
  }

  const usedGB = Math.round(((up + down) / 1073741824) * 100) / 100;
  const totalGB = Math.round((total / 1073741824) * 100) / 100;
  const daysLeft = expiryTime > 0 ? Math.ceil((expiryTime - Date.now()) / 86400000) : undefined;
  const usagePct = totalGB > 0 ? Math.min(100, Math.round((usedGB / totalGB) * 100)) : undefined;

  return {
    found: true,
    subId,
    email,
    brandName: reseller?.brandName || reseller?.name || "PvNetWork",
    totalGB,
    usedGB,
    expiryTime,
    enable,
    daysLeft: daysLeft !== undefined ? Math.max(0, daysLeft) : undefined,
    usagePct,
    links,
    locations,
  };
}
