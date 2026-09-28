import { db } from "@/lib/db";
import { withResellerLock, canonicalUserUsage, parseInboundRefs, refKey, type ResellerWithInbounds, type InboundRef } from "./reseller-helpers";
import { getAllPanelInbounds, getPanelConnection, getPrimaryPanel, type PanelBundle } from "./panel-manager";
import { deleteClient, resetClientTraffic, type PanelAuth } from "./panel";
import { logActivity } from "./logger";

/**
 * سرویس متمرکز عملیات تخریبی (حذف/ریست) — داشبورد و پل ربات هر دو از اینجا عبور می‌کنند.
 *
 * تضمین‌های فاز ۱.۱:
 * - پنل‌های مرتبط با کاربر (از refs ذخیره‌شده) باید همگی قابل خواندن باشند؛ حتی یک پنل مرتبط down ← رد عملیات
 *   (قطعی پنلِ نامرتبط مانع عملیات نمی‌شود)
 * - ژورنال ماندگار: مصرف کانونی قبل از عملیات ذخیره می‌شود؛ بدهکاری دقیقاً یک‌بار و فقط پس از موفقیت
 *   همه پنل‌های مرتبط؛ خرابی جزئی ← PARTIAL با حفظ snapshot برای retry
 * - retry فقط پنل‌های ناتمام را ادامه می‌دهد و هرگز دوبار بدهکاری نمی‌کند
 * - خطای پنل به‌صورت صریح دسته‌بندی می‌شود: SUCCESS / ALREADY_MISSING / FAILED / UNREACHABLE
 */

export type PanelOpResult = "SUCCESS" | "ALREADY_MISSING" | "FAILED" | "UNREACHABLE";

const MISSING_MARKERS = ["یافت نشد", "not found", "not exist", "does not exist", "no such"];

function classifyOpError(msg: string | undefined): PanelOpResult {
  const m = (msg || "").toLowerCase();
  if (MISSING_MARKERS.some((k) => m.includes(k.toLowerCase()))) return "ALREADY_MISSING";
  return "FAILED";
}

/** پنل‌های مرتبط با کاربر از refs ذخیره‌شده — panelId خالی (داده قدیمی) به پنل اصلی ترجمه می‌شود */
export async function getRequiredUserPanelIds(tracked: { inboundIds: string; panelId: string }): Promise<string[]> {
  const { getPrimaryPanel } = await import("./panel-manager");
  const primary = (await getPrimaryPanel())?.id || "";
  const refs: InboundRef[] = parseInboundRefs(tracked.inboundIds, tracked.panelId);
  return [...new Set(refs.map((r) => r.panelId || primary))];
}

/** همه پنل‌های مرتبط باید در snapshot خوانده شده باشند */
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

type JournalRow = { id: string; status: string; usageSnapshotGB: number | null; accountingCommitted: boolean; targetPanels: string; completedPanels: string; failedPanels: string };

async function findResumableJournal(email: string, type: "DELETE" | "RESET"): Promise<JournalRow | null> {
  const rows = await db.operationJournal.findMany({
    where: { email, type, status: { in: ["PENDING", "RUNNING", "PARTIAL"] } },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  return rows[0] ?? null;
}

function parseArr(v: string): string[] {
  try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

/** اجرای عملیات روی یک پنل با دسته‌بندی صریح نتیجه */
async function runPanelOp(
  panelId: string,
  op: "delete" | "reset",
  email: string
): Promise<{ panelId: string; result: PanelOpResult }> {
  const conn = await getPanelConnection(panelId);
  if (!conn.ok) return { panelId, result: "UNREACHABLE" };
  if (op === "delete") {
    const r = await deleteClient(conn.conn as PanelAuth, email);
    if (r.ok) return { panelId, result: "SUCCESS" };
    return { panelId, result: classifyOpError(r.msg) };
  }
  const r = await resetClientTraffic(conn.conn as PanelAuth, email);
  if (r.ok) return { panelId, result: "SUCCESS" };
  return { panelId, result: classifyOpError(r.msg) };
}

/** بدهکاری یک‌باره از snapshot ذخیره‌شده ژورنال */
async function commitJournalAccounting(journalId: string, resellerId: string, usageGB: number): Promise<void> {
  const j = await db.operationJournal.findUnique({ where: { id: journalId } });
  if (!j || j.accountingCommitted) return; // idempotent — هرگز دوبار
  await db.reseller.update({ where: { id: resellerId }, data: { consumedGB: { increment: usageGB } } });
  await db.operationJournal.update({ where: { id: journalId }, data: { accountingCommitted: true } });
}

export type DeleteResult =
  | { ok: true; debitedGB: number }
  | { ok: false; status: number; msg: string; partial?: boolean };

/**
 * حذف کاربر از همه پنل‌های مرتبط — با ژورنال ماندگار و بدهکاری دقیقاً یک‌باره.
 * داشبورد و پل ربات هر دو این تابع را صدا می‌زنند.
 */
export async function deleteUserByJournal(
  reseller: ResellerWithInbounds,
  tracked: { id: string; email: string; inboundIds: string; panelId: string; trafficGB: number },
  actorName: string
): Promise<DeleteResult> {
  return withResellerLock(reseller.id, async () => {
    const requiredPanels = await getRequiredUserPanelIds(tracked);
    const idempotencyKey = `delete:${tracked.id}`;

    // --- ادامه/ایجاد ژورنال ---
    let journal = await findResumableJournal(tracked.email, "DELETE");

    // --- خواندن همه پنل‌های مرتبط (fail-closed برای پنل‌های مرتبط) ---
    const snapshot = await getAllPanelInbounds();
    const readable = assertRequiredPanelsReadable(snapshot, requiredPanels);
    if (!readable.ok) {
      return { ok: false, status: 502, msg: `حذف انجام نشد: ${readable.msg}` };
    }

    // --- snapshot مصرف کانونی ---
    let usageGB = journal?.usageSnapshotGB ?? null;
    if (usageGB === null) {
      usageGB = Math.round((canonicalUserUsage(snapshot.panels, tracked.email).usedBytes / (1024 * 1024 * 1024)) * 10000) / 10000;
    }

    // --- ثبت/به‌روزرسانی ژورنال ---
    if (!journal) {
      const created = await db.operationJournal.create({
        data: {
          idempotencyKey, resellerId: reseller.id, userId: tracked.id, email: tracked.email,
          type: "DELETE", status: "RUNNING", usageSnapshotGB: usageGB,
          targetPanels: JSON.stringify(requiredPanels), completedPanels: "[]", failedPanels: "[]",
        },
      });
      journal = created;
    } else {
      await db.operationJournal.update({ where: { id: journal.id }, data: { status: "RUNNING", lastError: null } });
    }

    // --- اجرای حذف روی پنل‌های مرتبط (ناتمام‌ها) ---
    const completed = new Set(parseArr(journal.completedPanels));
    const results: { panelId: string; result: PanelOpResult }[] = [];
    for (const panelId of requiredPanels) {
      if (completed.has(panelId)) { results.push({ panelId, result: "SUCCESS" }); continue; }
      results.push(await runPanelOp(panelId, "delete", tracked.email));
    }
    const nowCompleted = results.filter((r) => r.result === "SUCCESS" || r.result === "ALREADY_MISSING").map((r) => r.panelId);
    const failed = results.filter((r) => r.result === "FAILED" || r.result === "UNREACHABLE");
    for (const c of nowCompleted) completed.add(c);

    // --- خرابی جزئی: بدون بدهکاری، بدون حذف رکورد، snapshot حفظ می‌شود ---
    if (failed.length > 0) {
      await db.operationJournal.update({
        where: { id: journal.id },
        data: {
          status: "PARTIAL",
          completedPanels: JSON.stringify([...completed]),
          failedPanels: JSON.stringify(failed.map((f) => `${f.panelId}:${f.result}`)),
          lastError: failed.map((f) => `${f.panelId}=${f.result}`).join(", "),
        },
      });
      return { ok: false, status: 502, partial: true, msg: `حذف ناقص بود — ${failed.length} پنل انجام نشد (${failed.map((f) => f.result).join(", ")}). مصرف ثبت‌شده حفظ شد؛ پس از رفع مشکل دوباره تلاش کنید.` };
    }

    // --- همه پنل‌ها انجام شد: بدهکاری دقیقاً یک‌بار + حذف رکورد محلی ---
    await commitJournalAccounting(journal.id, reseller.id, usageGB);
    await db.resellerUser.delete({ where: { id: tracked.id } });
    await db.operationJournal.update({
      where: { id: journal.id },
      data: { status: "SUCCESS", completedPanels: JSON.stringify([...completed]), failedPanels: "[]" },
    });
    await logActivity({
      actorType: "RESELLER",
      actorName: actorName,
      action: "حذف کاربر",
      detail: `${tracked.email}${usageGB > 0 ? ` | مصرف قطعی ثبت‌شده: ${usageGB} گیگ` : ""}`,
      resellerId: reseller.id,
    });
    return { ok: true, debitedGB: usageGB };
  });
}

export type ResetResult =
  | { ok: true; debitedGB: number }
  | { ok: false; status: number; msg: string; partial?: boolean };

/**
 * ریست ترافیک کاربر روی همه پنل‌های مرتبط — بدهکاری دقیقاً یک‌باره از snapshot ذخیره‌شده.
 */
export async function resetUserByJournal(
  reseller: ResellerWithInbounds,
  tracked: { id: string; email: string; inboundIds: string; panelId: string },
  actorName: string
): Promise<ResetResult> {
  return withResellerLock(reseller.id, async () => {
    const requiredPanels = await getRequiredUserPanelIds(tracked);

    const snapshot = await getAllPanelInbounds();
    const readable = assertRequiredPanelsReadable(snapshot, requiredPanels);
    if (!readable.ok) {
      return { ok: false, status: 502, msg: `ریست انجام نشد: ${readable.msg}` };
    }

    // ادامه ژورنال PARTIAL قبلی (در صورت وجود) — بدهکاری از snapshot همان عملیات
    const resumable = await findResumableJournal(tracked.email, "RESET");
    const usageGB =
      resumable?.usageSnapshotGB ??
      Math.round((canonicalUserUsage(snapshot.panels, tracked.email).usedBytes / (1024 * 1024 * 1024)) * 10000) / 10000;

    let journal = resumable;
    const idempotencyKey = `reset:${tracked.id}:${usageGB}`;
    if (!journal) {
      const created = await db.operationJournal.create({
        data: {
          idempotencyKey, resellerId: reseller.id, userId: tracked.id, email: tracked.email,
          type: "RESET", status: "RUNNING", usageSnapshotGB: usageGB,
          targetPanels: JSON.stringify(requiredPanels), completedPanels: "[]", failedPanels: "[]",
        },
      });
      journal = created;
    } else {
      await db.operationJournal.update({ where: { id: journal.id }, data: { status: "RUNNING", lastError: null } });
    }

    const completed = new Set(parseArr(journal.completedPanels));
    const results: { panelId: string; result: PanelOpResult }[] = [];
    for (const panelId of requiredPanels) {
      if (completed.has(panelId)) { results.push({ panelId, result: "SUCCESS" }); continue; }
      results.push(await runPanelOp(panelId, "reset", tracked.email));
    }
    const failed = results.filter((r) => r.result === "FAILED" || r.result === "UNREACHABLE");
    const nowCompleted = results.filter((r) => r.result === "SUCCESS" || r.result === "ALREADY_MISSING").map((r) => r.panelId);
    for (const c of nowCompleted) completed.add(c);

    if (failed.length > 0) {
      await db.operationJournal.update({
        where: { id: journal.id },
        data: {
          status: "PARTIAL",
          completedPanels: JSON.stringify([...completed]),
          failedPanels: JSON.stringify(failed.map((f) => `${f.panelId}:${f.result}`)),
          lastError: failed.map((f) => `${f.panelId}=${f.result}`).join(", "),
        },
      });
      return { ok: false, status: 502, partial: true, msg: `ریست ناقص بود — ${failed.length} پنل انجام نشد. مصرف ثبت‌شده حفظ شد؛ پس از رفع مشکل دوباره تلاش کنید.` };
    }

    await commitJournalAccounting(journal.id, reseller.id, usageGB);
    await db.operationJournal.update({
      where: { id: journal.id },
      data: { status: "SUCCESS", completedPanels: JSON.stringify([...completed]), failedPanels: "[]" },
    });
    await logActivity({
      actorType: "RESELLER",
      actorName: reseller.username,
      action: "ریست ترافیک کاربر",
      detail: `${tracked.email}${usageGB > 0 ? ` | مصرف قطعی ثبت‌شده: ${usageGB} گیگ` : ""}`,
      resellerId: reseller.id,
    });
    return { ok: true, debitedGB: usageGB };
  });
}
