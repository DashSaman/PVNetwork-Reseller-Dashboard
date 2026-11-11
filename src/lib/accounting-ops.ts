import { db } from "@/lib/db";
import { withResellerLock, canonicalUserUsage, parseInboundRefs, type ResellerWithInbounds, type InboundRef } from "./reseller-helpers";
import { getAllPanelInboundsFresh, getPanelConnection, type PanelBundle } from "./panel-manager";
import { deleteClient, resetClientTraffic, getVerifiedClientUsage, arePanelNodesSynchronized, getPanelNodeSyncSnapshot, isQueuedClientSaved, readClientCreation, readClientDeletion, type PanelAuth, type PanelNodeSyncSnapshot } from "./panel";
import { isSavedQueuedCreation, creationMetadata } from './queued-create';
import { isSavedQueuedUpdate, updateMetadata } from './queued-update';
import { logActivity } from "./logger";
import type { NodeMutationState, NodeMutationProgress } from "./node-client-sync";
import type { Prisma } from '@prisma/client';
import { operationInstallation } from './operation-installation';
import { canCancelUnstartedOperation, canFinalizeAcknowledgedDeletion, isCurrentDestructiveRequest, wasCancelledBeforeExecution } from './pending-reset';

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

function classifyOpError(_msg: string | undefined): PanelOpResult {
  // Only the native adapter may prove absence by reading the client record.
  return "FAILED";
}

/**
 * اعتبارسنج مرجع سهمیهٔ کاربر — تنها نگهبان «کاربر نامحدود برای نمایندهٔ محدود ممنوع».
 * همهٔ مسیرهای ساخت/ویرایش (داشبورد، گروهی، پل) موظف‌اند قبل از هر اثر ماندگار این را صدا بزنند.
 */
export function validateRequestedUserQuota(
  quotaState: QuotaState,
  requestedTrafficGB: number
): { ok: true } | { ok: false; msg: string } {
  if (!Number.isSafeInteger(requestedTrafficGB) || requestedTrafficGB < 0 || requestedTrafficGB > 8388607) {
    return { ok: false, msg: "سهمیه باید عدد صحیح معتبر و نامنفی بر حسب گیگابایت باشد" };
  }
  if (quotaState.unlimited) return { ok: true }; // نمایندهٔ نامحدود: ۰ = نامحدود مجاز (رفتار قدیمی)
  if (!Number.isFinite(requestedTrafficGB) || requestedTrafficGB <= 0) {
    return { ok: false, msg: "پول ترافیک شما محدود است — سهمیهٔ کاربر باید عددی مثبت باشد (۰/نامحدود مجاز نیست)" };
  }
  return { ok: true };
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
      type: { in: ["CREATE", "UPDATE", "RESET"] },
      status: { in: ["PENDING", "RUNNING", "PARTIAL", "NEEDS_REPAIR"] },
    },
    select: { reservedGB: true },
  });
  return rows.reduce((s, r) => s + (r.reservedGB || 0), 0);
}

type TrackedUser = { id: string; email: string; subId?: string | null; inboundIds: string; panelId: string; trafficGB: number };

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
  types: ("DELETE" | "RESET" | "UPDATE" | "CREATE")[] = ["DELETE", "RESET", "UPDATE", "CREATE"]
): Promise<boolean> {
  const n = await db.operationJournal.count({
    where: { resellerId, email, type: { in: types }, status: { in: ["PENDING", "RUNNING", "PARTIAL", "NEEDS_REPAIR"] } },
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
    await tx.operationJournal.update({ where: { id: journalId }, data: { accountingCommitted: true, reservedGB: 0 } });
  });
}

function nodeProgress(journalId: string, panelId: string): NodeMutationProgress {
  async function metadata(): Promise<Record<string, unknown>> {
    const row = await db.operationJournal.findUnique({ where: { id: journalId }, select: { metadata: true } });
    if (!row) throw new Error("Operation journal missing");
    return row.metadata ? JSON.parse(row.metadata) : {};
  }
  return {
    async checkpointUsage(bytes) {
      const row = await db.operationJournal.findUniqueOrThrow({ where: { id: journalId } });
      const m = JSON.parse(row.metadata || "{}");
      const byPanel = m.usageByPanel as Record<string, number> | undefined;
      if (!byPanel) throw new Error("Legacy operation needs accounting review");
      byPanel[panelId] = Math.max(byPanel[panelId] || 0, bytes / 1073741824);
      const usage = Object.values(byPanel).reduce((a, b) => a + b, 0);
      if (row.type === "RESET" && !row.accountingCommitted) {
        const q = await getQuotaState(row.resellerId);
        if (!q.unlimited && usage > q.pool - q.allocated - q.consumed - Math.max(0, q.reserved - row.reservedGB)) throw new Error("Insufficient pool for reset");
      }
      await db.operationJournal.update({ where: { id: journalId }, data: { metadata: JSON.stringify({ ...m, usageByPanel: byPanel }), usageSnapshotGB: usage, ...(row.type === "RESET" && !row.accountingCommitted ? { reservedGB: usage } : {}) } });
    },
    async load() {
      const m = await metadata();
      return (m.nodeSync as Record<string, NodeMutationState> | undefined)?.[panelId];
    },
    async save(state) {
      const m = await metadata();
      const states = (m.nodeSync || {}) as Record<string, NodeMutationState>;
      states[panelId] = state;
      await db.operationJournal.update({ where: { id: journalId }, data: { metadata: JSON.stringify({ ...m, nodeSync: states }) } });
    },
  };
}

async function runPanelOp(journalId: string, panelId: string, op: "delete" | "reset", email: string): Promise<{ panelId: string; result: PanelOpResult }> {
  const conn = await getPanelConnection(panelId);
  if (!conn.ok) return { panelId, result: "UNREACHABLE" };
  const progress = nodeProgress(journalId, panelId);
  const journal = await db.operationJournal.findUniqueOrThrow({ where: { id: journalId } });
  const tracked = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId: journal.resellerId, email } } });
  progress.expectedSubId = tracked?.subId || undefined;
  const r = op === "delete"
    ? await deleteClient(conn.conn as PanelAuth, email, progress)
    : await resetClientTraffic(conn.conn as PanelAuth, email, progress);
  if (r.ok) return { panelId, result: "SUCCESS" };
  return { panelId, result: classifyOpError(r.msg) };
}

/** اجرای عملیات روی پنل‌های هدف + ثبت per-panel در ژورنال */
async function executeAcrossPanels(
  journalId: string,
  targetPanels: string[],
  alreadyCompleted: string[],
  op: "delete" | "reset",
  email: string,
  completionOnly = false
): Promise<{ failed: { panelId: string; result: PanelOpResult }[]; completed: string[] }> {
  const completed = new Set(alreadyCompleted);
  const failed: { panelId: string; result: PanelOpResult }[] = [];
  for (const panelId of targetPanels) {
    if (completed.has(panelId) && (op !== 'delete' || completionOnly)) continue;
    const r = await runPanelOp(journalId, panelId, op, email);
    if (r.result === "SUCCESS" || r.result === "ALREADY_MISSING") {
      completed.add(panelId);
      await db.operationJournal.update({ where: { id: journalId }, data: { completedPanels: JSON.stringify([...completed]) } });
    }
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
  } else if (targetPanels.every(panelId => completed.has(panelId))) {
    // A previous attempt may have failed before these targets later acknowledged
    // the same operation. Do not let that stale failure block read-only final
    // accounting while the native synchronization marker briefly settles.
    await db.operationJournal.update({ where: { id: journalId }, data: { failedPanels: "[]", lastError: null } });
  }
  return { failed, completed: [...completed] };
}

export type OpResult = { ok: true; debitedGB: number; refundedGB?: number; pending?: boolean; message?: string } | { ok: false; status: number; msg: string; partial?: boolean };

async function prepareUsageLedger(journalId: string, panels: PanelBundle[], email: string): Promise<void> {
  const row = await db.operationJournal.findUniqueOrThrow({ where: { id: journalId } });
  const m = JSON.parse(row.metadata || "{}");
  if (m.usageByPanel) return;
  const targets = parseArr(row.targetPanels), completed = parseArr(row.completedPanels);
  // Old multi-panel partial journals cannot safely reconstruct a deleted counter.
  const destructiveProgress = Object.values(m.nodeSync || {}).some(s => (s as NodeMutationState).steps.some(step => step.status !== "PENDING"));
  if (targets.length > 1 && (completed.length || destructiveProgress)) throw new Error("Legacy partial operation needs accounting review");
  const usageByPanel = Object.fromEntries(targets.map(id => [id, canonicalUserUsage(panels.filter(p => p.panelId === id), email).usedBytes / 1073741824]));
  if (targets.length === 1) usageByPanel[targets[0]] = Math.max(usageByPanel[targets[0]], row.usageSnapshotGB || 0);
  await db.operationJournal.update({ where: { id: journalId }, data: { metadata: JSON.stringify({ ...m, usageByPanel }) } });
}

/** بارگذاری داخل قفل: reseller و tracked تازه */
async function loadWithinLock(resellerId: string, email: string): Promise<{ reseller: ResellerWithInbounds; tracked: TrackedUser } | { err: OpResult }> {
  const reseller = await db.reseller.findUnique({ where: { id: resellerId }, include: { inbounds: true } });
  if (!reseller || !reseller.active) return { err: { ok: false, status: 403, msg: "حساب شما فعال نیست" } };
  const tracked = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId, email } } });
  if (!tracked) return { err: { ok: false, status: 404, msg: "کاربر پیدا نشد" } };
  return { reseller: reseller as ResellerWithInbounds, tracked };
}

/** مانع تداخل: عملیات تخریبی/ویرایش هم‌زمان روی یک کاربر مجاز نیست */
async function assertNoConflictingOperation(resellerId: string, email: string, self: "DELETE" | "RESET" | "UPDATE", superseded: string[] = []): Promise<OpResult | null> {
  const rows = await db.operationJournal.findMany({
    where: { resellerId, email, status: { in: ["PENDING", "RUNNING", "PARTIAL", "NEEDS_REPAIR"] } },
  });
  const conflict = rows.find((r) => r.type !== self && !superseded.includes(r.id));
  if (conflict) {
    if (['DELETE', 'RESET'].includes(conflict.type)) {
      const name = conflict.type === 'DELETE' ? 'حذف' : 'ریست';
      return { ok: false, status: 409, msg: canCancelUnstartedOperation(conflict, operationInstallation())
        ? `درخواست ${name} هنوز اجرا نشده است؛ برای تمدید، «لغو درخواست و ویرایش» را در ردیف همین کاربر بزنید. مصرف و سهمیه حفظ می‌شوند.`
        : `${name} این حساب شروع شده یا نتیجهٔ آن نامشخص است؛ ابتدا همان درخواست باید تکمیل شود. مصرف و سهمیه محفوظ است.` };
    }
    return { ok: false, status: 409, msg: conflict.type === 'CREATE' ? 'ساخت حساب ثبت شده؛ تا تأیید همگام‌سازی لوکیشن‌ها، تغییر یا آزادسازی سهمیه مجاز نیست' : `عملیات ${conflict.type === "UPDATE" ? "ویرایش" : "تخریبی"} دیگری برای این کاربر در جریان است — ابتدا آن را تمام کنید` };
  }
  return null;
}

/** A paid, fully saved CREATE/UPDATE can be superseded by the owner's explicit
 * delete/reset. Uncertain writes, reservations, identity changes and bulk jobs
 * remain blocked. No quota is released by superseding a journal. */
async function verifiedSavedPredecessors(resellerId: string, tracked: TrackedUser) {
  const rows = await db.operationJournal.findMany({ where: { resellerId, email: tracked.email, type: { in: ['CREATE', 'UPDATE'] }, status: { in: ['PENDING', 'RUNNING', 'PARTIAL', 'NEEDS_REPAIR'] } } });
  const result: typeof rows = [];
  const refs = parseInboundRefs(tracked.inboundIds, tracked.panelId);
  for (const row of rows) {
    const user = { ...tracked, subId: tracked.subId || null, resellerId };
    if (row.type === 'CREATE' ? !isSavedQueuedCreation(user, row) : !isSavedQueuedUpdate(user, row)) continue;
    let verified = refs.length > 0;
    for (const id of new Set(refs.map(r => r.panelId))) {
      const connection = await getPanelConnection(id), ids = refs.filter(r => r.panelId === id).map(r => r.inboundId);
      if (!connection.ok || !await isQueuedClientSaved(connection.conn, tracked.email, tracked.trafficGB * 1073741824, tracked.subId || '', ids)) { verified = false;break; }
      const meta = row.type === 'CREATE' ? creationMetadata(row.metadata) : null;
      if (meta && !(await readClientCreation(connection.conn, ids, { id: meta.uuid, email: tracked.email, subId: meta.subId, totalGB: meta.trafficGB * 1073741824 })).ok) { verified = false;break; }
    }
    if (verified) result.push(row);
  }
  return result;
}

async function supersedeSavedPredecessors(tx: Prisma.TransactionClient, predecessors: Awaited<ReturnType<typeof verifiedSavedPredecessors>>, nextId: string) {
  for (const old of predecessors) {
    const changed = await tx.operationJournal.updateMany({ where: { id: old.id, status: old.status, updatedAt: old.updatedAt, metadata: old.metadata, reservedGB: 0 }, data: { status: 'SUCCESS', lastError: 'عملیات ذخیره‌شده با درخواست جدید مالک جایگزین شد', metadata: JSON.stringify({ ...updateMetadata(old.metadata), supersededBy: nextId, supersededWhilePending: true }) } });
    if (changed.count !== 1) throw new Error('Predecessor changed during operation');
  }
}

async function requiredTargetsReady(tracked: TrackedUser): Promise<boolean> {
  const refs = parseInboundRefs(tracked.inboundIds, tracked.panelId);
  if (!refs.length) return false;
  for (const id of new Set(refs.map(r => r.panelId))) {
    const connection = await getPanelConnection(id);
    if (!connection.ok || !await arePanelNodesSynchronized(connection.conn, true, refs.filter(r => r.panelId === id).map(r => r.inboundId))) return false;
  }
  return true;
}

/** A short native config push must not strand an explicit operation until the next
 * observer tick. Read-triggered completion still performs one read only. */
async function destructiveTargetsReady(tracked: TrackedUser, completionOnly: boolean): Promise<boolean> {
  const deadline = Date.now() + (completionOnly ? 0 : 8000);
  do {
    if (await requiredTargetsReady(tracked)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  return false;
}

const waitingForTargets = (): OpResult => ({ ok: true, pending: true, debitedGB: 0, refundedGB: 0, message: 'درخواست ثبت شد؛ یک لوکیشن مرتبط پاسخ نمی‌دهد. بعد از تأیید همهٔ لوکیشن‌ها تکمیل می‌شود؛ تا آن زمان سهمیه محفوظ است.' });

/** Fast confirmation on normal metadata reads, without dispatching native work. */
export async function confirmAcknowledgedDeletions(resellerId: string, budgetMs = 4000): Promise<void> {
  const rows = await db.operationJournal.findMany({ where: { resellerId, type: 'DELETE', status: { in: ['RUNNING', 'PARTIAL'] } }, orderBy: { updatedAt: 'asc' }, take: 100 });
  const deadline = Date.now() + budgetMs;
  for (const row of rows) {
    if (Date.now() > deadline) break;
    if (canFinalizeAcknowledgedDeletion(row, operationInstallation())) await deleteUserByJournal(resellerId, row.email, row.id, true);
  }
}

/** A synchronous bot must not mistake a briefly dirty, already-deleted native
 * customer for a failed deletion. Only finish this exact acknowledged request. */
export async function confirmAcknowledgedDeletion(resellerId: string, userId: string, email: string): Promise<boolean> {
  const row = await db.operationJournal.findFirst({ where: { resellerId, userId, email, type: 'DELETE', status: { in: ['RUNNING', 'PARTIAL', 'SUCCESS'] } }, orderBy: { createdAt: 'desc' } });
  const complete = (value: typeof row, missing: boolean) => !!value && value.status === 'SUCCESS' && value.accountingCommitted && value.resellerId === resellerId && value.userId === userId && value.email === email && missing
    && canFinalizeAcknowledgedDeletion({ ...value, status: 'RUNNING' }, operationInstallation());
  if (!row) return false;
  // A metadata poll may have completed this same request after the pending
  // response was produced. Recognize it without acting on a replacement user.
  if (row.status === 'SUCCESS') return complete(row, !await db.resellerUser.findUnique({ where: { id: userId } }));
  if (!canFinalizeAcknowledgedDeletion(row, operationInstallation())) return false;
  const deadline = Date.now() + 6000;
  do {
    const result = await deleteUserByJournal(resellerId, email, row.id, true);
    const [current, customer] = await Promise.all([db.operationJournal.findUnique({ where: { id: row.id } }), db.resellerUser.findUnique({ where: { id: userId } })]);
    if (complete(current, !customer)) return true;
    if (!result.ok || !current || !canFinalizeAcknowledgedDeletion(current, operationInstallation()) || Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  return false;
}

/** Only explicitly requested new operations are eligible. Durable node steps
 * prevent replaying a reset whose response was lost. Old repair journals are
 * never enrolled in automatic recovery. Called by the existing observation job. */
export async function continuePendingDestructiveOperations(resellerId: string): Promise<void> {
  const rows = await db.operationJournal.findMany({ where: { resellerId, type: { in: ['DELETE', 'RESET'] }, status: { in: ['RUNNING', 'PARTIAL'] } }, orderBy: { updatedAt: 'asc' }, take: 100 });
  const deadline = Date.now() + 5000;
  for (const row of rows) {
    if (Date.now() > deadline) break;
    const metadata = updateMetadata(row.metadata);
    if (metadata.explicitDestructive !== true) continue;
    const installation = operationInstallation();
    if (!installation || metadata.operationInstallation !== installation) continue;
    if (row.type === 'DELETE') await deleteUserByJournal(resellerId, row.email, row.id);
    else await resetUserByJournal(resellerId, row.email, row.id);
  }
}

async function continuedDestructiveMetadata(journalId: string): Promise<string | null> {
  const row = await db.operationJournal.findUniqueOrThrow({ where: { id: journalId } });
  const metadata = updateMetadata(row.metadata);
  return metadata.explicitDestructive === true
    ? JSON.stringify({ ...metadata, operationInstallation: operationInstallation(true) })
    : row.metadata;
}

/** حذف کاربر — مسیر مشترک داشبورد و پل */
export async function deleteUserByJournal(resellerId: string, email: string, expectedJournalId?: string, completionOnly = false): Promise<OpResult> {
  return withResellerLock(resellerId, async () => {
    const loaded = await loadWithinLock(resellerId, email);
    if ("err" in loaded) return loaded.err;
    const { reseller, tracked } = loaded;

    if (expectedJournalId && !await currentContinuation(resellerId, expectedJournalId, tracked, 'DELETE')) return { ok: true, debitedGB: 0 };
    if (completionOnly) {
      const current = expectedJournalId ? await db.operationJournal.findUnique({ where: { id: expectedJournalId } }) : null;
      if (!current || !canFinalizeAcknowledgedDeletion(current, operationInstallation())) return { ok: true, debitedGB: 0 };
    }

    const predecessors = await verifiedSavedPredecessors(resellerId, tracked);
    const conflict = await assertNoConflictingOperation(resellerId, email, "DELETE", predecessors.map(j => j.id));
    if (conflict) return conflict;

    const req = await getRequiredUserPanelIds(tracked);
    if (!req.ok) return { ok: false, status: 409, msg: req.msg };

    const snapshot = await getAllPanelInboundsFresh();
    const readable = assertRequiredPanelsReadable(snapshot, req.panelIds);
    if (!readable.ok) return { ok: false, status: 502, msg: `حذف انجام نشد: ${readable.msg}` };

    let journal = await findResumableJournal(resellerId, email, "DELETE");
    if (expectedJournalId && journal?.id !== expectedJournalId) return { ok: true, debitedGB: 0 };
    let usageGB = journal?.usageSnapshotGB ?? null;
    if (usageGB === null) {
      usageGB = canonicalUserUsage(snapshot.panels, email).usedBytes / 1073741824;
    }

    if (!journal) {
      journal = await db.$transaction(async tx => { const next = await tx.operationJournal.create({
        data: {
          idempotencyKey: opKey("delete", tracked.id),
          resellerId, userId: tracked.id, email, type: "DELETE", status: "RUNNING",
          usageSnapshotGB: usageGB,
          metadata: JSON.stringify({ explicitDestructive: true, operationInstallation: operationInstallation(true) }),
          targetPanels: JSON.stringify(req.panelIds), completedPanels: "[]", failedPanels: "[]",
        },
      });await supersedeSavedPredecessors(tx, predecessors, next.id);return next; });
    } else {
      await db.operationJournal.update({ where: { id: journal.id }, data: { status: "RUNNING", lastError: null, metadata: await continuedDestructiveMetadata(journal.id) } });
    }

    const targetPanels = parseArr(journal.targetPanels); // تغییرناپذیر
    if (!await destructiveTargetsReady(tracked, completionOnly)) return waitingForTargets();
    await prepareUsageLedger(journal.id, snapshot.panels, email);
    const { failed, completed } = await executeAcrossPanels(journal.id, targetPanels, parseArr(journal.completedPanels), "delete", email, completionOnly);

    if (failed.length > 0) {
      return { ok: false, status: 502, partial: true, msg: `حذف ناقص بود — ${failed.length} پنل انجام نشد (${failed.map((f) => f.result).join(", ")}). مصرف ثبت‌شده حفظ شد؛ پس از رفع مشکل دوباره تلاش کنید.` };
    }

    if (!await destructiveTargetsReady(tracked, completionOnly)) return waitingForTargets();

    // Native health and a vanished master are not proof that its remote copies
    // vanished. Recheck every configured peer without writes before any refund.
    const readAbsence = () => Promise.all(targetPanels.map(async id => {
      const connection = await getPanelConnection(id);
      return connection.ok && (await readClientDeletion(connection.conn, email)).ok;
    }));
    let absent = await readAbsence();
    if (!absent.every(Boolean) && !completionOnly) {
      // Native fan-out may land after the adapter's first absence proof, while
      // the controller is settling its dirty marker. Reconcile the SAME journal
      // once after that gate; persisted identities and usage checkpoints still
      // guard every write. Never dispatch this reconciliation from a GET.
      const retry = await executeAcrossPanels(journal.id, targetPanels, completed, "delete", email);
      if (retry.failed.length) return { ok: false, status: 502, partial: true, msg: "تأیید نهایی حذف کامل نشد؛ سهمیه و مصرف ثبت‌شده محفوظ است" };
      if (!await destructiveTargetsReady(tracked, false)) return waitingForTargets();
      absent = await readAbsence();
    }
    if (!absent.every(Boolean)) return waitingForTargets();

    usageGB = (await db.operationJournal.findUniqueOrThrow({ where: { id: journal.id } })).usageSnapshotGB || 0;
    await commitJournalAccounting(journal.id, resellerId, usageGB);
    // حذف محلی + بستن ژورنال در «یک» تراکنش (crash-safe)؛ اگر رکورد قبلاً حذف شده، فقط ژورنال بسته می‌شود
    await db.$transaction(async (tx) => {
      const stillThere = await tx.resellerUser.findUnique({ where: { id: tracked.id } });
      if (stillThere) await tx.resellerUser.delete({ where: { id: tracked.id } });
      await tx.operationJournal.update({ where: { id: journal.id }, data: { status: "SUCCESS", completedPanels: JSON.stringify(completed), failedPanels: "[]" } });
    });
    await logActivity({ actorType: "RESELLER", actorName: reseller.username, action: "حذف کاربر", detail: `${email}${usageGB > 0 ? ` | مصرف قطعی: ${usageGB} گیگ` : ""}`, resellerId });
    return { ok: true, debitedGB: usageGB, refundedGB: Math.max(0, tracked.trafficGB - usageGB) };
  });
}

/** ریست ترافیک — مسیر مشترک داشبورد و پل؛ هر چرخه = عملیات جدید با شناسه یکتا */
export async function resetUserByJournal(resellerId: string, email: string, expectedJournalId?: string): Promise<OpResult> {
  return withResellerLock(resellerId, async () => {
    const loaded = await loadWithinLock(resellerId, email);
    if ("err" in loaded) return loaded.err;
    const { reseller, tracked } = loaded;

    if (expectedJournalId && !await currentContinuation(resellerId, expectedJournalId, tracked, 'RESET')) return { ok: true, debitedGB: 0 };

    const predecessors = await verifiedSavedPredecessors(resellerId, tracked);
    const conflict = await assertNoConflictingOperation(resellerId, email, "RESET", predecessors.map(j => j.id));
    if (conflict) return conflict;

    const req = await getRequiredUserPanelIds(tracked);
    if (!req.ok) return { ok: false, status: 409, msg: req.msg };

    const snapshot = await getAllPanelInboundsFresh();
    const readable = assertRequiredPanelsReadable(snapshot, req.panelIds);
    if (!readable.ok) return { ok: false, status: 502, msg: `ریست انجام نشد: ${readable.msg}` };

    let journal = await findResumableJournal(resellerId, email, "RESET");
    if (expectedJournalId && journal?.id !== expectedJournalId) return { ok: true, debitedGB: 0 };
    let usageGB =
      journal?.usageSnapshotGB ??
      canonicalUserUsage(snapshot.panels, email).usedBytes / 1073741824;

    const quota = await getQuotaState(resellerId);
    const own = journal ? await db.operationJournal.findUniqueOrThrow({ where: { id: journal.id } }) : null;
    if (!own?.accountingCommitted && !quota.unlimited && usageGB > quota.pool - quota.allocated - quota.consumed - Math.max(0, quota.reserved - (own?.reservedGB || 0))) {
      return { ok: false, status: 403, msg: "برای ریست ترافیک، موجودی آزاد کافی نیست؛ مصرف قبلی باید از پول نماینده پرداخت شود" };
    }

    if (!journal) {
      journal = await db.$transaction(async tx => { const next = await tx.operationJournal.create({
        data: {
          idempotencyKey: opKey("reset", tracked.id),
          resellerId, userId: tracked.id, email, type: "RESET", status: "RUNNING",
          reservedGB: usageGB,
          usageSnapshotGB: usageGB,
          metadata: JSON.stringify({ explicitDestructive: true, operationInstallation: operationInstallation(true) }),
          targetPanels: JSON.stringify(req.panelIds), completedPanels: "[]", failedPanels: "[]",
        },
      });await supersedeSavedPredecessors(tx, predecessors, next.id);return next; });
    } else {
      await db.operationJournal.update({ where: { id: journal.id }, data: { status: "RUNNING", lastError: null, metadata: await continuedDestructiveMetadata(journal.id) } });
    }

    const targetPanels = parseArr(journal.targetPanels);
    if (!await destructiveTargetsReady(tracked, false)) return waitingForTargets();
    await prepareUsageLedger(journal.id, snapshot.panels, email);
    const { failed, completed } = await executeAcrossPanels(journal.id, targetPanels, parseArr(journal.completedPanels), "reset", email);

    if (failed.length > 0) {
      return { ok: false, status: 502, partial: true, msg: `ریست ناقص بود — ${failed.length} پنل انجام نشد. مصرف ثبت‌شده حفظ شد؛ پس از رفع مشکل دوباره تلاش کنید.` };
    }

    if (!await destructiveTargetsReady(tracked, false)) return waitingForTargets();

    usageGB = (await db.operationJournal.findUniqueOrThrow({ where: { id: journal.id } })).usageSnapshotGB || 0;
    await commitJournalAccounting(journal.id, resellerId, usageGB);
    await db.operationJournal.update({ where: { id: journal.id }, data: { status: "SUCCESS", completedPanels: JSON.stringify(completed), failedPanels: "[]" } });
    await logActivity({ actorType: "RESELLER", actorName: reseller.username, action: "ریست ترافیک کاربر", detail: `${email}${usageGB > 0 ? ` | مصرف قطعی: ${usageGB} گیگ` : ""}`, resellerId });
    return { ok: true, debitedGB: usageGB };
  });
}

/** Called inside the same owner lock as cancellation; a stale observer must not
 * revive a cancelled/completed generation or create a fresh destructive job. */
async function currentContinuation(resellerId: string, id: string, user: TrackedUser, type: 'RESET' | 'DELETE'): Promise<boolean> {
  const row = await db.operationJournal.findUnique({ where: { id } });
  return !!row && row.userId === user.id && row.resellerId === resellerId
    && row.email === user.email && row.type === type && isCurrentDestructiveRequest(row, operationInstallation());
}

export async function cancelUnstartedReset(resellerId: string, email: string, operationId: string): Promise<OpResult> {
  return cancelUnstartedOperation(resellerId, email, operationId, 'RESET');
}

export async function cancelUnstartedOperation(resellerId: string, email: string, operationId: string, expectedType?: 'RESET'): Promise<OpResult> {
  return withResellerLock(resellerId, async () => {
    const loaded = await loadWithinLock(resellerId, email);
    if ('err' in loaded) return loaded.err;
    const { reseller, tracked } = loaded;
    const row = await db.operationJournal.findUnique({ where: { id: operationId } });
    if (!row || !['RESET', 'DELETE'].includes(row.type) || expectedType && row.type !== expectedType || row.resellerId !== resellerId || row.userId !== tracked.id || row.email !== email) return { ok: false, status: 404, msg: 'درخواست پیدا نشد' };
    const name = row.type === 'DELETE' ? 'حذف' : 'ریست';
    if (wasCancelledBeforeExecution(row)) return { ok: true, debitedGB: 0 };
    if (!canCancelUnstartedOperation(row, operationInstallation())) return { ok: false, status: 409, msg: `اجرای ${name} آغاز شده یا نتیجهٔ آن نامشخص است؛ لغو امن مجاز نیست. مصرف و سهمیه حفظ شدند.` };
    await db.$transaction(async tx => {
      const changed = await tx.operationJournal.updateMany({
        where: { id: row.id, userId: tracked.id, resellerId, email, type: row.type, status: row.status, updatedAt: row.updatedAt, metadata: row.metadata, accountingCommitted: false, reservedGB: row.reservedGB, usageSnapshotGB: row.usageSnapshotGB, completedPanels: row.completedPanels, failedPanels: row.failedPanels },
        data: { status: 'CANCELLED', reservedGB: 0, lastError: null, metadata: JSON.stringify({ ...JSON.parse(row.metadata!), cancelledBeforeExecution: true, cancelledAt: new Date().toISOString() }) },
      });
      if (changed.count !== 1) throw Error('Reset changed during cancellation');
      await tx.activityLog.create({ data: { actorType: 'RESELLER', actorName: reseller.username, resellerId, action: `لغو ${name} اجرا‌نشده`, detail: `${email} | مصرف و سهمیهٔ کاربر حفظ شد` } });
    });
    return { ok: true, debitedGB: 0, message: `درخواست ${name} اجرا‌نشده لغو شد؛ مصرف و سهمیهٔ کاربر تغییری نکرد. اکنون می‌توانید ویرایش کنید.` };
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
  desired: { trafficGB: number; enable?: boolean; note?: string; snapshotStartedAt?: number; intent?: string },
  applyRemote: () => Promise<string[] | { errors: string[]; pending: boolean }>,
  commitLocal: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<void>
): Promise<{ ok: true; pending?: boolean } | { ok: false; status: number; msg: string; partial?: boolean }> {
  return withResellerLock(resellerId, async () => {
    const loaded = await loadWithinLock(resellerId, email);
    if ("err" in loaded) return loaded.err;

    const conflict = await assertNoConflictingOperation(resellerId, email, 'UPDATE');
    if (conflict) return conflict;

    // Resolve an unfinished target before validating a stale inherited quota.
    const existingJournal = await findResumableJournal(resellerId, email, "UPDATE");
    const existingRow = existingJournal ? await db.operationJournal.findUnique({ where: { id: existingJournal.id } }) : null;
    const meta = updateMetadata(existingRow?.metadata || null);
    const savedQueue = !!existingRow && isSavedQueuedUpdate({ ...loaded.tracked, resellerId }, existingRow);
    if (existingJournal) {
      if ((meta.intent || undefined) !== desired.intent) return { ok: false, status: 409, msg: 'عملیات قبلی این حساب باید از همان مسیر و با همان لوکیشن‌ها ادامه پیدا کند' };
      if (meta.localCommitted && desired.snapshotStartedAt !== undefined && existingRow!.updatedAt.getTime() >= desired.snapshotStartedAt) return { ok: false, status: 409, msg: "کاربر هنگام آماده‌سازی درخواست تغییر کرده؛ صفحه را بازخوانی و دوباره ویرایش کنید" };
      if (meta.kind === "SUBSCRIPTION_ROTATION") return { ok: false, status: 409, msg: "تغییر لینک اشتراک در جریان است؛ ابتدا همان عملیات را ادامه دهید" };
      if (meta.kind === "CUSTOMER_STATUS") return { ok: false, status: 409, msg: "تغییر گروهی وضعیت در جریان است؛ ابتدا همان عملیات را ادامه دهید" };
      if (meta.bulkJobId) return { ok: false, status: 409, msg: "افزایش گروهی این کاربر در جریان است؛ ابتدا همان عملیات را ادامه دهید" };
      if (meta.newTrafficGB !== undefined && meta.newTrafficGB !== desired.trafficGB && !(savedQueue && loaded.tracked.trafficGB > 0 && desired.trafficGB > loaded.tracked.trafficGB)) return { ok: false, status: 409, msg: `ویرایش قبلی با سهمیهٔ ${meta.newTrafficGB} گیگ هنوز در جریان است؛ کاهش سهمیه تا پایان همگام‌سازی مجاز نیست` };
    }
    const ownReserved = existingRow?.reservedGB ?? 0;

    // C1: نمایندهٔ محدود هرگز کاربر نامحدود نمی‌سازد
    if (desired.snapshotStartedAt !== undefined) {
      const newer = await db.operationJournal.findFirst({ where: {
        resellerId, email, type: "UPDATE", status: "SUCCESS", updatedAt: { gte: new Date(desired.snapshotStartedAt) },
      } });
      if (newer) return { ok: false, status: 409, msg: "کاربر هنگام آماده‌سازی درخواست تغییر کرده؛ صفحه را بازخوانی و دوباره ویرایش کنید" };
    }
    const quotaBefore = await getQuotaState(resellerId);
    const vq = validateRequestedUserQuota(quotaBefore, desired.trafficGB);
    if (!vq.ok) return { ok: false, status: 403, msg: vq.msg };

    const required = await getRequiredUserPanelIds(loaded.tracked);
    if (!required.ok) return { ok: false, status: 409, msg: required.msg };
    const live = await getAllPanelInboundsFresh();
    const readable = assertRequiredPanelsReadable(live, required.panelIds);
    if (!readable.ok) return { ok: false, status: 502, msg: readable.msg };
    let usedBytes = 0;
    for (const panelId of required.panelIds) {
      const conn = await getPanelConnection(panelId);
      if (!conn.ok) return { ok: false, status: 502, msg: conn.msg };
      const usage = await getVerifiedClientUsage(conn.conn, email);
      if (!usage.ok || usage.data === undefined) return { ok: false, status: 502, msg: usage.msg || "مصرف حساب قابل تأیید نیست" };
      usedBytes += Math.max(usage.data, canonicalUserUsage(live.panels.filter(p => p.panelId === panelId), email).usedBytes);
    }
    const usedGB = usedBytes / 1073741824;
    if (desired.trafficGB > 0 && desired.trafficGB < usedGB && (desired.trafficGB !== loaded.tracked.trafficGB || desired.enable === true)) return { ok: false, status: 403, msg: "سهمیهٔ کاربر از مصرف فعلی کمتر است؛ ابتدا حجم کافی اضافه کنید و سپس فعال کنید" };

    // C2: دلتای افزایش سهمیه باید قبل از اولین اثر ریموت رزرو شود
    const delta = Math.max(0, desired.trafficGB - loaded.tracked.trafficGB);
    if (!quotaBefore.unlimited && delta > 0) {
      const reservedOthers = Math.max(0, quotaBefore.reserved - ownReserved);
      const available = quotaBefore.pool - quotaBefore.allocated - reservedOthers - quotaBefore.consumed;
      if (delta > available) {
        return { ok: false, status: 403, msg: `پول ترافیک برای این افزایش کافی نیست — باقیماندهٔ مؤثر: ${Math.round(available * 100) / 100} گیگ` };
      }
    }

    // resume همان ژورنال یا ایجاد یکتا
    let journal = existingJournal;
    if (!journal) {
      const req = await getRequiredUserPanelIds(loaded.tracked);
      journal = await db.operationJournal.create({
        data: {
          idempotencyKey: opKey("update", loaded.tracked.id),
          resellerId, userId: loaded.tracked.id, email, type: "UPDATE", status: "RUNNING",
          reservedGB: delta,
          targetPanels: JSON.stringify(req.ok ? req.panelIds : []),
          metadata: JSON.stringify({ newTrafficGB: desired.trafficGB, note: desired.note, intent: desired.intent }),
        },
      });
    } else {
      // همان ژورنال: PARTIAL → RUNNING (ادامهٔ همان عملیات، نه عملیات جدید) — رزرو دلتا حفظ می‌شود
      await db.operationJournal.update({ where: { id: journal.id }, data: { status: "RUNNING", lastError: null, reservedGB: Math.max(ownReserved, delta), metadata: JSON.stringify({ ...meta, newTrafficGB: desired.trafficGB, localCommitted: false, nativePending: false, intent: desired.intent }) } });
    }

    const remote = await applyRemote();
    const errors = Array.isArray(remote) ? remote : remote.errors;
    const pending = !Array.isArray(remote) && remote.pending;
    let finalUsedBytes = 0;
    // A route must not silently skip a required target and then release allocation.
    for (const panelId of required.panelIds) {
      const conn = await getPanelConnection(panelId);
      if (!conn.ok) { errors.push("تأیید پنل مرتبط ممکن نشد"); continue; }
      const usage = await getVerifiedClientUsage(conn.conn, email, desired.trafficGB * 1073741824);
      if (!usage.ok || usage.data === undefined) errors.push("مصرف نهایی حساب قابل تأیید نیست");
      else finalUsedBytes += usage.data;
    }
    if (!errors.length && desired.trafficGB > 0 && desired.trafficGB < loaded.tracked.trafficGB) {
      if (finalUsedBytes > desired.trafficGB * 1073741824) errors.push("مصرف در زمان ویرایش تغییر کرده؛ کاهش سهمیه تأیید نشد");
    }
    // A queued decrease must keep the larger allocation until every node confirms.
    if (pending && (desired.trafficGB < loaded.tracked.trafficGB || loaded.tracked.trafficGB === 0 && desired.trafficGB > 0)) errors.push("کاهش سهمیه تا پایان همگام‌سازی لوکیشن‌ها ثبت نهایی نمی‌شود");
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
        data: { status: pending ? "PARTIAL" : "SUCCESS", reservedGB: 0, completedPanels: pending ? "[]" : jTargets, failedPanels: "[]", lastError: pending ? "تغییر در مرجع ثبت شده؛ برخی لوکیشن‌ها در انتظار همگام‌سازی هستند" : null, metadata: JSON.stringify({ ...meta, newTrafficGB: desired.trafficGB, localCommitted: true, nativePending: pending, intent: desired.intent }) },
      });
    });
    return { ok: true, pending };
  });
}

/** An enable-only continuation must not resurrect the old pre-increase quota. */
export async function pendingUpdateQuota(resellerId: string, email: string, fallback: number): Promise<number> {
  const journal = await findResumableJournal(resellerId, email, "UPDATE");
  if (!journal) return fallback;
  const row = await db.operationJournal.findUnique({ where: { id: journal.id }, select: { metadata: true } });
  try {
    const meta = JSON.parse(row?.metadata || "{}");
    return !meta.kind && !meta.bulkJobId && Number.isSafeInteger(meta.newTrafficGB) && meta.newTrafficGB >= fallback ? meta.newTrafficGB : fallback;
  } catch { return fallback; }
}

/** Settle only already-paid queues after read-only native confirmation.
 * The collector passes locked=true because it already owns this reseller lock.
 */
export async function confirmQueuedUserUpdates(resellerId: string, locked = false, budgetMs?: number): Promise<number> {
  const confirm = async () => {
    const signal = budgetMs ? AbortSignal.timeout(budgetMs) : undefined;
    const journals = await db.operationJournal.findMany({ where: { resellerId, type: 'UPDATE', status: 'PARTIAL', reservedGB: 0 }, take: 2000 });
    if (!journals.length) return 0;
    const users = await db.resellerUser.findMany({ where: { resellerId, id: { in: journals.flatMap(j => j.userId ? [j.userId] : []) } } });
    const connections = new Map<string, PanelAuth | null>();
    const snapshots = new Map<string, PanelNodeSyncSnapshot>();
    let confirmed = 0;
    for (const journal of journals) {
      if (signal?.aborted) break;
      const user = users.find(u => u.id === journal.userId);
      if (!user || !isSavedQueuedUpdate(user, journal)) continue;
      if (await db.operationJournal.count({ where: { resellerId, email: user.email, id: { not: journal.id }, status: { in: ['PENDING', 'RUNNING', 'PARTIAL', 'NEEDS_REPAIR'] } } })) continue;
      const required = await getRequiredUserPanelIds(user);
      if (!required.ok) continue;
      const refs = parseInboundRefs(user.inboundIds, user.panelId);
      let ready = true;
      for (const id of required.panelIds) {
        if (!connections.has(id)) {
          const connection = await getPanelConnection(id);
          connections.set(id, connection.ok ? connection.conn : null);
        }
        const auth = connections.get(id);
        const ids = refs.filter(r => r.panelId === id).map(r => r.inboundId);
        if (!auth) { ready = false; break; }
        let snapshot = snapshots.get(id);
        if (!snapshot || Date.now() - snapshot.health.observedAt > 5000) { snapshot = await getPanelNodeSyncSnapshot(auth, signal);snapshots.set(id, snapshot); }
        if (signal?.aborted || !await arePanelNodesSynchronized(auth, true, ids, snapshot) || !await isQueuedClientSaved(auth, user.email, user.trafficGB * 1073741824, user.subId || '', ids, signal)) { ready = false; break; }
      }
      if (!ready) continue;
      const result = await db.operationJournal.updateMany({ where: { id: journal.id, status: journal.status, updatedAt: journal.updatedAt, reservedGB: 0, metadata: journal.metadata }, data: { status: 'SUCCESS', completedPanels: journal.targetPanels, failedPanels: '[]', lastError: null, metadata: JSON.stringify({ ...updateMetadata(journal.metadata), nativePending: false }) } });
      confirmed += result.count;
    }
    return confirmed;
  };
  return locked ? confirm() : withResellerLock(resellerId, confirm);
}
