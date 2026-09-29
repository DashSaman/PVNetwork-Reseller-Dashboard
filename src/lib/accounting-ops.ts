import { db } from "@/lib/db";
import { withResellerLock, canonicalUserUsage, parseInboundRefs, type ResellerWithInbounds, type InboundRef } from "./reseller-helpers";
import { getAllPanelInbounds, getPanelConnection, type PanelBundle } from "./panel-manager";
import { deleteClient, resetClientTraffic, type PanelAuth } from "./panel";
import { logActivity } from "./logger";

/**
 * سرویس متمرکز عملیات تخریبی/حسابداری (فاز ۱.۲) — داشبورد و پل ربات از همین‌جا عبور می‌کنند.
 *
 * تضمین‌ها:
 * - رزرو ماندگار سهمیه: reservedGB ژورنال فعال (PENDING/RUNNING/PARTIAL/NEEDS_REPAIR از نوع CREATE)
 *   در محاسبه باقیمانده لحاظ می‌شود (getActiveReservationsGB) — یتیم NEEDS_REPAIR سهمیه را نگه می‌دارد
 * - commit اتمیک: increment consumedGB + accountingCommitted=true در «یک» تراکنش — تکرار no-op
 * - شناسه عملیات tenant-safe: (resellerId, email, type) — دو نماینده با ایمیل یکسال هرگز عملیات هم را resume نمی‌کنند
 * - کلید چرخه‌ای reset/delete: هر عملیات جدید = شناسه یکتا؛ retry همان ژورنال را ادامه می‌دهد (نه بر اساس مقدار مصرف)
 * - targetPanels تغییرناپذیر: عملیات resume‌شده از journal.targetPanels استفاده می‌کند، نه refs فعلی
 * - reload داخل قفل: reseller و tracked داخل قفل دوباره خوانده می‌شوند (ورودی فقط resellerId/email)
 * - fail-closed refs: refs خالی/خراب که به هیچ پنلی اشاره نکنند ← رد با خطای تعمیر
 */

export type PanelOpResult = "SUCCESS" | "ALREADY_MISSING" | "FAILED" | "UNREACHABLE";

const MISSING_MARKERS = ["یافت نشد", "not found", "not exist", "does not exist", "no such"];

function classifyOpError(msg: string | undefined): PanelOpResult {
  const m = (msg || "").toLowerCase();
  if (MISSING_MARKERS.some((k) => m.includes(k.toLowerCase()))) return "ALREADY_MISSING";
  return "FAILED";
}

export type QuotaState = {
  pool: number; allocated: number; consumed: number; reserved: number;
  remaining: number; unlimited: boolean;
};

/**
 * وضعیت سهمیهٔ نماینده — تابع مرجع و واحد؛ همهٔ مسیرهای create/bulk/PUT/پل باید از همین استفاده کنند.
 * remaining = pool − allocated − reserved − consumed (رزروهای CREATE فعال لحاظ می‌شوند)
 */
export async function getQuotaState(resellerId: string, reseller?: { trafficPoolGB: number }): Promise<QuotaState> {
  const row = reseller ?? (await db.reseller.findUnique({ where: { id: resellerId }, select: { trafficPoolGB: true } }));
  const pool = row?.trafficPoolGB ?? 0;
  const { getAllocatedGB, getConsumedGB } = await import("./reseller-helpers");
  const [allocated, consumed, reserved] = await Promise.all([
    getAllocatedGB(resellerId),
    getConsumedGB(resellerId),
    getActiveReservationsGB(resellerId),
  ]);
  return {
    pool, allocated, consumed, reserved,
    unlimited: pool <= 0,
    remaining: pool > 0 ? Math.max(0, pool - allocated - reserved - consumed) : 0,
  };
}

/** رزروهای فعال سهمیه — باید در remaining لحاظ شوند (ضد بازیابی سهمیه از یتیم NEEDS_REPAIR) */
export async function getActiveReservationsGB(resellerId: string): Promise<number> {
  const rows = await db.operationJournal.findMany({
    where: {
      resellerId,
      type: "CREATE",
      status: { in: ["PENDING", "RUNNING", "PARTIAL", "NEEDS_REPAIR"] },
    },
    select: { reservedGB: true },
  });
  return rows.reduce((s, r) => s + (r.reservedGB || 0), 0);
}

type TrackedUser = { id: string; email: string; inboundIds: string; panelId: string; trafficGB: number };

/** پنل‌های مرتبط با کاربر — خالی/خراب = خطای تعمیر */
export async function getRequiredUserPanelIds(tracked: TrackedUser): Promise<{ ok: true; panelIds: string[] } | { ok: false; msg: string }> {
  const { getPrimaryPanel } = await import("./panel-manager");
  const primary = (await getPrimaryPanel())?.id || "";
  let refs: InboundRef[] = [];
  try {
    refs = parseInboundRefs(tracked.inboundIds, tracked.panelId);
  } catch {
    refs = [];
  }
  const panelIds = [...new Set(refs.map((r) => r.panelId || primary).filter(Boolean))];
  if (panelIds.length === 0) {
    return { ok: false, msg: "ارجاع اینباندهای این کاربر خالی یا نامعتبر است — ابتدا باید توسط مدیر تعمیر شود" };
  }
  return { ok: true, panelIds };
}

function assertRequiredPanelsReadable(
  snapshot: { ok: boolean; msg?: string; panels: PanelBundle[] },
  requiredPanelIds: string[]
): { ok: true } | { ok: false; msg: string } {
  const readable = new Set(snapshot.panels.map((b) => b.panelId));
  const missing = requiredPanelIds.filter((id) => !readable.has(id));
  if (missing.length > 0) {
    return { ok: false, msg: `پنل(های) مرتبط با این کاربر در دسترس نیستند (${missing.length} از ${requiredPanelIds.length}) — برای جلوگیری از خطای حساب، عملیات انجام نشد` };
  }
  return { ok: true };
}

/** ژورنال قابل-ادامه — tenant-safe: scoped با resellerId+email+type */
async function findResumableJournal(
  resellerId: string,
  email: string,
  type: "DELETE" | "RESET" | "UPDATE"
): Promise<{ id: string; idempotencyKey: string; status: string; usageSnapshotGB: number | null; accountingCommitted: boolean; targetPanels: string; completedPanels: string } | null> {
  const rows = await db.operationJournal.findMany({
    where: { resellerId, email, type, status: { in: ["PENDING", "RUNNING", "PARTIAL"] } },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  return rows[0] ?? null;
}

/** آیا عملیات فعالی برای کاربر در جریان است؟ (مانع تداخل ویرایش/حذف/ریست هم‌زمان) */
export async function hasActiveOperation(
  resellerId: string,
  email: string,
  types: ("DELETE" | "RESET" | "UPDATE" | "CREATE")[] = ["DELETE", "RESET", "UPDATE"]
): Promise<boolean> {
  const n = await db.operationJournal.count({
    where: { resellerId, email, type: { in: types }, status: { in: ["PENDING", "RUNNING", "PARTIAL"] } },
  });
  return n > 0;
}

function parseArr(v: string): string[] {
  try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

function opKey(prefix: string, userId: string): string {
  return `${prefix}:${userId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

/** commit اتمیک بدهکاری — تراکنش واحد: یا هر دو، یا هیچ */
async function commitJournalAccounting(journalId: string, resellerId: string, usageGB: number): Promise<void> {
  await db.$transaction(async (tx) => {
    const j = await tx.operationJournal.findUnique({ where: { id: journalId } });
    if (!j || j.accountingCommitted) return; // idempotent — هیچ‌وقت دوبار
    await tx.reseller.update({ where: { id: resellerId }, data: { consumedGB: { increment: usageGB } } });
    await tx.operationJournal.update({ where: { id: journalId }, data: { accountingCommitted: true } });
  });
}

async function runPanelOp(panelId: string, op: "delete" | "reset", email: string): Promise<{ panelId: string; result: PanelOpResult }> {
  const conn = await getPanelConnection(panelId);
  if (!conn.ok) return { panelId, result: "UNREACHABLE" };
  const r = op === "delete"
    ? await deleteClient(conn.conn as PanelAuth, email)
    : await resetClientTraffic(conn.conn as PanelAuth, email);
  if (r.ok) return { panelId, result: "SUCCESS" };
  return { panelId, result: classifyOpError(r.msg) };
}

/** اجرای عملیات روی پنل‌های هدف + ثبت per-panel در ژورنال */
async function executeAcrossPanels(
  journalId: string,
  targetPanels: string[],
  alreadyCompleted: string[],
  op: "delete" | "reset",
  email: string
): Promise<{ failed: { panelId: string; result: PanelOpResult }[]; completed: string[] }> {
  const completed = new Set(alreadyCompleted);
  const failed: { panelId: string; result: PanelOpResult }[] = [];
  for (const panelId of targetPanels) {
    if (completed.has(panelId)) continue;
    const r = await runPanelOp(panelId, op, email);
    if (r.result === "SUCCESS" || r.result === "ALREADY_MISSING") completed.add(panelId);
    else failed.push(r);
  }
  if (failed.length > 0) {
    await db.operationJournal.update({
      where: { id: journalId },
      data: {
        status: "PARTIAL",
        completedPanels: JSON.stringify([...completed]),
        failedPanels: JSON.stringify(failed.map((f) => `${f.panelId}:${f.result}`)),
        lastError: failed.map((f) => `${f.panelId}=${f.result}`).join(", "),
      },
    });
  }
  return { failed, completed: [...completed] };
}

export type OpResult = { ok: true; debitedGB: number } | { ok: false; status: number; msg: string; partial?: boolean };

/** بارگذاری داخل قفل: reseller و tracked تازه */
async function loadWithinLock(resellerId: string, email: string): Promise<{ reseller: ResellerWithInbounds; tracked: TrackedUser } | { err: OpResult }> {
  const reseller = await db.reseller.findUnique({ where: { id: resellerId }, include: { inbounds: true } });
  if (!reseller || !reseller.active) return { err: { ok: false, status: 403, msg: "حساب شما فعال نیست" } };
  const tracked = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId, email } } });
  if (!tracked) return { err: { ok: false, status: 404, msg: "کاربر پیدا نشد" } };
  return { reseller: reseller as ResellerWithInbounds, tracked };
}

/** مانع تداخل: عملیات تخریبی/ویرایش هم‌زمان روی یک کاربر مجاز نیست */
async function assertNoConflictingOperation(resellerId: string, email: string, self: "DELETE" | "RESET"): Promise<OpResult | null> {
  const rows = await db.operationJournal.findMany({
    where: { resellerId, email, status: { in: ["PENDING", "RUNNING", "PARTIAL"] } },
    select: { type: true },
  });
  const conflict = rows.find((r) => r.type !== self);
  if (conflict) {
    return { ok: false, status: 409, msg: `عملیات ${conflict.type === "UPDATE" ? "ویرایش" : "تخریبی"} دیگری برای این کاربر در جریان است — ابتدا آن را تمام کنید` };
  }
  return null;
}

/** حذف کاربر — مسیر مشترک داشبورد و پل */
export async function deleteUserByJournal(resellerId: string, email: string): Promise<OpResult> {
  return withResellerLock(resellerId, async () => {
    const loaded = await loadWithinLock(resellerId, email);
    if ("err" in loaded) return loaded.err;
    const { reseller, tracked } = loaded;

    const conflict = await assertNoConflictingOperation(resellerId, email, "DELETE");
    if (conflict) return conflict;

    const req = await getRequiredUserPanelIds(tracked);
    if (!req.ok) return { ok: false, status: 409, msg: req.msg };

    const snapshot = await getAllPanelInbounds();
    const readable = assertRequiredPanelsReadable(snapshot, req.panelIds);
    if (!readable.ok) return { ok: false, status: 502, msg: `حذف انجام نشد: ${readable.msg}` };

    let journal = await findResumableJournal(resellerId, email, "DELETE");
    let usageGB = journal?.usageSnapshotGB ?? null;
    if (usageGB === null) {
      usageGB = Math.round((canonicalUserUsage(snapshot.panels, email).usedBytes / (1024 * 1024 * 1024)) * 10000) / 10000;
    }

    if (!journal) {
      journal = await db.operationJournal.create({
        data: {
          idempotencyKey: opKey("delete", tracked.id),
          resellerId, userId: tracked.id, email, type: "DELETE", status: "RUNNING",
          usageSnapshotGB: usageGB,
          targetPanels: JSON.stringify(req.panelIds), completedPanels: "[]", failedPanels: "[]",
        },
      });
    } else {
      await db.operationJournal.update({ where: { id: journal.id }, data: { status: "RUNNING", lastError: null } });
    }

    const targetPanels = parseArr(journal.targetPanels); // تغییرناپذیر
    const { failed, completed } = await executeAcrossPanels(journal.id, targetPanels, parseArr(journal.completedPanels), "delete", email);

    if (failed.length > 0) {
      return { ok: false, status: 502, partial: true, msg: `حذف ناقص بود — ${failed.length} پنل انجام نشد (${failed.map((f) => f.result).join(", ")}). مصرف ثبت‌شده حفظ شد؛ پس از رفع مشکل دوباره تلاش کنید.` };
    }

    await commitJournalAccounting(journal.id, resellerId, usageGB);
    await db.resellerUser.delete({ where: { id: tracked.id } });
    await db.operationJournal.update({ where: { id: journal.id }, data: { status: "SUCCESS", completedPanels: JSON.stringify(completed), failedPanels: "[]" } });
    await logActivity({ actorType: "RESELLER", actorName: reseller.username, action: "حذف کاربر", detail: `${email}${usageGB > 0 ? ` | مصرف قطعی: ${usageGB} گیگ` : ""}`, resellerId });
    return { ok: true, debitedGB: usageGB };
  });
}

/** ریست ترافیک — مسیر مشترک داشبورد و پل؛ هر چرخه = عملیات جدید با شناسه یکتا */
export async function resetUserByJournal(resellerId: string, email: string): Promise<OpResult> {
  return withResellerLock(resellerId, async () => {
    const loaded = await loadWithinLock(resellerId, email);
    if ("err" in loaded) return loaded.err;
    const { reseller, tracked } = loaded;

    const conflict = await assertNoConflictingOperation(resellerId, email, "RESET");
    if (conflict) return conflict;

    const req = await getRequiredUserPanelIds(tracked);
    if (!req.ok) return { ok: false, status: 409, msg: req.msg };

    const snapshot = await getAllPanelInbounds();
    const readable = assertRequiredPanelsReadable(snapshot, req.panelIds);
    if (!readable.ok) return { ok: false, status: 502, msg: `ریست انجام نشد: ${readable.msg}` };

    let journal = await findResumableJournal(resellerId, email, "RESET");
    const usageGB =
      journal?.usageSnapshotGB ??
      Math.round((canonicalUserUsage(snapshot.panels, email).usedBytes / (1024 * 1024 * 1024)) * 10000) / 10000;

    if (!journal) {
      journal = await db.operationJournal.create({
        data: {
          idempotencyKey: opKey("reset", tracked.id),
          resellerId, userId: tracked.id, email, type: "RESET", status: "RUNNING",
          usageSnapshotGB: usageGB,
          targetPanels: JSON.stringify(req.panelIds), completedPanels: "[]", failedPanels: "[]",
        },
      });
    } else {
      await db.operationJournal.update({ where: { id: journal.id }, data: { status: "RUNNING", lastError: null } });
    }

    const targetPanels = parseArr(journal.targetPanels);
    const { failed, completed } = await executeAcrossPanels(journal.id, targetPanels, parseArr(journal.completedPanels), "reset", email);

    if (failed.length > 0) {
      return { ok: false, status: 502, partial: true, msg: `ریست ناقص بود — ${failed.length} پنل انجام نشد. مصرف ثبت‌شده حفظ شد؛ پس از رفع مشکل دوباره تلاش کنید.` };
    }

    await commitJournalAccounting(journal.id, resellerId, usageGB);
    await db.operationJournal.update({ where: { id: journal.id }, data: { status: "SUCCESS", completedPanels: JSON.stringify(completed), failedPanels: "[]" } });
    await logActivity({ actorType: "RESELLER", actorName: reseller.username, action: "ریست ترافیک کاربر", detail: `${email}${usageGB > 0 ? ` | مصرف قطعی: ${usageGB} گیگ` : ""}`, resellerId });
    return { ok: true, debitedGB: usageGB };
  });
}


/**
 * ویرایش کاربر — سرویس مشترک داشبورد و پل، ژورنال RESUMABLE:
 * retry همان ژورنال PARTIAL را ادامه می‌دهد (RUNNING → SUCCESS)، هرگز ژورنال دوم نمی‌سازد.
 * applyRemote: اجرای عملیات ریموت توسط route (منطق attach/detach خودش) — خروجی: لیست خطاها
 * commitLocal: ثبت نهایی محلی (ResellerUser) توسط route
 */
export async function updateUserByJournal(
  resellerId: string,
  email: string,
  desired: { trafficGB: number; note?: string },
  applyRemote: () => Promise<string[]>,
  commitLocal: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<void>
): Promise<{ ok: true } | { ok: false; status: number; msg: string; partial?: boolean }> {
  return withResellerLock(resellerId, async () => {
    const loaded = await loadWithinLock(resellerId, email);
    if ("err" in loaded) return loaded.err;

    // مانع تداخل با DELETE/RESET فعال (UPDATE فعالِ خودش = resume)
    const conflict = await assertNoConflictingOperation(resellerId, email, "UPDATE" as never);
    if (conflict) return conflict;

    // resume همان ژورنال یا ایجاد یکتا
    let journal = await findResumableJournal(resellerId, email, "UPDATE");
    if (!journal) {
      const req = await getRequiredUserPanelIds(loaded.tracked);
      journal = await db.operationJournal.create({
        data: {
          idempotencyKey: opKey("update", loaded.tracked.id),
          resellerId, userId: loaded.tracked.id, email, type: "UPDATE", status: "RUNNING",
          targetPanels: JSON.stringify(req.ok ? req.panelIds : []),
          metadata: JSON.stringify({ newTrafficGB: desired.trafficGB, note: desired.note }),
        },
      });
    } else {
      // همان ژورنال: PARTIAL → RUNNING (ادامهٔ همان عملیات، نه عملیات جدید)
      await db.operationJournal.update({ where: { id: journal.id }, data: { status: "RUNNING", lastError: null } });
    }

    const errors = await applyRemote();
    if (errors.length > 0) {
      await db.operationJournal.update({
        where: { id: journal.id },
        data: { status: "PARTIAL", lastError: errors.join(" | ") },
      });
      return { ok: false, status: 502, partial: true, msg: "ویرایش ناقص بود: " + errors.join(" | ") };
    }

    const jid = journal.id;
    const jTargets = journal.targetPanels;
    await db.$transaction(async (tx) => {
      await commitLocal(tx);
      await tx.operationJournal.update({
        where: { id: jid },
        data: { status: "SUCCESS", completedPanels: jTargets, failedPanels: "[]" },
      });
    });
    return { ok: true };
  });
}
