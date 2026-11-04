import type { OperationJournal, ResellerUser } from '@prisma/client';
import { updateMetadata } from './queued-update';

export type CreationMetadata = { name: string; email?: string; uuid: string; subId: string; trafficGB: number; expiryTime: number; expiryDays?: number; ipLimit: number; refs: { panelId: string; inboundId: number }[]; localCommitted?: boolean; nativePending?: boolean; done?: boolean };
export function creationMetadata(value: string | null): CreationMetadata | null {
  const m = updateMetadata(value);
  if (typeof m.name !== 'string' || !m.name || typeof m.uuid !== 'string' || !m.uuid || typeof m.subId !== 'string' || !m.subId || !Number.isSafeInteger(m.trafficGB) || (m.trafficGB as number) < 0 || (m.trafficGB as number) > 8388607 || !Number.isSafeInteger(m.expiryTime) || !Number.isSafeInteger(m.ipLimit) || (m.ipLimit as number) < 0 || (m.ipLimit as number) > 10000 || !Array.isArray(m.refs) || !m.refs.length || m.refs.some(r => !r || typeof r.panelId !== 'string' || !r.panelId || !Number.isSafeInteger(r.inboundId) || r.inboundId <= 0)) return null;
  return m as CreationMetadata;
}
function refsKey(refs: CreationMetadata['refs']): string { return JSON.stringify([...new Set(refs.map(r => JSON.stringify([r.panelId, r.inboundId])))].sort()); }
export function isSavedQueuedCreation(user: Pick<ResellerUser, 'id' | 'email' | 'resellerId' | 'subId' | 'trafficGB' | 'inboundIds'>, journal: Pick<OperationJournal, 'type' | 'status' | 'userId' | 'resellerId' | 'email' | 'reservedGB' | 'metadata'>): boolean {
  const m = creationMetadata(journal.metadata);
  if (!m || journal.type !== 'CREATE' || !['PARTIAL', 'NEEDS_REPAIR'].includes(journal.status) || journal.userId !== user.id || journal.resellerId !== user.resellerId || journal.email !== user.email || journal.reservedGB !== 0 || m.localCommitted !== true || m.nativePending !== true || m.done === true || m.trafficGB !== user.trafficGB || m.subId !== user.subId || m.email && m.email !== user.email) return false;
  try { const refs = JSON.parse(user.inboundIds); return Array.isArray(refs) && refs.length > 0 && refs.every(r => r && typeof r.panelId === 'string' && Number.isSafeInteger(r.inboundId)) && refsKey(refs) === refsKey(m.refs); } catch { return false; }
}
