import { isTrafficQuotaGB } from './traffic-quota';

export type RenewalPlan = { trafficGB: number; days: number };
export type AutoRenewal = RenewalPlan & { installation: string };

export const AUTO_RENEWAL_PREFIX = 'customerAutoRenewal:';
export const renewalSettingKey = (userId: string) => AUTO_RENEWAL_PREFIX + userId;

export function parseRenewalPlan(value: unknown): RenewalPlan | null {
  if (!value || typeof value !== 'object') return null;
  const { trafficGB, days } = value as Partial<RenewalPlan>;
  if (!isTrafficQuotaGB(trafficGB) || trafficGB <= 0 || typeof days !== 'number' || !Number.isSafeInteger(days) || days < 1 || days > 3650) return null;
  return { trafficGB, days };
}

export function readAutoRenewal(value: string | null | undefined, installation: string | null | undefined): AutoRenewal | null {
  if (!value || !installation) return null;
  try {
    const parsed = JSON.parse(value);
    const plan = parseRenewalPlan(parsed);
    return plan && parsed.installation === installation ? { ...plan, installation } : null;
  } catch { return null; }
}

export type RenewalJournal = RenewalPlan & { previousGB: number; expiryTime: number; automatic: boolean };
export function readRenewalJournal(value: unknown): RenewalJournal | null {
  const plan = parseRenewalPlan(value);
  if (!plan) return null;
  const { previousGB, expiryTime, automatic } = value as Partial<RenewalJournal>;
  return isTrafficQuotaGB(previousGB) && typeof expiryTime === 'number' && Number.isSafeInteger(expiryTime) && expiryTime >= 0
    && typeof automatic === 'boolean' ? { ...plan, previousGB, expiryTime, automatic } : null;
}
