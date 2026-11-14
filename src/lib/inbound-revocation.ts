import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { getPanelConnection, getPrimaryPanel, getAllPanelInboundsFresh, type PanelBundle } from './panel-manager';
import { parseInboundRefs, refKey, stringifyInboundRefs, withResellerLock } from './reseller-helpers';
import { revokeClientInbounds, arePanelNodesSynchronized, type PanelAuth } from './panel';
import type { MembershipRevokeProgress } from './node-client-sync';
import { membershipStateKey, readMembershipState, type MembershipState } from './membership-state';
import { operationInstallation } from './operation-installation';
import { isAdminManagedReseller } from './reseller-ownership';
import { createReconciliationRunner } from './background-reconciliation';

const ACTIVE = ['PENDING', 'RUNNING', 'PARTIAL', 'NEEDS_REPAIR'];
const QUEUE = 'inboundGrantQueue:';
type GrantQueue = { version: 1; installation: string; revision: string };
export async function markInboundGrantChange(tx: Prisma.TransactionClient, resellerId: string) {
  const value = JSON.stringify({ version: 1, installation: operationInstallation(true)!, revision: randomUUID() } satisfies GrantQueue);
  await tx.setting.upsert({ where: { key: QUEUE + resellerId }, create: { key: QUEUE + resellerId, value }, update: { value } });
}
async function waitForRevocationSync(auth: PanelAuth, ids: number[]) {
  const deadline = Date.now() + 8000;
  do { if (await arePanelNodesSynchronized(auth, true, ids)) return true;if (Date.now() >= deadline) return false;await new Promise(resolve => setTimeout(resolve, 500)); } while (Date.now() < deadline);
  return false;
}
type RevokeIntent = { version: 1; kind: 'INBOUND_REVOCATION'; installation: string; sourceRefs: string; sourceMemberships: { panelId: string; inboundId: number }[]; removed: { panelId: string; inboundId: number }[]; node: Record<string, MembershipRevokeProgress> };

/** Called in the same transaction and owner lock that saves grants. No remote
 * work runs in this transaction. Revocation never reserves or refunds quota. */
export async function scheduleInboundRevocations(tx: Prisma.TransactionClient, resellerId: string, primary: string, observed: PanelBundle[] = [], remaining?: { value: number }): Promise<number> {
  const grants = await tx.resellerInbound.findMany({ where: { resellerId } }), allowed = new Set(grants.map(g => refKey({ panelId: g.panelId || primary, inboundId: g.inboundId })));
  const users = await tx.resellerUser.findMany({ where: { resellerId } });let scheduled = 0, outstanding = 0;
  for (const user of users) {
    const refs = parseInboundRefs(user.inboundIds, user.panelId || primary);
    // Include authenticated native memberships that an old import/repair left
    // outside tracked refs. Match the exact owned subscription, never just name.
    const actual = observed.flatMap(p => p.inbounds.filter(i => i.id > 0 && !!user.subId && i.clients.some(c => c.email === user.email && c.subId === user.subId)).map(i => ({ panelId: p.panelId, inboundId: i.id })));
    const memberships = [...new Map([...refs, ...actual].map(r => [refKey(r), r])).values()], removed = memberships.filter(r => !allowed.has(refKey(r)));
    if (removed.length) outstanding++;
    if (!removed.length || await tx.operationJournal.findFirst({ where: { resellerId, userId: user.id, type: 'REVOKE', status: { in: ACTIVE } } })) continue;
    if (await tx.operationJournal.count({ where: { resellerId, email: user.email, status: { in: ACTIVE } } })) continue;
    const intent: RevokeIntent = { version: 1, kind: 'INBOUND_REVOCATION', installation: operationInstallation(true)!, sourceRefs: user.inboundIds, sourceMemberships: memberships, removed, node: {} };
    await tx.operationJournal.create({ data: { idempotencyKey: `revoke:${user.id}:${randomUUID()}`, resellerId, userId: user.id, email: user.email, type: 'REVOKE', status: 'PENDING', reservedGB: 0, targetPanels: JSON.stringify([...new Set(removed.map(r => r.panelId))]), metadata: JSON.stringify(intent) } });scheduled++;
  }
  if (remaining) remaining.value = outstanding;
  if (outstanding) await tx.setting.upsert({ where: { key: QUEUE + resellerId },
    create: { key: QUEUE + resellerId, value: JSON.stringify({ version: 1, installation: operationInstallation(true)!, revision: randomUUID() } satisfies GrantQueue) }, update: {} });
  return scheduled;
}

async function runUserRevocation(resellerId: string, journalId: string): Promise<boolean> {
  return withResellerLock(resellerId, async () => {
    const row = await db.operationJournal.findUnique({ where: { id: journalId } });
    if (!row || row.resellerId !== resellerId || row.type !== 'REVOKE' || !ACTIVE.includes(row.status)) return true;
    const user = row.userId ? await db.resellerUser.findUnique({ where: { id: row.userId } }) : null;
    if (!user || user.resellerId !== resellerId || user.email !== row.email || !user.subId || await isAdminManagedReseller(resellerId)) return false;
    const intent = JSON.parse(row.metadata || 'null') as RevokeIntent;
    if (intent?.version !== 1 || intent.kind !== 'INBOUND_REVOCATION' || intent.installation !== operationInstallation() || intent.sourceRefs !== user.inboundIds || !Array.isArray(intent.removed) || !intent.removed.length || !Array.isArray(intent.sourceMemberships)) return false;
    if (await db.operationJournal.count({ where: { resellerId, email: user.email, id: { not: row.id }, status: { in: ACTIVE } } })) return false;
    const primary = user.panelId || (await getPrimaryPanel())?.id || '', refs = parseInboundRefs(user.inboundIds, primary);
    const grants = await db.resellerInbound.findMany({ where: { resellerId } }), allowed = new Set(grants.map(g => refKey({ panelId: g.panelId || primary, inboundId: g.inboundId })));
    // A regrant before any native action cancels only the no-longer-needed
    // removal. Once native work is recorded, finish that exact intent first.
    if (!Object.keys(intent.node).length && intent.removed.some(r => allowed.has(refKey(r)))) {
      intent.removed = intent.removed.filter(r => !allowed.has(refKey(r)));
      if (!intent.removed.length) { await db.operationJournal.update({ where: { id: row.id }, data: { status: 'SUCCESS', metadata: JSON.stringify(intent) } });return true; }
    }
    const keys = new Set(intent.removed.map(refKey));
    if (!intent.removed.every(r => intent.sourceMemberships.some(old => refKey(old) === refKey(r)))) return false;
    // Preserve an authoritative native record as an accounting target even if
    // its last inbound disappears. This marker grants no connection permission.
    const previous = await readMembershipState(user);
    const state: MembershipState = { version: 1, userId: user.id, resellerId, email: user.email, subId: user.subId, installation: operationInstallation()!, panels: [...new Set([...(previous?.panels || []), ...intent.sourceMemberships.map(r => r.panelId)])] };
    await db.$transaction(async tx => {
      await tx.setting.upsert({ where: { key: membershipStateKey(user.id) }, create: { key: membershipStateKey(user.id), value: JSON.stringify(state) }, update: { value: JSON.stringify(state) } });
      await tx.operationJournal.update({ where: { id: row.id }, data: { status: 'RUNNING', metadata: JSON.stringify(intent), lastError: null } });
    });
    for (const panelId of new Set(intent.removed.map(r => r.panelId))) {
      // Duplicate tracked owners must never share a mutation target merely
      // because their native email happens to match.
      if ((await db.resellerUser.findMany({ where: { email: user.email, id: { not: user.id } } })).some(other => parseInboundRefs(other.inboundIds, other.panelId || primary).some(r => r.panelId === panelId))) return false;
      const connection = await getPanelConnection(panelId);
      const ids = intent.removed.filter(r => r.panelId === panelId).map(r => r.inboundId);
      const progress = {
        load: async () => intent.node[panelId],
        save: async (value: MembershipRevokeProgress) => { intent.node[panelId] = value;await db.operationJournal.update({ where: { id: row.id }, data: { metadata: JSON.stringify(intent) } }); },
      };
      let result = connection.ok ? await revokeClientInbounds(connection.conn, user.email, user.subId, ids, progress) : { ok: false, msg: connection.msg };
      if (connection.ok && result.ok) {
        if (!await waitForRevocationSync(connection.conn, ids)) result = { ok: false, msg: 'منتظر تأیید همگام‌سازی لوکیشن‌های جداشده؛ مصرف و سهمیه محفوظ است' };
        else {
          result = await revokeClientInbounds(connection.conn, user.email, user.subId, ids, progress);
          if (result.ok && await waitForRevocationSync(connection.conn, ids)) result = await revokeClientInbounds(connection.conn, user.email, user.subId, ids, progress, true);
          else result = { ok: false, msg: 'تأیید نهایی لوکیشن‌های جداشده هنوز کامل نیست' };
        }
      }
      if (!result.ok) {
        await db.operationJournal.update({ where: { id: row.id }, data: { status: 'PARTIAL', lastError: result.msg || 'جداسازی لوکیشن‌ها تأیید نشد؛ مصرف و سهمیه محفوظ است' } });return false;
      }
    }
    const retained = refs.filter(r => !keys.has(refKey(r)));
    await db.$transaction(async tx => {
      const changed = await tx.resellerUser.updateMany({ where: { id: user.id, resellerId, email: user.email, subId: user.subId, inboundIds: intent.sourceRefs }, data: { inboundIds: stringifyInboundRefs(retained) } });
      if (changed.count !== 1) throw Error('Customer changed during inbound revocation');
      await tx.operationJournal.update({ where: { id: row.id }, data: { status: 'SUCCESS', reservedGB: 0, completedPanels: row.targetPanels, failedPanels: '[]', lastError: null, metadata: JSON.stringify(intent) } });
      await tx.activityLog.create({ data: { actorType: 'ADMIN', actorName: 'admin', resellerId, action: 'حذف لوکیشن‌های لغوشده از کاربر', detail: `${user.email} | ${intent.removed.length} لوکیشن؛ مصرف و سهمیه حفظ شدند` } });
    });
    return true;
  });
}

/** Used by the existing observation job and explicit admin mutations. Every
 * continuation rereads ownership and the exact journal after taking its lock. */
export async function reconcileInboundRevocations(resellerId: string, options: { schedule?: boolean; budgetMs?: number; maxUsers?: number } = {}) {
  if (await isAdminManagedReseller(resellerId)) return { completed: 0, pending: 0 };
  const primary = (await getPrimaryPanel())?.id || '';
  const schedule = async () => { const observed = await getAllPanelInboundsFresh();return withResellerLock(resellerId, () => db.$transaction(tx => scheduleInboundRevocations(tx, resellerId, primary, observed.panels))); };
  if (options.schedule) await schedule();
  const queue = await db.setting.findUnique({ where: { key: QUEUE + resellerId } });
  const rows = await db.operationJournal.findMany({ where: { resellerId, type: 'REVOKE', status: { in: ACTIVE } }, orderBy: { createdAt: 'asc' }, take: options.maxUsers ?? 100 });
  const deadline = Date.now() + (options.budgetMs ?? 20000);let completed = 0;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    try { if (await runUserRevocation(resellerId, row.id)) completed++; }
    catch { await db.operationJournal.updateMany({ where: { id: row.id, status: { in: ACTIVE } }, data: { status: 'PARTIAL', lastError: 'جداسازی لوکیشن‌ها هنوز قابل تأیید نیست؛ مصرف و سهمیه محفوظ است' } }); }
  }
  const remaining = { value: 0 };
  if (options.schedule) {
    const observed = await getAllPanelInboundsFresh();
    await withResellerLock(resellerId, () => db.$transaction(tx => scheduleInboundRevocations(tx, resellerId, primary, observed.panels, remaining)));
  }
  let pending = Math.max(remaining.value, await db.operationJournal.count({ where: { resellerId, type: 'REVOKE', status: { in: ACTIVE } } }));
  if (!pending && queue) {
    // A newer grant change must not be acknowledged by an older worker.
    const cleared = (await db.setting.deleteMany({ where: { key: queue.key, value: queue.value } })).count;
    pending = cleared || !await db.setting.findUnique({ where: { key: queue.key } }) ? 0 : 1;
  }
  return { completed, pending };
}

const runner = ((globalThis as { __pvnetInboundReconciliationRunner?: ReturnType<typeof createReconciliationRunner> }).__pvnetInboundReconciliationRunner ??= createReconciliationRunner({
  reconcile: resellerId => reconcileInboundRevocations(resellerId, { schedule: true, budgetMs: 60000 }),
}));
/** One bounded worker per owner in the existing app. Remaining batches continue
 * automatically; unavailable targets retry with backoff and unchanged guards. */
export function runInboundRevocationWorker(resellerId: string): Promise<void> {
  return runner.run(resellerId);
}

/** Restart recovery reads only the dashboard's durable queue. Native work still
 * goes through the exact owner/installation/identity guards above. Empty installs
 * acquire no leases/settings and remain eligible for backup restoration. */
export async function recoverInboundGrantWork() {
  const installation = operationInstallation();if (!installation) return;
  const [queued, journals] = await Promise.all([
    db.setting.findMany({ where: { key: { startsWith: QUEUE } }, select: { key: true, value: true } }),
    db.operationJournal.findMany({ where: { type: 'REVOKE', status: { in: ACTIVE }, metadata: { contains: JSON.stringify(installation) } }, distinct: ['resellerId'], select: { resellerId: true } }),
  ]);
  const owners = new Set(journals.map(j => j.resellerId));
  for (const item of queued) {
    try { const value = JSON.parse(item.value) as GrantQueue;if (value.version === 1 && value.installation === installation) owners.add(item.key.slice(QUEUE.length)); } catch { /* Unknown/restored intent never authorizes native work. */ }
  }
  for (const owner of owners) void runner.ensure(owner);
}

export function initializeInboundGrantRecovery() {
  const global = globalThis as { __pvnetInboundRecoveryStarted?: boolean };
  if (global.__pvnetInboundRecoveryStarted) return;
  global.__pvnetInboundRecoveryStarted = true;
  let scanning = false;
  const scan = async () => { if (scanning) return;scanning = true;try { await recoverInboundGrantWork(); } catch { /* The next bounded scan retries dashboard DB availability. */ } finally { scanning = false; } };
  const first = setTimeout(() => { void scan(); }, 1000);first.unref();
  const timer = setInterval(() => { void scan(); }, 60000);timer.unref();
}
