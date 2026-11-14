import { db } from './db';
import { randomUUID } from 'node:crypto';
import { nextUsageObservation } from './customer-model';
import { CUSTOMER_ACTIVE, customerHistory, customerHistoryKey, parseSetting } from './customer-management';
import { canonicalUserUsage, withResellerLock } from './reseller-helpers';
import { getRequiredUserPanelIds, confirmQueuedUserUpdates, continuePendingDestructiveOperations } from './accounting-ops';
import { getAllPanelInboundsFresh } from './panel-manager';
import { sendThresholdAlerts, type ThresholdAlert } from './telegram';
import { isAdminManagedReseller } from './reseller-ownership';
import { confirmQueuedCreations } from './user-create';
import { reconcileInboundRevocations } from './inbound-revocation';
import { retainDetachedAccounting } from './retained-accounting';

export async function loadAlertPreferences(resellerId: string) {
  const entry = await db.setting.findUnique({ where: { key: `customerAlertPreferences:${resellerId}` } });
  const value = parseSetting<{ usagePercent?: number; expiryDays?: number } | null>(entry?.value, null) || {};
  return { usagePercent: typeof value.usagePercent === 'number' && Number.isInteger(value.usagePercent) && value.usagePercent >= 1 && value.usagePercent <= 100 ? value.usagePercent : 80,
    expiryDays: typeof value.expiryDays === 'number' && Number.isInteger(value.expiryDays) && value.expiryDays >= 0 && value.expiryDays <= 30 ? value.expiryDays : 3 };
}

/** Read-only native collection. Setting writes only; no customer/inbound mutations. */
export async function collectCustomerObservations() {
  // A fresh installation must remain eligible for backup restore. Even a lease
  // Setting would make the empty-target check fail before any customer exists.
  if (!await db.resellerUser.count() && !await db.operationJournal.count({ where: { type: 'CREATE', status: { in: ['PARTIAL', 'NEEDS_REPAIR'] } } })) return { busy: false, observed: 0, skipped: 0 };
  const key = 'customerObservationLease', token = randomUUID(), now = Date.now();
  await db.setting.upsert({ where: { key }, create: { key, value: '0' }, update: {} });
  const lease = await db.setting.findUniqueOrThrow({ where: { key } });
  const previous = parseSetting<{ expires?: number } | null>(lease.value, null);
  if (previous?.expires && previous.expires > now) return { busy: true, observed: 0, skipped: 0 };
  const acquired = await db.setting.updateMany({ where: { key, value: lease.value }, data: { value: JSON.stringify({ token, expires: now + 20 * 60000 }) } });
  if (!acquired.count) return { busy: true, observed: 0, skipped: 0 };
  let observed = 0, skipped = 0, registered = 0, creationsConfirmed = 0;
  try {
    const resellers = await db.reseller.findMany({ take: 100 });
    for (const reseller of resellers) {
      await continuePendingDestructiveOperations(reseller.id);
      await reconcileInboundRevocations(reseller.id, { schedule: true, budgetMs: 20000 });
      const alerts = await withResellerLock(reseller.id, async () => {
        await confirmQueuedUserUpdates(reseller.id, true);
        const creations = await confirmQueuedCreations(reseller.id, { locked: true, recoverUntracked: true });
        registered += creations.registered;creationsConfirmed += creations.confirmed;
        const list: ThresholdAlert[] = [], preferences = await loadAlertPreferences(reseller.id);
        const snapshot = await getAllPanelInboundsFresh();
        const users = await db.resellerUser.findMany({ where: { resellerId: reseller.id }, take: 2000 });
        for (const user of users) {
          if (await db.operationJournal.count({ where: { resellerId: reseller.id, email: user.email, status: { in: CUSTOMER_ACTIVE } } })) { skipped++; continue; }
          const required = await getRequiredUserPanelIds(user);
          if (!required.ok) { skipped++; continue; }
          let panels = snapshot.panels.filter(p => required.panelIds.includes(p.panelId));
          try { panels = await retainDetachedAccounting(panels, user); }
          catch { skipped++; continue; }
          const stats = panels.flatMap(p => p.inbounds.flatMap(i => i.clientStats.filter(s => s.email === user.email)));
          if (!required.panelIds.every(id => panels.some(p => p.panelId === id && p.inbounds.some(i => i.clientStats.some(s => s.email === user.email)))) || !stats.length || stats.some(s => !Number.isFinite(s.up) || !Number.isFinite(s.down) || s.up < 0 || s.down < 0)) { skipped++; continue; }
          const usedGB = canonicalUserUsage(panels, user.email).usedBytes / 1073741824;
          const resets = await db.operationJournal.findMany({ where: { resellerId: reseller.id, userId: user.id, type: 'RESET', accountingCommitted: true, status: 'SUCCESS' }, select: { usageSnapshotGB: true } });
          const debit = resets.reduce((sum, j) => sum + Math.max(0, j.usageSnapshotGB || 0), 0);
          const history = nextUsageObservation(await customerHistory(user.id), usedGB + debit);
          const historyKey = customerHistoryKey(user.id), value = JSON.stringify(history);
          await db.setting.upsert({ where: { key: historyKey }, create: { key: historyKey, value }, update: { value } });
          observed++;
          const total = Math.max(...stats.map(s => s.total || 0)) / 1073741824;
          const pct = total > 0 ? Math.round(usedGB / total * 100) : 0;
          const expiry = Math.max(...stats.map(s => s.expiryTime || 0));
          const days = expiry > 0 ? Math.ceil((expiry - Date.now()) / 86400000) : -1;
          if (pct >= preferences.usagePercent) list.push({ email: user.email, name: user.name, type: 'usage', pct });
          if (days >= 0 && days <= preferences.expiryDays) list.push({ email: user.email, name: user.name, type: 'expiry', days });
        }
        return list;
      });
      // Delivery shares the reseller lock with read-triggered delivery, outside collection.
      if (reseller.active && !await isAdminManagedReseller(reseller.id)) await sendThresholdAlerts(reseller, alerts);
    }
    return { busy: false, observed, skipped, registered, creationsConfirmed };
  } finally {
    await db.setting.updateMany({ where: { key, value: JSON.stringify({ token, expires: now + 20 * 60000 }) }, data: { value: '0' } });
  }
}
