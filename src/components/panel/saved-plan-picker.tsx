"use client";

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from './shared';
import type { SavedResellerPlan } from '@/lib/reseller-plan-model';

export function SavedPlanPicker({ onApply, draft, disabled }: {
  onApply: (plan: SavedResellerPlan) => void; draft: Omit<SavedResellerPlan, 'id' | 'name'>; disabled: boolean;
}) {
  const [plans, setPlans] = useState<SavedResellerPlan[]>([]);
  const [selected, setSelected] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const reload = useCallback(async () => {
    const r = await api<{ plans: SavedResellerPlan[] }>('/api/reseller/plans');
    if (r.ok && r.data) setPlans(r.data.plans);
    else setNotice(r.error || 'بسته‌ها دریافت نشدند');
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function save() {
    if (plans.some(plan => plan.name === label.trim()) && !window.confirm('تنظیمات این بسته به‌روزرسانی شود؟')) return;
    setBusy(true);
    const r = await api<{ plan: SavedResellerPlan }>('/api/reseller/plans', { method: 'POST',
      body: JSON.stringify({ ...draft, name: label }) });
    if (r.ok && r.data) { setSelected(r.data.plan.id); await reload(); }
    setNotice(r.ok ? 'بسته ذخیره شد' : r.error || 'بسته ذخیره نشد');
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm('این بسته از فهرست بسته‌های آماده برداشته شود؟')) return;
    setBusy(true);
    const r = await api('/api/reseller/plans?id=' + encodeURIComponent(selected), { method: 'DELETE' });
    if (r.ok) { setSelected(''); await reload(); }
    setNotice(r.ok ? 'بسته حذف شد' : r.error || 'بسته حذف نشد');
    setBusy(false);
  }

  return <section className="space-y-2 rounded-lg border p-3">
    <h3 className="font-semibold text-sm">بسته‌های آماده</h3>
    {plans.length > 0 && <div className="flex flex-wrap gap-2">
      <select aria-label="انتخاب بستهٔ آماده" className="min-w-32 grow rounded-md border bg-background p-2 text-sm" value={selected} disabled={disabled || busy} onChange={e => {
        const plan = plans.find(item => item.id === e.target.value);
        setSelected(e.target.value);
        if (plan) { setLabel(plan.name); onApply(plan); }
      }}>
        <option value="">انتخاب بسته</option>
        {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name} · {plan.trafficGB} گیگ · {plan.days} روز</option>)}
      </select>
      <Button type="button" variant="outline" size="sm" disabled={disabled || busy || !selected} onClick={() => void remove()}>حذف بسته</Button>
    </div>}
    <div className="flex flex-wrap gap-2">
      <Input aria-label="نام بستهٔ آماده" placeholder="نام بسته" className="min-w-32 flex-1" value={label} maxLength={60} onChange={e => setLabel(e.target.value)} />
      <Button type="button" size="sm" variant="outline" disabled={disabled || busy || !label.trim() || !(draft.days > 0) || !(draft.trafficGB > 0) || !draft.refs.length} onClick={() => void save()}>ذخیره از فرم</Button>
    </div>
    {notice && <p role="status" className="text-xs">{notice}</p>}
  </section>;
}
