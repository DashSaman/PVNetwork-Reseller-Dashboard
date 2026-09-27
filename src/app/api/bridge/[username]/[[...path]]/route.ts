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
  debitUsedTraffic,
  parseInboundRefs,
  refKey,
  bytesToGB,
  gbToBytes,
  type InboundRef,
  type ResellerWithInbounds,
} from "@/lib/reseller-helpers";
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

  return xui(false, "مسیر پشتیبانی نمی‌شود");
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { username, path } = await ctx.params;
  const parts = (path || []).join("/");

  const auth = await getBridgeReseller(req, username);
  if (!auth.ok) return xui(false, auth.error);

  if (parts === "panel/api/inbounds/list") return bridgeInboundList(auth.reseller);
  if (parts === "panel/api/clients/list") return bridgeClientList(auth.reseller);

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
  if (!client && body.settings !== undefined) {
    // فرمت قدیمی per-inbound: {id, settings: JSON {clients: [...]}}
    try {
      const settings = typeof body.settings === "string" ? JSON.parse(String(body.settings)) : body.settings;
      const clients = (settings as { clients?: unknown })?.clients;
      if (Array.isArray(clients) && clients.length > 0) {
        client = clients[0] as Record<string, unknown>;
        inboundIdsRaw = [body.id];
      }
    } catch {
      /* ignore */
    }
  }
  if (!client && typeof body.email === "string") {
    // فرمت ساده {email, totalGB(ms?), inboundId}
    client = body;
    inboundIdsRaw = body.inboundIds ?? body.inboundId;
  }
  if (!client || typeof client !== "object") {
    return xui(false, "کلاینت در بدنه یافت نشد");
  }

  // اینباندهای مقصد — فقط از دسترسی‌های مجاز
  const ids = (Array.isArray(inboundIdsRaw) ? inboundIdsRaw : [inboundIdsRaw])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
  if (ids.length === 0) return xui(false, "هیچ اینباندی مشخص نشده است");

  const panelResult = await getAllPanelInbounds();
  if (!panelResult.ok) return xui(false, panelResult.msg || "هیچ پنلی در دسترس نیست");
  const allowed = await allowedRefsResolved(reseller);
  const inboundIndex = new Map<string, { panelId: string; inboundId: number; protocol: string }>();
  for (const bundle of panelResult.panels) {
    for (const inb of bundle.inbounds) {
      inboundIndex.set(`${bundle.panelId}#${inb.id}`, { panelId: bundle.panelId, inboundId: inb.id, protocol: inb.protocol });
    }
  }
  const refs: InboundRef[] = [];
  for (const id of ids) {
    // اگه panelId مشخصی ارسال نشده، اینباند را در پنل‌ها جستجو کن
    let found: { panelId: string; inboundId: number; protocol: string } | undefined =
      inboundIndex.get(`${reseller.inbounds[0]?.panelId || ""}#${id}`);
    if (!found || !allowed.has(refKey({ panelId: found.panelId, inboundId: id }))) {
      for (const v of inboundIndex.values()) {
        if (v.inboundId === id) {
          const key = refKey({ panelId: v.panelId, inboundId: v.inboundId });
          if (allowed.has(key)) { found = v; break; }
        }
      }
    }
    if (!found || !allowed.has(refKey({ panelId: found.panelId, inboundId: id }))) {
      return xui(false, `اینباند ${id} در دسترسی‌های شما نیست`);
    }
    refs.push({ panelId: found.panelId, inboundId: id });
  }

  // پارامترهای کلاینت — totalGB به بایت، expiryTime به میلی‌ثانیه (قرارداد 3x-ui)
  const rawEmail = String(client.email || body.email || "").trim();
  const name = rawEmail.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || `bot-${Date.now()}`;
  const totalBytes = Math.max(0, Number(client.totalGB ?? body.totalGB ?? 0) || 0);
  const trafficGB = totalBytes > 0 ? bytesToGB(totalBytes) : 0;
  const expiryTime = Math.max(0, Number(client.expiryTime ?? body.expiryTime ?? 0) || 0);
  const ipLimit = Math.max(0, Number(client.limitIp ?? body.limitIp ?? 0) || 0);
  const subIdRaw = String(client.subId ?? body.subId ?? "").trim();

  const r = await createResellerUserCore(reseller, {
    name,
    trafficGB,
    expiryTime,
    ipLimit,
    refs,
    exactEmail: name,
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

async function bridgeUpdateClient(req: NextRequest, reseller: ResellerWithInbounds, email: string) {
  const tracked = await db.resellerUser.findUnique({
    where: { resellerId_email: { resellerId: reseller.id, email } },
  });
  if (!tracked) return xui(false, "کاربر یافت نشد");

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return xui(false, "بدنه JSON نامعتبر است");
  }

  // سهمیه — با اعتبارسنجی پول (مصرف قطعی لحاظ می‌شود)
  const trafficGB =
    body.totalGB !== undefined
      ? (Math.max(0, Number(body.totalGB) || 0) > 0 ? bytesToGB(Math.max(0, Number(body.totalGB) || 0)) : 0)
      : body.trafficGB !== undefined
        ? Math.max(0, Number(body.trafficGB) || 0)
        : tracked.trafficGB;
  if (trafficGB !== tracked.trafficGB) {
    const [allocatedGB, consumedGB] = await Promise.all([getAllocatedGB(reseller.id, tracked.id), getConsumedGB(reseller.id)]);
    const pool = validatePoolAllocation(reseller.trafficPoolGB, allocatedGB, trafficGB, tracked.trafficGB, consumedGB);
    if (!pool.ok) return xui(false, pool.msg);
  }

  const expiryTime = body.expiryTime !== undefined ? Math.max(0, Number(body.expiryTime) || 0) : undefined;
  const enable = body.enable !== undefined ? !!body.enable : undefined;
  const ipLimit = body.limitIp !== undefined ? Math.max(0, Number(body.limitIp) || 0) : 0;

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
      limitIp: ipLimit,
      totalGB: trafficGB > 0 ? trafficGB * GB : 0,
      expiryTime: expiryTime ?? undefined,
      enable: enable ?? true,
      subId: tracked.subId || "",
    });
    if (!upd.ok) errors.push(upd.msg || "ویرایش ناموفق");
  }
  if (errors.length) return xui(false, errors.join(" | "));

  await db.resellerUser.update({ where: { id: tracked.id }, data: { trafficGB } });
  return xui(true, "");
}

async function bridgeDeleteClient(reseller: ResellerWithInbounds, email: string) {
  const tracked = await db.resellerUser.findUnique({
    where: { resellerId_email: { resellerId: reseller.id, email } },
  });
  if (!tracked) return xui(false, "کاربر یافت نشد");

  await debitUsedTraffic(reseller.id, email).catch(() => undefined);

  const panels = await db.panelConfig.findMany({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
  for (const panel of panels) {
    const conn = await getPanelConnection(panel.id);
    if (!conn.ok) continue;
    await deleteClient(conn.conn as PanelAuth, email);
  }
  await db.resellerUser.delete({ where: { id: tracked.id } });
  await logActivity({
    actorType: "RESELLER",
    actorName: reseller.username,
    action: "حذف کاربر از طریق پل ربات",
    detail: email,
    resellerId: reseller.id,
  });
  return xui(true, "");
}

async function bridgeResetTraffic(reseller: ResellerWithInbounds, email: string) {
  const tracked = await db.resellerUser.findUnique({
    where: { resellerId_email: { resellerId: reseller.id, email } },
  });
  if (!tracked) return xui(false, "کاربر یافت نشد");

  await debitUsedTraffic(reseller.id, email).catch(() => undefined);

  const panels = await db.panelConfig.findMany({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
  let anyOk = false;
  for (const panel of panels) {
    const conn = await getPanelConnection(panel.id);
    if (!conn.ok) continue;
    const r = await resetClientTraffic(conn.conn as PanelAuth, email);
    if (r.ok) anyOk = true;
  }
  if (!anyOk) return xui(false, "ریست ترافیک روی هیچ پنلی انجام نشد");
  return xui(true, "");
}

async function bridgeOnlines(reseller: ResellerWithInbounds) {
  const tracked = await db.resellerUser.findMany({ where: { resellerId: reseller.id }, select: { email: true } });
  const emails = new Set(tracked.map((t) => t.email));
  const r = await getOnlineAcrossPanels();
  const online = r.ok ? r.online.filter((e) => emails.has(e)) : [];
  return xui(true, "", online);
}
