import { db } from "@/lib/db";
import { getPanelConnection, getAllPanelInbounds, buildSubLink, type AllPanelsResult } from "./panel-manager";
import { addClient, type PanelAuth, type PanelClient } from "./panel";
import { randomHex, randomUuid } from "./crypto";
import { logActivity } from "./logger";
import {
  validateInboundSelection,
  validateUsername,
  sanitizeName,
  stringifyInboundRefs,
  refKey,
  type InboundRef,
  type ResellerWithInbounds,
} from "./reseller-helpers";

/**
 * هسته مشترک ساخت کاربر (تک‌کاربره و گروهی):
 * اعتبارسنجی نام → اینباندهای زنده → عدم تکرار → افزودن به پنل(ها) → ثبت در دیتابیس → لاگ
 * snapshot: نتیجه از پیش دریافت‌شده getAllPanelInbounds — در ساخت گروهی فقط یک بار گرفته می‌شود
 */
export type CoreUserParams = {
  name: string;
  trafficGB: number; // ۰ = نامحدود
  expiryTime: number; // میلی‌ثانیه epoch یا ۰ = نامحدود
  ipLimit: number;
  refs: InboundRef[];
};

export type CoreUserResult =
  | { ok: true; email: string; subId: string; subLink: string | null }
  | { ok: false; error: string; status: number };

export async function createResellerUserCore(
  reseller: ResellerWithInbounds,
  params: CoreUserParams,
  snapshot?: AllPanelsResult | null,
  opts?: { skipPoolCheck?: boolean }
): Promise<CoreUserResult> {
  // ---- نام ----
  const nameCheck = validateUsername(params.name.trim());
  if (!nameCheck.ok) return { ok: false, error: nameCheck.msg, status: 400 };
  const name = sanitizeName(params.name);
  if (!name || name.length < 2) {
    return { ok: false, error: "نام کاربر باید حداقل ۲ کاراکتر باشد", status: 400 };
  }

  // ---- اینباندها ----
  const refs = params.refs
    .map((r) => ({ panelId: r.panelId || "", inboundId: Number(r.inboundId) }))
    .filter((r) => Number.isFinite(r.inboundId));
  if (refs.length === 0) {
    return { ok: false, error: "حداقل یک اینباند باید انتخاب شود", status: 400 };
  }
  const selection = validateInboundSelection(reseller, refs);
  if (!selection.ok) return { ok: false, error: selection.msg, status: 403 };

  // ---- پول ترافیک (در ساخت گروهی پیش‌موجه بررسی شده — skip) ----
  if (!opts?.skipPoolCheck) {
    const { getAllocatedGB, validatePoolAllocation } = await import("./reseller-helpers");
    const allocatedGB = await getAllocatedGB(reseller.id);
    const pool = validatePoolAllocation(reseller.trafficPoolGB, allocatedGB, params.trafficGB);
    if (!pool.ok) return { ok: false, error: pool.msg, status: 403 };
  }

  // ---- اینباندهای زنده همه پنل‌ها ----
  const panelResult = snapshot || (await getAllPanelInbounds());
  if (!panelResult.ok) {
    return { ok: false, error: panelResult.msg || "هیچ پنلی در دسترس نیست", status: 502 };
  }
  const inboundIndex = new Map<string, { protocol: string; panelName: string }>();
  for (const bundle of panelResult.panels) {
    for (const inb of bundle.inbounds) {
      inboundIndex.set(refKey({ panelId: bundle.panelId, inboundId: inb.id }), {
        protocol: inb.protocol,
        panelName: bundle.panelName,
      });
    }
  }
  for (const ref of refs) {
    if (!inboundIndex.has(refKey(ref))) {
      return { ok: false, error: "اینباند انتخابی در پنل در دسترس نیست", status: 400 };
    }
  }

  // ---- شناسه‌ها ----
  const email = `${name}-${randomHex(4)}`;
  const subId = randomHex(16);
  const uuid = randomUuid();

  // عدم تکراری بودن ایمیل در همه پنل‌ها
  for (const bundle of panelResult.panels) {
    for (const inb of bundle.inbounds) {
      if (inb.clientStats.some((c) => c.email === email) || inb.clients.some((c) => c.email === email)) {
        return { ok: false, error: "این نام در پنل تکراری است، نام دیگری انتخاب کنید", status: 409 };
      }
    }
  }

  // ---- افزودن به پنل‌ها (گروه‌بندی refs به تفکیک پنل) ----
  const byPanel = new Map<string, number[]>();
  for (const ref of refs) {
    const arr = byPanel.get(ref.panelId) || [];
    arr.push(ref.inboundId);
    byPanel.set(ref.panelId, arr);
  }
  for (const [panelId, inboundIds] of byPanel) {
    const conn = await getPanelConnection(panelId);
    if (!conn.ok) {
      return { ok: false, error: `اتصال به پنل ناموفق: ${conn.msg}`, status: 502 };
    }
    const firstProtocol = inboundIndex.get(refKey({ panelId, inboundId: inboundIds[0] }))?.protocol || "vless";
    const r = await addClient(conn.conn as PanelAuth, inboundIds, firstProtocol, {
      id: uuid,
      password: uuid,
      email,
      limitIp: reseller.allowIpLimit ? params.ipLimit : 0,
      totalGB: params.trafficGB ? params.trafficGB * 1024 * 1024 * 1024 : 0,
      expiryTime: params.expiryTime,
      enable: true,
      subId,
    } as Partial<PanelClient>);
    if (!r.ok) {
      await logActivity({
        actorType: "RESELLER",
        actorName: reseller.username,
        action: "خطای ساخت کاربر",
        detail: `${email}: ${r.msg}`,
        resellerId: reseller.id,
      });
      return { ok: false, error: `ساخت کاربر ناموفق بود: ${r.msg}`, status: 502 };
    }
  }

  // ---- ثبت در دیتابیس + لاگ ----
  await db.resellerUser.create({
    data: {
      resellerId: reseller.id,
      email,
      name: params.name.trim().slice(0, 60) || null,
      subId,
      inboundIds: stringifyInboundRefs(refs),
      panelId: refs[0].panelId || "",
      trafficGB: params.trafficGB,
    },
  });

  const subLink = await buildSubLink(subId, reseller, refs[0].panelId || "");
  await logActivity({
    actorType: "RESELLER",
    actorName: reseller.username,
    action: "ایجاد کاربر",
    detail: `${email} | سهمیه: ${params.trafficGB || "نامحدود"}GB | اینباندها: ${refs
      .map((r) => `${r.panelId ? r.panelId.slice(0, 6) : "main"}#${r.inboundId}`)
      .join(", ")}`,
    resellerId: reseller.id,
  });

  return { ok: true, email, subId, subLink };
}
