"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, faNum, NumberInput, parseNumberInput } from "./shared";
import { Loader2 } from "lucide-react";

type Preview = { hash: string; total: number; affected: number; unchanged: number; requiredGB: number; remainingGB: number; unlimitedPool: boolean };
type Job = { jobId: string; status: string; total: number; done: number; pending: number; unchanged: number; requiredGB: number; input: { trafficGB: number; days: number }; errors: { email: string; error: string }[] };
export function BulkExtensionDialog({ reseller, onClose, onUpdated, scope = "admin" }: { reseller: { id: string; username: string }; onClose: () => void; onUpdated: () => void; scope?: "admin" | "reseller" }) {
  const [traffic, setTraffic] = useState("0");
  const [days, setDays] = useState("0");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef("");
  const alive = useRef(true);
  const url = scope === "reseller" ? "/api/reseller/users/bulk-extension" : `/api/admin/resellers/${reseller.id}/bulk-extension`;
  useEffect(() => {
    alive.current = true;
    void api<{ job: Job | null }>(url).then(r => {
      if (!alive.current) return;
      if (r.ok && r.data) setJob(r.data.job);
      else setError(r.error || "دریافت وضعیت ناموفق بود");
      setBusy(false);
    });
    return () => { alive.current = false; };
  }, [url]);
  function change(kind: "traffic" | "days", value: string) {
    (kind === "traffic" ? setTraffic : setDays)(value);
    setPreview(null); setError(""); requestId.current = "";
  }
  async function getPreview() {
    setBusy(true); setError("");
    const r = await api<{ preview: Preview }>(url, { method: "POST", body: JSON.stringify({ mode: "preview", trafficGB: parseNumberInput(traffic), days: parseNumberInput(days) }) });
    if (r.ok && r.data) { setPreview(r.data.preview); requestId.current = crypto.randomUUID(); }
    else setError(r.error || "پیش‌نمایش ناموفق بود");
    setBusy(false);
  }
  async function run(initial: Job) {
    setBusy(true); setError("");
    let current = initial;
    setJob(current);
    while (alive.current && current.pending > 0) {
      const r = await api<{ job: Job }>(url, { method: "POST", body: JSON.stringify({ mode: "run", jobId: current.jobId }) });
      if (!r.ok || !r.data) { setError(r.error || "ارتباط قطع شد؛ ادامهٔ همین عملیات را بزنید"); break; }
      const next = r.data.job;
      setJob(next); onUpdated();
      if (next.status === "PARTIAL" || (next.pending > 0 && next.done <= current.done)) {
        setError("عملیات ناقص است؛ پس از رفع خطای زیر، ادامهٔ همین عملیات را بزنید. سهمیهٔ لازم رزرو شده است.");
        break;
      }
      current = next;
    }
    if (alive.current) setBusy(false);
  }
  async function start() {
    if (!preview || !requestId.current) return;
    setBusy(true); setError("");
    const r = await api<{ job: Job }>(url, { method: "POST", body: JSON.stringify({ mode: "start", hash: preview.hash, requestId: requestId.current, trafficGB: parseNumberInput(traffic), days: parseNumberInput(days) }) });
    if (r.ok && r.data) await run(r.data.job);
    else { setError(r.error || "شروع ناموفق بود؛ وضعیت عملیات را دوباره بررسی کنید"); setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl" onInteractOutside={e => { if (busy) e.preventDefault(); }} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>افزایش گروهی حجم و زمان: {reseller.username}</DialogTitle>
          <DialogDescription>برای همهٔ کاربران همین نماینده. حجم از موجودی پول نماینده مصرف می‌شود و زمان به انقضای فعلی اضافه می‌شود؛ مصرف کاربران حفظ می‌شود.</DialogDescription>
        </DialogHeader>
        {!job && <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label htmlFor="bulk-traffic">حجم اضافه برای هر کاربر (گیگ)</Label><NumberInput id="bulk-traffic" value={traffic} onValueChange={v => change("traffic", v)} disabled={busy} /></div>
            <div className="space-y-2"><Label htmlFor="bulk-days">زمان اضافه برای هر کاربر (روز)</Label><NumberInput id="bulk-days" value={days} onValueChange={v => change("days", v)} disabled={busy} /></div>
          </div>
          <p className="text-xs text-muted-foreground">صفر یعنی بدون تغییر. حجم یا زمان نامحدود، نامحدود می‌ماند. تاریخ کاربران منقضی‌شده هم از تاریخ قبلی افزایش می‌یابد؛ حساب غیرفعال خودکار فعال نمی‌شود.</p>
          {preview && <div className="rounded-lg border p-3 text-sm space-y-2" role="status">
            <p>کاربران: {faNum(preview.total)} — قابل تغییر: {faNum(preview.affected)} — بدون تغییر: {faNum(preview.unchanged)}</p>
            <p>حجم لازم از پول نماینده: <strong>{faNum(preview.requiredGB)} گیگ</strong></p>
            <p>موجودی فعلی: {preview.unlimitedPool ? "نامحدود" : `${faNum(preview.remainingGB)} گیگ`}</p>
            <p>با تأیید، به هر کاربر محدود {faNum(parseNumberInput(traffic))} گیگ و {faNum(parseNumberInput(days))} روز اضافه می‌شود.</p>
          </div>}
        </>}
        {job && <div className="rounded-lg border p-3 space-y-2 text-sm" role="status" aria-live="polite">
          <p>انجام‌شده: {faNum(job.done)} از {faNum(job.total)} کاربر</p>
          <p>هر کاربر: +{faNum(job.input.trafficGB)} گیگ / +{faNum(job.input.days)} روز</p>
          <p>مجموع حجم تخصیص: {faNum(job.requiredGB)} گیگ</p>
          {job.pending === 0 && <p className="text-emerald-600">افزایش گروهی کامل شد.</p>}
          {job.errors.map(e => <p key={e.email} className="text-destructive">{e.email}: {e.error}</p>)}
        </div>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>بستن</Button>
          {!job && <Button onClick={preview ? start : getPreview} disabled={busy}>{busy && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}{preview ? "تأیید و اجرای افزایش گروهی" : "بررسی و پیش‌نمایش"}</Button>}
          {job && job.pending > 0 && <Button onClick={() => run(job)} disabled={busy}>{busy && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}{busy ? "در حال اجرا…" : "ادامهٔ همین عملیات"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
