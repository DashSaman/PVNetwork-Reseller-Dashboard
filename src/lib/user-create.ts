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
  /** استفاده توسط پل 3x-ui (ربات میرزا): استفاده از ایمیل ارسالی بدون پسوند تصادفی */
  exactEmail?: string;
  /** uuid دلخواه ربات — رها شود تا uuid تصادفی ساخته شود */
  exactUuid?: string;
  /** شناسه سابسکریپشن دلخواه ربات — خالی = تولید خودکار */
  subId?: string;
};

/** حذف جبرانی کپی‌های ساخته‌شده روی پنل‌های موفق — true یعنی جبران کامل */
async function compensatePartialCreate(
  reseller: ResellerWithInbounds,
  email: string,
  createdPanels: string[]
): Promise<boolean> {
  if (createdPanels.length === 0) return true;
  let allOk = true;
  const { getPanelConnection } = await import("./panel-manager");
  const { deleteClient } = await import("./panel");
  for (const panelId of createdPanels) {
    try {
      const conn = await getPanelConnection(panelId);
      if (!conn.ok) { allOk = false; continue; }
      const r = await deleteClient(conn.conn as unknown as Parameters<typeof deleteClient>[0], email);
      if (!r.ok) allOk = false;
    } catch {
      allOk = false;
    }
  }
  return allOk;
}

/** ثبت کاربر یتیم NEEDS_REPAIR — سهمیه رزرو می‌ماند و برای بررسی دستی ثبت می‌شود */
async function recordOrphanRepair(
  reseller: ResellerWithInbounds,
  email: string,
  createdPanels: string[],
  params: CoreUserParams,
  lastError: string
): Promise<void> {
  await db.operationJournal.create({
    data: {
      idempotencyKey: `create-orphan:${email}:${Date.now()}`,
      resellerId: reseller.id,
      email,
      type: "CREATE",
      status: "NEEDS_REPAIR",
      targetPanels: JSON.stringify(createdPanels),
      lastError,
      metadata: JSON.stringify({ trafficGB: params.trafficGB, expiryTime: params.expiryTime, refs: params.refs }),
    },
  });
  await logActivity({
    actorType: "RESELLER",
    actorName: reseller.username,
    action: "کاربر یتیم پس از ساخت ناقص — NEEDS_REPAIR",
    detail: `${email} روی پنل‌های ${createdPanels.join(", ")} ساخته شده و حذف جبرانی ناموفق بود`,
    resellerId: reseller.id,
  });
}

export type CoreUserResult =
  | { ok: true; email: string; subId: string; subLink: string | null }
  | { ok: false; error: string; status: number };

export async function createResellerUserCore(
  reseller: ResellerWithInbounds,
  params: CoreUserParams,
  snapshot?: AllPanelsResult | null
): Promise<CoreUserResult> {
  // مسیر عمومی: همیشه قفل + بررسی پول — هیچ مسیری امکان عبور از بررسی سهمیه ندارد
  const { withResellerLock } = await import("./reseller-helpers");
  return withResellerLock(reseller.id, () => createResellerUserCoreInner(reseller, params, snapshot ?? null, { checkPool: true }));
}

/**
 * فقط از داخل قفلِ پیش‌تر گرفته‌شدهٔ نماینده (ساخت گروهی — پیش‌بررسی کل دسته در همان قفل انجام شده).
 * نام صریح برای جلوگیری از استفاده تصادفی به‌عنوان میان‌بر عبور از بررسی سهمیه.
 */
export async function createResellerUserCoreWithinResellerLock(
  reseller: ResellerWithInbounds,
  params: CoreUserParams,
  snapshot?: AllPanelsResult | null
): Promise<CoreUserResult> {
  return createResellerUserCoreInner(reseller, params, snapshot ?? null, { checkPool: false });
}

async function createResellerUserCoreInner(
  reseller: ResellerWithInbounds,
  params: CoreUserParams,
  snapshot: AllPanelsResult | null,
  opts: { checkPool: boolean }
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
  const selection = await validateInboundSelection(reseller, refs);
  if (!selection.ok) return { ok: false, error: selection.msg, status: 403 };

  // ---- پول ترافیک (در ساخت گروهی پیش‌موجه بررسی شده — skip) ----
  if (opts.checkPool) {
    const { getAllocatedGB, getConsumedGB, validatePoolAllocation } = await import("./reseller-helpers");
    const [allocatedGB, consumedGB] = await Promise.all([getAllocatedGB(reseller.id), getConsumedGB(reseller.id)]);
    const pool = validatePoolAllocation(reseller.trafficPoolGB, allocatedGB, params.trafficGB, 0, consumedGB);
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
  // پل 3x-ui (ربات میرزا): ایمیل دقیق و subId دلخواه ربات؛ در داشبورد: پسوند تصادفی
  let email: string;
  if (params.exactEmail) {
    email = params.exactEmail.trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 32);
    if (email.length < 3) {
      return { ok: false, error: "ایمیل/نام کاربری باید حداقل ۳ کاراکتر معتبر باشد", status: 400 };
    }
  } else {
    email = `${name}-${randomHex(4)}`;
  }
  const subId = (params.subId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || randomHex(16);
  const uuid = (params.exactUuid || "").trim() || randomUuid();

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
  const createdPanels: string[] = [];
  for (const [panelId, inboundIds] of byPanel) {
    const conn = await getPanelConnection(panelId);
    if (!conn.ok) {
      const repaired = await compensatePartialCreate(reseller, email, createdPanels);
      if (!repaired) await recordOrphanRepair(reseller, email, createdPanels, params, "اتصال پنل قطع شد");
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
      // ساخت ناقص چندپنلی: حذف جبرانی روی پنل‌های موفق — کاربر یتیم نمی‌ماند
      const repaired = await compensatePartialCreate(reseller, email, createdPanels);
      if (!repaired) {
        await recordOrphanRepair(reseller, email, createdPanels, params, r.msg || "unknown");
        return { ok: false, error: `ساخت روی بعضی پنل‌ها ناموفق بود و حذف جبرانی هم انجام نشد — برای بررسی دستی ثبت شد: ${r.msg}`, status: 502 };
      }
      return { ok: false, error: `ساخت کاربر ناموفق بود: ${r.msg}`, status: 502 };
    }
    createdPanels.push(panelId);
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
