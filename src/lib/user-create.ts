import { db } from "@/lib/db";
import { getPanelConnection, getAllPanelInboundsFresh, buildSubLink, type AllPanelsResult } from "./panel-manager";
import { addClient, type PanelAuth, type PanelClient } from "./panel";
import { randomHex, randomUuid } from "./crypto";
type TypePanelAuth = import("./panel").PanelAuth;
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
  /** هویت idempotent درخواست (داشبورد/کلاینت) — retry همان عملیات را resume می‌کند */
  requestId?: string;
  /** شناسه سابسکریپشن دلخواه ربات — خالی = تولید خودکار */
  subId?: string;
};

/** بررسی وضعیت واقعی ریموت پس از شکست مبهم addClient — timeout/خطای شبکه ≠ عدم ساخت */
async function verifyRemoteAbsent(panelId: string, email: string): Promise<"ABSENT" | "PRESENT" | "UNKNOWN"> {
  try {
    const { getPanelConnection } = await import("./panel-manager");
    const { getInbounds } = await import("./panel");
    const conn = await getPanelConnection(panelId);
    if (!conn.ok) return "UNKNOWN";
    const r = await getInbounds(conn.conn as Parameters<typeof getInbounds>[0]);
    if (!r.ok || !r.data) return "UNKNOWN";
    for (const inb of r.data) {
      if (inb.clients.some((c) => c.email === email) || inb.clientStats.some((c) => c.email === email)) return "PRESENT";
    }
    return "ABSENT";
  } catch {
    return "UNKNOWN";
  }
}

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


/**
 * ادامهٔ CREATE نیمه‌کاره از metadata «اصلی» ژورنال — هیچ شناسهٔ جدیدی تولید نمی‌شود (C4).
 * اگر ریموت کامل است → finalize؛ اگر ناقص → تلاش برای تکمیل پنل‌های مانده با پارامترهای اصلی.
 */
async function resumeCreateFromJournal(
  reseller: ResellerWithInbounds,
  journalId: string,
  meta: { email: string; subId: string; trafficGB: number; expiryTime: number; ipLimit: number; refs: InboundRef[]; name: string },
  snapshot: AllPanelsResult | null
): Promise<CoreUserResult> {
  const panelResult = snapshot || (await getAllPanelInboundsFresh());
  if (!panelResult.ok) return { ok: false, error: panelResult.msg || "هیچ پنلی در دسترس نیست", status: 502 };
  const uuid = randomUuid(); // uuid فقط برای پنل‌های «ناموفق قبلی» که کلاینت ندارند — اگر داشته باشند add رد می‌شود و duplicate-detect ریموت را می‌بندد
  const byPanel = new Map<string, number[]>();
  for (const ref of meta.refs) {
    const arr = byPanel.get(ref.panelId) || [];
    arr.push(ref.inboundId);
    byPanel.set(ref.panelId, arr);
  }
  const { addClient } = await import("./panel");
  const { getPanelConnection } = await import("./panel-manager");
  const createdPanels: string[] = [];
  let remoteComplete = 0;
  for (const [panelId, inboundIds] of byPanel) {
    const present = panelResult.panels
      .find((b) => b.panelId === panelId)
      ?.inbounds.some((inb) => inboundIds.includes(inb.id) && (inb.clients.some((c) => c.email === meta.email) || inb.clientStats.some((c) => c.email === meta.email)));
    if (present) { remoteComplete++; createdPanels.push(panelId); continue; }
    const conn = await getPanelConnection(panelId);
    if (!conn.ok) continue;
    const r = await addClient(conn.conn as TypePanelAuth, inboundIds, "vless", {
      id: uuid, password: uuid, email: meta.email,
      limitIp: meta.ipLimit, totalGB: meta.trafficGB * 1024 * 1024 * 1024,
      expiryTime: meta.expiryTime, enable: true, subId: meta.subId,
    } as never);
    if (r.ok) { remoteComplete++; createdPanels.push(panelId); }
  }
  if (remoteComplete < byPanel.size) {
    await db.operationJournal.update({ where: { id: journalId }, data: { status: "NEEDS_REPAIR", lastError: "resume: remote incomplete" } });
    return { ok: false, error: "عملیات ساخت قبلی هنوز روی همهٔ پنل‌ها کامل نشده — پس از رفع مشکل، همان درخواست را تکرار کنید", status: 409 };
  }
  await finishCreateAtomically(journalId, reseller, { email: meta.email, subId: meta.subId, refs: meta.refs, trafficGB: meta.trafficGB, name: meta.name });
  await db.operationJournal.update({
    where: { id: journalId },
    data: { metadata: JSON.stringify({ name: meta.name, trafficGB: meta.trafficGB, expiryTime: meta.expiryTime, ipLimit: meta.ipLimit, refs: meta.refs, subId: meta.subId, email: meta.email, done: true }) },
  });
  const subLink = await buildSubLink(meta.subId, reseller, meta.refs[0]?.panelId || "");
  return { ok: true, email: meta.email, subId: meta.subId, subLink };
}

/**
 * finalize اتمیک CREATE — در یک تراکنش: ثبت ResellerUser (اگر نیست) + SUCCESS + reservedGB=0.
 * idempotent: تکرار (بازیابی پس از کرش) هیچ ردیف تکراری/دوباره‌حسابی نمی‌سازد.
 */
async function finishCreateAtomically(
  journalId: string,
  reseller: ResellerWithInbounds,
  info: { email: string; subId: string; refs: InboundRef[]; trafficGB: number; name: string }
): Promise<void> {
  await db.$transaction(async (tx) => {
    const j = await tx.operationJournal.findUnique({ where: { id: journalId } });
    if (!j || j.status === "SUCCESS") return; // idempotent
    const existing = await tx.resellerUser.findUnique({
      where: { resellerId_email: { resellerId: reseller.id, email: info.email } },
    });
    if (!existing) {
      await tx.resellerUser.create({
        data: {
          resellerId: reseller.id,
          email: info.email,
          name: info.name.trim().slice(0, 60) || null,
          subId: info.subId,
          inboundIds: stringifyInboundRefs(info.refs),
          panelId: info.refs[0].panelId || "",
          trafficGB: info.trafficGB,
        },
      });
    }
    await tx.operationJournal.update({
      where: { id: journalId },
      data: { status: "SUCCESS", reservedGB: 0, completedPanels: j.targetPanels, failedPanels: "[]" },
    });
  });
}

/** لاگ فعالیت یتیم — وضعیت ژورنال در createJournal تنظیم شده است */
async function recordOrphanRepair(
  reseller: ResellerWithInbounds,
  email: string,
  createdPanels: string[],
  params: CoreUserParams,
  lastError: string
): Promise<void> {
  await logActivity({
    actorType: "RESELLER",
    actorName: reseller.username,
    action: "کاربر یتیم پس از ساخت ناقص — NEEDS_REPAIR",
    detail: `${email} روی پنل‌های ${createdPanels.join(", ")} — ${lastError}`,
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
  // ---- بازیابی idempotent با requestId (قبل از هر محاسبهٔ جدید) ----
  if (params.requestId) {
    const key = `create-req:${params.requestId}`;
    const j = await db.operationJournal.findFirst({
      where: { resellerId: reseller.id, idempotencyKey: key, type: "CREATE" },
      orderBy: { createdAt: "desc" },
    });
    if (j) {
      const meta = JSON.parse(j.metadata || "{}") as {
        email?: string; subId?: string; trafficGB?: number; expiryTime?: number; ipLimit?: number;
        refs?: InboundRef[]; name?: string; done?: boolean;
      };
      // payload متفاوت با عملیات اصلی → تعارض (معنای عملیات عوض نمی‌شود)
      const samePayload =
        meta.trafficGB === params.trafficGB &&
        meta.expiryTime === params.expiryTime &&
        meta.ipLimit === params.ipLimit &&
        JSON.stringify(meta.refs) === JSON.stringify(params.refs);
      if (!samePayload) {
        return { ok: false, error: "این شناسهٔ درخواست قبلاً با پارامترهای متفاوت استفاده شده — عملیات جدید نیاز به شناسهٔ جدید دارد", status: 409 };
      }
      if (j.status === "SUCCESS" && meta.done && (meta.email || j.email)) {
        // عملیات قبلاً کامل شده — همان نتیجه را idempotent برگردان
        const subLink = await buildSubLink(meta.subId || "", reseller, meta.refs?.[0]?.panelId || "");
        return { ok: true, email: String(meta.email || j.email), subId: meta.subId || "", subLink };
      }
      // عملیات نیمه‌کاره — ایمیل اصلی روی خود ژورنال ذخیره شده (fail-safe)
      if (meta.subId && (meta.email || j.email)) {
        return await resumeCreateFromJournal(reseller, j.id, { email: String(meta.email || j.email), subId: meta.subId!, trafficGB: meta.trafficGB ?? params.trafficGB, expiryTime: meta.expiryTime ?? params.expiryTime, ipLimit: meta.ipLimit ?? params.ipLimit, refs: meta.refs ?? params.refs, name: meta.name || params.name }, snapshot);
      }
    }
  }

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
  {
    // C1 + مرجع سهمیه — برای هر مسیر (حتی داخل قفل گروهی) نگهبان نامحدودسازی اعمال می‌شود
    const { getQuotaState, validateRequestedUserQuota } = await import("./accounting-ops");
    const quota = await getQuotaState(reseller.id, reseller);
    const vq = validateRequestedUserQuota(quota, params.trafficGB);
    if (!vq.ok) return { ok: false, error: vq.msg, status: 403 };
    if (!quota.unlimited && params.trafficGB > quota.remaining) {
      return { ok: false, error: `پول ترافیک کافی نیست — باقیماندهٔ مؤثر شما: ${Math.round(quota.remaining * 100) / 100} گیگ (شامل رزروهای فعال)`, status: 403 };
    }
  }

  // ---- اینباندهای زنده همه پنل‌ها ----
  const panelResult = snapshot || (await getAllPanelInboundsFresh());
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

  // ---- شناسه‌ها (قبل از هر اثر ماندگار/ریموت — همهٔ validation سبک اینجا تمام می‌شود) ----
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
  let subId = (params.subId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "";
  if (params.subId && subId) {
    // پل/کلاینت subId مشخص داده — تصادم با کاربر دیگر ممنوع
    const clash = await db.resellerUser.findFirst({ where: { subId } });
    if (clash) return { ok: false, error: "این شناسهٔ اشتراک (subId) قبلاً به کاربر دیگری اختصاص یافته است", status: 409 };
  } else {
    // تولید با اطمینان یکتایی سراسری
    for (let attempt = 0; attempt < 3; attempt++) {
      subId = randomHex(16);
      const clash = await db.resellerUser.findFirst({ where: { subId } });
      if (!clash) break;
    }
  }
  const uuid = (params.exactUuid || "").trim() || randomUuid();

  // گروه‌بندی refs به تفکیک پنل (هدف تغییرناپذیر عملیات)
  const byPanel = new Map<string, number[]>();
  for (const ref of refs) {
    const arr = byPanel.get(ref.panelId) || [];
    arr.push(ref.inboundId);
    byPanel.set(ref.panelId, arr);
  }
  const targetPanelIds = [...byPanel.keys()];

  // عدم تکراری بودن ایمیل — با بازیابی عملیات قبلی (crash-after-remote)
  let remotePresentPanels = 0;
  for (const bundle of panelResult.panels) {
    for (const inb of bundle.inbounds) {
      if (inb.clientStats.some((c) => c.email === email) || inb.clients.some((c) => c.email === email)) {
        remotePresentPanels++;
        break;
      }
    }
  }
  if (remotePresentPanels > 0) {
    // آیا این، ادامهٔ عملیات CREATE قبلیِ همین نماینده است که ریموت کامل شده ولی محلی بسته نشده؟
    const stale = await db.operationJournal.findFirst({
      where: { resellerId: reseller.id, email, type: "CREATE", status: { in: ["RUNNING", "PARTIAL", "NEEDS_REPAIR"] } },
      orderBy: { createdAt: "desc" },
    });
    if (stale && remotePresentPanels >= targetPanelIds.length) {
      // بازیابی: ثبت محلی idempotent و بستن همان ژورنال (بدون ساخت مجدد ریموت)
      await finishCreateAtomically(stale.id, reseller, { email, subId, refs, trafficGB: params.trafficGB, name: params.name });
      const subLink = await buildSubLink(subId, reseller, refs[0].panelId || "");
      return { ok: true, email, subId, subLink };
    }
    if (stale) {
      // ریموت ناقص مانده از عملیات قبلی — همچنان NEEDS_REPAIR با رزرو فعال
      return { ok: false, error: "عملیات ساخت قبلی برای همین نام نیمه‌کاره است — پس از رفع مشکل پنل‌ها همان درخواست را تکرار کنید", status: 409 };
    }
    return { ok: false, error: "این نام در پنل تکراری است، نام دیگری انتخاب کنید", status: 409 };
  }

  // ---- ژورنال CREATE + رزرو — فقط پس از اتمام کامل validation بدون عارضهٔ ریموت ----
  // هویت ماندگار: ایمیل نهایی/هدف پنل‌ها/سهمیه/انقضا از این لحظه قابل بازیابی‌اند
  const createJournal = await db.operationJournal.create({
    data: {
      idempotencyKey: params.requestId ? `create-req:${params.requestId}` : `create:${params.name}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`,
      resellerId: reseller.id,
      email,
      type: "CREATE",
      status: "RUNNING",
      reservedGB: params.trafficGB,
      targetPanels: JSON.stringify(targetPanelIds),
      metadata: JSON.stringify({ name: params.name, trafficGB: params.trafficGB, expiryTime: params.expiryTime, ipLimit: params.ipLimit, refs, subId }),
    },
  });

  // ---- افزودن به پنل‌ها (به ترتیب هدف تغییرناپذیر) ----
  const createdPanels: string[] = [];
  for (const [panelId, inboundIds] of byPanel) {
    const conn = await getPanelConnection(panelId);
    if (!conn.ok) {
      const repaired = await compensatePartialCreate(reseller, email, createdPanels);
      if (!repaired) {
        await db.operationJournal.update({
          where: { id: createJournal.id },
          data: { status: "NEEDS_REPAIR", email, lastError: conn.msg, failedPanels: JSON.stringify(createdPanels) },
        });
        await recordOrphanRepair(reseller, email, createdPanels, params, "اتصال پنل قطع شد");
      } else {
        await db.operationJournal.update({ where: { id: createJournal.id }, data: { status: "FAILED", reservedGB: 0, email, lastError: conn.msg } });
      }
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
      // UNKNOWN-outcome: خطای addClient دلیل عدمِ ساخت نیست — وضعیت ریموت همین پنل را استعلام می‌کنیم
      const outcome = await verifyRemoteAbsent(panelId, email);
      if (outcome === "PRESENT") createdPanels.push(panelId); // در واقع ساخته شده — جبرانش کن
      if (outcome === "UNKNOWN") {
        // نتیجه نامشخص — رزرو می‌ماند و NEEDS_REPAIR (هرگز سهمیه آزاد نمی‌شود)
        await db.operationJournal.update({
          where: { id: createJournal.id },
          data: { status: "NEEDS_REPAIR", email, lastError: `(UNKNOWN outcome) ${r.msg}`, failedPanels: JSON.stringify([...createdPanels, panelId]) },
        });
        await recordOrphanRepair(reseller, email, [...createdPanels, panelId], params, `نتیجهٔ ریموت نامشخص: ${r.msg}`);
        return { ok: false, error: `پاسخ پنل قطع شد و وضعیت ساخت نامشخص است — سهمیه رزرو ماند و برای بررسی ثبت شد: ${r.msg}`, status: 502 };
      }
      // ساخت ناقص چندپنلی: حذف جبرانی روی پنل‌های موفق — کاربر یتیم نمی‌ماند
      const repaired = await compensatePartialCreate(reseller, email, createdPanels);
      if (!repaired) {
        // جبران نامطمئن — رزرو می‌ماند (سهمیه قفل) و ژورنال NEEDS_REPAIR
        await db.operationJournal.update({
          where: { id: createJournal.id },
          data: { status: "NEEDS_REPAIR", email, lastError: r.msg || "unknown", failedPanels: JSON.stringify(createdPanels) },
        });
        await recordOrphanRepair(reseller, email, createdPanels, params, r.msg || "unknown");
        return { ok: false, error: `ساخت روی بعضی پنل‌ها ناموفق بود و حذف جبرانی هم انجام نشد — سهمیه رزرو ماند و برای بررسی دستی ثبت شد: ${r.msg}`, status: 502 };
      }
      // جبران کامل — رزرو آزاد و عملیات FAILED
      await db.operationJournal.update({
        where: { id: createJournal.id },
        data: { status: "FAILED", reservedGB: 0, email, lastError: r.msg || "unknown" },
      });
      return { ok: false, error: `ساخت کاربر ناموفق بود: ${r.msg}`, status: 502 };
    }
    createdPanels.push(panelId);
  }

  // ---- finalize اتمیک: ثبت محلی + بستن ژورنال + آزادسازی رزرو در «یک» تراکنش ----
  await finishCreateAtomically(createJournal.id, reseller, { email, subId, refs, trafficGB: params.trafficGB, name: params.name });
  if (params.requestId) {
    await db.operationJournal.update({
      where: { id: createJournal.id },
      data: { metadata: JSON.stringify({ name: params.name, trafficGB: params.trafficGB, expiryTime: params.expiryTime, ipLimit: params.ipLimit, refs, subId, email, done: true }) },
    });
  }

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
