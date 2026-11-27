"use client";

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { parseRenewalPlan, type ManualRenewalDraft, type PreviousRenewalPeriod } from '@/lib/renewal-plan';
import { isTrafficQuotaGB } from '@/lib/traffic-quota';
import { api, faNum, NumberInput, parseNumberInput } from './shared';

type SavedPackage = { draft: ManualRenewalDraft | null; inProgress: boolean };
type EditRenewalState = SavedPackage & { previousPeriod: PreviousRenewalPeriod | null };

export function EditRenewal({ email, onRenewed }: { email: string; onRenewed: () => void }) {
  const endpoint = `/api/reseller/users/${encodeURIComponent(email)}/renew/edit`;
  const [state, setState] = useState<EditRenewalState | null>(null);
  const [traffic, setTraffic] = useState('');
  const [days, setDays] = useState('30');
  const [previousQuota, setPreviousQuota] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    let current = true;
    void api<EditRenewalState>(endpoint).then(response => {
      if (!current) return;
      if (!response.ok || !response.data) {
        setError(response.error || 'بسته و سابقهٔ کاربر قابل دریافت نیست');
        return;
      }
      setState(response.data);
      setPreviousQuota(response.data.previousPeriod?.trafficGB.toString() ?? '');
      if (response.data.draft) {
        setTraffic(String(response.data.draft.trafficGB));
        setDays(String(response.data.draft.days));
      }
    });
    return () => { current = false; };
  }, [endpoint]);

  const plan = parseRenewalPlan({ trafficGB: parseNumberInput(traffic), days: parseNumberInput(days) });
  const draft = state?.draft;
  const matchesDraft = !!plan && plan.trafficGB === draft?.trafficGB && plan.days === draft.days;
  const previous = state?.previousPeriod;
  const correctedQuota = parseNumberInput(previousQuota);

  async function savePackage() {
    if (!state || !plan || busy || state.inProgress) return;
    setBusy(true);
    setError('');
    setStatus('');
    const response = await api<SavedPackage>(endpoint, { method: 'PUT', body: JSON.stringify(plan) });
    setBusy(false);
    if (!response.ok || !response.data?.draft) {
      setError(response.error || 'ثبت حجم و مدت بسته ناموفق بود');
      return;
    }
    setState({ ...state, ...response.data });
    setStatus('حجم و مدت بسته ذخیره شد. برای اعمال آن «شروع بستهٔ جدید» را بزنید.');
  }

  async function startPackage() {
    if (!draft || !matchesDraft || busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    const response = await api<{ pending?: boolean; message?: string }>(endpoint, {
      method: 'POST', body: JSON.stringify({ requestId: draft.requestId }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error || 'شروع بستهٔ جدید ناموفق بود');
      return;
    }
    toast({ title: response.data?.pending ? 'شروع بسته در انتظار تکمیل' : 'بستهٔ جدید شروع شد',
      description: response.data?.message });
    onRenewed();
  }

  async function savePreviousQuota() {
    if (!state || !previous || !previousQuota.trim() || !isTrafficQuotaGB(correctedQuota) || busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    const response = await api<{ previousPeriod: PreviousRenewalPeriod }>(endpoint, {
      method: 'PATCH', body: JSON.stringify({ periodId: previous.id, trafficGB: correctedQuota }),
    });
    setBusy(false);
    if (!response.ok || !response.data) {
      setError(response.error || 'ثبت سهمیهٔ دورهٔ قبلی ناموفق بود');
      return;
    }
    setState({ ...state, previousPeriod: response.data.previousPeriod });
    setStatus('سهمیهٔ نمایشی دورهٔ قبلی در سابقه ثبت شد.');
  }

  return (
    <div className="mt-3 grid min-w-0 gap-4">
      {state && (
        <>
          {previous ? (
            <div className="grid gap-2">
              <label className="grid gap-1 text-sm">
                سهمیهٔ ثبت‌شدهٔ دورهٔ قبلی (گیگابایت)
                <NumberInput value={previousQuota} onValueChange={setPreviousQuota} allowDecimal disabled={busy} />
              </label>
              {previous.usedGB !== null && <p className="text-sm text-muted-foreground">مصرف ثبت‌شدهٔ دورهٔ قبلی {faNum(previous.usedGB)} گیگ</p>}
              <Button type="button" variant="outline" className="w-fit max-w-full"
                disabled={busy || !previousQuota.trim() || !isTrafficQuotaGB(correctedQuota) || correctedQuota === previous.trafficGB}
                onClick={() => void savePreviousQuota()}>ذخیرهٔ سهمیهٔ دورهٔ قبلی</Button>
            </div>
          ) : <p className="text-sm text-muted-foreground">سهمیهٔ دورهٔ قبلی بعد از نخستین شروع بسته در اینجا ثبت می‌شود.</p>}
          <div className="grid min-w-0 gap-2 border-t pt-3">
            <p className="text-sm text-muted-foreground">پس از اتمام حجم یا انقضا، حجم کل و مدت را ثبت کنید و شروع بسته را جداگانه تأیید کنید.</p>
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1 text-sm">حجم کل بستهٔ جدید (گیگابایت)
                <NumberInput value={traffic} onValueChange={setTraffic} allowDecimal disabled={busy || state.inProgress} />
              </label>
              <label className="grid min-w-0 gap-1 text-sm">مدت بستهٔ جدید (روز)
                <NumberInput value={days} onValueChange={setDays} disabled={busy || state.inProgress} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void savePackage()} disabled={!plan || matchesDraft || busy || state.inProgress}>
                ثبت حجم و مدت بسته
              </Button>
              <Button type="button" onClick={() => void startPackage()} disabled={!matchesDraft || busy}>
                {state.inProgress ? 'ادامهٔ شروع بسته' : 'شروع بستهٔ جدید'}
              </Button>
            </div>
          </div>
        </>
      )}
      {!state && !error && <p role="status" className="text-sm text-muted-foreground">در حال دریافت سابقه و بستهٔ ثبت‌شده…</p>}
      {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
      {error && <p role="alert" className="text-sm tone-danger">{error}</p>}
    </div>
  );
}