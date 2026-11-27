import { isTrafficQuotaGB } from './traffic-quota';

export type RenewalPlan = { trafficGB: number; days: number };
export type AutoRenewalLimits = { maxRenewals?: number; stopAt?: number };
export type AutoRenewal = RenewalPlan & AutoRenewalLimits & { installation: string; cycleId?: string };
export type AutoRenewalStop = 'count' | 'date' | 'balance' | 'disabled';

export const AUTO_RENEWAL_PREFIX = 'customerAutoRenewal:';
export const renewalSettingKey = (userId: string) => AUTO_RENEWAL_PREFIX + userId;

export function parseRenewalPlan(value: unknown): RenewalPlan | null {
  if (!value || typeof value !== 'object') return null;
  const { trafficGB, days } = value as Partial<RenewalPlan>;
  if (!isTrafficQuotaGB(trafficGB) || trafficGB <= 0 || typeof days !== 'number' || !Number.isSafeInteger(days) || days < 1 || days > 3650) return null;
  return { trafficGB, days };
}

export function parseAutoRenewalLimits(value: unknown): AutoRenewalLimits | null {
  if (!value || typeof value !== 'object') return null;
  const { maxRenewals, stopAt } = value as AutoRenewalLimits;
  if (maxRenewals !== undefined && (!Number.isSafeInteger(maxRenewals) || maxRenewals < 1 || maxRenewals > 10000)) return null;
  if (stopAt !== undefined && (!Number.isSafeInteger(stopAt) || stopAt <= 0 || stopAt > 253402300799999)) return null;
  return { maxRenewals, stopAt };
}

export function renewalCap(plan: AutoRenewalLimits, completed: number, now = Date.now()): AutoRenewalStop | null {
  if (plan.stopAt !== undefined && now >= plan.stopAt) return 'date';
  if (plan.maxRenewals !== undefined && completed >= plan.maxRenewals) return 'count';
  return null;
}

export function readAutoRenewal(value: string | null | undefined, installation: string | null | undefined): AutoRenewal | null {
  if (!value || !installation) return null;
  try {
    const parsed = JSON.parse(value);
    const plan = parseRenewalPlan(parsed);
    const limits = parseAutoRenewalLimits(parsed);
    const cycleId = typeof parsed.cycleId === 'string' && /^[a-f0-9-]{36}$/.test(parsed.cycleId) ? parsed.cycleId : undefined;
    return plan && limits && parsed.installation === installation ? { ...plan, ...limits, cycleId, installation } : null;
  } catch { return null; }
}

export type RenewalJournal = RenewalPlan & { previousGB: number; expiryTime: number; automatic: boolean; cycleId?: string };
export function readRenewalJournal(value: unknown): RenewalJournal | null {
  const plan = parseRenewalPlan(value);
  if (!plan) return null;
  const { previousGB, expiryTime, automatic, cycleId } = value as Partial<RenewalJournal>;
  return isTrafficQuotaGB(previousGB) && typeof expiryTime === 'number' && Number.isSafeInteger(expiryTime) && expiryTime >= 0
    && typeof automatic === 'boolean' ? { ...plan, previousGB, expiryTime, automatic, cycleId: typeof cycleId === 'string' ? cycleId : undefined } : null;
}
