'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { History, Tags, Bell } from 'lucide-react';
import { api, faDate, faNum, Spinner } from './shared';
import { toast } from '@/hooks/use-toast';
import type { UsageHistory } from '@/lib/customer-model';

type Metadata = { email: string; labels: string[]; lastOnline: number | null };
type Customer = { email: string; name?: string | null; usedGB?: number | null };
type Batch = { emails: string[]; enable: boolean; requestId: string };
type ItemResult = { email: string; ok: boolean; error?: string };
export function useCustomerMetadata(scope: 'admin' | 'reseller', users: Customer[]) {
  const [data, setData] = useState<Map<string, Metadata>>(new Map());
  const [error, setError] = useState('');
  const signature = users.map(u => u.email).sort().join('|');
  const reload = useCallback(async () => {
    const r = await api<{ users: Metadata[] }>(scope === 'admin' ? '/api/admin/customer-observations' : '/api/reseller/customer-tools?live=1', { signal: AbortSignal.timeout(20000) });
    if (r.ok && r.data) { setData(new Map(r.data.users.map(u => [u.email, u]))); setError(''); }
    else setError('اطلاعات گروه‌ها و آخرین اتصال فعلاً دریافت نشد.');
  }, [scope]);
  useEffect(() => { let alive = true; const run = () => { if (alive && document.visibilityState === 'visible') void reload(); };run();const t = setInterval(run, 60000);return () => { alive = false;clearInterval(t); }; }, [reload, signature]);
  return { data, reload, error };
}

export function CustomerRowTools({ user, meta, checked, onCheck, adminId, online }: { user: Customer; meta?: Metadata; checked?: boolean; onCheck?: () => void; adminId?: string; online?: boolean }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  return <div className="space-y-1.5 min-w-36 max-w-56">
    <div className="flex items-center gap-2">
      {onCheck && <input type="checkbox" aria-label={`انتخاب ${user.email}`} checked={checked || false} onChange={onCheck} className="h-4 w-4 accent-teal-500" />}
      <span className="text-[11px] text-muted-foreground">{online ? 'اکنون آنلاین' : meta?.lastOnline == null ? 'آخرین اتصال: نامشخص' : meta.lastOnline === 0 ? 'اتصالی ثبت نشده' : `آخرین اتصال: ${faDate(meta.lastOnline)}`}</span>
    </div>
    <div className="flex flex-wrap gap-1">{meta?.labels.map(label => <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-600 dark:text-violet-300" key={label}>{label}</Badge>)}</div>
    <Button size="sm" variant="ghost" className="h-6 px-1 text-[11px]" onClick={() => setHistoryOpen(true)} aria-label={`سابقه ${user.email}`}><History className="h-3 w-3" />مصرف و سابقه</Button>
    {historyOpen && <CustomerHistoryDialog email={user.email} adminId={adminId} onClose={() => setHistoryOpen(false)} />}
  </div>;
}

export function CustomerHistoryDialog({ email, adminId, onClose }: { email: string; adminId?: string; onClose: () => void }) {
  const [data, setData] = useState<{ history: UsageHistory | null; operations: { type: string; status: string; createdAt: string }[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let alive = true;void api<typeof data>(adminId ? `/api/admin/customer-observations?id=${encodeURIComponent(adminId)}` : `/api/reseller/customer-tools/history?email=${encodeURIComponent(email)}`).then(r => { if (!alive) return;if (r.ok) setData(r.data || null);else setError(r.error || 'اطلاعات دریافت نشد'); });return () => { alive = false; }; }, [email, adminId]);
  const types: Record<string, string> = { CREATE: 'ساخت', UPDATE: 'ویرایش', RESET: 'بازنشانی مصرف', DELETE: 'حذف' };
  const states: Record<string, string> = { SUCCESS: 'موفق', PARTIAL: 'ناقص', RUNNING: 'در جریان', NEEDS_REPAIR: 'نیازمند بررسی', FAILED: 'ناموفق', PENDING: 'در انتظار' };
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>مصرف و سابقهٔ کاربر</DialogTitle><DialogDescription dir="ltr">{email}</DialogDescription></DialogHeader>
    {error ? <p role="alert">{error}</p> : !data ? <Spinner /> : <>
      <p className="text-xs text-muted-foreground">{data.history ? `آغاز ثبت: ${faDate(data.history.startedAt)} · آخرین بررسی: ${faDate(data.history.observedAt)}` : 'ثبت مصرف از اولین بررسی خودکار آغاز می‌شود؛ اطلاعات روزهای گذشته ساخته نمی‌شود.'}</p>
      {!!data.history?.gaps && <p className="text-xs text-amber-500">بخشی از سابقه به علت تغییر شمارندهٔ خارج از پنل کامل نیست.</p>}
      {data.history?.days.length ? <><div className="h-56 w-full" dir="ltr"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.history.days.slice(-30)}><XAxis dataKey="day" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip formatter={v => [`${Number(v).toFixed(3)} GB`, 'مصرف ثبت‌شده']} /><Bar dataKey="usedGB" fill="#8b5cf6" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div><p className="text-[11px] text-muted-foreground">مصرف بین دو بررسی، در روز پایان بازه ثبت می‌شود؛ زمان‌های بدون بررسی پوشش کامل ندارند. نگه‌داری ۹۰ روز.</p></> : <p className="rounded-xl border p-4 text-sm">هنوز بازهٔ مصرف ثبت نشده است.</p>}
      <div className="space-y-2"><h3 className="font-bold text-sm">آخرین عملیات</h3>{data.operations.length ? data.operations.map((op, i) => <div key={i} className="flex justify-between gap-2 border-b py-2 text-xs"><span>{types[op.type] || 'عملیات کاربر'} · {states[op.status] || op.status}</span><span>{faDate(op.createdAt)}</span></div>) : <p className="text-xs text-muted-foreground">عملیاتی ثبت نشده است.</p>}</div>
    </>}
  </DialogContent></Dialog>;
}

export function CustomerToolsBar({ users, visible, metadata, selected, setSelected, labelFilter, setLabelFilter, activityFilter, setActivityFilter, reload }: {
  users: Customer[]; visible: Customer[]; metadata: Map<string, Metadata>; selected: Set<string>; setSelected: (value: Set<string>) => void;
  labelFilter: string; setLabelFilter: (value: string) => void; activityFilter: string; setActivityFilter: (value: string) => void; reload: () => void;
}) {
  const [action, setAction] = useState<'labels' | 'status' | 'alerts' | null>(null);
  const [labels, setLabels] = useState('');const [busy, setBusy] = useState(false);
  const [enable, setEnable] = useState(true);const [results, setResults] = useState<ItemResult[] | null>(null);
  const attempt = useRef<Batch | null>(null);const [pending, setPending] = useState<Batch | null>(null);
  const [usagePercent, setUsagePercent] = useState('80');const [expiryDays, setExpiryDays] = useState('3');
  const chosen = users.filter(u => selected.has(u.email));
  const allLabels = [...new Set([...metadata.values()].flatMap(m => m.labels))].sort();
  useEffect(() => { void api<{ batch: Batch | null }>('/api/reseller/customer-tools/status').then(r => { if (r.ok && r.data?.batch) { setPending(r.data.batch);attempt.current = r.data.batch; } }); }, []);
  async function save() {
    setBusy(true);
    try {
      if (action === 'labels') {
        const r = await api('/api/reseller/customer-tools', { method: 'PATCH', body: JSON.stringify({ emails: chosen.map(u => u.email), labels: labels.split(/[,،\n]/).map(v => v.trim()).filter(Boolean) }) });
        if (!r.ok) throw Error(r.error);setAction(null);reload();
      } else if (action === 'alerts') {
        const r = await api('/api/reseller/customer-tools/alerts', { method: 'PUT', body: JSON.stringify({ usagePercent: Number(usagePercent), expiryDays: Number(expiryDays) }) });
        if (!r.ok) throw Error(r.error);setAction(null);toast({ title: 'آستانه‌های هشدار ذخیره شد' });
      } else {
        const batch = attempt.current || { emails: chosen.map(u => u.email), enable, requestId: crypto.randomUUID() };attempt.current = batch;
        const r = await api<{ results: ItemResult[]; complete: boolean }>('/api/reseller/customer-tools/status', { method: 'POST', body: JSON.stringify(batch) });
        if (!r.ok || !r.data) throw Error(r.error);setResults(r.data.results);setPending(r.data.complete ? null : batch);reload();
        if (r.data.complete) { attempt.current = null;setSelected(new Set()); }
      }
    } catch (e) { if (action === 'status' && attempt.current) setPending(attempt.current);toast({ title: 'عملیات انجام نشد', description: (e as Error).message, variant: 'destructive' }); }
    finally { setBusy(false); }
  }
  async function closeUnattempted() {
    if (!pending) return;setBusy(true);
    const r = await api('/api/reseller/customer-tools/status', { method: 'DELETE', body: JSON.stringify({ requestId: pending.requestId }) });
    setBusy(false);
    if (r.ok) { setPending(null);attempt.current = null;setResults(null);setAction(null); }
    else toast({ title: 'بستن عملیات مجاز نیست', description: r.error, variant: 'destructive' });
  }
  return <div className="rounded-xl border bg-card/60 p-3 space-y-3">
    <div className="flex flex-wrap gap-2 items-center">
      <select aria-label="فیلتر گروه کاربران" className="h-9 rounded-lg border bg-background px-2 text-xs max-w-44" value={labelFilter} onChange={e => setLabelFilter(e.target.value)}><option value="">همهٔ گروه‌ها</option><option value="__none">بدون برچسب</option>{allLabels.map(v => <option key={v} value={v}>{v}</option>)}</select>
      <select aria-label="فیلتر آخرین اتصال" className="h-9 rounded-lg border bg-background px-2 text-xs" value={activityFilter} onChange={e => setActivityFilter(e.target.value)}><option value="">همهٔ اتصال‌ها</option><option value="never">بدون اتصال ثبت‌شده</option><option value="7">بدون اتصال در ۷ روز</option><option value="30">بدون اتصال در ۳۰ روز</option></select>
      <Button size="sm" variant="outline" disabled={!visible.length || !!pending} onClick={() => setSelected(new Set(visible.slice(0, 50).map(u => u.email)))}>انتخاب نتایج (تا ۵۰)</Button>
      <span className="text-xs text-muted-foreground">{faNum(chosen.length)} انتخاب‌شده</span>
      {!!chosen.length && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>پاک‌کردن انتخاب</Button>}
      <Button size="sm" variant="outline" disabled={!chosen.length || chosen.length > 50 || !!pending} onClick={() => { setLabels(chosen.length === 1 ? (metadata.get(chosen[0].email)?.labels || []).join('، ') : '');setAction('labels'); }}><Tags className="h-3 w-3" />برچسب‌ها</Button>
      <Button size="sm" variant="outline" disabled={!pending && (!chosen.length || chosen.length > 50)} onClick={() => { setResults(null);if (pending) { attempt.current = pending;setEnable(pending.enable); } else attempt.current = null;setAction('status'); }}>{pending ? 'ادامهٔ تغییر وضعیت ناقص' : 'فعال / غیرفعال گروهی'}</Button>
      <Button size="sm" variant="ghost" onClick={() => { void api<{ usagePercent: number; expiryDays: number }>('/api/reseller/customer-tools/alerts').then(r => { if (r.ok && r.data) { setUsagePercent(String(r.data.usagePercent));setExpiryDays(String(r.data.expiryDays)); } });setAction('alerts'); }}><Bell className="h-3 w-3" />آستانهٔ هشدار</Button>
    </div>
    <Dialog open={action !== null} onOpenChange={o => !o && !busy && setAction(null)}><DialogContent><DialogHeader><DialogTitle>{action === 'labels' ? 'برچسب کاربران انتخابی' : action === 'alerts' ? 'هشدار مصرف و انقضا' : 'تغییر گروهی وضعیت'}</DialogTitle><DialogDescription>{action === 'alerts' ? 'ارسال با بات فعال در تنظیمات حساب؛ بررسی مستقل هر ۳۰ دقیقه و فاصلهٔ تکرار ۱۲ ساعت.' : `${faNum(pending && action === 'status' ? pending.emails.length : chosen.length)} کاربر از همین نماینده`}</DialogDescription></DialogHeader>
      {action === 'labels' ? <div className="space-y-2"><Input aria-label="برچسب‌های کاربران" placeholder="فروشگاه، پکیج A" value={labels} onChange={e => setLabels(e.target.value)} /><p className="text-xs text-muted-foreground">برچسب‌های قبلی با این فهرست جایگزین می‌شوند. خالی = حذف برچسب‌ها؛ حداکثر ۱۰ برچسب، هر کدام ۴۰ حرف.</p></div> : action === 'alerts' ? <div className="space-y-3"><label className="block text-sm">درصد مصرف<Input aria-label="درصد هشدار مصرف" type="number" min={1} max={100} value={usagePercent} onChange={e => setUsagePercent(e.target.value)} /></label><label className="block text-sm">روز مانده تا انقضا<Input aria-label="روز هشدار انقضا" type="number" min={0} max={30} value={expiryDays} onChange={e => setExpiryDays(e.target.value)} /></label></div> : <div className="space-y-3">
        <select disabled={busy || !!pending || !!results} aria-label="وضعیت گروهی جدید" className="h-10 w-full rounded-lg border bg-background px-3" value={enable ? 'on' : 'off'} onChange={e => { setEnable(e.target.value === 'on');attempt.current = null; }}><option value="on">فعال‌کردن</option><option value="off">غیرفعال‌کردن</option></select>
        <p className="text-xs text-muted-foreground">حجم، مصرف، انقضا و مشخصات اتصال حفظ می‌شوند؛ حساب منقضی یا بدون حجم با این دکمه تمدید نمی‌شود.</p>
        <div className="max-h-48 overflow-y-auto text-xs space-y-1">{(results || (pending?.emails || chosen.map(u => u.email)).map(email => ({ email, ok: true }))).map(r => <div key={r.email} className="flex justify-between gap-2 rounded border p-2"><span dir="ltr">{r.email}</span><span className={r.ok ? 'text-teal-500' : 'text-rose-500'}>{results ? r.ok ? 'موفق' : r.error : 'انتخاب‌شده'}</span></div>)}</div>
      </div>}
      <DialogFooter className="flex-wrap gap-2">{action === 'status' && pending && <Button variant="outline" disabled={busy} onClick={() => void closeUnattempted()}>بستن موارد اجرا‌نشده</Button>}<Button variant="outline" disabled={busy} onClick={() => setAction(null)}>بستن</Button>{!(action === 'status' && results?.every(r => r.ok)) && <Button disabled={busy} onClick={() => void save()}>{busy ? 'در حال انجام…' : action === 'status' ? results ? 'ادامهٔ موارد ناموفق' : 'تأیید تغییر وضعیت' : 'ذخیره'}</Button>}</DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
