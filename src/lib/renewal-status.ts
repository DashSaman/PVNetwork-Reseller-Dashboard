import { db } from './db';
import { readRenewalJournal, type AutoRenewal } from './renewal-plan';
import { updateMetadata } from './queued-update';

export const renewalStatusKey = (userId: string) => 'customerAutoRenewStatus:' + userId;

export async function completedAutoRenewals(resellerId: string, userId: string, plan: AutoRenewal) {
  if (!plan.cycleId) return 0;
  const entries = await db.operationJournal.findMany({
    where: { resellerId, userId, type: 'RESET', status: 'SUCCESS', accountingCommitted: true, metadata: { contains: plan.cycleId } },
    select: { metadata: true },
  });
  return entries.filter(row => {
    const metadata = updateMetadata(row.metadata);
    const renewal = readRenewalJournal(metadata.renewal);
    return metadata.operationInstallation === plan.installation && renewal?.automatic && renewal.cycleId === plan.cycleId;
  }).length;
}
