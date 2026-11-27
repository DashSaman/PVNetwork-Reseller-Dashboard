"use client";

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { api, NumberInput, parseNumberInput } from './shared';
import type { RenewalPlan, AutoRenewalLimits, AutoRenewalStop } from '@/lib/renewal-plan';

export function RenewalDialog({ email, quota, onClose, onRenewed }: { email: string; quota: number; onClose: () => void; onRenewed: () => void }) {
  const endpoint = `/api/reseller/users/${encodeURIComponent(email)}/renew`;
  const [traffic, setTraffic] = useState(String(quota || 10));
  const [days, setDays] = useState("30");
  const [enabled, setEnabled] = useState(false);
  const [maxRenewals, setMaxRenewals] = useState('');
  const [stopDate, setStopDate] = useState('');
  const [progress, setProgress] = useState<{ completed?: number; stopped?: AutoRenewalStop | null }>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submission = useRef<{ values: string; requestId: string } | null>(null);

  useEffect(() => {
    void api<{ plan: (RenewalPlan & AutoRenewalLimits) | null; completed?: number; stopped?: AutoRenewalStop | null }>(endpoint).then(response => {
      if (!response.ok || !response.data) {
        setError(response.error || 'تنظیمات تمدید قابل دریافت نیست');
        return;
      }
      const { plan } = response.data;
      setEnabled(!!plan);
      if (plan) {
        setTraffic(String(plan.trafficGB));
        setDays(String(plan.days));
        setMaxRenewals(plan.maxRenewals?.toString() || '');
        if (plan.stopAt) {
          const date = new Date(plan.stopAt - 1);
          setStopDate([date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'));
        }
        setProgress({ completed: response.data.completed, stopped: response.data.stopped });
      }
      setLoaded(true);
    });
  }, [endpoint]);

  async function submit(manual: boolean) {
    if (busy || !loaded) return;
    const plan = { trafficGB: parseNumberInput(traffic), days: parseNumberInput(days) };
    let stopAt: number | undefined;
    if (stopDate) {
      const date = new Date(stopDate + 'T00:00:00');
      date.setDate(date.getDate() + 1);
      stopAt = date.getTime();
    }
    const max = maxRenewals.trim() ? parseNumberInput(maxRenewals) : undefined;
    if (!manual && enabled && ((max !== undefined && (!Number.isSafeInteger(max) || max < 1 || max > 10000)) || (stopAt !== undefined && !Number.isSafeInteger(stopAt)))) {
      setError('سقف تعداد یا تاریخ پایان معتبر نیست');
      return;
    }
    const values = JSON.stringify(plan);
    if (manual && submission.current?.values !== values) submission.current = { values, requestId: crypto.randomUUID() };
    setBusy(true);
    setError("");
    const result = await api<{ pending?: boolean; message?: string }>(endpoint, {
      method: manual ? "POST" : "PUT",
      body: JSON.stringify(manual ? { ...plan, requestId: submission.current?.requestId } : { ...plan, enabled, maxRenewals: max, stopAt }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'ثبت تمدید ناموفق بود');
      return;
    }
    if (manual) {
      toast({ title: result.data?.pending ? 'تمدید در انتظار تکمیل' : 'دورهٔ جدید شروع شد', description: result.data?.message });
      onRenewed();
    } else {
      toast({ title: enabled ? 'تمدید خودکار روشن شد' : 'تمدید خودکار خاموش شد' });
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>دورهٔ جدید و تمدید خودکار</DialogTitle>
          <DialogDescription dir="ltr">{email}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">بعد از اتمام حجم یا انقضا، بستهٔ جدید از پول ترافیک نماینده تخصیص می‌یابد و مصرف دورهٔ قبلی در حسابداری ثبت می‌شود.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>حجم بستهٔ جدید (گیگابایت)</Label>
            <NumberInput aria-label="حجم بستهٔ جدید" value={traffic} onValueChange={setTraffic} />
          </div>
          <div className="space-y-2">
            <Label>مدت بستهٔ جدید (روز)</Label>
            <NumberInput aria-label="مدت بستهٔ جدید" value={days} onValueChange={setDays} />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border px-3 py-2">
          <Label htmlFor="customer-auto-renew">تمدید خودکار این کاربر</Label>
          <Switch id="customer-auto-renew" checked={enabled} onCheckedChange={setEnabled} disabled={!loaded || busy} />
        </div>
        {enabled && <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm">حداکثر تعداد تمدید<NumberInput aria-label="حداکثر تعداد تمدید" value={maxRenewals} onValueChange={setMaxRenewals} placeholder="بدون سقف" /></label>
          <label className="space-y-1 text-sm">آخرین روز مجاز<Input type="date" aria-label="آخرین روز مجاز تمدید" dir="ltr" value={stopDate} onChange={e => setStopDate(e.target.value)} /></label>
          <p className="col-span-2 text-xs text-muted-foreground">تمدید موفق این دوره {progress.completed ?? 0}
            {progress.stopped === 'date' ? ' · مهلت تمام شده' : progress.stopped === 'count' ? ' · سقف تمدید پر شده' : progress.stopped === 'balance' ? ' · موجودی کافی برای آخرین تلاش نبوده' : ''}
          </p>
        </div>}
        {error && <div role="alert" className="text-sm tone-danger">{error}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => void submit(false)} disabled={!loaded || busy}>ذخیرهٔ تنظیم تمدید خودکار</Button>
          <Button onClick={() => void submit(true)} disabled={!loaded || busy}>شروع دورهٔ جدید</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
