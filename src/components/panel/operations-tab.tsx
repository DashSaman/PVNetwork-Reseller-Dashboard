"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api, faDate, gbLabel } from './shared';

type Row = {
  id: string; customer: string; owner?: string; kind: string; status: string; updatedAt: string;
  reservedGB: number; accounted: boolean; retry?: 'review' | 'automatic' | 'unknown' | null; targets: { number: number; label?: string; status: string }[];
};
type Feed = { operations: Row[]; next?: string };
const kinds: Record<string, string> = { CREATE: 'ساخت', UPDATE: 'ویرایش', DELETE: 'حذف', RESET: 'ریست مصرف', RENEW: 'تمدید' };
const statuses: Record<string, string> = {
  PENDING: 'در انتظار', RUNNING: 'در حال اجرا', PARTIAL: 'تکمیل جزئی', NEEDS_REPAIR: 'نیاز به بررسی', SUCCESS: 'انجام‌شده', FAILED: 'ناموفق',
};
const stages: Record<string, string> = { failed: 'پاسخ ناموفق', done: 'تکمیل‌شده', confirmed: 'یک مرحله تأیید شده', waiting: 'در انتظار تأیید' };

export function OperationsTab({ scope }: { scope: 'admin' | 'reseller' }) {
  const [pending, setPending] = useState(true);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async (before?: string) => {
    const id = ++sequence.current;
    setBusy(true);
    setError('');
    const query = new URLSearchParams({ pending: pending ? '1' : '0' });
    if (before) query.set('before', before);
    const result = await api<Feed>('/api/' + scope + '/operations?' + query);
    if (id !== sequence.current) return;
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.error || 'دریافت وضعیت عملیات ناموفق بود');
      return;
    }
    const next = result.data;
    setFeed(previous => before && previous ? { ...next, operations: [...previous.operations, ...next.operations] } : next);
  }, [pending, scope]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);

  return <section className="space-y-4" dir="rtl">
    <div className="flex flex-wrap justify-between gap-3">
      <h2 className="text-lg font-bold">پیگیری عملیات کاربران</h2>
      <div className="flex gap-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pending} onChange={e => { setFeed(null); setPending(e.target.checked); }} /> فقط عملیات باز</label>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>به‌روزرسانی</Button>
      </div>
    </div>
    {error && <p role="alert" className="tone-danger text-sm">{error}</p>}
    {!feed && busy && <p role="status">در حال دریافت وضعیت…</p>}
    {feed?.operations.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">عملیاتی در این فهرست وجود ندارد.</p>}
    {feed?.operations.map(row => <article key={row.id} className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <strong dir="ltr">{row.customer}</strong>
        {row.owner && <bdi className="text-muted-foreground text-xs">{row.owner}</bdi>}
        <Badge variant="outline">{kinds[row.kind] || row.kind}</Badge>
        <Badge variant={row.status === 'SUCCESS' ? 'default' : 'secondary'}>{statuses[row.status] || row.status}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">آخرین تغییر {faDate(row.updatedAt)} · {row.accounted ? 'حسابداری ثبت شده' : row.reservedGB > 0 ? 'حجم رزروشده ' + gbLabel(row.reservedGB) : 'رزرو حجم ثبت نشده'}</p>
      {row.retry && <p className="text-xs text-muted-foreground">{row.retry === 'review' ? 'این عملیات به بررسی نیاز دارد.' : row.retry === 'automatic' ? 'ادامهٔ خودکار در بررسی بعدی؛ ساعت دقیق ثبت نشده است.' : 'زمان تلاش بعدی ثبت نشده است.'}</p>}
      {row.targets.length > 0 && <ul className="flex flex-wrap gap-2 text-xs">
        {row.targets.map(target => <li key={target.number} className="rounded border px-2 py-1">{target.label || 'مقصد ' + target.number} · {stages[target.status]}</li>)}
      </ul>}
    </article>)}
    {feed?.next && <Button variant="outline" disabled={busy} onClick={() => void load(feed.next)}>نمایش بیشتر</Button>}
  </section>;
}
