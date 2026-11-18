const WEEK_MS = 7 * 86400000;

export type DeletionRefundPolicy = {
  version: 1;
  requestedAt: number;
  expiries: (number | null)[];
  eligible: boolean;
  reason: 'eligible' | 'final-week' | 'expired' | 'unknown-expiry';
};

/** Freeze eligibility when deletion is accepted, before any native write. A
 * delayed reply must neither give an expired account a refund nor penalize an
 * early request that took time to finish. Zero is an explicitly unlimited date;
 * a negative native date is the unactivated first-use duration. No rounding. */
export function deletionRefundPolicy(expiries: (number | null)[], requestedAt: number): DeletionRefundPolicy {
  let reason: DeletionRefundPolicy['reason'] = 'eligible';
  if (!expiries.length || expiries.some(e => e === null || !Number.isSafeInteger(e))) reason = 'unknown-expiry';
  else if (expiries.some(e => e! > 0 && e! <= requestedAt)) reason = 'expired';
  else if (expiries.some(e => e !== 0 && (e! < 0 ? -e! : e! - requestedAt) <= WEEK_MS)) reason = 'final-week';
  return { version: 1, requestedAt, expiries, eligible: reason === 'eligible', reason };
}

export type DeletionSettlement = {
  version: 1;
  allocatedGB: number;
  usedGB: number;
  refundedGB: number;
  forfeitedGB: number;
  reason: DeletionRefundPolicy['reason'];
};

export function deletionSettlement(policy: DeletionRefundPolicy, allocatedGB: number, usedGB: number): DeletionSettlement {
  if (![allocatedGB, usedGB].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Invalid deletion accounting');
  const unused = Math.max(0, allocatedGB - usedGB);
  return { version: 1, allocatedGB, usedGB, refundedGB: policy.eligible ? unused : 0, forfeitedGB: policy.eligible ? 0 : unused, reason: policy.reason };
}

/** Missing entries belong to the old policy. A malformed new financial entry
 * cannot silently disappear from the available balance. */
export function readDeletionSettlement(metadata: string | null): DeletionSettlement | null {
  const value = JSON.parse(metadata || '{}').deletionSettlement;
  if (value === undefined) return null;
  if (!value || value.version !== 1 || !['eligible', 'final-week', 'expired', 'unknown-expiry'].includes(value.reason)
    || !['allocatedGB', 'usedGB', 'refundedGB', 'forfeitedGB'].every(k => typeof value[k] === 'number' && Number.isFinite(value[k]) && value[k] >= 0)
    || Math.abs(value.refundedGB + value.forfeitedGB - Math.max(0, value.allocatedGB - value.usedGB)) > 1e-9
    || value.reason === 'eligible' && value.forfeitedGB !== 0 || value.reason !== 'eligible' && value.refundedGB !== 0) throw new Error('Invalid saved deletion settlement');
  return value;
}
