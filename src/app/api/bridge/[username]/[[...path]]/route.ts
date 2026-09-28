import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, randomUuid } from "@/lib/crypto";
import { BRIDGE_COOKIE, bridgeCookiePath, issueBridgeToken, getBridgeReseller, parseBody, xui } from "@/lib/bridge";
import { isBlocked, recordFailure, clearFailures, clientIp, LIMITS } from "@/lib/rate-limit";
import { getAllPanelInbounds, getOnlineAcrossPanels, getPanelConnection } from "@/lib/panel-manager";
import {
  getAllocatedGB,
  getConsumedGB,
  validatePoolAllocation,
  withResellerLock,
  debitUsedTraffic,
  parseInboundRefs,
  refKey,
  bytesToGB,
  gbToBytes,
  type InboundRef,
  type ResellerWithInbounds,
} from "@/lib/reseller-helpers";
import { deleteUserByJournal, resetUserByJournal } from "@/lib/accounting-ops";
import { createResellerUserCore } from "@/lib/user-create";
import { updateClient, resetClientTraffic, deleteClient, type PanelAuth } from "@/lib/panel";
import { logActivity } from "@/lib/logger";

/**
 * پل 3x-ui برای ربات میرزا — مسیرها:
 *   POST /api/bridge/{username}/login
 *   GET  /api/bridge/{username}/panel/api/inbounds/list
 *   GET  /api/bridge/{username}/panel/api/clients/list
 *   POST /api/bridge/{username}/panel/api/clients/add            (فرمت یکپارچه: {client, inboundIds})
 *   POST /api/bridge/{username}/panel/api/clients/update/{email}
 *   POST /api/bridge/{username}/panel/api/clients/del/{email}
 *   POST /api/bridge/{username}/panel/api/clients/resetTraffic/{email}
 *   POST /api/bridge/{username}/panel/api/clients/onlines
 */

type Ctx = { params: Promise<{ username: string; path?: string[] }> };

const GB = 1024 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: Ctx) {
  const { username, path } = await ctx.params;
  const parts = (path || []).join("/");

  // ---------- لاگین (فرم urlencoded یا JSON) ----------
  if (parts === "login") {
    return bridgeLogin(req, username);
  }

  // ---------- بقیه مسیرها نیازمند نشست ----------
  const auth = await getBridgeReseller(req, username);
  if (!auth.ok) return xui(false, auth.error);

  const emailFromPath = decodeURIComponent(parts.split("/").pop() || "");

  if (parts === "panel/api/clients/add") return bridgeAddClient(req, auth.reseller);
  if (parts === "panel/api/clients/onlines") return bridgeOnlines(auth.reseller);
  if (parts.startsWith("panel/api/clients/update/")) return bridgeUpdateClient(req, auth.reseller, emailFromPath);
  if (parts.startsWith("panel/api/clients/del/")) return bridgeDeleteClient(auth.reseller, emailFromPath);
  if (parts.startsWith("panel/api/clients/resetTraffic/")) return bridgeResetTraffic(auth.reseller, emailFromPath);

  // ---------- سازگاری با ربات میرزا (x-ui_single) ----------
  if (parts === "panel/api/inbounds/addClient") return bridgeMirzaAddClient(req, auth.reseller);
  if (parts.startsWith("panel/api/inbounds/updateClient/")) {
    return bridgeUpdateClient(req, auth.reseller, decodeURIComponent(parts.slice("panel/api/inbounds/updateClient/".length)));
  }
  const mirzaReset = parts.match(/^panel\/api\/inbounds\/(\d+)\/resetClientTraffic\/(.+)$/);
  if (mirzaReset) return bridgeResetTraffic(auth.reseller, decodeURIComponent(mirzaReset[2]));
  const mirzaDel = parts.match(/^panel\/api\/inbounds\/(\d+)\/delClientByEmail\/(.+)$/);
  if (mirzaDel) return bridgeDeleteClient(auth.reseller, decodeURIComponent(mirzaDel[2]));

  // ---------- سازگاری با API قدیمی 3x-ui v2 (برخی ربات‌ها) ----------
  if (parts === "panel/api/inbounds/list") return bridgeInboundList(auth.reseller);
  const legacyAdd = parts.match(/^panel\/api\/inbounds\/(\d+)\/addClient$/);
  if (legacyAdd) return bridgeLegacyAddClient(req, auth.reseller);
  const legacyReset = parts.match(/^panel\/api\/inbounds\/(\d+)\/clientResetTraffic\/(.+)$/);
  if (legacyReset) return bridgeResetTraffic(auth.reseller, decodeURIComponent(legacyReset[2]));

  return xui(false, "مسیر پشتیبانی نمی‌شود");
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { username, path } = await ctx.params;
  const parts = (path || []).join("/");

  const auth = await getBridgeReseller(req, username);
  if (!auth.ok) return xui(false, auth.error);

  if (parts === "panel/api/inbounds/list") return bridgeInboundList(auth.reseller);
  if (parts === "panel/api/clients/list") return bridgeClientList(auth.reseller);
  if (parts.startsWith("panel/api/inbounds/getClientTraffics/")) {
    return bridgeGetClientTraffics(auth.reseller, decodeURIComponent(parts.slice("panel/api/inbounds/getClientTraffics/".length)));
  }
  if (parts === "panel/api/server/status" || parts === "panel/api/server/getStatus") return bridgeServerStatus();
  if (parts === "panel/setting" || parts === "panel/api/setting") return bridgeSetting();

  return xui(false, "مسیر پشتیبانی نمی‌شود");
}

// ============================================================ login
async function bridgeLogin(req: NextRequest, username: string) {
  const body = await parseBody(req);
  const user = (body.username || username || "").trim();
  const password = body.password || "";
  if (!user || !password) return xui(false, "نام کاربری و رمز عبور الزامی است");

  // ضد بشکن — مشابه ورود داشبورد
  const ip = clientIp(req);
  const unameKey = `bridge:u:${user.toLowerCase()}`;
  if (isBlocked(unameKey).blocked) {
    return xui(false, "تلاش‌های ناموفق زیاد بود — بعداً تلاش کنید");
  }

  const row = await db.reseller.findUnique({ where: { username: user } });
  if (!row || !row.active || !verifyPassword(password, row.password)) {
    recordFailure(unameKey, LIMITS.MAX_PER_USERNAME);
    void logActivity({ actorType: "RESELLER", actorName: user, action: "ورود ناموفق ربات به پل 3x-ui" });
    return xui(false, "نام کاربری یا رمز عبور اشتباه است");
  }
  if (!row.mirzaEnabled) {
    return xui(false, "اتصال ربات برای این حساب فعال نشده است — از تنظیمات حساب داشبورد فعال کنید");
  }
  clearFailures(unameKey);

  const token = issueBridgeToken(row);
  const res = NextResponse.json({ success: true, msg: "login ok", obj: { token } });
  res.cookies.set(BRIDGE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: bridgeCookiePath(row.username),
    maxAge: 60 * 60 * 24,
  });
  await logActivity({
    actorType: "RESELLER",
    actorName: row.username,
    action: "ورود موفق ربات به پل 3x-ui",
    resellerId: row.id,
  });
  return res;
}

// ============================================================ اینباندها — فقط دسترسی‌های خود نماینده
/** کلیدهای مجاز نماینده — panelId خالی (داده‌های قدیمی) به پنل اصلی ترجمه می‌شود */
async function allowedRefsResolved(reseller: ResellerWithInbounds): Promise<Set<string>> {
  const { getPrimaryPanel } = await import("@/lib/panel-manager");
  const primaryPanelId = (await getPrimaryPanel())?.id || "";
  return new Set(
    reseller.inbounds.map((i) => refKey({ panelId: i.panelId || primaryPanelId, inboundId: i.inboundId }))
  );
}

async function bridgeInboundList(reseller: ResellerWithInbounds) {
  const panelResult = await getAllPanelInbounds();
  if (!panelResult.ok) return xui(false, panelResult.msg || "هیچ پنلی در دسترس نیست");

  const allowed = await allowedRefsResolved(reseller);
  const tracked = await db.resellerUser.findMany({ where: { resellerId: reseller.id } });
  const trackedEmails = new Set(tracked.map((t) => t.email));

  const obj: unknown[] = [];
  for (const bundle of panelResult.panels) {
    for (const inb of bundle.inbounds) {
      if (!allowed.has(refKey({ panelId: bundle.panelId, inboundId: inb.id }))) continue;
      const clients = inb.clients.filter((c) => trackedEmails.has(c.email));
      const clientStats = inb.clientStats.filter((c) => trackedEmails.has(c.email));
      obj.push({
        id: inb.id,
        port: inb.port,
        protocol: inb.protocol,
        tag: inb.remark || inb.tag,
        remark: inb.remark || inb.tag,
        up: inb.up,
        down: inb.down,
        total: inb.total,
        settings: JSON.stringify({ clients }),
        streamSettings: JSON.stringify(inb.stream || {}),
        clientStats,
      });
    }
  }
  return xui(true, "", obj);
}

// ============================================================ کلاینت‌ها
async function bridgeClientList(reseller: ResellerWithInbounds) {
  const panelResult = await getAllPanelInbounds();
  const tracked = await db.resellerUser.findMany({ where: { resellerId: reseller.id } });
  const obj = tracked.map((t) => {
    // پیدا کردن رکورد زنده کاربر در پنل‌ها (uuid/password/آمار)
    let record: Record<string, unknown> = {};
    let up = 0;
    let down = 0;
    if (panelResult.ok) {
      for (const bundle of panelResult.panels) {
        for (const inb of bundle.inbounds) {
          const live = inb.clients.find((c) => c.email === t.email);
          if (live) {
            record = { ...live } as Record<string, unknown>;
            const st = inb.clientStats.find((c) => c.email === t.email);
            if (st) {
              // بین پنل‌ها بیشینه (رکورد یکتا) — همان منطق داشبورد
              up = Math.max(up, st.up || 0);
              down = Math.max(down, st.down || 0);
            }
          }
        }
      }
    }
    return {
      email: t.email,
      subId: t.subId || "",
      id: record.id || record.password || "",
      password: record.password || "",
      flow: record.flow || "",
      limitIp: record.limitIp ?? 0,
      totalGB: t.trafficGB > 0 ? gbToBytes(t.trafficGB) : 0,
      expiryTime: record.expiryTime ?? 0,
      enable: record.enable ?? true,
      up,
      down,
    };
  });
  return xui(true, "", obj);
}

/** ساخت یک کلاینت از طریق پل — مشترک بین فرمت جدید (یکی + inboundIds) و قدیمی (per-inbound) */
async function createOneViaBridge(
  reseller: ResellerWithInbounds,
  client: Record<string, unknown>,
  ids: number[]
): Promise<Response> {
  const panelResult = await getAllPanelInbounds();
  if (!panelResult.ok) return xui(false, panelResult.msg || "هیچ پنلی در دسترس نیست");
  const allowed = await allowedRefsResolved(reseller);

  const refs: InboundRef[] = [];
  for (const id of ids) {
    // اینباند را بین پنل‌های دارای دسترسی جستجو کن
    let found: { panelId: string; inboundId: number } | undefined;
    for (const bundle of panelResult.panels) {
      const key = refKey({ panelId: bundle.panelId, inboundId: id });
      if (allowed.has(key) && bundle.inbounds.some((inb) => inb.id === id)) {
        found = { panelId: bundle.panelId, inboundId: id };
        break;
      }
    }
    if (!found) return xui(false, `اینباند ${id} در دسترسی‌های شما نیست`);
    refs.push(found);
  }

  // پارامترهای کلاینت — totalGB به بایت، expiryTime به میلی‌ثانیه (قرارداد 3x-ui)
  const rawEmail = String(client.email || "").trim();
  const name = rawEmail.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || `bot-${Date.now()}`;
  const totalBytes = Math.max(0, Number(client.totalGB ?? 0) || 0);
  const trafficGB = totalBytes > 0 ? bytesToGB(totalBytes) : 0;
  const expiryTime = Math.max(0, Number(client.expiryTime ?? 0) || 0);
  const ipLimit = Math.max(0, Number(client.limitIp ?? 0) || 0);
  const subIdRaw = String(client.subId ?? "").trim();

  const r = await createResellerUserCore(reseller, {
    name,
    trafficGB,
    expiryTime,
    ipLimit,
    refs,
    exactEmail: name,
    exactUuid: typeof client.id === "string" ? client.id.trim() : "",
    subId: subIdRaw,
  });
  if (!r.ok) return xui(false, r.error);

  void (async () => {
    try {
      const { notifyUserCreated } = await import("@/lib/telegram");
      await notifyUserCreated({ ...reseller, brandName: reseller.brandName }, [{ email: r.email, subLink: r.subLink, trafficGB }], "single");
    } catch {
      /* بی‌صدا */
    }
  })();

  return xui(true, "", { email: r.email, subId: r.subId, subLink: r.subLink, trafficGB });
}

async function bridgeAddClient(req: NextRequest, reseller: ResellerWithInbounds) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return xui(false, "بدنه JSON نامعتبر است");
  }

  // فرمت یکپارچه 3x-ui: {client, inboundIds} — یا ساده: {inboundId, client}
  let client = (body.client || null) as Record<string, unknown> | null;
  let inboundIdsRaw: unknown = body.inboundIds;
  if (!client && typeof body.email === "string") {
    client = body;
    inboundIdsRaw = body.inboundIds ?? body.inboundId;
  }
  if (!client || typeof client !== "object") {
    return xui(false, "کلاینت در بدنه یافت نشد");
  }
  const ids = (Array.isArray(inboundIdsRaw) ? inboundIdsRaw : [inboundIdsRaw])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
  if (ids.length === 0) return xui(false, "هیچ اینباندی مشخص نشده است");
  return createOneViaBridge(reseller, client, ids);
}

/** فرمت قدیمی: POST /panel/api/inbounds/{id}/addClient با {id, settings: "JSON"} */
async function bridgeLegacyAddClient(req: NextRequest, reseller: ResellerWithInbounds) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return xui(false, "بدنه JSON نامعتبر است");
  }
  let clients: unknown;
  try {
    const settings = typeof body.settings === "string" ? JSON.parse(body.settings) : body.settings;
    clients = (settings as { clients?: unknown })?.clients;
  } catch {
    return xui(false, "settings نامعتبر است");
  }
  if (!Array.isArray(clients) || clients.length === 0) return xui(false, "کلاینت در settings یافت نشد");

  const inboundId = Number(body.id);
  const results: unknown[] = [];
  for (const c of clients as Record<string, unknown>[]) {
    const r = await createOneViaBridge(reseller, c, [inboundId]);
    const j = (await r.json()) as { success: boolean; msg?: string; obj?: unknown };
    if (!j.success) return xui(false, j.msg || "ساخت کاربر ناموفق بود");
    results.push(j.obj);
  }
  return xui(true, "", results);
}

// ============================================================ ربات میرزا (x-ui_single)
/** GET /panel/api/inbounds/getClientTraffics/{email} — وضعیت کاربر؛ obj شامل inboundId/uuid/آمار */
async function bridgeGetClientTraffics(reseller: ResellerWithInbounds, email: string) {
  const tracked = await db.resellerUser.findUnique({
    where: { resellerId_email: { resellerId: reseller.id, email } },
  });
  if (!tracked) {
    return Response.json({ success: false, msg: "user not found", obj: null });
  }
  const panelResult = await getAllPanelInbounds();
  if (!panelResult.ok) {
    return Response.json({ success: false, msg: panelResult.msg || "هیچ پنلی در دسترس نیست", obj: null });
  }

  // رکورد زنده و آمار کاربر — همان منطق داشبورد: بین پنل‌ها بیشینه مصرف
  type LiveClient = { id?: string; password?: string; flow?: string; limitIp?: number; enable?: boolean; subId?: string };
  let live: LiveClient | null = null;
  let stats: { up: number; down: number; total: number; expiryTime: number; enable?: boolean } | null = null;
  let inboundId = reseller.inbounds[0]?.inboundId ?? 0;
  for (const bundle of panelResult.panels) {
    for (const inb of bundle.inbounds) {
      const rec = inb.clients.find((c) => c.email === email);
      const st = inb.clientStats.find((c) => c.email === email);
      if (rec) live = rec as LiveClient;
      if (st) {
        inboundId = inb.id;
        if (!stats || st.up + st.down > stats.up + stats.down) {
          stats = { up: st.up || 0, down: st.down || 0, total: st.total || 0, expiryTime: st.expiryTime || 0, enable: st.enable };
        }
      }
    }
  }

  const obj = {
    id: live?.id || "",
    uuid: live?.id || "",
    password: live?.password || "",
    flow: live?.flow || "",
    email,
    subId: tracked.subId || live?.subId || "",
    limitIp: live?.limitIp ?? 0,
    total: stats?.total || (tracked.trafficGB > 0 ? gbToBytes(tracked.trafficGB) : 0),
    up: stats?.up || 0,
    down: stats?.down || 0,
    expiryTime: stats?.expiryTime || 0,
    enable: stats?.enable ?? live?.enable ?? true,
    inboundId,
  };
  return Response.json({ success: true, msg: "", obj });
}

/** POST /panel/api/inbounds/addClient — بدنه میرزا: {id: inboundId, settings: "JSON{clients:[...]}", decryption, fallbacks} */
async function bridgeMirzaAddClient(req: NextRequest, reseller: ResellerWithInbounds) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return xui(false, "بدنه JSON نامعتبر است");
  }
  const inboundId = Number(body.id);
  if (!Number.isFinite(inboundId)) return xui(false, "شناسه اینباند نامعتبر است");

  let clients: unknown;
  try {
    const settings = typeof body.settings === "string" ? JSON.parse(body.settings) : body.settings;
    clients = (settings as { clients?: unknown })?.clients;
  } catch {
    return xui(false, "settings نامعتبر است");
  }
  if (!Array.isArray(clients) || clients.length === 0) return xui(false, "کلاینت در settings یافت نشد");

  for (const c of clients as Record<string, unknown>[]) {
    const r = await createOneViaBridge(reseller, c, [inboundId]);
    const j = (await r.json()) as { success: boolean; msg?: string };
    if (!j.success) return xui(false, j.msg || "ساخت کاربر ناموفق بود");
  }
  return xui(true, "");
}

/** وضعیت سرور پنل اصلی — فقط برای نمایش وضعیت اتصال در ربات */
async function bridgeServerStatus() {
  const { getPrimaryPanel, getPanelConnection } = await import("@/lib/panel-manager");
  const { getServerStatus } = await import("@/lib/panel");
  const primary = await getPrimaryPanel();
  if (!primary) return xui(false, "پنلی متصل نیست");
  const conn = await getPanelConnection(primary.id);
  if (!conn.ok) return xui(false, conn.msg);
  const st = await getServerStatus(conn.conn as PanelAuth);
  if (!st.ok || !st.data) return xui(false, st.msg || "وضعیت سرور دریافت نشد");
  return xui(true, "", {
    cpu: st.data.cpu,
    cpuColor: "",
    mem: { current: st.data.memUsed, total: st.data.memTotal },
    disk: {},
    xray: { state: st.data.xrayRunning ? "running" : "stopped", running: st.data.xrayRunning, error: "" },
    uptime: st.data.uptime,
    netIO: { up: st.data.up, down: st.data.down },
    tcpCount: st.data.tcpCount,
  });
}

/** تنظیمات سابسکریپشن پنل — برای ساخت لینک ساب توسط ربات */
async function bridgeSetting() {
  const { getPrimaryPanel } = await import("@/lib/panel-manager");
  const panel = await getPrimaryPanel();
  if (!panel?.subBase) return xui(true, "", { subEnable: false });
  let port = "";
  let host = "";
  try {
    const u = new URL(panel.subBase.trim());
    host = u.hostname;
    port = u.port || "443";
  } catch {
    host = panel.subBase.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
  const subPath = (panel.subPath || "sub").replace(/^\/+|\/+$/g, "");
  return xui(true, "", {
    subEnable: true,
    subPort: Number(port) || 443,
    subPath: `/${subPath}/`,
    subDomain: host,
    subURI: panel.subBase.trim(),
    subJsonURI: "",
    subTLS: panel.subBase.trim().startsWith("https"),
  });
}

async function bridgeUpdateClient(req: NextRequest, reseller: ResellerWithInbounds, email: string) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return xui(false, "بدنه JSON نامعتبر است");
  }

  // بدنه میرزا: {id (اینباند یا uuid جدید), settings: "JSON{clients:[{id (uuid جدید), email, totalGB, expiryTime, enable, subId}]}"}
  let payload = body;
  if (body.settings !== undefined) {
    try {
      const settings = typeof body.settings === "string" ? JSON.parse(body.settings) : body.settings;
      const clients = (settings as { clients?: unknown })?.clients;
      if (!Array.isArray(clients) || clients.length === 0) return xui(false, "کلاینت در settings یافت نشد");
      payload = clients[0] as Record<string, unknown>;
      const settingsEmail = String((payload as Record<string, unknown>).email || "").trim();
      if (settingsEmail) email = settingsEmail;
    } catch {
      return xui(false, "settings نامعتبر است");
    }
  }

  const tracked = await db.resellerUser.findUnique({
    where: { resellerId_email: { resellerId: reseller.id, email } },
  });
  if (!tracked) return xui(false, "کاربر یافت نشد");

  // سهمیه — با اعتبارسنجی پول (مصرف قطعی لحاظ می‌شود)
  const trafficGB =
    payload.totalGB !== undefined
      ? (Math.max(0, Number(payload.totalGB) || 0) > 0 ? bytesToGB(Math.max(0, Number(payload.totalGB) || 0)) : 0)
      : payload.trafficGB !== undefined
        ? Math.max(0, Number(payload.trafficGB) || 0)
        : tracked.trafficGB;
  return withResellerLock(reseller.id, async () => {
  if (trafficGB !== tracked.trafficGB) {
    const [allocatedGB, consumedGB] = await Promise.all([getAllocatedGB(reseller.id, tracked.id), getConsumedGB(reseller.id)]);
    const pool = validatePoolAllocation(reseller.trafficPoolGB, allocatedGB, trafficGB, tracked.trafficGB, consumedGB);
    if (!pool.ok) return xui(false, pool.msg);
  }

  const expiryTime = payload.expiryTime !== undefined ? Math.max(0, Number(payload.expiryTime) || 0) : undefined;
  const enable = payload.enable !== undefined ? !!payload.enable : undefined;
  const ipLimit = payload.limitIp !== undefined ? Math.max(0, Number(payload.limitIp) || 0) : 0;
  const newUuid = typeof payload.id === "string" && payload.id.trim() ? payload.id.trim() : undefined;
  const newSubId = typeof payload.subId === "string" && payload.subId.trim() ? payload.subId.trim() : undefined;

  // اعمال روی پنل‌های دارای این کاربر
  const panelResult = await getAllPanelInbounds();
  if (!panelResult.ok) return xui(false, panelResult.msg || "هیچ پنلی در دسترس نیست");
  const refs = parseInboundRefs(tracked.inboundIds, tracked.panelId);
  const errors: string[] = [];
  const donePanels = new Set<string>();
  for (const ref of refs) {
    if (donePanels.has(ref.panelId)) continue;
    donePanels.add(ref.panelId);
    const bundle = panelResult.panels.find((p) => p.panelId === ref.panelId);
    if (!bundle) continue;
    const inb = bundle.inbounds.find((x) => x.id === ref.inboundId);
    const exists = inb ? inb.clients.some((c) => c.email === email) || inb.clientStats.some((c) => c.email === email) : false;
    if (!exists) continue;
    const conn = await getPanelConnection(ref.panelId);
    if (!conn.ok) { errors.push(conn.msg); continue; }
    const upd = await updateClient(conn.conn as PanelAuth, email, inb?.protocol || "vless", {
      email,
      id: newUuid,
      limitIp: ipLimit,
      totalGB: trafficGB > 0 ? trafficGB * GB : 0,
      expiryTime: expiryTime ?? undefined,
      enable: enable ?? true,
      subId: newSubId || tracked.subId || "",
    });
    if (!upd.ok) errors.push(upd.msg || "ویرایش ناموفق");
  }
  if (errors.length) return xui(false, errors.join(" | "));

  await db.resellerUser.update({
    where: { id: tracked.id },
    data: { trafficGB, ...(newSubId ? { subId: newSubId } : {}) },
  });
  await logActivity({
    actorType: "RESELLER",
    actorName: reseller.username,
    action: "ویرایش کاربر از طریق پل ربات",
    detail: `${email} | سهمیه: ${trafficGB || "نامحدود"}GB`,
    resellerId: reseller.id,
  });
  return xui(true, "");
  });
}

async function bridgeDeleteClient(reseller: ResellerWithInbounds, email: string) {
  const tracked = await db.resellerUser.findUnique({
    where: { resellerId_email: { resellerId: reseller.id, email } },
  });
  if (!tracked) return xui(false, "کاربر یافت نشد");

  const result = await deleteUserByJournal(reseller, tracked, reseller.username);
  if (!result.ok) return xui(false, result.msg);
  return xui(true, "");
}

async function bridgeResetTraffic(reseller: ResellerWithInbounds, email: string) {
  const tracked = await db.resellerUser.findUnique({
    where: { resellerId_email: { resellerId: reseller.id, email } },
  });
  if (!tracked) return xui(false, "کاربر یافت نشد");

  const result = await resetUserByJournal(reseller, tracked, reseller.username);
  if (!result.ok) return xui(false, result.msg);
  return xui(true, "");
}

async function bridgeOnlines(reseller: ResellerWithInbounds) {
  const tracked = await db.resellerUser.findMany({ where: { resellerId: reseller.id }, select: { email: true } });
  const emails = new Set(tracked.map((t) => t.email));
  const r = await getOnlineAcrossPanels();
  const online = r.ok ? r.online.filter((e) => emails.has(e)) : [];
  return xui(true, "", online);
}
