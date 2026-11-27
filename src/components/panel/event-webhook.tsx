"use client";

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, faDate } from './shared';

type Config = { enabled: boolean; url?: string; secret?: string; deliveries?: {
  id: string; event: string; at: string; status: 'pending' | 'sent' | 'failed'; attempts: number; nextAttempt: number | null;
}[] };
const states = { pending: 'در انتظار ارسال', sent: 'تحویل شد', failed: 'ارسال ناموفق' };
const endpoint = '/api/admin/event-webhook';

export function EventWebhook() {
  const [config, setConfig] = useState<Config | null>(null);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const result = await api<Config>(endpoint);
    if (result.ok && result.data) { setConfig(result.data); setUrl(result.data.url || ''); }
    else setNotice(result.error || 'تنظیمات دریافت نشد');
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(enabled: boolean, rotate = false) {
    if (config?.enabled && (!enabled || rotate || config.url !== url.trim()) && !window.confirm('ارسال‌های معطل مقصد فعلی بایگانی شوند؟')) return;
    setBusy(true);
    const result = await api<Config>(endpoint, { method: 'PUT', body: JSON.stringify({ enabled, url, rotate }) });
    if (result.ok && result.data) {
      if (result.data.secret) setSecret(result.data.secret);
      else if (!enabled) setSecret('');
      await load();
    }
    setNotice(result.ok ? 'تنظیم وب‌هوک ذخیره شد' : result.error || 'تنظیم ذخیره نشد');
    setBusy(false);
  }

  return <section className="space-y-3 rounded-lg border bg-card p-4">
    <h2 className="font-bold">وب‌هوک رویدادهای اشتراک</h2>
    <p className="text-sm text-muted-foreground">نتیجهٔ قطعی تمدید، حذف و برگشت حجم به مقصد HTTPS می‌رسد. رویداد فقط شناسه‌ها و مقادیر حسابداری را دارد.</p>
    <form className="space-y-2" onSubmit={e => { e.preventDefault(); void save(true); }}>
      <label className="block text-sm">نشانی دریافت رویداد<Input type="url" className="mt-1" dir="ltr" required maxLength={1024} value={url} onChange={e => setUrl(e.target.value)} disabled={!config || busy} /></label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!config || busy}>{config?.enabled ? 'ذخیرهٔ نشانی' : 'فعال‌کردن وب‌هوک'}</Button>
        {config?.enabled && <><Button type="button" variant="outline" disabled={busy} onClick={() => void save(true, true)}>تعویض کلید</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void save(false)}>خاموش‌کردن</Button></>}
      </div>
    </form>
    {secret && <div className="rounded border p-2 space-y-2"><p className="text-xs">کلید امضا را برای تنظیم مقصد کپی کنید. این کلید فقط هنگام صدور نمایش داده می‌شود.</p><code className="block break-all text-xs" dir="ltr">{secret}</code></div>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {config?.enabled && <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-sm">آخرین ارسال‌ها</h3><Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>بازخوانی</Button></div>
      {!config.deliveries?.length && <p className="text-sm text-muted-foreground">رویدادی ثبت نشده است.</p>}
      {config.deliveries?.map(row => <p key={row.id} className="text-xs"><bdi>{row.event}</bdi> · {states[row.status]} · {faDate(row.at)}{row.nextAttempt && ' · تلاش از ' + faDate(row.nextAttempt)}</p>)}
    </div>}
  </section>;
}
