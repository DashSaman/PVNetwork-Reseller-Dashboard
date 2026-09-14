import { db } from "@/lib/db";
import { decryptSecret } from "./crypto";
import { panelLogin, getInbounds, getOnlineEmails, getClientIps, getClientIpsLegacy, type PanelAuth, type PanelInbound } from "./panel";
import type { PanelConfig } from "@prisma/client";

/**
 * مدیریت چند پنل ثنایی (3x-ui)
 * - هر پنل یک رکورد PanelConfig است (پنل اصلی = قدیمی‌ترین/اولین رکورد)
 * - اتصال با API Token (Bearer) یا نشست لاگین (کش ۲۵ دقیقه‌ای به تفکیک پنل)
 */

type SessionCache = { baseUrl: string; cookie: string; csrf?: string; exp: number };
const sessionCache = new Map<string, SessionCache>(); // key = panelId
const CACHE_TTL = 1000 * 60 * 25; // ۲۵ دقیقه

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** پنل اصلی (اولین پنل ثبت‌شده) */
export async function getPrimaryPanel(): Promise<PanelConfig | null> {
  return db.panelConfig.findFirst({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
}

/** همه پنل‌های فعال به ترتیب */
export async function getAllPanels(): Promise<PanelConfig[]> {
  return db.panelConfig.findMany({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
}

export async function getPanelById(panelId: string): Promise<PanelConfig | null> {
  if (!panelId) return getPrimaryPanel();
  const p = await db.panelConfig.findUnique({ where: { id: panelId } });
  return p || getPrimaryPanel();
}

/** اتصال به یک پنل مشخص (یا پنل اصلی اگر panelId خالی باشد) */
export async function getPanelConnection(
  panelId?: string
): Promise<{ ok: true; conn: PanelAuth; panel: PanelConfig } | { ok: false; msg: string }> {
  const config = await getPanelById(panelId || "");
  if (!config) {
    return { ok: false, msg: "اتصال پنل تنظیم نشده است. ابتدا از بخش تنظیمات، پنل ثنایی را متصل کنید." };
  }
  const base = normalize(config.baseUrl);

  // ---- حالت ۱: API Token ----
  if (config.apiToken) {
    const token = decryptSecret(config.apiToken);
    if (token) {
      return { ok: true, conn: { baseUrl: base, token }, panel: config };
    }
  }

  // ---- حالت ۲: نام کاربری / رمز ----
  const pass = decryptSecret(config.password);
  if (!pass) {
    return { ok: false, msg: "رمز ذخیره‌شده پنل قابل خواندن نیست؛ دوباره آن را ذخیره کنید." };
  }

  const cached = sessionCache.get(config.id);
  if (cached && cached.baseUrl === base && cached.exp > Date.now()) {
    return { ok: true, conn: { baseUrl: base, cookie: cached.cookie, csrf: cached.csrf }, panel: config };
  }

  const login = await panelLogin(config.baseUrl, config.username, pass);
  if (!login.ok || !login.data) {
    return { ok: false, msg: login.msg || "ورود به پنل ثنایی ناموفق بود" };
  }
  sessionCache.set(config.id, {
    baseUrl: base,
    cookie: login.data.cookie,
    csrf: login.data.csrf,
    exp: Date.now() + CACHE_TTL,
  });
  return {
    ok: true,
    conn: { baseUrl: base, cookie: login.data.cookie, csrf: login.data.csrf },
    panel: config,
  };
}

export type PanelBundle = {
  panelId: string;
  panelName: string;
  inbounds: PanelInbound[];
};

export type AllPanelsResult = {
  ok: boolean;
  msg?: string;
  panels: PanelBundle[];
  errors: { panelId: string; panelName: string; msg: string }[];
};

/** دریافت اینباندهای همه پنل‌ها (پنل‌های قطع‌شده خطایشان جداگانه برمی‌گردد) */
export async function getAllPanelInbounds(): Promise<AllPanelsResult> {
  const panels = await getAllPanels();
  if (panels.length === 0) {
    return { ok: false, msg: "اتصال پنل تنظیم نشده است. ابتدا از بخش تنظیمات، پنل ثنایی را متصل کنید.", panels: [], errors: [] };
  }
  const bundles: PanelBundle[] = [];
  const errors: { panelId: string; panelName: string; msg: string }[] = [];

  for (const p of panels) {
    if (!p.active) continue;
    const conn = await getPanelConnection(p.id);
    if (!conn.ok) {
      errors.push({ panelId: p.id, panelName: p.name, msg: conn.msg });
      continue;
    }
    let r = await getInbounds(conn.conn);
    if (!r.ok || !r.data) {
      // نشست شاید منقضی شده — یک بار تلاش مجدد
      sessionCache.delete(p.id);
      const retryConn = await getPanelConnection(p.id);
      if (retryConn.ok) r = await getInbounds(retryConn.conn);
    }
    if (!r.ok || !r.data) {
      errors.push({ panelId: p.id, panelName: p.name, msg: r.msg || "دریافت اینباندها ناموفق بود" });
      continue;
    }
    bundles.push({ panelId: p.id, panelName: p.name, inbounds: r.data });
  }

  return { ok: bundles.length > 0, panels: bundles, errors, msg: bundles.length === 0 ? errors[0]?.msg : undefined };
}

/** سازگاری با کد قبلی — اینباندهای پنل اصلی */
export async function getPanelInbounds(): Promise<
  { ok: true; inbounds: PanelInbound[] } | { ok: false; msg: string }
> {
  const r = await getAllPanelInbounds();
  if (!r.ok) return { ok: false, msg: r.msg || "دریافت اینباندها ناموفق بود" };
  const primary = r.panels[0];
  if (!primary) return { ok: false, msg: "هیچ پنلی در دسترس نیست" };
  return { ok: true, inbounds: primary.inbounds };
}

export function invalidatePanelCache(): void {
  sessionCache.clear();
}

/** ایمیل‌های آنلاین لحظه‌ای در همه پنل‌های فعال (اجتماع بین‌پنلی) */
export async function getOnlineAcrossPanels(): Promise<{
  ok: boolean;
  online: string[];
  errors: { panelName: string; msg: string }[];
}> {
  const panels = await getAllPanels();
  const online = new Set<string>();
  const errors: { panelName: string; msg: string }[] = [];
  let anyOk = false;
  for (const p of panels) {
    if (!p.active) continue;
    const conn = await getPanelConnection(p.id);
    if (!conn.ok) {
      errors.push({ panelName: p.name, msg: conn.msg });
      continue;
    }
    let r = await getOnlineEmails(conn.conn);
    if (!r.ok) {
      // نشست شاید منقضی شده — یک بار تلاش مجدد
      sessionCache.delete(p.id);
      const retryConn = await getPanelConnection(p.id);
      if (retryConn.ok) r = await getOnlineEmails(retryConn.conn);
    }
    if (r.ok && r.data) {
      for (const e of r.data) online.add(e);
      anyOk = true;
    } else {
      errors.push({ panelName: p.name, msg: r.msg || "دریافت آنلاین‌ها ناموفق بود" });
    }
  }
  return { ok: anyOk, online: [...online], errors };
}

/** IPهای ثبت‌شده یک کلاینت در پنل‌ها (اجتماع بین‌پنلی) */
export async function getClientIpsAcrossPanels(
  email: string
): Promise<{ ok: boolean; ips: string[]; msg?: string }> {
  const panels = await getAllPanels();
  const ips = new Set<string>();
  let lastMsg = "";
  let anyPanel = false;
  for (const p of panels) {
    if (!p.active) continue;
    anyPanel = true;
    const conn = await getPanelConnection(p.id);
    if (!conn.ok) {
      lastMsg = conn.msg;
      continue;
    }
    let r = await getClientIps(conn.conn, email);
    if (!r.ok) {
      // fallback نسخه‌های قدیمی 3x-ui: مسیر per-inbound
      const inbs = await getInbounds(conn.conn);
      if (inbs.ok && inbs.data) {
        const merged = new Set<string>();
        for (const inb of inbs.data) {
          const rr = await getClientIpsLegacy(conn.conn, inb.id, email);
          if (rr.ok && rr.data) for (const ip of rr.data) if (ip) merged.add(ip);
        }
        if (merged.size > 0) r = { ok: true, data: [...merged] };
      }
    }
    if (!r.ok) {
      sessionCache.delete(p.id);
      const retryConn = await getPanelConnection(p.id);
      if (retryConn.ok) r = await getClientIps(retryConn.conn, email);
    }
    if (r.ok && r.data) {
      for (const ip of r.data) if (ip) ips.add(ip);
    } else {
      lastMsg = r.msg || "";
    }
  }
  if (ips.size > 0) return { ok: true, ips: [...ips] };
  if (!anyPanel) return { ok: false, ips: [], msg: "هیچ پنلی در دسترس نیست" };
  return { ok: true, ips: [], msg: "هیچ IP ثبت‌شده‌ای برای این کاربر پیدا نشد" };
}

async function getSubPathFor(panelId: string): Promise<string> {
  const panel = await getPanelById(panelId);
  const p = (panel?.subPath || "sub").replace(/^\/+|\/+$/g, "");
  return p ? `/${p}` : "";
}

/** لینک سابسکریپشن یک کاربر — با پشتیبانی از دامنه اختصاصی نماینده (وایت‌لیبل) و پنل مرجع */
export async function buildSubLink(
  subId: string,
  reseller?: { allowWhitelabel: boolean; customDomain: string | null; domainVerified: boolean } | null,
  panelId?: string
): Promise<string | null> {
  if (!subId) return null;

  const path = await getSubPathFor(panelId || "");

  // پورت عمومی سابسکریپشن (از subBase پنل مرجع — مثل 2053)
  let subPort = "";
  const refPanel = await getPanelById(panelId || "");
  if (refPanel?.subBase) {
    try {
      const u = new URL(refPanel.subBase.trim());
      const p = Number(u.port);
      if (p && p !== 443) subPort = `:${p}`;
    } catch {
      subPort = "";
    }
  }

  // وایت‌لیبل: اگر نماینده دامنه تأییدشده داشته باشد، ساب با دامنه خودش ساخته می‌شود
  if (reseller && reseller.allowWhitelabel && reseller.customDomain && reseller.domainVerified) {
    const domain = reseller.customDomain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (domain) return `https://${domain}${subPort}${path}/${subId}`;
  }

  const panel = refPanel;
  if (!panel?.subBase) return null;
  const base = panel.subBase.trim().replace(/\/+$/, "");
  return `${base}${path}/${subId}`;
}
