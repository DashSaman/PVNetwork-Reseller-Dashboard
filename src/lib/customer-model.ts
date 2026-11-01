/** Pure validation shared by dashboard creation and customer observations. */
export type ExpiryInput = { expiryMode?: string; expiryDays?: number; expiryDate?: string };
export function expiryFromInput(body: ExpiryInput, now = Date.now()): number {
  if (body.expiryMode !== undefined && !['from-now', 'first-use'].includes(body.expiryMode)) throw Error('نوع اعتبار نامعتبر است');
  if (body.expiryDays !== undefined && (!Number.isSafeInteger(body.expiryDays) || body.expiryDays < 0 || body.expiryDays > 36500)) throw Error('مدت اعتبار باید عدد صحیح تا ۳۶۵۰۰ روز باشد');
  if (body.expiryMode === 'first-use') {
    if (!body.expiryDays || body.expiryDate) throw Error('اعتبار از اولین اتصال به تعداد روز مثبت و بدون تاریخ ثابت نیاز دارد');
    return -body.expiryDays * 86400000;
  }
  const value = body.expiryDate ? new Date(body.expiryDate + 'T23:59:59').getTime() : body.expiryDays ? now + body.expiryDays * 86400000 : 0;
  if (!Number.isSafeInteger(value)) throw Error('تاریخ انقضا نامعتبر است');
  return value;
}

export function normalizedLabels(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 10) throw Error('حداکثر ۱۰ برچسب مجاز است');
  if (input.some(v => typeof v !== 'string' || v.trim().length > 40 || /[\u0000-\u001f\u007f]/.test(v))) throw Error('هر برچسب باید متن کوتاه تا ۴۰ حرف باشد');
  return [...new Set(input.map(v => (v as string).trim()).filter(Boolean))];
}

export function onlineTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const ms = value > 0 && value < 1e12 ? value * 1000 : value;
  return Number.isSafeInteger(ms) && ms <= Date.now() + 300000 ? ms : null;
}

export type UsageHistory = { startedAt: number; observedAt: number; lifetimeGB: number; gaps: number; days: { day: string; usedGB: number }[] };
export function nextUsageObservation(previous: UsageHistory | null, lifetimeGB: number, now = Date.now()): UsageHistory {
  if (!Number.isFinite(lifetimeGB) || lifetimeGB < 0 || !Number.isSafeInteger(now)) throw Error('Invalid observation');
  if (!previous) return { startedAt: now, observedAt: now, lifetimeGB, gaps: 0, days: [] };
  if (now <= previous.observedAt) return previous;
  const delta = lifetimeGB - previous.lifetimeGB;
  const cutoff = new Date(now - 89 * 86400000).toISOString().slice(0, 10);
  const days = previous.days.filter(d => d.day >= cutoff).map(d => ({ ...d }));
  if (delta >= 0) {
    const day = new Date(now).toISOString().slice(0, 10);
    const row = days.find(d => d.day === day);
    if (row) row.usedGB += delta;
    else days.push({ day, usedGB: delta });
  }
  // External/native counter resets lack a debit checkpoint: do not invent usage.
  return { ...previous, observedAt: now, lifetimeGB, days, gaps: previous.gaps + (delta < 0 ? 1 : 0) };
}
