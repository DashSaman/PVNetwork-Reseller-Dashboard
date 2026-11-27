import type { Prisma, ResellerUser } from '@prisma/client';
import { db } from './db';
import { readRenewalJournal, type AutoRenewal } from './renewal-plan';
import { updateMetadata } from './queued-update';

export const manualUserStatusKey = (userId: string) => 'customerManualStatus:' + userId;

export async function saveManualUserStatus(tx: Pick<Prisma.TransactionClient, 'setting'>, userId: string, enable: boolean) {
  const key = manualUserStatusKey(userId), value = enable ? 'enabled' : 'disabled';
  await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function isRenewalPaused(user: Pick<ResellerUser, 'id' | 'resellerId' | 'email'>) {
  const row = await db.setting.findUnique({ where: { key: manualUserStatusKey(user.id) } });
  if (row?.value === 'disabled' || row?.value === 'enabled') return row.value === 'disabled';
  // Older bulk status changes recorded explicit user intent in their journal.
  const legacy = await db.operationJournal.findFirst({
    where: { userId: user.id, resellerId: user.resellerId, email: user.email, type: 'UPDATE', status: 'SUCCESS',
      idempotencyKey: { startsWith: 'customer-status:' } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], select: { metadata: true },
  });
  const metadata = updateMetadata(legacy?.metadata ?? null);
  return metadata.kind === 'CUSTOMER_STATUS' && metadata.enable === false;
}

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
