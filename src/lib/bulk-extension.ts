import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { getQuotaState } from "@/lib/accounting-ops";
import { parseInboundRefs, withResellerLock } from "@/lib/reseller-helpers";
import { getAllPanelInboundsFresh, getPanelConnection, getPrimaryPanel } from "@/lib/panel-manager";
import { getInbounds, updateClient } from "@/lib/panel";
import { logActivity } from "@/lib/logger";
import { planExtension, executeExtensionUser, validateExtensionInput, type ExtensionInput, type ExtensionSource, type ExtensionPlan } from "./bulk-extension-core";

const ACTIVE = ["PENDING", "RUNNING", "PARTIAL", "NEEDS_REPAIR"];
type JobMeta = { input: ExtensionInput; hash: string; planCipher: string; actorName: string };
export class ExtensionError extends Error {
  status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
const digest = (plan: ExtensionPlan) => createHash("sha256").update(JSON.stringify(plan)).digest("hex");

async function previewWithinLock(resellerId: string, input: ExtensionInput) {
  validateExtensionInput(input);
  const reseller = await db.reseller.findUnique({ where: { id: resellerId } });
  if (!reseller) throw new ExtensionError("نماینده پیدا نشد", 404);
  const activeJob = await db.operationJournal.findFirst({ where: { resellerId, type: "BULK_EXTEND", status: { in: ACTIVE } } });
  if (activeJob) throw new ExtensionError("افزایش گروهی قبلی هنوز تمام نشده؛ همان عملیات را ادامه دهید");
  const users = await db.resellerUser.findMany({ where: { resellerId }, orderBy: { id: "asc" } });
  if (!users.length) throw new ExtensionError("این نماینده کاربری ندارد", 400);
  const conflicts = await db.operationJournal.count({ where: { resellerId, email: { in: users.map(u => u.email) }, status: { in: ACTIVE } } });
  if (conflicts) throw new ExtensionError("عملیات دیگری روی کاربران این نماینده در جریان است؛ ابتدا آن را تمام کنید");
  const panels = await getAllPanelInboundsFresh();
  const primary = await getPrimaryPanel();
  const sources: ExtensionSource[] = users.map(u => {
    const refs = parseInboundRefs(u.inboundIds, u.panelId || primary?.id || "");
    if (!refs.length) throw new ExtensionError(`لوکیشن کاربر ${u.email} مشخص نیست`);
    const targets = [...new Set(refs.map(r => r.panelId))].sort().map(panelId => {
      const bundle = panels.panels.find(p => p.panelId === panelId);
      if (!bundle) throw new ExtensionError(`پنل کاربر ${u.email} در دسترس نیست؛ هیچ تغییری انجام نشد`, 502);
      // Ownership is restricted to the user's saved inbound references.
      const inbound = bundle.inbounds.find(i => refs.some(r => r.panelId === panelId && r.inboundId === i.id) && i.clients.some(c => c.email === u.email));
      const client = inbound?.clients.find(c => c.email === u.email);
      if (!inbound || !client) throw new ExtensionError(`اطلاعات زندهٔ ${u.email} یافت نشد؛ ابتدا اصلاح کنید`);
      return { panelId, protocol: inbound.protocol, client: { ...client } };
    });
    return { id: u.id, email: u.email, trafficGB: u.trafficGB, targets };
  });
  const quota = await getQuotaState(resellerId, reseller);
  const plan = planExtension(sources, input, quota);
  if (!plan.users.length) throw new ExtensionError("هیچ کاربری تغییر نمی‌کند؛ حجم یا زمان کاربران نامحدود است", 400);
  return { plan, hash: digest(plan), remainingGB: quota.remaining, unlimitedPool: quota.unlimited };
}

export async function previewExtension(resellerId: string, input: ExtensionInput) {
  return withResellerLock(resellerId, async () => {
    const p = await previewWithinLock(resellerId, input);
    return { hash: p.hash, total: p.plan.total, affected: p.plan.users.length, unchanged: p.plan.unchanged, requiredGB: p.plan.requiredGB, remainingGB: p.remainingGB, unlimitedPool: p.unlimitedPool };
  });
}

export async function startExtension(resellerId: string, input: ExtensionInput, hash: string, requestId: string, actorName: string) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw new ExtensionError("شناسهٔ درخواست نامعتبر است", 400);
  validateExtensionInput(input);
  return withResellerLock(resellerId, async () => {
    const key = `bulk-extend:${resellerId}:${requestId}`;
    const existing = await db.operationJournal.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      const meta = JSON.parse(existing.metadata || "{}") as JobMeta;
      if (meta.hash !== hash || JSON.stringify(meta.input) !== JSON.stringify(input)) throw new ExtensionError("این شناسه برای درخواست دیگری استفاده شده است");
      return jobSummary(existing.id, resellerId);
    }
    const p = await previewWithinLock(resellerId, input);
    if (p.hash !== hash) throw new ExtensionError("اطلاعات کاربران از زمان پیش‌نمایش تغییر کرده؛ دوباره پیش‌نمایش بگیرید");
    const job = await db.$transaction(async tx => {
      const parent = await tx.operationJournal.create({ data: {
        idempotencyKey: key, resellerId, email: "__bulk_extension__", type: "BULK_EXTEND", status: "RUNNING",
        metadata: JSON.stringify({ input, hash, actorName, planCipher: encryptSecret(JSON.stringify(p.plan)) } satisfies JobMeta),
      } });
      for (const u of p.plan.users) {
        await tx.operationJournal.create({ data: {
          idempotencyKey: `${key}:${u.id}`, resellerId, userId: u.id, email: u.email, type: "UPDATE", status: "PENDING",
          reservedGB: u.newTrafficGB - u.oldTrafficGB,
          targetPanels: JSON.stringify(u.targets.map(t => t.panelId)),
          metadata: JSON.stringify({ bulkJobId: parent.id, newTrafficGB: u.newTrafficGB }),
        } });
      }
      return parent;
    }, { timeout: 20000 });
    await logActivity({ actorType: "ADMIN", actorName, action: "شروع افزایش گروهی حجم و زمان", detail: `${p.plan.users.length} کاربر | هر کاربر +${input.trafficGB} گیگ / +${input.days} روز | رزرو ${p.plan.requiredGB} گیگ`, resellerId });
    return jobSummary(job.id, resellerId);
  });
}

async function loadJob(jobId: string, resellerId: string) {
  const job = await db.operationJournal.findFirst({ where: { id: jobId, resellerId, type: "BULK_EXTEND" } });
  if (!job) throw new ExtensionError("عملیات پیدا نشد", 404);
  const meta = JSON.parse(job.metadata || "{}") as JobMeta;
  const decoded = decryptSecret(meta.planCipher);
  if (!decoded) throw new ExtensionError("اطلاعات عملیات قابل خواندن نیست؛ نیاز به بررسی دارد", 500);
  const plan = JSON.parse(decoded) as ExtensionPlan;
  const children = await db.operationJournal.findMany({ where: { resellerId, idempotencyKey: { startsWith: `${job.idempotencyKey}:` } }, orderBy: { idempotencyKey: "asc" } });
  return { job, meta, plan, children };
}

export async function jobSummary(jobId: string, resellerId: string) {
  const { job, plan, children } = await loadJob(jobId, resellerId);
  const done = children.filter(c => c.status === "SUCCESS").length;
  return { jobId: job.id, status: job.status, total: children.length, done, pending: children.length - done,
    unchanged: plan.unchanged, requiredGB: plan.requiredGB, input: plan.input,
    errors: children.filter(c => c.lastError).map(c => ({ email: c.email, error: c.lastError })) };
}

export async function activeExtension(resellerId: string) {
  const job = await db.operationJournal.findFirst({ where: { resellerId, type: "BULK_EXTEND", status: { in: ACTIVE } }, orderBy: { createdAt: "desc" } });
  return job ? jobSummary(job.id, resellerId) : null;
}

/** One user per HTTP request bounds work and survives browser or process restarts. */
export async function runExtensionStep(jobId: string, resellerId: string) {
  return withResellerLock(resellerId, async () => {
    const { job, meta, plan, children } = await loadJob(jobId, resellerId);
    if (job.status === "SUCCESS") return jobSummary(jobId, resellerId);
    const child = children.find(c => c.status !== "SUCCESS");
    if (child) {
      const u = plan.users.find(u => u.id === child.userId);
      if (!u) throw new ExtensionError("اطلاعات کاربر در عملیات موجود نیست", 500);
      const tracked = await db.resellerUser.findFirst({ where: { id: u.id, resellerId, email: u.email } });
      if (!tracked || tracked.trafficGB !== u.oldTrafficGB) throw new ExtensionError(`اطلاعات کاربر ${u.email} تغییر کرده؛ عملیات نیاز به بررسی دارد`);
      const completed = JSON.parse(child.completedPanels) as string[];
      const childMeta = JSON.parse(child.metadata || "{}") as { bulkJobId: string; newTrafficGB: number; attemptedPanels?: string[] };
      const attempted = childMeta.attemptedPanels || [];
      const result = await executeExtensionUser(u, completed, {
        apply: async t => {
          // Never let getPanelConnection's legacy fallback target another panel.
          const config = await db.panelConfig.findUnique({ where: { id: t.panelId } });
          if (!config || !config.active) throw new Error("پنل مقصد غیرفعال یا حذف شده است");
          const conn = await getPanelConnection(t.panelId);
          if (!conn.ok) throw new Error(conn.msg);
          const fresh = await getInbounds(conn.conn);
          if (!fresh.ok || !fresh.data) throw new Error(fresh.msg || "پنل در دسترس نیست");
          const current = fresh.data.flatMap(i => i.clients).find(c => c.email === u.email);
          if (!current || current.id !== t.client.id || current.password !== t.client.password || current.subId !== t.client.subId) throw new Error("شناسهٔ اتصال کاربر تغییر کرده؛ برای جلوگیری از بازنویسی عملیات متوقف شد");
          const gb = plan.input.trafficGB;
          const dayDelta = plan.input.days * 86400000 * (t.client.expiryTime < 0 ? -1 : 1);
          let oldExpiry = t.client.expiryTime === 0 ? 0 : t.client.expiryTime - dayDelta;
          if (t.client.expiryTime < 0 && current.expiryTime > 0) {
            if (attempted.includes(t.panelId)) throw new Error("اشتراک با اولین اتصال فعال شده و نتیجهٔ درخواست قبلی نامشخص است؛ برای جلوگیری از افزایش دوباره، زمان این کاربر نیاز به بررسی دارد");
            // Activation before this target's first write: persist an absolute expiry
            // before sending it. Subsequent retries reuse exactly this timestamp.
            oldExpiry = current.expiryTime;
            t.client.expiryTime = current.expiryTime + plan.input.days * 86400000;
            meta.planCipher = encryptSecret(JSON.stringify(plan));
            await db.operationJournal.update({ where: { id: job.id }, data: { metadata: JSON.stringify(meta) } });
          }
          const oldTotal = gb > 0 ? u.oldTrafficGB * 1073741824 : t.client.totalGB;
          if (![oldTotal, t.client.totalGB].includes(current.totalGB) || ![oldExpiry, t.client.expiryTime].includes(current.expiryTime)) throw new Error("حجم یا انقضای کاربر خارج از این عملیات تغییر کرده است");
          if (!attempted.includes(t.panelId)) {
            attempted.push(t.panelId);
            await db.operationJournal.update({ where: { id: child.id }, data: { metadata: JSON.stringify({ ...childMeta, attemptedPanels: attempted }) } });
          }
          const r = await updateClient(conn.conn, u.email, t.protocol, { ...current, totalGB: t.client.totalGB, expiryTime: t.client.expiryTime });
          if (!r.ok) throw new Error(r.msg || "ویرایش پنل ناموفق بود");
        },
        markPanel: async panelId => {
          completed.push(panelId);
          await db.operationJournal.update({ where: { id: child.id }, data: { completedPanels: JSON.stringify(completed), status: "RUNNING" } });
        },
        commit: async () => {
          await db.$transaction(async tx => {
            await tx.resellerUser.update({ where: { id: u.id }, data: { trafficGB: u.newTrafficGB } });
            await tx.operationJournal.update({ where: { id: child.id }, data: { status: "SUCCESS", reservedGB: 0, lastError: null, accountingCommitted: true } });
          });
        },
      });
      if (!result.ok) {
        await db.operationJournal.update({ where: { id: child.id }, data: { status: "PARTIAL", lastError: result.error } });
        await db.operationJournal.update({ where: { id: job.id }, data: { status: "PARTIAL", lastError: result.error } });
        return jobSummary(job.id, resellerId);
      }
    }
    const summary = await jobSummary(job.id, resellerId);
    if (summary.pending === 0) {
      await db.operationJournal.update({ where: { id: job.id }, data: { status: "SUCCESS", lastError: null } });
      await logActivity({ actorType: "ADMIN", actorName: meta.actorName, action: "تکمیل افزایش گروهی حجم و زمان", detail: `${summary.done} کاربر | ${plan.requiredGB} گیگ از پول نماینده | +${plan.input.days} روز`, resellerId });
    } else {
      await db.operationJournal.update({ where: { id: job.id }, data: { status: "RUNNING", lastError: null } });
    }
    return jobSummary(job.id, resellerId);
  });
}
