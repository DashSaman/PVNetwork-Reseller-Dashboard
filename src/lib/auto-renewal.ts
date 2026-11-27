import { db } from './db';
import { renewUserByJournal } from './accounting-ops';
import { getAllPanelInboundsFresh } from './panel-manager';
import { canonicalUserUsage } from './reseller-helpers';
import { AUTO_RENEWAL_PREFIX, readAutoRenewal, readRenewalJournal } from './renewal-plan';
import { operationInstallation } from './operation-installation';
import { updateMetadata } from './queued-update';

const active = ['PENDING', 'RUNNING', 'PARTIAL'];

export async function recoverCustomerRenewals() {
  const installation = operationInstallation();
  if (!installation) return;
  const pending = await db.operationJournal.findMany({
    where: { type: 'RESET', status: { in: active }, metadata: { contains: '"renewal":' } },
    select: { id: true, email: true, resellerId: true, userId: true, metadata: true },
  });
  const recovering = new Set(pending.map(row => row.userId));
  for (const row of pending) {
    const metadata = updateMetadata(row.metadata);
    if (metadata.operationInstallation !== installation || !readRenewalJournal(metadata.renewal)) continue;
    try { await renewUserByJournal(row.resellerId, row.email, { automatic: true, journalId: row.id }); }
    catch { /* Retry the same durable checkpoint on the next scan. */ }
  }
  const rows = await db.setting.findMany({ where: { key: { startsWith: AUTO_RENEWAL_PREFIX } }, select: { key: true, value: true } });
  const ids = rows.flatMap(row => readAutoRenewal(row.value, installation) ? [row.key.slice(AUTO_RENEWAL_PREFIX.length)] : []).filter(id => !recovering.has(id));
  if (!ids.length) return;
  const candidates = await db.resellerUser.findMany({ where: { id: { in: ids }, reseller: { active: true } }, select: { id: true, resellerId: true, email: true, subId: true, trafficGB: true } });
  if (!candidates.length) return;
  const { ok, panels } = await getAllPanelInboundsFresh();
  if (!ok) return;
  const now = Date.now();
  const ready = candidates.filter(customer =>
    (customer.trafficGB > 0 && canonicalUserUsage(panels, customer.email).usedBytes >= customer.trafficGB * 1073741824)
    || panels.some(panel => panel.inbounds.some(inbound => inbound.clients.some(client =>
      client.email === customer.email && client.subId === customer.subId && (client.expiryTime || 0) > 0 && client.expiryTime! <= now,
    ))),
  );
  for (const customer of ready) {
    try { await renewUserByJournal(customer.resellerId, customer.email, { automatic: true }); }
    catch { /* The worker never substitutes an unverified native result. */ }
  }
}

export function initializeCustomerRenewal() {
  const state = globalThis as { __pvnetRenewalStarted?: boolean };
  if (state.__pvnetRenewalStarted) return;
  state.__pvnetRenewalStarted = true;
  let scanning = false;
  const scan = async () => {
    if (scanning) return;
    scanning = true;
    try { await recoverCustomerRenewals(); }
    catch { /* Re-read configuration when the dashboard database is ready. */ }
    finally { scanning = false; }
  };
  setTimeout(() => { void scan(); }, 5000).unref();
  setInterval(() => { void scan(); }, 60000).unref();
}
