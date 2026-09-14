"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { api, Spinner, faDate, faNum, PasswordInput, PvLogo } from "./shared";
import type { ActivityLogRow, PanelInfo } from "./types";
import {
  Plug,
  Loader2,
  CheckCircle2,
  XCircle,
  History,
  Palette,
  Save,
  KeyRound,
  Server,
  Plus,
  Pencil,
  Trash2,
  Star,
  ShieldCheck,
} from "lucide-react";
import QRCodeLib from "react-qr-code";

const emptyPanelForm = {
  id: "",
  name: "",
  baseUrl: "",
  username: "",
  password: "",
  apiToken: "",
  subBase: "",
  subPath: "sub",
};

export function PanelSettingsTab() {
  const [loading, setLoading] = useState(true);
  const [panels, setPanels] = useState<PanelInfo[]>([]);
  const [form, setForm] = useState({ ...emptyPanelForm });
  const [editing, setEditing] = useState<PanelInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingSaved, setTestingSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [deleting, setDeleting] = useState<PanelInfo | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  // برند سامانه
  const [brand, setBrand] = useState("PvNetWork");
  const [brandSaving, setBrandSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<{ panels: PanelInfo[] }>("/api/admin/panel-config");
    const b = await api<{ brand: string }>("/api/admin/brand");
    setLoading(false);
    if (r.ok && r.data?.panels) setPanels(r.data.panels);
    if (b.ok && b.data?.brand) setBrand(b.data.brand);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBrand() {
    setBrandSaving(true);
    const r = await api("/api/admin/brand", { method: "PUT", body: JSON.stringify({ brand }) });
    setBrandSaving(false);
    if (r.ok) toast({ title: "موفق", description: "نام سامانه ذخیره شد" });
    else toast({ title: "خطا", description: r.error, variant: "destructive" });
  }

  function openEdit(p: PanelInfo) {
    setEditing(p);
    setForm({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      username: p.username,
      password: "",
      apiToken: "",
      subBase: p.subBase || "",
      subPath: p.subPath || "sub",
    });
    setTestResult(null);
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyPanelForm });
    setTestResult(null);
  }

  async function save() {
    if (!form.baseUrl || !form.username) {
      toast({ title: "خطا", description: "آدرس پنل و نام کاربری الزامی است", variant: "destructive" });
      return;
    }
    setSaving(true);
    let r;
    if (editing) {
      r = await api("/api/admin/panel-config", {
        method: "PUT",
        body: JSON.stringify({
          id: editing.id,
          name: form.name,
          baseUrl: form.baseUrl,
          username: form.username,
          password: form.password || undefined,
          apiToken: form.apiToken ? form.apiToken : undefined,
          subBase: form.subBase,
          subPath: form.subPath,
        }),
      });
    } else {
      r = await api("/api/admin/panel-config", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          baseUrl: form.baseUrl,
          username: form.username,
          password: form.password || undefined,
          apiToken: form.apiToken || undefined,
          subBase: form.subBase,
          subPath: form.subPath,
        }),
      });
    }
    setSaving(false);
    if (r.ok) {
      toast({ title: "موفق", description: editing ? "پنل ویرایش شد" : "پنل جدید اضافه شد" });
      setForm({ ...emptyPanelForm });
      setEditing(null);
      void load();
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function testNew() {
    if (!form.baseUrl) {
      toast({ title: "خطا", description: "آدرس پنل را وارد کنید", variant: "destructive" });
      return;
    }
    if (!form.apiToken && (!form.username || (!form.password && !editing))) {
      toast({ title: "خطا", description: "API Token یا نام کاربری و رمز عبور را وارد کنید", variant: "destructive" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    const r = await api<{ ok: boolean; msg: string }>("/api/admin/panel-test", {
      method: "POST",
      body: JSON.stringify({
        baseUrl: form.baseUrl,
        username: form.username,
        password: form.password || "dummy-not-used",
        apiToken: form.apiToken || undefined,
      }),
    });
    setTesting(false);
    setTestResult({ ok: r.ok && (r.data?.ok ?? false), msg: r.data?.msg || r.error || "" });
    if (r.ok && r.data?.ok) toast({ title: "اتصال موفق", description: r.data.msg });
  }

  async function testAllSaved() {
    setTestingSaved(true);
    setTestResult(null);
    const r = await api<{ ok: boolean; msg: string }>("/api/admin/panel-test-saved", { method: "POST" });
    setTestingSaved(false);
    setTestResult({ ok: r.ok && (r.data?.ok ?? false), msg: r.data?.msg || r.error || "" });
  }

  async function toggleActive(p: PanelInfo) {
    setToggling(p.id);
    const r = await api("/api/admin/panel-config", {
      method: "PUT",
      body: JSON.stringify({ id: p.id, name: p.name, baseUrl: p.baseUrl, username: p.username, active: !p.active }),
    });
    setToggling(null);
    if (r.ok) void load();
    else toast({ title: "خطا", description: r.error, variant: "destructive" });
  }

  async function confirmDelete() {
    if (!deleting) return;
    const r = await api(`/api/admin/panel-config?id=${deleting.id}`, { method: "DELETE" });
    if (r.ok) {
      toast({ title: "موفق", description: "پنل حذف شد" });
      void load();
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
    setDeleting(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-extrabold flex items-center gap-2">
          <Plug className="h-5 w-5 text-[var(--brand)]" />
          تنظیمات سامانه
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          اتصال به یک یا چند پنل ثنایی (3x-ui) و تنظیمات برند سامانه.
        </p>
      </div>

      <AdminAccountCard />

      {/* برند سامانه */}
      <Card className="bg-card card-soft">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="h-4 w-4 text-[var(--brand-orange)]" />
            نام سامانه
          </CardTitle>
          <CardDescription>این نام در صفحه ورود، هدر پنل ادمین و فوتر نمایش داده می‌شود.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="space-y-2 flex-1">
              <Label>نام نمایشی سامانه</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="PvNetWork" maxLength={60} />
            </div>
            <Button onClick={saveBrand} disabled={brandSaving} className="brand-gradient text-white hover:opacity-90 font-bold">
              {brandSaving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} ذخیره نام
            </Button>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 p-3">
            <PvLogo size={32} />
            <div className="leading-tight">
              <div className="text-xs font-bold">پیش‌نمایش: سامانه نمایندگی {brand || "PvNetWork"}</div>
              <div className="text-[10px] text-muted-foreground">در صفحه ورود به این شکل نمایش داده می‌شود</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* پنل‌های متصل */}
      <Card className="bg-card card-soft">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4 text-[var(--brand)]" />
            پنل‌های ثنایی متصل ({panels.length} پنل)
          </CardTitle>
          <CardDescription>
            می‌توانید چند پنل 3x-ui متصل کنید و اینباندهای هر کدام را به نماینده‌ها اختصاص دهید. اولین پنل = پنل اصلی.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="h-5 w-5 animate-spin" /> در حال بارگذاری...
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {panels.map((p, idx) => (
                  <div key={p.id} className="rounded-xl border border-border p-3 flex flex-wrap items-center justify-between gap-3 bg-card">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">{p.name}</span>
                        {idx === 0 && (
                          <Badge variant="outline" className="text-[10px] bg-[var(--brand-soft)] text-[var(--brand-deep)] border-[var(--brand)]/30">
                            <Star className="h-3 w-3 me-0.5" /> اصلی
                          </Badge>
                        )}
                        {p.hasApiToken && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            <KeyRound className="h-3 w-3 me-0.5" /> API Token
                          </Badge>
                        )}
                        {p.active ? (
                          <Badge variant="outline" className="text-[10px] tone-ok">فعال</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">غیرفعال</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3" dir="ltr">
                        <span>{p.baseUrl}</span>
                        <span>user: {p.username}</span>
                        <span>{faNum(p.inboundsAssigned)} اینباند اختصاص‌یافته</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1" dir="ltr">
                      <div className="flex items-center gap-1.5 me-2">
                        <span className="text-[10px] text-muted-foreground">فعال</span>
                        <Switch checked={p.active} onCheckedChange={() => toggleActive(p)} disabled={toggling === p.id} />
                      </div>
                      <Button size="icon" variant="ghost" title="ویرایش" onClick={() => openEdit(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="حذف" onClick={() => setDeleting(p)} disabled={panels.length <= 1}>
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {testResult && (
                <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${testResult.ok ? "tone-ok" : "tone-danger"}`}>
                  {testResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                  <span>{testResult.msg}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> افزودن پنل جدید
                </Button>
                <Button variant="outline" onClick={testAllSaved} disabled={testingSaved}>
                  {testingSaved ? <Spinner className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                  تست همه پنل‌های ذخیره‌شده
                </Button>
              </div>

              {/* فرم افزودن/ویرایش */}
              <div className={`rounded-xl border p-4 space-y-4 ${editing ? "border-[var(--brand)]/40 bg-[var(--brand-soft)]" : "border-border bg-muted/40"}`}>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-bold">
                    {editing ? `ویرایش پنل: ${editing.name}` : "افزودن پنل ثنایی جدید"}
                  </Label>
                  {editing && (
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setForm({ ...emptyPanelForm }); }}>
                      انصراف از ویرایش
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>نام پنل (برای نمایش)</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثلاً: سرور آلمان" />
                  </div>
                  <div className="space-y-2">
                    <Label>آدرس پنل</Label>
                    <Input dir="ltr" className="latin-input" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://1.2.3.4:2053" />
                  </div>
                  <div className="space-y-2">
                    <Label>نام کاربری ادمین پنل</Label>
                    <Input dir="ltr" className="latin-input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="admin" autoComplete="off" />
                  </div>
                  <div className="space-y-2">
                    <Label>{editing ? "رمز عبور (برای تغییر وارد کنید)" : "رمز عبور"}</Label>
                    <PasswordInput
                      dir="ltr"
                      className="latin-input"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder={editing ? "••••••••" : "رمز پنل ثنایی"}
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-[var(--brand)]" />
                      API Token (پیشنهادی)
                    </Label>
                    <PasswordInput
                      dir="ltr"
                      className="latin-input"
                      value={form.apiToken}
                      onChange={(e) => setForm({ ...form, apiToken: e.target.value })}
                      placeholder={editing?.hasApiToken ? "•••••••••••• (ذخیره شده)" : "توکن API پنل ۳x-ui"}
                      autoComplete="off"
                    />
                    <p className="text-[11px] text-muted-foreground">اگر توکن وارد شود، اتصال با آن انجام می‌شود (پایدارتر از رمز).</p>
                  </div>
                  <div className="space-y-2">
                    <Label>آدرس پایه سابسکریپشن (اختیاری)</Label>
                    <Input dir="ltr" className="latin-input" value={form.subBase} onChange={(e) => setForm({ ...form, subBase: e.target.value })} placeholder="https://sub.example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>مسیر سابسکریپشن</Label>
                    <Input dir="ltr" className="latin-input" value={form.subPath} onChange={(e) => setForm({ ...form, subPath: e.target.value })} placeholder="sub" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={testNew} disabled={testing}>
                    {testing ? <Spinner className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                    تست اتصال
                  </Button>
                  <Button onClick={save} disabled={saving} className="brand-gradient text-white hover:opacity-90 font-bold">
                    {saving && <Spinner className="h-4 w-4" />}
                    {editing ? "ذخیره تغییرات پنل" : "ذخیره پنل جدید"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground leading-6">
                  نکته: آدرس هر پنل یکتا است. پنل‌های غیرفعال در ساخت کاربر جدید استفاده نمی‌شوند اما کاربران قبلی‌شان مدیریت می‌شوند.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* تایید حذف پنل */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف پنل {deleting?.name}؟</AlertDialogTitle>
            <AlertDialogDescription>
              اگر اینباندهایی از این پنل به نماینده‌ها اختصاص یافته باشد، حذف انجام نمی‌شود. ابتدا دسترسی‌ها را از نماینده‌ها بردارید.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-500 text-white">حذف کن</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function LogsTab() {
  const [logs, setLogs] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = await api<{ logs: ActivityLogRow[] }>("/api/admin/logs");
      setLoading(false);
      if (r.ok && r.data) setLogs(r.data.logs);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold flex items-center gap-2">
          <History className="h-5 w-5 text-[var(--brand)]" />
          گزارش فعالیت‌ها
        </h2>
        <p className="text-sm text-muted-foreground mt-1">تمام عملیات ادمین و نماینده‌ها ثبت می‌شود.</p>
      </div>
      <Card className="bg-card card-soft">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> در حال بارگذاری...
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">هنوز فعالیتی ثبت نشده است.</div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              <Table className="min-w-0">
                <TableHeader>
                  <TableRow>
                    <TableHead>زمان</TableHead>
                    <TableHead>عامل</TableHead>
                    <TableHead>عملیات</TableHead>
                    <TableHead className="hidden md:table-cell">جزئیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs whitespace-nowrap">{faDate(l.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant={l.actorType === "ADMIN" ? "default" : "secondary"} className={`text-xs ${l.actorType === "ADMIN" ? "bg-[var(--brand)] text-white" : ""}`}>
                          {l.actorType === "ADMIN" ? "ادمین" : "نماینده"}
                        </Badge>
                        <span className="ms-2 text-sm" dir="ltr">{l.actorName}</span>
                      </TableCell>
                      <TableCell className="text-sm">{l.action}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-80 truncate" dir="auto">
                        {l.detail || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- حساب مدیر اصلی: تغییر نام کاربری/رمز + 2FA ----------
function AdminAccountCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [busy, setBusy] = useState(false);

  // 2FA ادمین
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [otpauth, setOtpauth] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [disablePass, setDisablePass] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  const load2fa = useCallback(async () => {
    const r = await api<{ totpEnabled: boolean }>("/api/admin/2fa");
    if (r.ok && r.data) setTotpEnabled(r.data.totpEnabled);
  }, []);

  useEffect(() => {
    void load2fa();
  }, [load2fa]);

  async function saveAccount() {
    if (!currentPassword) {
      toast({ title: "خطا", description: "رمز عبور فعلی الزامی است", variant: "destructive" });
      return;
    }
    if (!newUsername && !newPassword) {
      toast({ title: "خطا", description: "نام کاربری یا رمز جدید را وارد کنید", variant: "destructive" });
      return;
    }
    if (newPassword && newPassword !== newPassword2) {
      toast({ title: "خطا", description: "تکرار رمز جدید مطابقت ندارد", variant: "destructive" });
      return;
    }
    setBusy(true);
    const r = await api<{ username: string }>("/api/admin/account", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newUsername: newUsername || undefined, newPassword: newPassword || undefined }),
    });
    setBusy(false);
    if (r.ok) {
      toast({ title: "موفق", description: "حساب مدیر بروزرسانی شد" });
      setCurrentPassword("");
      setNewUsername("");
      setNewPassword("");
      setNewPassword2("");
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function setup2fa() {
    setTotpBusy(true);
    const r = await api<{ otpauth: string }>("/api/admin/2fa", { method: "POST", body: JSON.stringify({ action: "setup" }) });
    setTotpBusy(false);
    if (r.ok && r.data) {
      setOtpauth(r.data.otpauth);
      setTotpCode("");
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function enable2fa() {
    if (totpCode.replace(/\D/g, "").length !== 6) {
      toast({ title: "خطا", description: "کد ۶ رقمی را وارد کنید", variant: "destructive" });
      return;
    }
    setTotpBusy(true);
    const r = await api("/api/admin/2fa", { method: "POST", body: JSON.stringify({ action: "enable", code: totpCode }) });
    setTotpBusy(false);
    if (r.ok) {
      toast({ title: "موفق", description: "ورود دومرحله‌ای ادمین فعال شد" });
      setOtpauth("");
      setTotpCode("");
      setTotpEnabled(true);
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function disable2fa() {
    if (!disablePass) {
      toast({ title: "خطا", description: "رمز عبور الزامی است", variant: "destructive" });
      return;
    }
    setTotpBusy(true);
    const r = await api("/api/admin/2fa", { method: "DELETE", body: JSON.stringify({ password: disablePass }) });
    setTotpBusy(false);
    if (r.ok) {
      toast({ title: "موفق", description: "ورود دومرحله‌ای خاموش شد" });
      setTotpEnabled(false);
      setShowDisable(false);
      setDisablePass("");
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* تغییر نام کاربری / رمز */}
      <Card className="bg-card card-soft">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--brand)]" />
            حساب مدیر اصلی
          </CardTitle>
          <CardDescription>نام کاربری و رمز عبور ورود به پنل ادمین را از همین‌جا عوض کنید.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>رمز عبور فعلی (الزامی)</Label>
            <PasswordInput dir="ltr" className="latin-input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>نام کاربری جدید (اختیاری)</Label>
              <Input dir="ltr" className="latin-input" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="بدون تغییر" />
            </div>
            <div className="space-y-2">
              <Label>رمز عبور جدید (اختیاری)</Label>
              <PasswordInput dir="ltr" className="latin-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </div>
          </div>
          {newPassword && (
            <div className="space-y-2">
              <Label>تکرار رمز جدید</Label>
              <PasswordInput dir="ltr" className="latin-input" value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} autoComplete="new-password" />
            </div>
          )}
          <Button onClick={saveAccount} disabled={busy} className="brand-gradient text-white hover:opacity-90 font-bold">
            {busy ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} ذخیره حساب مدیر
          </Button>
        </CardContent>
      </Card>

      {/* ورود دومرحله‌ای ادمین */}
      <Card className="bg-card card-soft">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--brand-orange)]" />
            ورود دومرحله‌ای ادمین
            {totpEnabled !== null && (
              <Badge variant="outline" className={`ms-1 ${totpEnabled ? "tone-ok" : "tone-muted"}`}>
                {totpEnabled ? "فعال" : "غیرفعال"}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>حساب ادمین حساس‌ترین دسترسی سامانه است — فعال‌سازی این گزینه شدیداً توصیه می‌شود.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {totpEnabled ? (
            !showDisable ? (
              <Button variant="outline" onClick={() => setShowDisable(true)} className="hover:border-red-300 hover:text-red-500">
                خاموش‌سازی ورود دومرحله‌ای
              </Button>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-2">
                  <Label>رمز عبور برای تأیید</Label>
                  <PasswordInput dir="ltr" className="latin-input" value={disablePass} onChange={(e) => setDisablePass(e.target.value)} />
                </div>
                <Button variant="outline" onClick={() => { setShowDisable(false); setDisablePass(""); }}>انصراف</Button>
                <Button onClick={disable2fa} disabled={totpBusy} className="bg-red-600 hover:bg-red-500 text-white">خاموش کن</Button>
              </div>
            )
          ) : otpauth ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start gap-4">
                <div className="p-2.5 bg-white rounded-xl border border-border shrink-0">
                  {/* QR */}<QRCodeLib value={otpauth} size={150} />
                </div>
                <div className="text-xs space-y-1.5 text-muted-foreground leading-5">
                  <p>با اپ Authenticator اسکن کنید، سپس کد ۶ رقمی را وارد کنید.</p>
                  <code dir="ltr" className="block bg-muted rounded-md px-2 py-1 font-mono text-[9px] break-all max-w-60 overflow-hidden">{otpauth}</code>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-2">
                  <Label>کد ۶ رقمی</Label>
                  <Input dir="ltr" className="latin-input w-32" inputMode="numeric" maxLength={6} value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="------" />
                </div>
                <Button onClick={enable2fa} disabled={totpBusy} className="brand-gradient text-white hover:opacity-90 font-bold">تأیید و فعال‌سازی</Button>
                <Button variant="outline" onClick={() => setOtpauth("")}>انصراف</Button>
              </div>
            </div>
          ) : (
            <Button onClick={setup2fa} disabled={totpBusy} className="brand-gradient text-white hover:opacity-90 font-bold">
              {totpBusy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />} فعال‌سازی ورود دومرحله‌ای
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
