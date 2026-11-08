import { db } from './db';
import { normalizedLabels, onlineTimestamp, type UsageHistory } from './customer-model';
import { getResellerWithAccess, withResellerLock, parseInboundRefs, validateInboundSelection } from './reseller-helpers';
import { getRequiredUserPanelIds, confirmQueuedUserUpdates, confirmAcknowledgedDeletions } from './accounting-ops';
import { isSavedQueuedUpdate } from './queued-update';
import type { ResellerUser } from '@prisma/client';
import { confirmQueuedCreations } from './user-create';
import { getAllPanelInboundsFresh, getPanelConnection, getPrimaryPanel } from './panel-manager';
import { updateClient, getLastOnline, type PanelClient } from './panel';
import { logActivity } from './logger';
import { canCancelUnstartedReset, canCancelUnstartedOperation } from './pending-reset';
import { operationInstallation } from './operation-installation';

export const CUSTOMER_ACTIVE = ['PENDING', 'RUNNING', 'PARTIAL', 'NEEDS_REPAIR'];
const identity = (client: PanelClient) => client.id || client.password || '';
export const customerMetaKey = (id: string) => `customerMeta:${id}`;
export const customerHistoryKey = (id: string) => `customerHistory:${id}`;
export function parseSetting<T>(value: string | null | undefined, fallback: T): T { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }

export async function ownedCustomers(resellerId: string, input: unknown) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50 || input.some(e => typeof e !== 'string' || !e || e.length > 150)) throw Error('بین ۱ تا ۵۰ کاربر را انتخاب کنید');
  const emails = [...new Set(input as string[])].sort();
  const users = await db.resellerUser.findMany({ where: { resellerId, email: { in: emails } } });
  return users.length === emails.length ? users : null;
}

export async function customerMetadata(users: ResellerUser[]) {
  await Promise.all([...new Set(users.map(u => u.resellerId))].map(async id => { await confirmAcknowledgedDeletions(id);await confirmQueuedUserUpdates(id, false, 4000);await confirmQueuedCreations(id, { budgetMs: 4000 }); }));
  const present = new Set((await db.resellerUser.findMany({ where: { id: { in: users.map(u => u.id) } }, select: { id: true } })).map(u => u.id));
  const entries = await db.setting.findMany({ where: { key: { in: users.map(u => customerMetaKey(u.id)) } } });
  const values = new Map(entries.map(s => [s.key, s.value]));
  const updates = await db.operationJournal.findMany({ where: { userId: { in: users.map(u => u.id) }, type: { in: ['UPDATE', 'CREATE', 'DELETE', 'RESET'] }, status: { in: ['PENDING', 'RUNNING', 'PARTIAL', 'NEEDS_REPAIR'] } }, orderBy: { createdAt: 'desc' } });
  return users.map(u => {
    const value = parseSetting<{ labels?: unknown } | null>(values.get(customerMetaKey(u.id)), null);
    let labels: string[] = [];
    try { labels = normalizedLabels(value?.labels || []); } catch { /* Invalid restored metadata must not break the user list. */ }
    const operation = updates.find(j => j.userId === u.id && j.type === 'UPDATE');
    const pending = parseSetting<{ newTrafficGB?: number; kind?: string; bulkJobId?: string; localCommitted?: boolean } | null>(operation?.metadata, null);
    const pendingUpdate = pending && !pending.kind && !pending.bulkJobId && Number.isSafeInteger(pending.newTrafficGB) && pending.newTrafficGB! >= 0 ? { trafficGB: pending.newTrafficGB!, localCommitted: !!operation && isSavedQueuedUpdate(u, operation) } : null;
    const destructive = updates.find(j => j.userId === u.id && j.resellerId === u.resellerId && j.email === u.email && ['DELETE', 'RESET'].includes(j.type) && parseSetting<{ explicitDestructive?: boolean }>(j.metadata, {}).explicitDestructive === true);
    return { email: u.email, labels, deleted: !present.has(u.id), pendingUpdate, pendingCreate: updates.some(j => j.userId === u.id && j.type === 'CREATE' && j.resellerId === u.resellerId && j.email === u.email), pendingOperation: destructive?.type || null, pendingOperationId: destructive?.id || null, canCancelReset: !!destructive && canCancelUnstartedReset(destructive, operationInstallation()), canCancelOperation: !!destructive && canCancelUnstartedOperation(destructive, operationInstallation()) };
  });
}

export async function setCustomerLabels(resellerId: string, emails: unknown, input: unknown) {
  const labels = normalizedLabels(input);
  return withResellerLock(resellerId, async () => {
    if (!await getResellerWithAccess(resellerId)) return false;
    const users = await ownedCustomers(resellerId, emails);
    if (!users) return false;
    await db.$transaction(users.map(user => { const key = customerMetaKey(user.id), value = JSON.stringify({ labels }); return db.setting.upsert({ where: { key }, create: { key, value }, update: { value } }); }));
    return true;
  });
}

// One read-only native map per panel per 30 seconds. Missing values remain unknown.
const onlineCache = new Map<string, { at: number; value: Promise<Record<string, number | null>> }>();
export async function customerLastOnline(users: { email: string; panelId: string; inboundIds: string; id: string; trafficGB: number }[]) {
  const required = await Promise.all(users.map(async u => ({ user: u, panels: await getRequiredUserPanelIds(u) })));
  const panelIds = [...new Set(required.flatMap(r => r.panels.ok ? r.panels.panelIds : []))];
  const maps = new Map(await Promise.all(panelIds.map(async id => {
    const entry = onlineCache.get(id);
    let value = entry?.value;
    if (!entry || Date.now() - entry.at > 30000) {
      value = (async () => { const c = await getPanelConnection(id); if (!c.ok) return {}; const r = await getLastOnline(c.conn); return r.ok && r.data ? Object.fromEntries(Object.entries(r.data).map(([email, stamp]) => [email, onlineTimestamp(stamp)])) : {}; })();
      onlineCache.set(id, { at: Date.now(), value });
    }
    return [id, await value!] as const;
  })));
  return new Map(required.map(({ user, panels }) => {
    const stamps = panels.ok ? panels.panelIds.map(id => maps.get(id)?.[user.email] ?? null) : [];
    return [user.email, stamps.length && stamps.every(n => n !== null) ? Math.max(...stamps as number[]) : null];
  }));
}

type StatusMeta = { kind: 'CUSTOMER_STATUS'; enable: boolean; requestId: string; identities: Record<string, string> };
type StatusResult = { email: string; ok: boolean; error?: string };
export async function setCustomerStatus(resellerId: string, userId: string, email: string, enable: boolean, requestId: string): Promise<StatusResult> {
  return withResellerLock(resellerId, async () => {
    const fail = (error: string): StatusResult => ({ email, ok: false, error });
    const reseller = await getResellerWithAccess(resellerId);
    if (!reseller) return fail('حساب نماینده فعال نیست');
    const user = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId, email } } });
    if (!user || user.id !== userId) return fail('مالکیت یا هویت کاربر تغییر کرده است');
    const key = `customer-status:${resellerId}:${requestId}:${email}`;
    let journal = await db.operationJournal.findUnique({ where: { idempotencyKey: key } });
    if (journal?.status === 'SUCCESS') return { email, ok: true };
    const active = await db.operationJournal.findMany({ where: { resellerId, email, status: { in: CUSTOMER_ACTIVE } } });
    if (active.some(j => j.id !== journal?.id)) return fail('عملیات دیگری روی کاربر در جریان است');
    const required = await getRequiredUserPanelIds(user);
    if (!required.ok) return fail(required.msg);
    if (enable) {
      const primary = (await getPrimaryPanel())?.id || '';
      const refs = parseInboundRefs(user.inboundIds, user.panelId || primary).map(r => ({ ...r, panelId: r.panelId || primary }));
      const permitted = await validateInboundSelection(reseller, refs);
      if (!permitted.ok) return fail(permitted.msg);
    }
    const snapshot = await getAllPanelInboundsFresh();
    const current = new Map<string, { client: PanelClient; protocol: string }>();
    for (const id of required.panelIds) {
      const bundle = snapshot.panels.find(p => p.panelId === id);
      const inb = bundle?.inbounds.find(i => i.clients.some(c => c.email === email));
      const client = inb?.clients.find(c => c.email === email);
      if (!client || !inb || !identity(client) || user.subId && client.subId !== user.subId) return fail('هویت کاربر در همهٔ پنل‌های مرتبط قابل تأیید نیست');
      current.set(id, { client, protocol: inb.protocol });
    }
    const meta: StatusMeta = journal ? JSON.parse(journal.metadata!) : { kind: 'CUSTOMER_STATUS', enable, requestId, identities: Object.fromEntries([...current].map(([id, c]) => [id, identity(c.client)])) };
    if (meta.enable !== enable || meta.kind !== 'CUSTOMER_STATUS' || [...current].some(([id, c]) => meta.identities[id] !== identity(c.client))) return fail('هدف یا هویت عملیات تغییر کرده است');
    if (!journal) journal = await db.operationJournal.create({ data: { idempotencyKey: key, resellerId, userId, email, type: 'UPDATE', status: 'RUNNING', targetPanels: JSON.stringify(required.panelIds), metadata: JSON.stringify(meta) } });
    const completed = new Set<string>(JSON.parse(journal.completedPanels));
    const errors: string[] = [];
    for (const id of required.panelIds) {
      if (completed.has(id)) continue;
      try {
        const conn = await getPanelConnection(id); if (!conn.ok) throw Error('اتصال پنل در دسترس نیست');
        // id is an equality guard in the adapter; enable is the only changed field.
        const r = await updateClient(conn.conn, email, current.get(id)!.protocol, { id: meta.identities[id], enable });
        if (!r.ok) throw Error('تغییر وضعیت در همهٔ لوکیشن‌ها تأیید نشد');
        completed.add(id);
        await db.operationJournal.update({ where: { id: journal.id }, data: { completedPanels: JSON.stringify([...completed]) } });
      } catch (e) { errors.push((e as Error).message); }
    }
    if (!errors.length) {
      const after = await getAllPanelInboundsFresh();
      for (const id of required.panelIds) {
        const c = after.panels.find(p => p.panelId === id)?.inbounds.flatMap(i => i.clients).find(c => c.email === email);
        if (!c || identity(c) !== meta.identities[id] || c.enable !== enable) errors.push('وضعیت نهایی تأیید نشد');
      }
    }
    await db.operationJournal.update({ where: { id: journal.id }, data: { status: errors.length ? 'PARTIAL' : 'SUCCESS', lastError: errors.length ? errors.join(' | ') : null } });
    if (errors.length) return fail(errors.join(' | '));
    await logActivity({ actorType: 'RESELLER', actorName: reseller.username, resellerId, action: 'تغییر گروهی وضعیت کاربر', detail: `${email} | ${enable ? 'فعال' : 'غیرفعال'}` });
    return { email, ok: true };
  });
}

export async function customerHistory(id: string) {
  const s = await db.setting.findUnique({ where: { key: customerHistoryKey(id) } });
  return parseSetting<UsageHistory | null>(s?.value, null);
}
