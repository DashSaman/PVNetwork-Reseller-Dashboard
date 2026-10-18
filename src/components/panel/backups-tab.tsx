"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, faDate, faNum, Spinner } from "./shared";
import { Download, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { RestorePreview } from "@/lib/dashboard-restore";
type Entry = { name: string; createdAt: string; kind: string; size: number; complete: boolean; panelCount: number; errors: { id: string; name: string; error: string }[] };
export function BackupsTab() {
  const [files, setFiles] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scheduled, setScheduled] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [restore, setRestore] = useState<{ allowed: boolean; reason: string } | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<{ token: string; preview: RestorePreview } | null>(null);
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [queued, setQueued] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<{ files: Entry[]; scheduled: boolean }>("/api/admin/backups");
    if (r.ok && r.data) { setFiles(r.data.files); setScheduled(r.data.scheduled); } else setError(r.error || "دریافت فهرست ناموفق بود");
    const available = await api<{ allowed: boolean; reason: string }>("/api/admin/backups/restore");
    if (available.ok && available.data) setRestore(available.data);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!queued) return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch("/api/auth/me", { cache: "no-store" });
        if (r.ok && (await r.json()).user === null) window.location.reload();
      } catch { /* Wait until this dashboard is back online. */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [queued]);
  async function checkRestore() {
    if (!file) return;
    setRestoring(true); setChecked(null); setError("");
    try {
      if (file.size > 64 * 1024 * 1024) throw Error("حداکثر حجم فایل ۶۴ مگابایت است.");
      const r = await fetch("/api/admin/backups/restore", { method: "PUT", headers: { "Content-Type": "application/zip" }, body: file });
      const result = await r.json();
      if (!r.ok) throw Error(result.error || "اعتبارسنجی بکاپ ناموفق بود.");
      setChecked(result); setConfirmed(false);
    } catch (e) { setError(e instanceof Error ? e.message : "بارگذاری فایل ناموفق بود."); }
    finally { setRestoring(false); }
  }
  async function applyRestore() {
    if (!checked || !confirmed) return;
    setRestoring(true); setError("");
    try {
      const r = await api<{ queued: boolean }>("/api/admin/backups/restore", { method: "POST", body: JSON.stringify({ token: checked.token, password, totpCode, confirm: "RESTORE" }) });
      if (!r.ok || !r.data?.queued) throw Error(r.error || "شروع بازیابی ناموفق بود.");
      setPassword(""); setTotpCode(""); setQueued(true);
    } catch (e) { setError(e instanceof Error ? e.message : "شروع بازیابی ناموفق بود."); }
    finally { setRestoring(false); }
  }
  async function create() {
    setBusy(true); setError("");
    const r = await api<{ backup: Entry }>("/api/admin/backups", { method: "POST", body: JSON.stringify({ kind: "manual" }) });
    if (r.ok && r.data) { await load(); if (!r.data.backup.complete) setError("بکاپ داشبورد ذخیره شد، ولی خروجی برخی پنل‌ها ناقص است؛ خطاهای زیر را بررسی کنید."); }
    else setError(r.error || "تهیه بکاپ ناموفق بود");
    setBusy(false);
  }
  async function download(name: string) {
    setDownloading(name); setError("");
    try {
      const response = await fetch(`/api/admin/backups?download=${encodeURIComponent(name)}&raw=1`, { cache: "no-store" });
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("application/zip")) throw new Error("دریافت فایل بکاپ ناموفق بود؛ فهرست را دوباره دریافت کنید.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = name;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setError(e instanceof Error ? e.message : "دانلود بکاپ ناموفق بود"); }
    finally { setDownloading(""); }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-extrabold flex items-center gap-2"><ShieldCheck className="h-5 w-5" />بکاپ و انتقال سرور</h2>
      <div className="flex flex-wrap gap-2"><Button variant="outline" title={restore?.reason} onClick={() => setShowRestore(v => !v)} disabled={!restore?.allowed || busy || restoring || queued}><Upload className="h-4 w-4" />بازیابی بکاپ</Button><Button variant="outline" onClick={load} disabled={busy || loading || restoring || queued}><RefreshCw className="h-4 w-4" />بازخوانی</Button><Button onClick={create} disabled={busy || restoring || queued}>{busy ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}{busy ? "در حال تهیهٔ بکاپ…" : "تهیهٔ بکاپ کامل"}</Button></div>
    </div>
    <Card><CardContent className="p-4 space-y-2 text-sm">
      <p>بکاپ شامل تمام اطلاعات پنل نمایندگی، نماینده‌ها، کاربران، موجودی و مصرف، دسترسی‌ها، برند و دامنه، گزارش‌ها، تنظیمات اتصال و کلید بازیابی داشبورد است. تهیهٔ بکاپ فقط از داشبورد انجام می‌شود.</p>
      <p>{scheduled ? <>بکاپ خودکار هر روز ساعت <strong>۰۳:۰۰ به وقت تهران</strong> تهیه می‌شود.</> : "زمان‌بندی روزانه هنوز روی این سرور فعال نشده است."} فایل‌های این بخش پس از <strong>۵ روز</strong> هنگام تهیهٔ بکاپ جدید خودکار حذف می‌شوند.</p>
      <p>فایل‌ها روی همین سرور نگهداری می‌شوند؛ برای انتقال یا نگهداری جداگانه، آن‌ها را دانلود کنید.</p>
      <p className="text-muted-foreground">فایل بکاپ حاوی اطلاعات محرمانه و کلید بازیابی است؛ آن را در محل امن نگه دارید. بازیابی باید روی مقصد تازه انجام شود و روی داده‌های سرور فعال بازنویسی نمی‌کند.</p>
    </CardContent></Card>
    {restore && !restore.allowed && <p className="text-sm text-muted-foreground">{restore.reason}</p>}
    {showRestore && <Card><CardContent className="p-4 space-y-4">
      <h3 className="font-bold">بازیابی روی نصب تازه</h3>
      <p className="text-sm">فقط بکاپ مورد اعتماد خودتان را انتخاب کنید. ابتدا فایل و کلید بازیابی بررسی می‌شود. دیتابیس پنل نمایندگی برمی‌گردد؛ سرورهای VPN، پورت‌ها و سرویس‌های دیگر تغییر نمی‌کنند.</p>
      <label className="block space-y-2"><span>فایل بکاپ ZIP (حداکثر ۶۴ مگابایت)</span><Input type="file" accept=".zip,application/zip" disabled={restoring || queued} onChange={e => { setFile(e.target.files?.[0] || null); setChecked(null); setConfirmed(false); }} /></label>
      <Button variant="outline" disabled={!file || restoring || queued} onClick={checkRestore}>{restoring ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}بارگذاری و بررسی بکاپ</Button>
      {checked && <div className="space-y-3 text-sm">
        <p>فایل سالم و سازگار است · {faDate(checked.preview.createdAt)} · {faNum(checked.preview.counts.ResellerUser)} کاربر · {faNum(checked.preview.counts.Reseller)} نماینده · {faNum(checked.preview.counts.PanelConfig)} اتصال · {faNum(checked.preview.peerCount)} نود همگام‌سازی</p>
        <p className="break-all text-xs" dir="ltr">SHA-256: {checked.preview.sha256}</p>
        <p>تنظیمات، تخصیص‌ها، مصرف قطعی، دسترسی‌ها و ژورنال‌ها با کلید اصلی برمی‌گردند. مصرف و وضعیت زنده از پنل‌های متصل دریافت می‌شود.</p>
        {checked.preview.privateRoute && <p role="alert">بکاپ دارای مسیر خصوصی نود است؛ پیش از استفادهٔ عملی، دسترسی و TLS آن را از سرور جدید بررسی کنید. آدرس داخلی سرور قبلی خودکار عوض نمی‌شود.</p>}
        {checked.preview.nativePanelsIgnored > 0 && <p>فایل‌های پنل VPN داخل این آرشیو نصب نمی‌شوند؛ فقط داشبورد بازیابی می‌شود.</p>}
        <label className="block space-y-1"><span>رمز فعلی ادمین این نصب</span><Input type="password" autoComplete="current-password" value={password} disabled={restoring || queued} onChange={e => setPassword(e.target.value)} /></label>
        <label className="block space-y-1"><span>کد دومرحله‌ای (اگر فعال است)</span><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} disabled={restoring || queued} onChange={e => setTotpCode(e.target.value)} /></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={restoring || queued} onChange={e => setConfirmed(e.target.checked)} /><span>تأیید می‌کنم اطلاعات نصب تازه جایگزین شود؛ پس از شروع مجدد فقط با حساب ادمین داخل بکاپ وارد می‌شوم و داشبورد مبدأ هم‌زمان اجازهٔ تغییر داده نخواهد داشت.</span></label>
        <Button variant="destructive" disabled={!confirmed || !password || restoring || queued} onClick={applyRestore}>بازیابی و راه‌اندازی مجدد داشبورد</Button>
      </div>}
      {queued && <p role="status">در حال راه‌اندازی مجدد و بازیابی داشبورد… پس از آماده‌شدن، صفحهٔ ورود باز می‌شود. اگر باز نشد صفحه را دوباره باز کنید؛ فایل را مجدداً اعمال نکنید.</p>}
    </CardContent></Card>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading ? <p>در حال دریافت بکاپ‌ها…</p> : files.length === 0 ? <p className="text-sm text-muted-foreground">هنوز بکاپی تهیه نشده است.</p> : files.map(f => <Card key={f.name}><CardContent className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1"><div className="flex flex-wrap gap-2 items-center"><strong>{faDate(f.createdAt)}</strong><Badge variant={f.complete ? "secondary" : "destructive"}>{f.complete ? "کامل" : "ناقص"}</Badge><Badge variant="outline">{f.kind === "daily" ? "روزانه" : "دستی"}</Badge></div><p className="text-xs text-muted-foreground">تمام اطلاعات داشبورد · {faNum(Math.round(f.size / 1024))} کیلوبایت</p></div>
        <Button variant="outline" disabled={!!downloading} onClick={() => download(f.name)}>{downloading === f.name ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}دانلود بکاپ</Button>
      </div>
      {f.errors.map(e => <p key={e.id} className="text-sm text-destructive">{e.name}: {e.error}</p>)}
    </CardContent></Card>)}
  </div>;
}
