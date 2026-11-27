import { randomUUID } from 'node:crypto';
import { db } from './db';
import { validateInboundSelection, type InboundRef, type ResellerWithInbounds } from './reseller-helpers';
import type { SavedResellerPlan } from './reseller-plan-model';

const storagePrefix = (owner: string) => 'resellerPlan:' + owner + ':';
export const planKey = (owner: string, id: string) => storagePrefix(owner) + id;
export const newPlanId = () => randomUUID();

export function parseResellerPlan(value: unknown): Omit<SavedResellerPlan, 'id'> | null {
  if (!value || typeof value !== 'object') return null;
  const { name, trafficGB, days, expiryMode, ipLimit, refs } = value as Omit<SavedResellerPlan, 'id'>;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60 || /[\x00-\x1f\x7f]/.test(name)
    || !Number.isSafeInteger(trafficGB) || trafficGB < 1 || trafficGB > 1048576
    || !Number.isSafeInteger(days) || days < 1 || days > 36500
    || (expiryMode !== 'first-use' && expiryMode !== 'from-now')
    || !Number.isSafeInteger(ipLimit) || ipLimit < 0 || ipLimit > 10000
    || !Array.isArray(refs) || refs.length < 1 || refs.length > 100) return null;
  const locations = refs.map((ref: InboundRef) => ref && typeof ref.panelId === 'string' && /^[a-z0-9_-]{1,128}$/i.test(ref.panelId)
    && Number.isSafeInteger(ref.inboundId) && ref.inboundId > 0 ? { panelId: ref.panelId, inboundId: ref.inboundId } : null);
  if (locations.some(ref => !ref) || new Set(locations.map(ref => JSON.stringify(ref))).size !== locations.length) return null;
  return { name: name.trim(), trafficGB, days, expiryMode, ipLimit, refs: locations as InboundRef[] };
}

function fromStorage(id: string, value: string): SavedResellerPlan | null {
  try {
    const plan = parseResellerPlan(JSON.parse(value));
    return plan && { ...plan, id };
  } catch { return null; }
}

export async function readResellerPlan(owner: string, id: unknown) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return null;
  const record = await db.setting.findUnique({ where: { key: planKey(owner, id) } });
  return record && fromStorage(id, record.value);
}

export async function listResellerPlans(owner: string) {
  const prefix = storagePrefix(owner);
  const rows = await db.setting.findMany({ where: { key: { startsWith: prefix } }, orderBy: { updatedAt: 'desc' }, take: 50 });
  return rows.flatMap(row => {
    const plan = fromStorage(row.key.slice(prefix.length), row.value);
    return plan ? [plan] : [];
  });
}

export async function checkResellerPlan(owner: ResellerWithInbounds, plan: Omit<SavedResellerPlan, 'id'>) {
  if (!owner.allowIpLimit && plan.ipLimit > 0) return 'مجوز محدودیت دستگاه برای این بسته وجود ندارد';
  const result = await validateInboundSelection(owner, plan.refs);
  return result.ok ? null : 'یک یا چند لوکیشن بسته دیگر برای این نماینده مجاز نیست';
}
