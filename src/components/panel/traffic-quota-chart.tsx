"use client";

import { quotaChartModel, type QuotaChartData } from "@/lib/quota-chart";
import { faNum } from "./shared";

const gb = (value: number | null | undefined) => value == null ? "نامشخص" : `${faNum(Math.round(value * 100) / 100)} GB`;

export function TrafficQuotaChart({ data, compact = false, label = "نمودار حجم" }: { data: QuotaChartData | null | undefined; compact?: boolean; label?: string }) {
  if (!data) return <div aria-label={label} className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">در حال دریافت اطلاعات نمودار…</div>;
  const model = quotaChartModel(data);
  const total = model.pool.reduce((sum, s) => sum + s.value, 0);
  const gradient = model.pool.map((s, index) => {
    const start = total ? model.pool.slice(0, index).reduce((sum, item) => sum + item.value, 0) / total * 100 : 0;
    const end = start + (total ? s.value / total * 100 : 0);
    return `${s.color} ${start}% ${end}%`;
  }).join(", ");
  const bars = (segments: typeof model.pool, title: string) => {
    const sum = segments.reduce((n, s) => n + s.value, 0);
    return <div role="img" aria-label={`${title}: ${segments.length ? segments.map(s => `${s.label} ${gb(s.value)}`).join("، ") : "بدون حجم"}`} className={`${compact ? "h-2" : "h-3"} flex w-full overflow-hidden rounded-full bg-muted`} dir="ltr">
      {segments.map(s => <span key={s.label} title={`${s.label}: ${gb(s.value)}`} style={{ width: `${sum ? s.value / sum * 100 : 0}%`, backgroundColor: s.color }} className="h-full transition-[width] duration-500 motion-reduce:transition-none" />)}
    </div>;
  };
  if (compact) return <div aria-label={label} className="mt-2 max-w-80 space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-2">
    <div className="flex justify-between gap-2 text-[10px] text-muted-foreground"><span>توزیع سهمیه</span><span>{data.poolGB === null ? "نامحدود" : gb(data.poolGB)}</span></div>
    {data.poolGB === null ? <div className="h-2 rounded-full bg-sky-500/20" /> : bars(model.pool, "توزیع سهمیه")}
    <div className="text-[10px] text-muted-foreground">جزئیات فروش: مصرف‌شده / مصرف‌نشده</div>
    {model.sales === null ? <p className="text-[10px] text-muted-foreground">{data.unlimitedUsers ? "شامل سهمیه نامحدود" : "در انتظار آمار زنده"}</p> : bars(model.sales, "جزئیات فروش")}
  </div>;
  return <section aria-label={label} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <div className="border-b border-border bg-gradient-to-l from-violet-500/10 via-sky-500/5 to-transparent px-4 py-3 sm:px-5">
      <h3 className="text-sm font-bold">{label}</h3><p className="mt-1 text-[11px] text-muted-foreground">فروش یک حجم کلی است؛ مصرف‌شده و مصرف‌نشده، دو بخش آن هستند.</p>
    </div>
    <div className="grid items-center gap-5 p-4 sm:p-5 md:grid-cols-[170px_1fr]">
      <div role="img" aria-label={`توزیع سهمیه: ${model.pool.map(s => `${s.label} ${gb(s.value)}`).join("، ") || (data.poolGB === null ? "نامحدود" : "بدون حجم")}`} className="relative mx-auto flex h-40 w-40 items-center justify-center rounded-full shadow-inner" style={{ background: gradient ? `conic-gradient(${gradient})` : "var(--muted)" }}>
        <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-card text-center shadow-sm"><span className="text-[11px] text-muted-foreground">سهمیه کل</span><strong className="mt-1 text-base" dir="ltr">{data.poolGB === null ? "نامحدود" : gb(data.poolGB)}</strong></div>
      </div>
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "باقی‌مانده", value: data.poolGB === null ? "نامحدود" : gb(data.unsoldGB), style: "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" },
            { label: "فروخته‌شده", value: `${gb(data.soldGB)}${data.unlimitedUsers ? " + نامحدود" : ""}`, style: "border-sky-500/20 bg-sky-500/5 text-sky-700 dark:text-sky-300" },
            { label: "مصرف واقعی", value: gb(data.actualUsedGB), style: "border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300" },
            { label: "فروخته‌شده، مصرف‌نشده", value: data.unlimitedUsers ? "شامل سهمیه نامحدود" : gb(data.soldButUnusedGB), style: "border-violet-500/20 bg-violet-500/5 text-violet-700 dark:text-violet-300" },
          ].map(item => <div key={item.label} className={`min-w-0 rounded-xl border p-2.5 ${item.style}`}><div className="text-[11px]">{item.label}</div><div className="mt-1 break-words text-sm font-bold" dir="ltr">{item.value}</div></div>)}
        </div>
        <div className="space-y-2"><div className="text-xs font-semibold">جزئیات حجم فروخته‌شده</div>
          {model.sales === null ? <p className="text-xs text-muted-foreground">{data.unlimitedUsers ? "برای سهمیه نامحدود درصد مصرف محاسبه نمی‌شود." : "نمودار مصرف پس از دریافت آمار زنده نمایش داده می‌شود."}</p> : <>{bars(model.sales, "جزئیات فروش")}<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">{model.sales.map(s => <span key={s.label} className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />{s.label}: {gb(s.value)}</span>)}</div></>}
        </div>
      </div>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-[11px] text-muted-foreground sm:px-5">{model.pool.map(s => <span key={s.label} className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />{s.label}: {gb(s.value)}</span>)}{model.overQuotaGB !== null && model.overQuotaGB > 0.001 && <span>مصرف مازاد بر سهمیه: {gb(model.overQuotaGB)}</span>}</div>
  </section>;
}
