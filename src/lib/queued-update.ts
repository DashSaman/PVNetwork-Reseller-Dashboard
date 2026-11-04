import type { OperationJournal, ResellerUser } from '@prisma/client';

export function updateMetadata(value: string | null): Record<string, unknown> {
  try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

/** A saved, fully funded edit is distinct from an incomplete native write. */
export function isSavedQueuedUpdate(user: Pick<ResellerUser, 'id' | 'email' | 'resellerId' | 'trafficGB'>, journal: Pick<OperationJournal, 'type' | 'status' | 'userId' | 'email' | 'resellerId' | 'reservedGB' | 'metadata'>): boolean {
  const meta = updateMetadata(journal.metadata);
  return journal.type === 'UPDATE' && journal.status === 'PARTIAL' && journal.userId === user.id && journal.email === user.email && journal.resellerId === user.resellerId && journal.reservedGB === 0 && !meta.kind && !meta.bulkJobId && meta.localCommitted === true && meta.nativePending === true && Number.isSafeInteger(meta.newTrafficGB) && (meta.newTrafficGB as number) >= 0 && (meta.newTrafficGB as number) <= 8388607 && meta.newTrafficGB === user.trafficGB;
}

/** Unknown, disabled, dirty or unreachable nodes never prove propagation. */
export function nodesSynchronized(value: unknown): boolean {
  if (!Array.isArray(value) || !value.length) return false;
  return value.every(node => node && typeof node === 'object' && Number.isSafeInteger(node.id) && node.id > 0 && node.enable === true && node.status === 'online' && node.configDirty === false && (node.children === undefined || Array.isArray(node.children) && (!node.children.length || nodesSynchronized(node.children))));
}
