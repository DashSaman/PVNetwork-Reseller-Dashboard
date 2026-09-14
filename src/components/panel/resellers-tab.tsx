"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { api, StatusBadge, Spinner, gbLabel, faNum, PasswordInput } from "./shared";
import type { InboundInfo, ResellerInfo, InboundRefForm } from "./types";
import { UserCog, Plus, Pencil, Trash2, KeyRound, Loader2, Globe, BadgeCheck, Server, ShieldOff } from "lucide-react";

type FormState = {
  username: string;
  password: string;
  name: string;
  active: boolean;
  multiLocation: boolean;
  trafficPoolGB: number;
  allowIpLimit: boolean;
  allowWhitelabel: boolean;
  inbounds: InboundRefForm[];
};

const emptyForm: FormState = {
  username: "",
  password: "",
  name: "",
  active: true,
  multiLocation: false,
  trafficPoolGB: 2048,
  allowIpLimit: true,
  allowWhitelabel: true,
  inbounds: [],
};

/** گروه‌بندی اینباندها بر اساس پنل */
function groupByPanel(inbounds: InboundInfo[]): { panelId: string; panelName: string; items: InboundInfo[] }[] {
  const map = new Map<string, { panelId: string; panelName: string; items: InboundInfo[] }>();
  for (const i of inbounds) {
    const g = map.get(i.panelId) || { panelId: i.panelId, panelName: i.panelName || "پنل", items: [] };
    g.items.push(i);
    map.set(i.panelId, g);
  }
  return Array.from(map.values());
}

function refKey(r: InboundRefForm): string {
  return `${r.panelId}::${r.inboundId}`;
}

export function ResellersTab({ inbounds, panelConnected }: { inbounds: InboundInfo[]; panelConnected: boolean }) {
  const [resellers, setResellers] = useState<ResellerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ResellerInfo | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [disabling2fa, setDisabling2fa] = useState(false);
  const [deleting, setDeleting] = useState<ResellerInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<{ resellers: ResellerInfo[] }>("/api/admin/resellers");
    setLoading(false);
    if (r.ok && r.data) setResellers(r.data.resellers);
    else toast({ title: "خطا", description: r.error, variant: "destructive" });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, inbounds: [] });
    setDialogOpen(true);
  }

  function openEdit(r: ResellerInfo) {
    setEditing(r);
    setForm({
      username: r.username,
      password: "",
      name: r.name || "",
      active: r.active,
      multiLocation: r.multiLocation,
      trafficPoolGB: r.trafficPoolGB,
      allowIpLimit: r.allowIpLimit,
      allowWhitelabel: r.allowWhitelabel,
      inbounds: r.inbounds.map((i) => ({ panelId: i.panelId, inboundId: i.inboundId })),
    });
    setDialogOpen(true);
  }

  function toggleInbound(panelId: string, inboundId: number) {
    setForm((f) => {
      const key = refKey({ panelId, inboundId });
      const exists = f.inbounds.some((x) => refKey(x) === key);
      return {
        ...f,
        inbounds: exists ? f.inbounds.filter((x) => refKey(x) !== key) : [...f.inbounds, { panelId, inboundId }],
      };
    });
  }

  async function save() {
    if (!editing) {
      if (!/^[a-zA-Z0-9_-]{3,32}$/.test(form.username)) {
        toast({ title: "خطا", description: "نام کاربری: ۳ تا ۳۲ کاراکتر — حروف انگلیسی (بزرگ/کوچک)، عدد، خط تیره و آندرلاین", variant: "destructive" });
        return;
      }
      if (form.password.length < 4) {
        toast({ title: "خطا", description: "رمز عبور حداقل ۴ کاراکتر باشد", variant: "destructive" });
        return;
      }
    }
    if (form.inbounds.length === 0) {
      toast({ title: "خطا", description: "حداقل یک اینباند انتخاب کنید", variant: "destructive" });
      return;
    }
    setSaving(true);
    const r = editing
      ? await api(`/api/admin/resellers/${editing.id}`, { method: "PUT", body: JSON.stringify(form) })
      : await api("/api/admin/resellers", { method: "POST", body: JSON.stringify(form) });
    setSaving(false);
    if (r.ok) {
      toast({ title: "موفق", description: editing ? "نماینده ویرایش شد" : "نماینده ایجاد شد" });
      setDialogOpen(false);
      void load();
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function disableReseller2fa() {
    if (!editing) return;
    setDisabling2fa(true);
    const r = await api(`/api/admin/resellers/${editing.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: form.name, disable2fa: true }),
    });
    setDisabling2fa(false);
    if (r.ok) {
      toast({ title: "موفق", description: "ورود دومرحله‌ای این نماینده خاموش شد" });
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const r = await api(`/api/admin/resellers/${deleting.id}`, { method: "DELETE" });
    if (r.ok) {
      toast({ title: "موفق", description: "نماینده حذف شد" });
      void load();
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
    setDeleting(null);
  }

  async function toggleActive(r: ResellerInfo) {
    const res = await api(`/api/admin/resellers/${r.id}`, { method: "PUT", body: JSON.stringify({ active: !r.active }) });
    if (res.ok) void load();
    else toast({ title: "خطا", description: res.error, variant: "destructive" });
  }

  const grouped = groupByPanel(inbounds);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold flex items-center gap-2">
            <UserCog className="h-5 w-5 text-[var(--brand)]" />
            مدیریت نماینده‌ها
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            به هر نماینده پول ترافیک بدهید — خودش آزادانه بین کاربرانش تقسیم می‌کند.
          </p>
        </div>
        <Button onClick={openCreate} className="brand-gradient text-white hover:opacity-90 font-bold">
          <Plus className="h-4 w-4" /> نماینده جدید
        </Button>
      </div>

      <Card className="bg-card card-soft">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> در حال بارگذاری...
            </div>
          ) : resellers.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              هنوز نماینده‌ای ساخته نشده است. با دکمه «نماینده جدید» اولین نماینده را بسازید.
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>کاربر</TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead className="hidden md:table-cell">اینباندهای مجاز</TableHead>
                    <TableHead className="hidden lg:table-cell">پول ترافیک</TableHead>
                    <TableHead className="hidden xl:table-cell">وایت‌لیبل</TableHead>
                    <TableHead>کاربران</TableHead>
                    <TableHead className="text-left">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resellers.map((r) => {
                    const pct = r.trafficPoolGB > 0 ? Math.min(100, (r.allocatedGB / r.trafficPoolGB) * 100) : 0;
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-semibold" dir="ltr">{r.username}</div>
                          {r.name && <div className="text-xs text-muted-foreground">{r.name}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <StatusBadge active={r.active} />
                            {r.multiLocation && (
                              <Badge variant="outline" className="border-[var(--brand)]/40 text-[var(--brand-deep)] text-xs">
                                مولتی‌لوکیشن
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex flex-wrap gap-1 max-w-64">
                            {r.inbounds.slice(0, 4).map((i) => (
                              <Badge key={`${i.panelId}-${i.inboundId}`} variant="secondary" className="text-xs" dir="ltr">
                                {i.inboundTag || `#${i.inboundId}`}
                              </Badge>
                            ))}
                            {r.inbounds.length > 4 && <Badge variant="secondary" className="text-xs">+{faNum(r.inbounds.length - 4)}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <div className="space-y-1 min-w-32">
                            <div className="text-xs text-muted-foreground" dir="ltr">
                              {r.trafficPoolGB > 0 ? `${faNum(r.allocatedGB)} / ${faNum(r.trafficPoolGB)} GB` : "نامحدود"}
                            </div>
                            {r.trafficPoolGB > 0 && (
                              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden" dir="ltr">
                                <div
                                  className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-[var(--brand)]"}`}
                                  style={{ width: `${Math.max(3, pct)}%` }}
                                />
                              </div>
                            )}
                            <div className="text-[10px] text-muted-foreground">{faNum(r.usersCount)} کاربر</div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell">
                          {r.allowWhitelabel ? (
                            <div className="space-y-1">
                              {r.brandName && (
                                <div className="flex items-center gap-1 text-xs">
                                  <BadgeCheck className="h-3.5 w-3.5 text-[var(--brand)]" />
                                  <span className="font-medium">{r.brandName}</span>
                                </div>
                              )}
                              {r.customDomain ? (
                                <div className="flex items-center gap-1 text-xs" dir="ltr">
                                  <Globe className={`h-3.5 w-3.5 ${r.domainVerified ? "text-emerald-500" : "text-amber-500"}`} />
                                  {r.customDomain}
                                  {!r.domainVerified && <span className="text-amber-500">(تأییدنشده)</span>}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">دامنه ثبت نشده</div>
                              )}
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-xs text-muted-foreground">مجوز ندارد</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-[var(--brand-soft)] text-[var(--brand-deep)] border-[var(--brand)]/30">
                            {faNum(r.usersCount)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-left">
                          <div className="flex items-center gap-1 justify-start" dir="ltr">
                            <Button size="icon" variant="ghost" title="ویرایش" onClick={() => openEdit(r)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" title={r.active ? "غیرفعال‌سازی" : "فعال‌سازی"} onClick={() => toggleActive(r)}>
                              <KeyRound className={`h-4 w-4 ${r.active ? "text-[var(--brand)]" : "text-red-400"}`} />
                            </Button>
                            <Button size="icon" variant="ghost" title="حذف" onClick={() => setDeleting(r)}>
                              <Trash2 className="h-4 w-4 text-red-400" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* دیالوگ ساخت/ویرایش */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `ویرایش نماینده: ${editing.username}` : "ایجاد نماینده جدید"}</DialogTitle>
            <DialogDescription>
              پول ترافیک و اینباندهای مجاز را تعیین کنید. نماینده آزاد است هر تعداد کاربر بسازد و سهمیه هر کاربر را خودش از پول تعیین کند.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>نام کاربری {editing && "(غیرقابل تغییر)"}</Label>
                <Input
                  dir="ltr"
                  className="latin-input"
                  value={form.username}
                  disabled={!!editing}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="Reseller1"
                />
                <p className="text-xs text-muted-foreground">حروف انگلیسی بزرگ/کوچک، عدد، خط تیره و آندرلاین مجاز است</p>
              </div>
              <div className="space-y-2">
                <Label>{editing ? "رمز جدید (اختیاری)" : "رمز عبور"}</Label>
                <PasswordInput
                  dir="ltr"
                  className="latin-input"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editing ? "برای تغییر وارد کنید" : "رمز عبور"}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>نام/عنوان نمایشی (اختیاری)</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثلاً: فروشگاه تهران" />
            </div>

            {/* پول ترافیک */}
            <div className="rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-soft)] p-4 space-y-2">
              <Label className="text-sm font-bold">پول ترافیک نماینده (گیگابایت)</Label>
              <div className="flex items-center gap-3">
                <Input
                  dir="ltr"
                  className="latin-input max-w-40"
                  type="number"
                  min={0}
                  step={1}
                  value={form.trafficPoolGB}
                  onChange={(e) => setForm({ ...form, trafficPoolGB: Number(e.target.value) })}
                />
                <div className="flex flex-wrap gap-1.5">
                  {[512, 1024, 2048, 4096].map((g) => (
                    <Button key={g} type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, trafficPoolGB: g })}>
                      {faNum(g)} گیگ
                    </Button>
                  ))}
                  <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, trafficPoolGB: 0 })}>
                    نامحدود
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {editing && editing.trafficPoolGB > 0 && (
                  <>تخصیص‌یافته فعلی به کاربران: {faNum(editing.allocatedGB)} گیگ — </>
                )}
                ۰ = نامحدود. مثال: با ۲۰۴۸ گیگ، نماینده می‌تواند ۲۰ کاربر ۱۰۰ گیگی یا ۱۰۰ کاربر ۲۰ گیگی بسازد.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
              <Label className="text-sm font-bold">دسترسی‌ها</Label>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">مولتی‌لوکیشن</div>
                  <div className="text-xs text-muted-foreground">نماینده بتواند برای یک کاربر چند اینباند (لوکیشن) انتخاب کند</div>
                </div>
                <Switch checked={form.multiLocation} onCheckedChange={(v) => setForm({ ...form, multiLocation: v })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">اجازه محدودیت دستگاه</div>
                  <div className="text-xs text-muted-foreground">نماینده بتواند تعداد دستگاه هر کاربر را تعیین کند</div>
                </div>
                <Switch checked={form.allowIpLimit} onCheckedChange={(v) => setForm({ ...form, allowIpLimit: v })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">وایت‌لیبل (برند و دامنه اختصاصی)</div>
                  <div className="text-xs text-muted-foreground">نماینده بتواند نام برند و دامنه خودش را برای سابسکریپشن ثبت کند</div>
                </div>
                <Switch checked={form.allowWhitelabel} onCheckedChange={(v) => setForm({ ...form, allowWhitelabel: v })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">حساب فعال</div>
                  <div className="text-xs text-muted-foreground">نماینده غیرفعال نتواند وارد شود</div>
                </div>
                <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>اینباندهای مجاز {form.multiLocation ? "(قابل انتخاب چندگانه)" : "(فقط یک اینباند برای هر کاربر)"}</Label>
              {!panelConnected && (
                <p className="text-xs tone-warn border rounded-md px-3 py-2">
                  پنل متصل نیست؛ لیست اینباندها از آخرین داده‌های ذخیره‌شده نمایش داده می‌شود. ابتدا اتصال پنل را تنظیم کنید.
                </p>
              )}
              {grouped.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  اینباندی یافت نشد. از تب «تنظیمات» پنل ثنایی را متصل کنید.
                </p>
              ) : (
                <ScrollArea className="h-52 rounded-xl border border-border p-3">
                  <div className="space-y-3">
                    {grouped.map((g) => (
                      <div key={g.panelId}>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--brand-deep)] mb-1.5">
                          <Server className="h-3.5 w-3.5" />
                          {g.panelName}
                          <span className="text-muted-foreground font-normal">({faNum(g.items.length)} اینباند)</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {g.items.map((i) => {
                            const checked = form.inbounds.some((x) => refKey(x) === refKey({ panelId: g.panelId, inboundId: i.inboundId }));
                            return (
                              <label
                                key={`${g.panelId}-${i.inboundId}`}
                                className={`flex items-center gap-2 rounded-lg border p-2 cursor-pointer transition-colors ${
                                  checked ? "border-[var(--brand)]/50 bg-[var(--brand-soft)]" : "border-border hover:bg-muted/60"
                                }`}
                              >
                                <Checkbox checked={checked} onCheckedChange={() => toggleInbound(g.panelId, i.inboundId)} />
                                <div className="min-w-0">
                                  <div className="text-sm truncate" dir="ltr">{i.remark || i.tag}</div>
                                  <div className="text-xs text-muted-foreground" dir="ltr">
                                    {i.protocol} : {i.port} · {faNum(i.clientsCount ?? 0)} کاربر
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>

          <DialogFooter className="flex-wrap gap-2">
            {editing && (
              <Button type="button" variant="outline" disabled={disabling2fa} title="اگر نماینده اپ Authenticator را از دست داده باشد" onClick={disableReseller2fa} className="me-auto hover:border-amber-300 hover:text-amber-600">
                <ShieldOff className="h-4 w-4" /> خاموشی 2FA نماینده
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialogOpen(false)}>انصراف</Button>
            <Button onClick={save} disabled={saving} className="brand-gradient text-white hover:opacity-90 font-bold">
              {saving && <Spinner className="h-4 w-4" />}
              {editing ? "ذخیره تغییرات" : "ایجاد نماینده"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تایید حذف */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف نماینده {deleting?.username}؟</AlertDialogTitle>
            <AlertDialogDescription>
              با حذف نماینده، دسترسی او قطع می‌شود. کاربران او در پنل ثنایی باقی می‌مانند اما دیگر از این پنل قابل مدیریت نیستند.
              این عمل قابل بازگشت نیست.
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
