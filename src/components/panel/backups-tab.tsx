"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, faDate, faNum, Spinner } from "./shared";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
type Entry = { name: string; createdAt: string; kind: string; size: number; complete: boolean; panelCount: number; errors: { id: string; name: string; error: string }[] };
export function BackupsTab() {
  const [files, setFiles] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scheduled, setScheduled] = useState(false);
  const [downloading, setDownloading] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<{ files: Entry[]; scheduled: boolean }>("/api/admin/backups");
    if (r.ok && r.data) { setFiles(r.data.files); setScheduled(r.data.scheduled); } else setError(r.error || "دریافت فهرست ناموفق بود");
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
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
      <div className="flex gap-2"><Button variant="outline" onClick={load} disabled={busy || loading}><RefreshCw className="h-4 w-4" />بازخوانی</Button><Button onClick={create} disabled={busy}>{busy ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}{busy ? "در حال تهیهٔ بکاپ…" : "تهیهٔ بکاپ کامل"}</Button></div>
    </div>
    <Card><CardContent className="p-4 space-y-2 text-sm">
      <p>بکاپ شامل تمام اطلاعات پنل نمایندگی، نماینده‌ها، کاربران، موجودی و مصرف، دسترسی‌ها، برند و دامنه، گزارش‌ها، تنظیمات اتصال و کلید بازیابی داشبورد است. تهیهٔ بکاپ فقط از داشبورد انجام می‌شود.</p>
      <p>{scheduled ? <>بکاپ خودکار هر روز ساعت <strong>۰۳:۰۰ به وقت تهران</strong> تهیه می‌شود.</> : "زمان‌بندی روزانه هنوز روی این سرور فعال نشده است."} فایل‌های این بخش پس از <strong>۵ روز</strong> هنگام تهیهٔ بکاپ جدید خودکار حذف می‌شوند.</p>
      <p>فایل‌ها روی همین سرور نگهداری می‌شوند؛ برای انتقال یا نگهداری جداگانه، آن‌ها را دانلود کنید.</p>
      <p className="text-muted-foreground">فایل بکاپ حاوی اطلاعات محرمانه و کلید بازیابی است؛ آن را در محل امن نگه دارید. بازیابی باید روی مقصد تازه انجام شود و روی داده‌های سرور فعال بازنویسی نمی‌کند.</p>
    </CardContent></Card>
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
