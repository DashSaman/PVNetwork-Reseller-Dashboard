"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { api, StatCard, TrafficBar, ExpiryBadge, StatusBadge, Spinner, faDate, faNum, PvLogo } from "./shared";
import { ThemeToggle } from "./theme";
import type { InboundInfo, ResellerPermissions, ResellerUserRow, Session, InboundRefForm } from "./types";
import {
  Users,
  UserCheck,
  UserX,
  ArrowUpDown,
  LogOut,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  Copy,
  QrCode,
  RefreshCw,
  Info,
  Palette,
  Globe,
  Link2,
  BadgeCheck,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  Crown,
  Download,
  UserCircle,
  KeyRound,
  Send,
  Activity,
  Send as SendIcon2,
} from "lucide-react";
import QRCode from "react-qr-code";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number | string; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div dir="rtl" className="rounded-lg border border-border bg-popover/95 backdrop-blur px-3 py-2 shadow-lg text-xs space-y-1">
      {label !== undefined && <div className="font-bold text-foreground">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-bold">{typeof p.value === "number" ? faNum(Math.round(p.value * 100) / 100) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

type WhitelabelInfo = {
  allowWhitelabel: boolean;
  brandName: string | null;
  customDomain: string | null;
  domainVerified: boolean;
  verifyToken: string | null;
  subPort?: number;
  subHost?: string;
};

type UserLinkData = {
  email: string;
  subId: string | null;
  subLink: string | null;
  links: { protocol: string; port: number; uri: string; tag: string; panelName: string; remark: string }[];
  panelError?: string | null;
};

type UserAlert = { email: string; type: "usage" | "expiry"; pct?: number; days?: number };

export function ResellerView({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [tab, setTab] = useState<"users" | "stats" | "brand" | "account">("users");
  const [users, setUsers] = useState<ResellerUserRow[]>([]);
  const [alerts, setAlerts] = useState<UserAlert[]>([]);
  const [inbounds, setInbounds] = useState<InboundInfo[]>([]);
  const [permissions, setPermissions] = useState<ResellerPermissions | null>(null);
  const [whitelabel, setWhitelabel] = useState<WhitelabelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelError, setPanelError] = useState("");
  const [stats, setStats] = useState<Record<string, number | boolean> | null>(null);
  const [charts, setCharts] = useState<StatsCharts | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<{ users: ResellerUserRow[]; alerts?: UserAlert[] }>("/api/reseller/users");
    const i = await api<{ inbounds: InboundInfo[]; panelError: string | null; permissions: ResellerPermissions }>("/api/reseller/inbounds");
    const s = await api<{ stats: Record<string, number | boolean>; charts: StatsCharts }>("/api/reseller/stats");
    const w = await api<{ whitelabel: WhitelabelInfo }>("/api/reseller/whitelabel");
    setLoading(false);
    if (r.ok && r.data) {
      setUsers(r.data.users);
      setAlerts(r.data.alerts || []);
    } else if (!i.ok) setPanelError(r.error || "خطا در دریافت کاربران");
    else setUsers([]);
    if (i.ok && i.data) {
      setInbounds(i.data.inbounds);
      setPermissions(i.data.permissions);
      setPanelError(i.data.panelError || "");
    } else if (!i.ok && r.ok) {
      setPanelError("");
    }
    if (s.ok && s.data) {
      setStats(s.data.stats);
      setCharts(s.data.charts);
    }
    if (w.ok && w.data) setWhitelabel(w.data.whitelabel);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  const brandTitle = whitelabel?.brandName || "پنل نمایندگی";

  const tabs: { id: "users" | "stats" | "brand" | "account"; label: string; icon: React.ReactNode }[] = [
    { id: "users", label: "کاربران من", icon: <Users className="h-4 w-4" /> },
    { id: "stats", label: "آمار و مصرف", icon: <ArrowUpDown className="h-4 w-4" /> },
    { id: "brand", label: "برند و دامنه", icon: <Palette className="h-4 w-4" /> },
    { id: "account", label: "تنظیمات حساب", icon: <ShieldCheck className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <PvLogo size={38} />
            <div className="leading-tight">
              <div className="text-sm font-extrabold">{brandTitle}</div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                سامانه نمایندگی PvNetWork
                {whitelabel?.customDomain && whitelabel.domainVerified && (
                  <Badge variant="outline" className="ms-1 h-4 px-1 text-[9px] tone-ok">
                    <BadgeCheck className="h-3 w-3 me-0.5" /> وایت‌لیبل فعال
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-muted-foreground">
              <span dir="ltr" className="font-semibold">{session.username}</span>
            </span>
            <ThemeToggle />
            <Button size="sm" variant="outline" onClick={logout} className="hover:border-red-300 hover:text-red-500">
              <LogOut className="h-4 w-4" /> خروج
            </Button>
          </div>
        </div>
      </header>

      <nav className="border-b border-border/60 bg-background/60">
        <div className="mx-auto max-w-6xl px-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? "border-[var(--brand)] text-[var(--brand-deep)]"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
        {tab === "users" && permissions && <UsersTab users={users} inbounds={inbounds} permissions={permissions} loading={loading} panelError={panelError} reload={load} alerts={alerts} />}
        {tab === "stats" && permissions && <StatsTab stats={stats} charts={charts} />}
        {tab === "brand" && <BrandTab whitelabel={whitelabel} reload={load} />}
        {tab === "account" && <AccountSettingsTab username={session.username} />}
      </main>

      <footer className="border-t border-border/60 py-4 text-center text-xs text-muted-foreground mt-auto bg-background/50">
        {brandTitle} — سامانه نمایندگی PvNetWork
      </footer>
    </div>
  );
}

// ---------- نمودارها: آمار و مصرف ----------
type StatsCharts = {
  trafficByInbound: { tag: string; usedGB: number; totalGB: number }[];
  usersPerInbound: { tag: string; users: number }[];
  topUsers: { email: string; name: string | null; usedGB: number; totalGB: number }[];
  statusBreakdown: { name: string; value: number }[];
};

function StatsTab({ stats, charts }: { stats: Record<string, number | boolean> | null; charts: StatsCharts | null }) {
  if (!stats) return <div className="text-center py-16 text-muted-foreground">داده‌ای موجود نیست</div>;
  const statusData = charts?.statusBreakdown.filter((s) => s.value > 0) || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="کاربران من" value={faNum(Number(stats.usersCount || 0))} sub="بدون محدودیت تعداد" icon={<Users className="h-4 w-4" />} tone="brand" />
        <StatCard title="فعال" value={faNum(Number(stats.activeUsers || 0))} icon={<UserCheck className="h-4 w-4" />} tone="success" />
        <StatCard title="منقضی/پر" value={faNum(Number(stats.expiredUsers || 0))} icon={<UserX className="h-4 w-4" />} tone="danger" />
        <StatCard title="مصرف کل" value={`${faNum(Number(stats.totalUsedGB || 0))} گیگ`} sub={Number(stats.totalQuotaGB || 0) > 0 ? `از ${faNum(Math.round(Number(stats.totalQuotaGB)))} گیگ سهمیه` : undefined} icon={<ArrowUpDown className="h-4 w-4" />} tone="orange" />
      </div>

      {/* سرعت لحظه‌ای شبکه و منابع */}
      <LiveSpeedCard />

      {/* پول ترافیک */}
      <PoolCard pool={stats} />

      {/* نمودارها */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* وضعیت کاربران */}
        <Card className="bg-card card-soft lg:col-span-2">
          <CardContent className="p-5">
            <h3 className="font-bold text-sm flex items-center gap-2 mb-4">
              <UserCheck className="h-4 w-4 text-[var(--brand)]" />
              وضعیت کاربران
            </h3>
            {statusData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">هنوز کاربری ندارید</p>
            ) : (
              <div dir="ltr" className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={82} paddingAngle={3} strokeWidth={2} stroke="var(--card)">
                      {statusData.map((entry, i) => (
                        <Cell key={i} fill={entry.name === "فعال" ? "#0f9e99" : entry.name === "منقضی/پر" ? "#f37021" : "#94a3b8"} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 11, color: "var(--tick-text)" }}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* مصرف به تفکیک لوکیشن */}
        <Card className="bg-card card-soft lg:col-span-3">
          <CardContent className="p-5">
            <h3 className="font-bold text-sm flex items-center gap-2 mb-4">
              <Globe className="h-4 w-4 text-[var(--brand-orange)]" />
              مصرف ترافیک به تفکیک لوکیشن (گیگابایت)
            </h3>
            {(charts?.trafficByInbound.length || 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">داده مصرفی موجود نیست</p>
            ) : (
              <div dir="ltr" className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts!.trafficByInbound} margin={{ top: 5, right: 5, left: -14, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gUsage" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f37021" />
                        <stop offset="100%" stopColor="#0f9e99" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" vertical={false} />
                    <XAxis dataKey="tag" tick={{ fontSize: 10, fill: "var(--tick-text)" }} axisLine={false} tickLine={false} interval={0} angle={-10} height={44} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--tick-text)" }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15,158,153,0.06)" }} />
                    <Bar dataKey="usedGB" name="مصرف (گیگ)" fill="url(#gUsage)" radius={[6, 6, 0, 0]} maxBarSize={46} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* برترین مصرف‌کننده‌ها */}
        <Card className="bg-card card-soft lg:col-span-5">
          <CardContent className="p-5">
            <h3 className="font-bold text-sm flex items-center gap-2 mb-4">
              <Crown className="h-4 w-4 text-[var(--brand-orange)]" />
              برترین مصرف‌کننده‌ها
            </h3>
            {(charts?.topUsers.length || 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">هنوز مصرفی ثبت نشده است</p>
            ) : (
              <div className="space-y-3">
                {charts!.topUsers.map((u, i) => {
                  const max = charts!.topUsers[0]?.usedGB || 1;
                  const pct = Math.max(4, (u.usedGB / max) * 100);
                  return (
                    <div key={u.email} className="flex items-center gap-3">
                      <span className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center text-xs font-bold ${i === 0 ? "brand-gradient text-white" : "bg-muted text-muted-foreground"}`}>
                        {faNum(i + 1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-medium truncate" dir="ltr">{u.name || u.email}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap" dir="ltr">
                            {faNum(u.usedGB)} / {u.totalGB > 0 ? `${faNum(u.totalGB)} GB` : "∞"}
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden" dir="ltr">
                          <div className="h-full rounded-full bg-[linear-gradient(90deg,#0f9e99,#f37021)]" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* دسترسی‌ها */}
      <Card className="bg-card card-soft">
        <CardContent className="p-5 space-y-3 text-sm">
          <h3 className="font-bold flex items-center gap-2"><Info className="h-4 w-4 text-[var(--brand)]" /> دسترسی‌های حساب شما</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-muted-foreground">
            <div>مولتی‌لوکیشن: <Badge variant="outline" className="ms-1">{stats.multiLocation ? "دارد" : "ندارد"}</Badge></div>
            <div>اینباندهای مجاز: {faNum(Number(stats.inboundsCount))}</div>
            <div>پول ترافیک: {Number(stats.trafficPoolGB) > 0 ? `${faNum(Number(stats.trafficPoolGB))} گیگ` : "نامحدود"}</div>
            <div>تخصیص‌یافته: {faNum(Number(stats.allocatedGB || 0))} گیگ</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** نمایش پول ترافیک با نوار پیشرفت */
function PoolCard({ pool }: { pool: Record<string, number | boolean> }) {
  const total = Number(pool.trafficPoolGB || 0);
  const allocated = Number(pool.allocatedGB || 0);
  const used = Number(pool.totalUsedGB || 0);
  const remaining = Number(pool.remainingGB || 0);
  if (total <= 0) {
    return (
      <Card className="bg-card card-soft">
        <CardContent className="p-4 flex items-center gap-3">
          <Crown className="h-5 w-5 text-[var(--brand-orange)]" />
          <div>
            <div className="text-sm font-bold">پول ترافیک: نامحدود</div>
            <div className="text-xs text-muted-foreground">سهمیه هر کاربر را آزادانه تعیین کنید — تخصیص‌یافته: {faNum(allocated)} گیگ</div>
          </div>
        </CardContent>
      </Card>
    );
  }
  const allocPct = Math.min(100, (allocated / total) * 100);
  const usedPct = Math.min(100, (used / total) * 100);
  return (
    <Card className="bg-card card-soft">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-bold flex items-center gap-1.5"><Crown className="h-4 w-4 text-[var(--brand-orange)]" /> پول ترافیک شما</span>
          <span className="text-muted-foreground" dir="ltr">{faNum(allocated)} / {faNum(total)} GB تخصیص‌یافته</span>
        </div>
        <div className="relative h-3 w-full rounded-full bg-muted overflow-hidden" dir="ltr">
          <div className="h-full bg-[var(--brand)]/25" style={{ width: `${Math.max(2, allocPct)}%` }} />
          <div className="absolute top-0 h-full bg-[linear-gradient(90deg,#0f9e99,#f37021)]" style={{ width: `${Math.max(2, usedPct)}%` }} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>باقیمانده قابل تخصیص: <b className="text-foreground">{faNum(remaining)} گیگ</b></span>
          <span dir="ltr">{faNum(used)} GB مصرف واقعی</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- برند و دامنه (وایت‌لیبل) ----------
function BrandTab({ whitelabel, reload }: { whitelabel: WhitelabelInfo | null; reload: () => void }) {
  const [brandName, setBrandName] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (whitelabel && !loaded) {
      setBrandName(whitelabel.brandName || "");
      setCustomDomain(whitelabel.customDomain || "");
      setLoaded(true);
    }
  }, [whitelabel, loaded]);

  if (!whitelabel) {
    return <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> در حال بارگذاری...</div>;
  }

  if (!whitelabel.allowWhitelabel) {
    return (
      <Card className="bg-card card-soft">
        <CardContent className="py-16 text-center space-y-3">
          <Palette className="h-10 w-10 text-muted-foreground mx-auto" />
          <p className="font-bold">وایت‌لیبل برای حساب شما غیرفعال است</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            برای فعال‌سازی برند و دامنه اختصاصی با مدیر سامانه تماس بگیرید.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function save() {
    setSaving(true);
    const r = await api<{ ok: boolean }>("/api/reseller/whitelabel", {
      method: "PUT",
      body: JSON.stringify({ brandName, customDomain }),
    });
    setSaving(false);
    if (r.ok) {
      toast({ title: "موفق", description: "تنظیمات برند ذخیره شد" });
      reload();
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function verify() {
    setVerifying(true);
    setVerifyResult(null);
    const r = await api<{ ok: boolean; msg: string }>("/api/reseller/whitelabel", { method: "POST" });
    setVerifying(false);
    setVerifyResult({ ok: r.ok, msg: r.data?.msg || r.error || "" });
    if (r.ok) reload();
  }

  const txtHost = customDomain ? `_pvnet.${customDomain}` : "_pvnet.sub.your-domain.com";
  const token = whitelabel.verifyToken ? `pvnet-verify=${whitelabel.verifyToken}` : "pvnet-verify=...";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold flex items-center gap-2">
          <Palette className="h-5 w-5 text-[var(--brand)]" />
          برند و دامنه اختصاصی (وایت‌لیبل)
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          نام پنل خودتان را تعیین کنید و دامنه اختصاصی ثبت کنید تا لینک سابسکریپشن کاربران با دامنه خودتان باز شود.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* برند */}
        <Card className="bg-card card-soft">
          <CardContent className="p-5 space-y-4">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <Crown className="h-4 w-4 text-[var(--brand-orange)]" />
              نام برند پنل شما
            </h3>
            <div className="space-y-2">
              <Label>نام نمایشی (مثلاً: فروشگاه نت برتر)</Label>
              <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="فروشگاه نت برتر" maxLength={60} />
              <p className="text-xs text-muted-foreground">
                این نام در هدر پنل شما نمایش داده می‌شود. خالی بگذارید تا «پنل نمایندگی» بماند.
              </p>
            </div>
            {/* پیش‌نمایش هدر */}
            <div className="rounded-xl border border-border p-3 bg-muted/40">
              <div className="text-xs text-muted-foreground mb-2">پیش‌نمایش:</div>
              <div className="flex items-center gap-2.5 bg-card rounded-lg p-2.5 border border-border">
                <PvLogo size={30} />
                <div className="leading-tight">
                  <div className="text-xs font-bold">{brandName || "پنل نمایندگی"}</div>
                  <div className="text-[9px] text-muted-foreground flex items-center gap-1">
                    سامانه نمایندگی PvNetwork
                    {whitelabel.domainVerified && customDomain && <BadgeCheck className="h-3 w-3 text-emerald-500" />}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* دامنه */}
        <Card className="bg-card card-soft">
          <CardContent className="p-5 space-y-4">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <Globe className="h-4 w-4 text-[var(--brand)]" />
              دامنه اختصاصی سابسکریپشن
            </h3>
            <div className="space-y-2">
              <Label>دامنه (مثلاً: sub.myshop.ir)</Label>
              <Input dir="ltr" className="latin-input" value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} placeholder="sub.myshop.ir" />
              <div className="flex items-center gap-2 text-xs">
                وضعیت:
                {whitelabel.customDomain && whitelabel.domainVerified ? (
                  <Badge variant="outline" className="tone-ok">
                    <BadgeCheck className="h-3 w-3 me-1" /> تأییدشده
                  </Badge>
                ) : whitelabel.customDomain ? (
                  <Badge variant="outline" className="tone-warn">در انتظار تأیید</Badge>
                ) : (
                  <span className="text-muted-foreground">دامنه‌ای ثبت نشده</span>
                )}
              </div>
              {customDomain && (
                <div className="rounded-lg bg-[var(--brand-soft)] border border-[var(--brand)]/20 p-3 text-xs space-y-1.5">
                  <div className="font-bold text-[var(--brand-deep)]">لینک ساب کاربران شما به این شکل می‌شود:</div>
                  <code dir="ltr" className="block bg-muted rounded-md px-2 py-1.5 font-mono text-[10px] break-all border border-[var(--brand)]/20">
                    https://{customDomain}:{whitelabel.subPort || 2053}/sub/xxxxxxxx
                  </code>
                </div>
              )}
            </div>
            <Button onClick={save} disabled={saving} className="brand-gradient text-white hover:opacity-90 font-bold w-full">
              {saving && <Spinner className="h-4 w-4" />} ذخیره تنظیمات برند
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* تأیید دامنه */}
      {customDomain && (
        <Card className="bg-card card-soft">
          <CardContent className="p-5 space-y-4">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--brand-orange)]" />
              تأیید مالکیت دامنه
            </h3>
            <p className="text-sm text-muted-foreground">
              برای فعال شدن سابسکریپشن روی دامنه خودتان، یک رکورد TXT در DNS دامنه اضافه کنید. به پنل مدیریت دامنه‌تان (مثلاً Cloudflare) بروید و رکورد زیر را بسازید:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border border-border p-3">
                <div className="text-muted-foreground mb-1">نوع (Type)</div>
                <code dir="ltr" className="font-mono font-bold">TXT</code>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-muted-foreground mb-1">نام (Name)</div>
                <code dir="ltr" className="font-mono font-bold break-all">{txtHost}</code>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-muted-foreground mb-1">مقدار (Value)</div>
                <code dir="ltr" className="font-mono font-bold break-all">{token}</code>
              </div>
            </div>
            {verifyResult && (
              <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${verifyResult.ok ? "tone-ok" : "tone-danger"}`}>
                {verifyResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                <span>{verifyResult.msg}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={verify} disabled={verifying || !whitelabel.customDomain || whitelabel.domainVerified} variant="outline">
                {verifying ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                {whitelabel.domainVerified ? "دامنه تأیید شده است" : "بررسی و تأیید دامنه"}
              </Button>
                <div className="rounded-lg bg-[var(--brand-soft)] border border-[var(--brand)]/25 p-3 text-xs space-y-2">
                <div className="font-bold text-[var(--brand-deep)]">تنظیمات DNS لازم (هر ۳ مورد):</div>
                <ol className="list-decimal ps-4 space-y-1 text-muted-foreground">
                  <li>رکورد TXT زیر را در DNS دامنه بسازید (برای تأیید مالکیت).</li>
                  <li>
                    رکورد <b>A</b> برای <code dir="ltr" className="font-mono">{customDomain}</code> با آی‌پی سرور بسازید — دامنه باید به همین سرور اشاره کند.
                  </li>
                  <li>
                    در Cloudflare، پروکسی دامنه را <b>روشن (ابر نارنجی)</b> کنید و SSL/TLS mode را روی <b>Full</b> بگذارید تا گواهی معتبر برای دامنه شما سرو شود.
                  </li>
                </ol>
                <p className="text-muted-foreground">
                  نکته: پورت سابسکریپشن <code dir="ltr" className="font-mono">{whitelabel.subPort || 2053}</code> است (پورت ۴۴۳ سرور برای سرویس دیگری استفاده می‌شود).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------- کاربران ----------
type EditForm = {
  name: string;
  trafficGB: number;
  expiryDate: string;
  ipLimit: number;
  enable: boolean;
  inbounds: InboundRefForm[];
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

function UsersTab({
  users,
  inbounds,
  permissions,
  loading,
  panelError,
  reload,
  alerts,
}: {
  users: ResellerUserRow[];
  inbounds: InboundInfo[];
  permissions: ResellerPermissions;
  loading: boolean;
  panelError: string;
  reload: () => void;
  alerts: UserAlert[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ResellerUserRow | null>(null);
  const [deleting, setDeleting] = useState<ResellerUserRow | null>(null);
  const [linksUser, setLinksUser] = useState<{ email: string; name: string | null } | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [linkData, setLinkData] = useState<UserLinkData | null>(null);
  const [linksLoading, setLinksLoading] = useState(false);
  const [qrLink, setQrLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");

  // ---- مرتب‌سازی، صفحه‌بندی و خروجی CSV ----
  type SortKey = "email" | "traffic" | "expiry" | "enable";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
    setPage(1);
  }

  function exportCsv() {
    const header = ["کاربر", "شناسه", "لوکیشن‌ها", "مصرف (GB)", "سهمیه (GB)", "درصد مصرف", "انقضا", "وضعیت", "آنلاین", "لینک ساب"];
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = sorted.map((u) => {
      const pct = u.totalGB > 0 ? Math.round((u.usedGB / u.totalGB) * 100) : 0;
      const exp = u.expiryTime > 0 ? new Date(u.expiryTime).toISOString().slice(0, 10) : "نامحدود";
      return [
        esc(u.name || ""), esc(u.email), esc(u.inboundTags.join(" + ")),
        esc(Math.round(u.usedGB * 100) / 100), esc(u.totalGB > 0 ? u.totalGB : "نامحدود"),
        esc(u.totalGB > 0 ? `${pct}%` : "-"), esc(exp),
        esc(u.enable ? "فعال" : "غیرفعال"), esc(onlineSet.has(u.email) ? "آنلاین" : "آفلاین"),
        esc(u.subLink || ""),
      ].join(",");
    });
    const csv = "\uFEFF" + [header.map(esc).join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ title: "خروجی CSV", description: `${faNum(sorted.length)} کاربر دانلود شد` });
  }

  // آنلاین‌ها، ساخت گروهی و IPهای کاربر
  const [onlineSet, setOnlineSet] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(1); // ۱ = تک‌کاربره؛ بیشتر = ساخت گروهی
  const [bulkResult, setBulkResult] = useState<{ created: { email: string; subLink: string | null }[]; failed: { name: string; error: string }[] } | null>(null);
  const [ipsUser, setIpsUser] = useState<{ email: string; name: string | null } | null>(null);
  const [ipsList, setIpsList] = useState<string[] | null>(null);

  // فرم ساخت کاربر
  const [name, setName] = useState("");
  const poolLimited = permissions.trafficPoolGB > 0;
  const [trafficGB, setTrafficGB] = useState(() => {
    if (poolLimited) return Math.max(1, Math.min(20, permissions.remainingGB));
    return 20;
  });
  const [expiryDate, setExpiryDate] = useState("");
  const [ipLimit, setIpLimit] = useState(permissions.allowIpLimit ? 2 : 0);
  const [selectedInbounds, setSelectedInbounds] = useState<InboundRefForm[]>([]);

  // فرم ویرایش
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  useEffect(() => {
    if (createOpen && selectedInbounds.length === 0 && inbounds.length > 0) {
      setSelectedInbounds([{ panelId: inbounds[0].panelId, inboundId: inbounds[0].inboundId }]);
    }
  }, [createOpen, inbounds, selectedInbounds]);

  // نظرسنجی لحظه‌ای کاربران آنلاین (هر ۳۰ ثانیه)
  useEffect(() => {
    let alive = true;
    async function poll() {
      const r = await api<{ online: string[]; onlineCount: number }>("/api/reseller/online");
      if (alive && r.ok && r.data) setOnlineSet(new Set(r.data.online || []));
    }
    void poll();
    const t = setInterval(poll, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  function openEdit(u: ResellerUserRow) {
    // یافتن refs فعلی کاربر بر اساس تگ‌های اینباند و پنل‌ها
    const currentRefs: InboundRefForm[] = [];
    for (const tag of u.inboundTags) {
      const clean = tag.includes(" · ") ? tag.split(" · ")[1] : tag;
      const inb = inbounds.find((i) => (i.remark || i.tag) === clean || i.tag === clean);
      if (inb) currentRefs.push({ panelId: inb.panelId, inboundId: inb.inboundId });
    }
    setEditing(u);
    setEditForm({
      name: u.name || u.email.split("-")[0],
      trafficGB: u.trafficGB || u.totalGB,
      expiryDate: u.expiryTime > 0 ? new Date(u.expiryTime).toISOString().slice(0, 10) : "",
      ipLimit: 0,
      enable: u.enable,
      inbounds: currentRefs,
    });
  }

  async function createUser() {
    if (!name.trim()) {
      toast({ title: "خطا", description: "نام کاربر را وارد کنید", variant: "destructive" });
      return;
    }
    if (selectedInbounds.length === 0) {
      toast({ title: "خطا", description: "حداقل یک اینباند (لوکیشن) انتخاب کنید", variant: "destructive" });
      return;
    }
    if (poolLimited && trafficGB <= 0) {
      toast({ title: "خطا", description: "پول ترافیک شما محدود است — سهمیه کاربر باید عددی مثبت باشد", variant: "destructive" });
      return;
    }
    if (poolLimited && trafficGB > permissions.remainingGB) {
      toast({ title: "خطا", description: `باقیمانده پول شما ${faNum(permissions.remainingGB)} گیگ است`, variant: "destructive" });
      return;
    }
    // ---- ساخت گروهی (تعداد > ۱) ----
    if (count > 1) {
      setBusy(true);
      const rb = await api<{
        createdCount: number;
        failedCount: number;
        created: { email: string; subLink: string | null }[];
        failed: { name: string; error: string }[];
      }>("/api/reseller/users/bulk", {
        method: "POST",
        body: JSON.stringify({ prefix: name, count, trafficGB, expiryDate, ipLimit, inbounds: selectedInbounds }),
      });
      setBusy(false);
      if (rb.ok && rb.data) {
        toast({
          title: "ساخت گروهی انجام شد",
          description: `${faNum(rb.data.createdCount)} کاربر ساخته شد${rb.data.failedCount ? ` — ${faNum(rb.data.failedCount)} ناموفق` : ""}`,
        });
        setCreateOpen(false);
        setBulkResult({ created: rb.data.created || [], failed: rb.data.failed || [] });
        setName("");
        setExpiryDate("");
        setSelectedInbounds([]);
        reload();
      } else {
        toast({ title: "خطا", description: rb.error, variant: "destructive" });
      }
      return;
    }
    setBusy(true);
    const r = await api<{ ok: boolean; email: string; subLink: string | null }>("/api/reseller/users", {
      method: "POST",
      body: JSON.stringify({ name, trafficGB, expiryDate, ipLimit, inbounds: selectedInbounds }),
    });
    setBusy(false);
    if (r.ok && r.data) {
      toast({
        title: "کاربر ساخته شد",
        description: r.data.subLink ? "لینک سابسکریپشن آماده است" : `شناسه کاربر: ${r.data.email}`,
      });
      setCreateOpen(false);
      setName("");
      setExpiryDate("");
      setSelectedInbounds([]);
      reload();
      // باز کردن خودکار پنجره لینک‌ها برای کاربر تازه‌ساخته
      void openLinks(r.data.email, name);
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function saveEdit() {
    if (!editing || !editForm) return;
    setBusy(true);
    const r = await api<{ ok: boolean }>(`/api/reseller/users/${encodeURIComponent(editing.email)}`, {
      method: "PUT",
      body: JSON.stringify(editForm),
    });
    setBusy(false);
    if (r.ok) {
      toast({ title: "موفق", description: "کاربر ویرایش شد" });
      setEditing(null);
      setEditForm(null);
      reload();
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const r = await api(`/api/reseller/users/${encodeURIComponent(deleting.email)}`, { method: "DELETE" });
    if (r.ok) {
      toast({ title: "موفق", description: "کاربر حذف شد" });
      reload();
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
    setDeleting(null);
  }

  async function resetTraffic(u: ResellerUserRow) {
    const r = await api(`/api/reseller/users/${encodeURIComponent(u.email)}/reset-traffic`, { method: "POST" });
    if (r.ok) {
      toast({ title: "موفق", description: "ترافیک کاربر ریست شد" });
      reload();
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function toggleEnable(u: ResellerUserRow) {
    const r = await api(`/api/reseller/users/${encodeURIComponent(u.email)}`, {
      method: "PUT",
      body: JSON.stringify({ enable: !u.enable }),
    });
    if (r.ok) {
      toast({ title: "موفق", description: !u.enable ? "کاربر فعال شد" : "کاربر غیرفعال شد" });
      reload();
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  function copyLink(link: string) {
    copyText(link, "لینک سابسکریپشن");
  }

  function copyText(text: string, label = "لینک") {
    navigator.clipboard.writeText(text).then(
      () => toast({ title: "کپی شد", description: `${label} کپی شد` }),
      () => toast({ title: "خطا", description: "کپی ناموفق بود", variant: "destructive" })
    );
  }

  /** دریافت لینک‌های اتصال (ساب + لینک‌های V2Ray) یک کاربر */
  async function openLinks(email: string, displayName?: string | null) {
    setLinksUser({ email, name: displayName ?? null });
    setLinkData(null);
    setQrLink(null);
    setLinksLoading(true);
    const r = await api<UserLinkData>(`/api/reseller/users/${encodeURIComponent(email)}/links`);
    setLinksLoading(false);
    if (r.ok && r.data) {
      setLinkData(r.data);
    } else {
      toast({ title: "خطا", description: r.error || "دریافت لینک‌ها ناموفق بود", variant: "destructive" });
    }
  }

  /** دوباره‌سازی لینک اشتراک — subId جدید (وقتی لینک قبلی لو رفته) */
  async function regenSub() {
    if (!linksUser || regenLoading) return;
    if (!confirm("لینک قبلی باطل می‌شود و لینک جدید ساخته می‌شود. مطمئن هستید؟")) return;
    setRegenLoading(true);
    const r = await api<{ ok: boolean; subId: string; subLink: string | null }>(
      `/api/reseller/users/${encodeURIComponent(linksUser.email)}/reset-sub`,
      { method: "POST" }
    );
    setRegenLoading(false);
    if (r.ok && r.data?.ok) {
      toast({ title: "انجام شد", description: "لینک اشتراک جدید ساخته شد — لینک قبلی دیگر کار نمی‌کند." });
      // بازخوانی لینک‌ها با subId جدید
      setLinksLoading(true);
      const lr = await api<UserLinkData>(`/api/reseller/users/${encodeURIComponent(linksUser.email)}/links`);
      setLinksLoading(false);
      if (lr.ok && lr.data) setLinkData(lr.data);
      reload(); // بازخوانی لیست کاربران با subId جدید
    } else {
      toast({ title: "خطا", description: r.error || "دوباره‌سازی لینک ناموفق بود", variant: "destructive" });
    }
  }

  /** دریافت IPهای ثبت‌شده/متصل یک کاربر */
  async function openIps(email: string, displayName?: string | null) {
    setIpsUser({ email, name: displayName ?? null });
    setIpsList(null);
    const r = await api<{ ips: string[] }>(`/api/reseller/users/${encodeURIComponent(email)}/ips`);
    if (r.ok && r.data) {
      setIpsList(r.data.ips || []);
    } else {
      setIpsUser(null);
      toast({ title: "خطا", description: r.error || "دریافت IPها ناموفق بود", variant: "destructive" });
    }
  }

  function toggleInboundSelection(panelId: string, inboundId: number) {
    const key = refKey({ panelId, inboundId });
    if (!permissions.multiLocation) {
      setSelectedInbounds([{ panelId, inboundId }]);
      return;
    }
    setSelectedInbounds((s) =>
      s.some((x) => refKey(x) === key) ? s.filter((x) => refKey(x) !== key) : [...s, { panelId, inboundId }]
    );
  }

  const filtered = users.filter(
    (u) =>
      !search ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name || "").toLowerCase().includes(search.toLowerCase())
  );

  // مرتب‌سازی
  const sorted = [...filtered].sort((a, b) => {
    if (!sortKey) return 0;
    let cmp = 0;
    if (sortKey === "email") cmp = (a.name || a.email).localeCompare(b.name || b.email);
    else if (sortKey === "traffic") cmp = a.usedGB / (a.totalGB || Infinity) - b.usedGB / (b.totalGB || Infinity);
    else if (sortKey === "expiry") cmp = (a.expiryTime || Infinity) - (b.expiryTime || Infinity);
    else if (sortKey === "enable") cmp = Number(a.enable) - Number(b.enable);
    return sortDir === "asc" ? cmp : -cmp;
  });

  // صفحه‌بندی
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // نقشه هشدار هر کاربر
  const alertMap = new Map<string, UserAlert[]>();
  for (const a of alerts) {
    const arr = alertMap.get(a.email) || [];
    arr.push(a);
    alertMap.set(a.email, arr);
  }

  const SortIcon = ({ k }: { k: SortKey }) => (
    <ArrowUpDown className={`h-3 w-3 inline-block ms-0.5 ${sortKey === k ? "text-[var(--brand)]" : "text-muted-foreground/40"}`} />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-extrabold">کاربران من</h2>
          <Badge variant="outline" className="bg-[var(--brand-soft)] text-[var(--brand-deep)] border-[var(--brand)]/30">
            {faNum(users.length)} کاربر
          </Badge>
          <Badge variant="outline" className="border-green-500/40 text-green-600 dark:text-green-400 text-xs">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse ml-1" />
            {faNum(onlineSet.size)} آنلاین
          </Badge>
          {permissions.trafficPoolGB > 0 && (
            <Badge variant="outline" className="border-[var(--brand)]/40 text-[var(--brand-deep)] text-xs">
              باقیمانده پول: {faNum(permissions.remainingGB)} گیگ
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="جستجو..."
            className="w-36 sm:w-52"
          />
          <Button variant="outline" onClick={exportCsv} disabled={sorted.length === 0} title="دانلود خروجی CSV">
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">CSV</span>
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="brand-gradient text-white hover:opacity-90 font-bold">
            <Plus className="h-4 w-4" /> کاربر جدید
          </Button>
        </div>
      </div>

      {panelError && (
        <p className="text-sm tone-danger border rounded-md px-3 py-2">{panelError}</p>
      )}

      <Card className="bg-card card-soft">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" /> در حال دریافت اطلاعات...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              {users.length === 0 ? "هنوز کاربری نساخته‌اید. با دکمه «کاربر جدید» شروع کنید." : "نتیجه‌ای برای جستجو پیدا نشد."}
            </div>
          ) : (
            <div className="max-h-[68vh] overflow-auto">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <button type="button" className="font-semibold inline-flex items-center" onClick={() => toggleSort("email")}>
                        کاربر <SortIcon k="email" />
                      </button>
                    </TableHead>
                    <TableHead>لوکیشن‌ها</TableHead>
                    <TableHead>
                      <button type="button" className="font-semibold inline-flex items-center" onClick={() => toggleSort("traffic")}>
                        ترافیک <SortIcon k="traffic" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button type="button" className="font-semibold inline-flex items-center" onClick={() => toggleSort("expiry")}>
                        انقضا <SortIcon k="expiry" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button type="button" className="font-semibold inline-flex items-center" onClick={() => toggleSort("enable")}>
                        وضعیت <SortIcon k="enable" />
                      </button>
                    </TableHead>
                    <TableHead className="text-left">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((u) => (
                    <TableRow key={u.email}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            title={onlineSet.has(u.email) ? "آنلاین — دیدن IPها" : "آفلاین — دیدن IPها"}
                            onClick={() => openIps(u.email, u.name)}
                            className="shrink-0 cursor-pointer"
                          >
                            <span
                              className={`inline-block h-2.5 w-2.5 rounded-full ${
                                onlineSet.has(u.email) ? "bg-green-500 animate-pulse" : "bg-muted-foreground/30"
                              }`}
                            />
                          </button>
                          <div>
                            <div className="font-semibold flex items-center gap-1" dir="ltr">
                              {u.name || u.email}
                              {alertMap.get(u.email)?.some((a) => a.type === "usage") && (
                                <span
                                  className="inline-flex items-center h-4 px-1 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-bold"
                                  title={`مصرف ${faNum(alertMap.get(u.email)!.find((a) => a.type === "usage")!.pct || 100)}٪ — اعلان تلگرام ارسال شد`}
                                >
                                  {faNum(alertMap.get(u.email)!.find((a) => a.type === "usage")!.pct || 100)}٪+
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground" dir="ltr">{u.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-40">
                          {u.inboundTags.slice(0, 3).map((t, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs" dir="ltr">{t}</Badge>
                          ))}
                          {u.inboundTags.length > 3 && <Badge variant="secondary" className="text-xs">+{faNum(u.inboundTags.length - 3)}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell><TrafficBar used={u.usedGB} total={u.totalGB} /></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <ExpiryBadge expiryTime={u.expiryTime} />
                          {alertMap.get(u.email)?.some((a) => a.type === "expiry") && (
                            <span
                              className="inline-flex items-center h-4 px-1 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-bold"
                              title="انقضای نزدیک — اعلان تلگرام ارسال شد"
                            >
                              نزدیک
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell><StatusBadge active={u.enable} /></TableCell>
                      <TableCell className="text-left">
                        <div className="flex items-center gap-0.5 justify-start" dir="ltr">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="لینک‌ها و QR کاربر"
                            className="text-[var(--brand)] hover:text-[var(--brand-deep)]"
                            onClick={() => openLinks(u.email, u.name)}
                          >
                            <Link2 className="h-4 w-4" />
                          </Button>
                          {u.subLink && (
                            <Button size="icon" variant="ghost" title="کپی لینک ساب" onClick={() => copyLink(u.subLink!)}>
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" title="ریست ترافیک" onClick={() => resetTraffic(u)}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" title={u.enable ? "غیرفعال‌سازی" : "فعال‌سازی"} onClick={() => toggleEnable(u)}>
                            <UserX className={`h-4 w-4 ${u.enable ? "" : "text-[var(--brand)]"}`} />
                          </Button>
                          <Button size="icon" variant="ghost" title="ویرایش" onClick={() => openEdit(u)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" title="حذف" onClick={() => setDeleting(u)}>
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {/* صفحه‌بندی */}
          {!loading && sorted.length > 0 && (
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border/60 text-sm">
              <span className="text-xs text-muted-foreground">
                {faNum(sorted.length)} کاربر — صفحه {faNum(safePage)} از {faNum(totalPages)}
              </span>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>قبلی</Button>
                <Button size="sm" variant="outline" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>بعدی</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* دیالوگ ساخت کاربر */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ساخت کاربر جدید</DialogTitle>
            <DialogDescription>
              {permissions.multiLocation
                ? "حساب شما مولتی‌لوکیشن دارد — می‌توانید چند لوکیشن برای یک کاربر انتخاب کنید."
                : "حساب شما تک‌لوکیشن است — برای هر کاربر یک لوکیشن انتخاب کنید."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {/* پول ترافیک */}
            {poolLimited ? (
              <div className="rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-soft)] px-3 py-2.5 text-sm flex items-center justify-between">
                <span className="font-medium">باقیمانده پول ترافیک شما:</span>
                <span className="font-bold text-[var(--brand-deep)]" dir="ltr">{faNum(permissions.remainingGB)} / {faNum(permissions.trafficPoolGB)} GB</span>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                پول ترافیک شما نامحدود است — هر سهمیه‌ای بخواهید بدهید.
              </div>
            )}
            <div className="space-y-2">
              <Label>تعداد — بیشتر از ۱ یعنی ساخت گروهی (تا ۵۰)</Label>
              <Input
                dir="ltr"
                className="latin-input"
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
              />
              {count > 1 && (
                <p className="text-xs text-muted-foreground" dir="ltr">
                  {name || "shop"}01 … {name || "shop"}{faNum(count)} — شماره خودکار اضافه می‌شود
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{count > 1 ? "پیشوند نام کاربرها (حروف انگلیسی)" : "نام کاربر (حروف انگلیسی، عدد، - و _)"}</Label>
              <Input
                dir="ltr"
                className="latin-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ali-Shop"
              />
              <p className="text-xs text-muted-foreground">حروف بزرگ و کوچک انگلیسی، عدد، خط تیره و آندرلاین مجاز است</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>سهمیه ترافیک (گیگ) {poolLimited ? "— الزامی" : "— ۰ = نامحدود"}</Label>
                <Input
                  dir="ltr"
                  className="latin-input"
                  type="number"
                  min={poolLimited ? 1 : 0}
                  max={poolLimited ? permissions.remainingGB : undefined}
                  value={trafficGB}
                  onChange={(e) => setTrafficGB(Number(e.target.value))}
                />
                {poolLimited && (
                  <div className="flex flex-wrap gap-1.5">
                    {[5, 10, 20, 50, 100]
                      .filter((g) => g <= permissions.remainingGB)
                      .map((g) => (
                        <Button key={g} type="button" size="sm" variant="outline" onClick={() => setTrafficGB(g)}>
                          {faNum(g)} گیگ
                        </Button>
                      ))}
                  </div>
                )}
              </div>
              {permissions.allowIpLimit && (
                <div className="space-y-2">
                  <Label>تعداد دستگاه — ۰ = نامحدود</Label>
                  <Input dir="ltr" className="latin-input" type="number" min={0} value={ipLimit} onChange={(e) => setIpLimit(Number(e.target.value))} />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>تاریخ انقضا</Label>
              <Input dir="ltr" className="latin-input" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              <p className="text-xs text-muted-foreground">خالی = نامحدود</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { d: 30, l: "۱ ماه" },
                  { d: 60, l: "۲ ماه" },
                  { d: 90, l: "۳ ماه" },
                  { d: 180, l: "۶ ماه" },
                ].map((p) => (
                  <Button
                    key={p.d}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setExpiryDate(new Date(Date.now() + p.d * 86400000).toISOString().slice(0, 10))}
                  >
                    {p.l}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>اینباندها (لوکیشن‌ها) {permissions.multiLocation ? "— چندگانه" : ""}</Label>
              {inbounds.length === 0 ? (
                <p className="text-sm text-muted-foreground">اینباندی برای شما تعریف نشده — با مدیر تماس بگیرید.</p>
              ) : (
                <div className="space-y-3 max-h-52 overflow-y-auto rounded-xl border border-border p-2.5">
                  {groupByPanel(inbounds).map((g) => (
                    <div key={g.panelId}>
                      <div className="text-[11px] font-bold text-[var(--brand-deep)] mb-1.5">{g.panelName}</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {g.items.map((i) => {
                          const selected = selectedInbounds.some((x) => refKey(x) === refKey({ panelId: g.panelId, inboundId: i.inboundId }));
                          return (
                            <button
                              key={`${g.panelId}-${i.inboundId}`}
                              type="button"
                              disabled={i.unavailable}
                              onClick={() => toggleInboundSelection(g.panelId, i.inboundId)}
                              className={`rounded-lg border p-2 text-right transition-colors disabled:opacity-40 ${
                                selected
                                  ? "border-[var(--brand)]/50 bg-[var(--brand-soft)]"
                                  : "border-border hover:bg-muted/60"
                              }`}
                            >
                              <div className="text-sm truncate" dir="ltr">{i.remark || i.tag}</div>
                              <div className="text-xs text-muted-foreground" dir="ltr">{i.protocol} : {i.port}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>انصراف</Button>
            <Button onClick={createUser} disabled={busy} className="brand-gradient text-white hover:opacity-90 font-bold">
              {busy && <Spinner className="h-4 w-4" />} {count > 1 ? `ساخت ${faNum(count)} کاربر` : "ساخت کاربر"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نتیجه ساخت گروهی */}
      <Dialog open={!!bulkResult} onOpenChange={(o) => !o && setBulkResult(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>نتیجه ساخت گروهی</DialogTitle>
            <DialogDescription>
              {bulkResult &&
                `${faNum(bulkResult.created.length)} کاربر ساخته شد${bulkResult.failed.length ? ` — ${faNum(bulkResult.failed.length)} ناموفق` : ""}`}
            </DialogDescription>
          </DialogHeader>
          {bulkResult && (
            <div className="space-y-3 py-1">
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const all = bulkResult.created.map((c) => c.subLink).filter(Boolean).join("\n");
                    if (all) copyText(all, "همه لینک‌های ساب");
                  }}
                >
                  <Copy className="h-4 w-4" /> کپی همه لینک‌های ساب
                </Button>
              </div>
              <div className="rounded-xl border border-border max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>کاربر</TableHead>
                      <TableHead className="text-left">لینک ساب</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bulkResult.created.map((c) => (
                      <TableRow key={c.email}>
                        <TableCell className="text-xs" dir="ltr">{c.email}</TableCell>
                        <TableCell className="text-left">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="کپی لینک ساب"
                            onClick={() => c.subLink && copyText(c.subLink, "لینک ساب")}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {bulkResult.failed.map((f) => (
                      <TableRow key={f.name}>
                        <TableCell className="text-xs text-red-400" dir="ltr">{f.name}</TableCell>
                        <TableCell className="text-xs text-red-400 text-left" dir="rtl">{f.error}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkResult(null)}>بستن</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* دیالوگ IPهای کاربر */}
      <Dialog open={!!ipsUser} onOpenChange={(o) => !o && setIpsUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>IPهای کاربر: {ipsUser?.name || ipsUser?.email}</DialogTitle>
            <DialogDescription dir="ltr">{ipsUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {ipsList === null ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin" /> در حال دریافت...
              </div>
            ) : ipsList.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                هنوز IPای برای این کاربر ثبت نشده — وقتی دستگاهی متصل شود اینجا نمایش داده می‌شود.
              </p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{faNum(ipsList.length)} IP ثبت‌شده:</p>
                {ipsList.map((ip) => (
                  <div key={ip} className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5">
                    <span className="text-sm font-medium" dir="ltr">{ip}</span>
                    <Button size="icon" variant="ghost" onClick={() => copyText(ip, "IP")}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIpsUser(null)}>بستن</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* دیالوگ ویرایش */}
      <Dialog open={!!editing && !!editForm} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ویرایش کاربر: {editing?.name || editing?.email}</DialogTitle>
            <DialogDescription dir="ltr">{editing?.email}</DialogDescription>
          </DialogHeader>
          {editForm && (
            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label>نام/یادداشت</Label>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>سهمیه ترافیک (گیگ) {poolLimited ? "— الزامی" : "— ۰ = نامحدود"}</Label>
                  <Input
                    dir="ltr"
                    className="latin-input"
                    type="number"
                    min={poolLimited ? 1 : 0}
                    value={editForm.trafficGB}
                    onChange={(e) => setEditForm({ ...editForm, trafficGB: Number(e.target.value) })}
                  />
                  {poolLimited && (
                    <p className="text-xs text-muted-foreground">
                      سهمیه فعلی این کاربر: {faNum(editing?.trafficGB || 0)} گیگ — باقیمانده پول بدون این کاربر: {faNum(Math.max(0, permissions.remainingGB + (editing?.trafficGB || 0)))} گیگ
                    </p>
                  )}
                </div>
                {permissions.allowIpLimit && (
                  <div className="space-y-2">
                    <Label>تعداد دستگاه (۰ = بدون تغییر)</Label>
                    <Input
                      dir="ltr"
                      className="latin-input"
                      type="number"
                      min={0}
                      value={editForm.ipLimit}
                      onChange={(e) => setEditForm({ ...editForm, ipLimit: Number(e.target.value) })}
                    />
                    <p className="text-xs text-muted-foreground">در ویرایش، مقدار ۰ یعنی بدون محدودیت</p>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>تاریخ انقضا</Label>
                <Input dir="ltr" className="latin-input" type="date" value={editForm.expiryDate} onChange={(e) => setEditForm({ ...editForm, expiryDate: e.target.value })} />
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { d: 30, l: "۱ ماه" },
                    { d: 60, l: "۲ ماه" },
                    { d: 90, l: "۳ ماه" },
                  ].map((p) => (
                    <Button key={p.d} type="button" size="sm" variant="outline" onClick={() => setEditForm({ ...editForm, expiryDate: new Date(Date.now() + p.d * 86400000).toISOString().slice(0, 10) })}>
                      {p.l}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
                <Label>فعال بودن کاربر</Label>
                <Switch checked={editForm.enable} onCheckedChange={(v) => setEditForm({ ...editForm, enable: v })} />
              </div>
              <div className="space-y-2">
                <Label>لوکیشن‌ها {permissions.multiLocation ? "(چندگانه — حتی بین پنل‌ها)" : "(تکی)"}</Label>
                <div className="space-y-2.5 max-h-44 overflow-y-auto rounded-xl border border-border p-2.5">
                  {groupByPanel(inbounds).map((g) => (
                    <div key={g.panelId}>
                      <div className="text-[11px] font-bold text-[var(--brand-deep)] mb-1">{g.panelName}</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {g.items.map((i) => {
                          const selected = editForm.inbounds.some((x) => refKey(x) === refKey({ panelId: g.panelId, inboundId: i.inboundId }));
                          return (
                            <button
                              key={`${g.panelId}-${i.inboundId}`}
                              type="button"
                              disabled={i.unavailable}
                              onClick={() => {
                                const k = refKey({ panelId: g.panelId, inboundId: i.inboundId });
                                if (!permissions.multiLocation) {
                                  setEditForm({ ...editForm, inbounds: [{ panelId: g.panelId, inboundId: i.inboundId }] });
                                  return;
                                }
                                setEditForm({
                                  ...editForm,
                                  inbounds: editForm.inbounds.some((x) => refKey(x) === k)
                                    ? editForm.inbounds.filter((x) => refKey(x) !== k)
                                    : [...editForm.inbounds, { panelId: g.panelId, inboundId: i.inboundId }],
                                });
                              }}
                              className={`rounded-lg border p-2 text-right transition-colors disabled:opacity-40 ${
                                selected
                                  ? "border-[var(--brand)]/50 bg-[var(--brand-soft)]"
                                  : "border-border hover:bg-muted/60"
                              }`}
                            >
                              <div className="text-sm truncate" dir="ltr">{i.remark || i.tag}</div>
                              <div className="text-xs text-muted-foreground" dir="ltr">{i.protocol} : {i.port}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>انصراف</Button>
            <Button onClick={saveEdit} disabled={busy} className="brand-gradient text-white hover:opacity-90 font-bold">
              {busy && <Spinner className="h-4 w-4" />} ذخیره
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* لینک‌های کاربر (ساب + لینک‌های V2Ray) */}
      <Dialog
        open={!!linksUser}
        onOpenChange={(o) => {
          if (!o) {
            setLinksUser(null);
            setLinkData(null);
            setQrLink(null);
          }
        }}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>لینک‌های کاربر: {linksUser?.name || linksUser?.email}</DialogTitle>
            <DialogDescription dir="ltr" className="break-all">{linksUser?.email}</DialogDescription>
          </DialogHeader>
          {linksLoading ? (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : linkData ? (
            <div className="space-y-4">
              {/* لینک سابسکریپشن */}
              {linkData.subLink ? (
                <div className="space-y-2">
                  <div className="text-sm font-bold flex items-center gap-1.5">
                    <Link2 className="h-4 w-4 text-[var(--brand)]" /> لینک سابسکریپشن
                  </div>
                  <code dir="ltr" className="block bg-muted rounded-lg px-2.5 py-2 font-mono text-[10px] break-all border border-border">
                    {linkData.subLink}
                  </code>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => copyText(linkData.subLink!, "لینک ساب")}>
                      <Copy className="h-3.5 w-3.5" /> کپی
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setQrLink(qrLink === linkData.subLink ? null : linkData.subLink!)}>
                      <QrCode className="h-3.5 w-3.5" /> QR
                    </Button>
                    {linkData.subId && (
                      <Button size="sm" variant="outline" title="صفحه اختصاصی کاربر — آمار و QR و دانلود اپ" onClick={() => window.open(`/s/${linkData.subId}`, "_blank")}>
                        <UserCircle className="h-3.5 w-3.5" /> صفحه کاربر
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="tone-warn"
                      title="لینک قبلی باطل و لینک جدید ساخته می‌شود — برای وقتی لینک لو رفته"
                      disabled={regenLoading}
                      onClick={regenSub}
                    >
                      {regenLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} لینک جدید
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-5">
                    این لینک را در اپ کاربر (V2RayNG / v2box / Streisand) وارد کنید — همه لوکیشن‌ها خودکار اضافه می‌شوند و به‌روزرسانی هم خودکار است.
                  </p>
                  {qrLink === linkData.subLink && (
                    <div className="flex justify-center p-3 bg-card rounded-xl border border-border">
                      <QRCode value={linkData.subLink} size={192} />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs tone-warn rounded-lg border border-border px-3 py-2">
                  لینک ساب در دسترس نیست — از لینک‌های اتصال مستقیم زیر استفاده کنید.
                </p>
              )}

              {/* لینک‌های اتصال مستقیم */}
              <div className="space-y-2">
                <div className="text-sm font-bold flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <Globe className="h-4 w-4 text-[var(--brand-orange)]" /> لینک‌های اتصال (V2Ray)
                  </span>
                  {linkData.links.length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => copyText(linkData.links.map((l) => l.uri).join("\n"), "همه لینک‌ها")}>
                      <Copy className="h-3.5 w-3.5" /> کپی همه
                    </Button>
                  )}
                </div>
                {linkData.links.length === 0 ? (
                  <p className="text-xs text-muted-foreground rounded-lg border border-border p-3">
                    لینکی برای این کاربر یافت نشد — اگر تازه ساخته شده چند لحظه بعد دوباره باز کنید.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {linkData.links.map((l, i) => (
                      <div key={i} className="rounded-xl border border-border p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Badge variant="secondary" className="text-[10px]" dir="ltr">{l.protocol}</Badge>
                            <span className="text-xs font-semibold truncate" dir="ltr">{l.remark}</span>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="کپی لینک" onClick={() => copyText(l.uri, "لینک اتصال")}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="QR" onClick={() => setQrLink(qrLink === l.uri ? null : l.uri)}>
                              <QrCode className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <code dir="ltr" className="block bg-muted rounded-md px-2 py-1.5 font-mono text-[9px] break-all border border-border max-h-20 overflow-y-auto">
                          {l.uri}
                        </code>
                        {qrLink === l.uri && (
                          <div className="flex justify-center p-2 bg-card rounded-lg border border-border">
                            <QRCode value={l.uri} size={180} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">اطلاعاتی برای نمایش نیست</p>
          )}
        </DialogContent>
      </Dialog>

      {/* حذف */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف کاربر {deleting?.name || deleting?.email}؟</AlertDialogTitle>
            <AlertDialogDescription>
              کاربر از همه لوکیشن‌های سامانه حذف می‌شود و دسترسی او قطع خواهد شد. این عمل قابل بازگشت نیست.
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

// ---------- سرعت لحظه‌ای شبکه ----------
type ServerStatus = {
  ok: boolean;
  up: number; // بایت/ثانیه
  down: number;
  cpu: number;
  memUsed: number;
  memTotal: number;
  tcpCount: number;
  xrayRunning: boolean;
};

function formatSpeed(bps: number): string {
  if (bps >= 1048576) return `${faNum(Math.round((bps / 1048576) * 10) / 10)} MB/s`;
  if (bps >= 1024) return `${faNum(Math.round(bps / 1024))} KB/s`;
  return `${faNum(bps)} B/s`;
}

function LiveSpeedCard() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    async function poll() {
      const r = await api<ServerStatus>("/api/reseller/server-status");
      if (!alive) return;
      if (r.ok && r.data) {
        setStatus(r.data);
        setErr("");
      } else {
        setErr(r.error || "عدم دسترسی به سرور");
      }
    }
    void poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tick]);

  return (
    <Card className="bg-card card-soft">
      <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="h-10 w-10 rounded-xl bg-[var(--brand-soft)] flex items-center justify-center text-[var(--brand-deep)]">
            <Activity className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-bold flex items-center gap-1.5">
              سرعت لحظه‌ای شبکه
              <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" title="به‌روزرسانی هر ۳ ثانیه" />
            </div>
            <div className="text-xs text-muted-foreground">مجموع ترافیک زنده سرور — به‌روزرسانی خودکار</div>
          </div>
        </div>
        {err ? (
          <span className="text-xs tone-danger">{err}</span>
        ) : !status ? (
          <Spinner className="text-muted-foreground" />
        ) : (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" dir="ltr">
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-500 font-bold">↑</span>
              <span className="font-extrabold">{formatSpeed(status.up)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--brand-orange)] font-bold">↓</span>
              <span className="font-extrabold">{formatSpeed(status.down)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              CPU: {faNum(Math.round(status.cpu))}٪ · TCP: {faNum(status.tcpCount)} ·{" "}
              {status.xrayRunning ? <span className="text-emerald-500">Xray فعال</span> : <span className="text-red-500">Xray متوقف!</span>}
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7" title="به‌روزرسانی" onClick={() => setTick((t) => t + 1)}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- تنظیمات حساب نماینده (رمز + 2FA + تلگرام) ----------
function AccountSettingsTab({ username }: { username: string }) {
  // ---- رمز ----
  const [curPass, setCurPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [passBusy, setPassBusy] = useState(false);

  // ---- 2FA ----
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [otpauth, setOtpauth] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [disablePass, setDisablePass] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  // ---- تلگرام ----
  const [tgChatId, setTgChatId] = useState("");
  const [tgToken, setTgToken] = useState("");
  const [tgHasToken, setTgHasToken] = useState(false);
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);

  const load2fa = useCallback(async () => {
    const r = await api<{ totpEnabled: boolean }>("/api/reseller/2fa");
    if (r.ok && r.data) setTotpEnabled(r.data.totpEnabled);
  }, []);

  const loadTg = useCallback(async () => {
    const r = await api<{ telegram: { enabled: boolean; chatId: string; hasToken: boolean } }>("/api/reseller/telegram");
    if (r.ok && r.data) {
      setTgEnabled(r.data.telegram.enabled);
      setTgChatId(r.data.telegram.chatId);
      setTgHasToken(r.data.telegram.hasToken);
    }
  }, []);

  useEffect(() => {
    void load2fa();
    void loadTg();
  }, [load2fa, loadTg]);

  async function changePassword() {
    if (!curPass || !newPass) {
      toast({ title: "خطا", description: "رمز فعلی و رمز جدید الزامی است", variant: "destructive" });
      return;
    }
    if (newPass !== newPass2) {
      toast({ title: "خطا", description: "تکرار رمز جدید مطابقت ندارد", variant: "destructive" });
      return;
    }
    setPassBusy(true);
    const r = await api("/api/reseller/account", { method: "POST", body: JSON.stringify({ currentPassword: curPass, newPassword: newPass }) });
    setPassBusy(false);
    if (r.ok) {
      toast({ title: "موفق", description: "رمز عبور تغییر کرد" });
      setCurPass("");
      setNewPass("");
      setNewPass2("");
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function setup2fa() {
    setTotpBusy(true);
    const r = await api<{ otpauth: string }>("/api/reseller/2fa", { method: "POST", body: JSON.stringify({ action: "setup" }) });
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
      toast({ title: "خطا", description: "کد ۶ رقمی را از اپ Authenticator وارد کنید", variant: "destructive" });
      return;
    }
    setTotpBusy(true);
    const r = await api("/api/reseller/2fa", { method: "POST", body: JSON.stringify({ action: "enable", code: totpCode }) });
    setTotpBusy(false);
    if (r.ok) {
      toast({ title: "موفق", description: "ورود دومرحله‌ای فعال شد — از دفعه بعد کد لازم است" });
      setOtpauth("");
      setTotpCode("");
      setTotpEnabled(true);
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function disable2fa() {
    if (!disablePass) {
      toast({ title: "خطا", description: "رمز عبور برای خاموش‌سازی الزامی است", variant: "destructive" });
      return;
    }
    setTotpBusy(true);
    const r = await api("/api/reseller/2fa", { method: "DELETE", body: JSON.stringify({ password: disablePass }) });
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

  async function saveTg() {
    setTgBusy(true);
    const r = await api("/api/reseller/telegram", { method: "PUT", body: JSON.stringify({ botToken: tgToken, chatId: tgChatId, enabled: tgEnabled }) });
    setTgBusy(false);
    if (r.ok) {
      toast({ title: "موفق", description: "تنظیمات تلگرام ذخیره شد" });
      setTgToken("");
      void loadTg();
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  async function testTg() {
    setTgBusy(true);
    const r = await api<{ ok: boolean; msg: string }>("/api/reseller/telegram", { method: "POST" });
    setTgBusy(false);
    if (r.ok) {
      toast({ title: "ارسال شد", description: "پیام تست به تلگرام شما ارسال شد" });
    } else {
      toast({ title: "خطا", description: r.error, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-lg font-extrabold flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[var(--brand)]" />
          تنظیمات حساب
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          رمز عبور، ورود دومرحله‌ای و اعلان‌های تلگرام — حساب: <b dir="ltr">{username}</b>
        </p>
      </div>

      {/* تغییر رمز */}
      <Card className="bg-card card-soft">
        <CardContent className="p-5 space-y-4">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--brand-orange)]" />
            تغییر رمز عبور
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>رمز فعلی</Label>
              <Input dir="ltr" className="latin-input" type="password" value={curPass} onChange={(e) => setCurPass(e.target.value)} autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label>رمز جدید (حداقل ۶ کاراکتر)</Label>
              <Input dir="ltr" className="latin-input" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label>تکرار رمز جدید</Label>
              <Input dir="ltr" className="latin-input" type="password" value={newPass2} onChange={(e) => setNewPass2(e.target.value)} autoComplete="new-password" />
            </div>
          </div>
          <Button onClick={changePassword} disabled={passBusy} className="brand-gradient text-white hover:opacity-90 font-bold">
            {passBusy && <Spinner className="h-4 w-4" />} تغییر رمز عبور
          </Button>
        </CardContent>
      </Card>

      {/* ورود دومرحله‌ای */}
      <Card className="bg-card card-soft">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--brand)]" />
              ورود دومرحله‌ای (Google Authenticator)
            </h3>
            {totpEnabled !== null && (
              <Badge variant="outline" className={totpEnabled ? "tone-ok" : "tone-muted"}>
                {totpEnabled ? "فعال" : "غیرفعال"}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-5">
            با فعال‌سازی این گزینه، بعد از وارد کردن رمز، یک کد ۶ رقمی از اپ Authenticator هم لازم می‌شود — حتی اگر رمز لو برود کسی وارد حساب شما نمی‌شود.
          </p>

          {totpEnabled ? (
            <div className="space-y-3">
              {!showDisable ? (
                <Button variant="outline" onClick={() => setShowDisable(true)} className="hover:border-red-300 hover:text-red-500">
                  خاموش‌سازی ورود دومرحله‌ای
                </Button>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5">
                    <Label>رمز عبور برای تأیید</Label>
                    <Input dir="ltr" className="latin-input" type="password" value={disablePass} onChange={(e) => setDisablePass(e.target.value)} />
                  </div>
                  <Button variant="outline" onClick={() => { setShowDisable(false); setDisablePass(""); }}>انصراف</Button>
                  <Button onClick={disable2fa} disabled={totpBusy} className="bg-red-600 hover:bg-red-500 text-white">
                    {totpBusy && <Spinner className="h-4 w-4" />} خاموش کن
                  </Button>
                </div>
              )}
            </div>
          ) : otpauth ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start gap-4">
                <div className="p-2.5 bg-white rounded-xl border border-border shrink-0">
                  <QRCode value={otpauth} size={160} />
                </div>
                <div className="text-xs space-y-1.5 text-muted-foreground leading-5">
                  <p><b className="text-foreground">۱.</b> اپ Google Authenticator / Authy را باز کنید</p>
                  <p><b className="text-foreground">۲.</b> QR بالا را اسکن کنید (یا + و «Enter a setup key»)</p>
                  <p><b className="text-foreground">۳.</b> کد ۶ رقمی فعلی را وارد و تأیید کنید</p>
                  <code dir="ltr" className="block bg-muted rounded-md px-2 py-1 font-mono text-[9px] break-all max-w-64 overflow-hidden">{otpauth}</code>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <Label>کد ۶ رقمی</Label>
                  <Input dir="ltr" className="latin-input w-32" inputMode="numeric" maxLength={6} value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="۱۲۳۴۵۶" />
                </div>
                <Button onClick={enable2fa} disabled={totpBusy} className="brand-gradient text-white hover:opacity-90 font-bold">
                  {totpBusy && <Spinner className="h-4 w-4" />} تأیید و فعال‌سازی
                </Button>
                <Button variant="outline" onClick={() => setOtpauth("")}>انصراف</Button>
              </div>
            </div>
          ) : (
            <Button onClick={setup2fa} disabled={totpBusy} className="brand-gradient text-white hover:opacity-90 font-bold">
              {totpBusy && <Spinner className="h-4 w-4" />} فعال‌سازی ورود دومرحله‌ای
            </Button>
          )}
        </CardContent>
      </Card>

      {/* تلگرام */}
      <Card className="bg-card card-soft">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <Send className="h-4 w-4 text-[var(--brand-orange)]" />
              اعلان‌های تلگرام
            </h3>
            <Switch checked={tgEnabled} onCheckedChange={setTgEnabled} />
          </div>
          <p className="text-xs text-muted-foreground leading-5">
            خبرساز شوید: ساخت کاربر، مصرف ۸۰٪ به بالا و انقضای نزدیک — همه به تلگرام شما پیام می‌دهند. بات خودتان را از <b dir="ltr">@BotFather</b> بسازید، توکن را اینجا بگذارید و شناسه چت را از <b dir="ltr">@userinfobot</b> بگیرید. (قبل از استفاده یک پیام به بات خودتان بدهید)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>توکن بات {tgHasToken && <span className="text-[10px] tone-ok">(ذخیره شده — برای تغییر پر کنید)</span>}</Label>
              <Input dir="ltr" className="latin-input" type="password" value={tgToken} onChange={(e) => setTgToken(e.target.value)} placeholder={tgHasToken ? "••••••••••••" : "123456789:AAE..."} />
            </div>
            <div className="space-y-1.5">
              <Label>شناسه چت (Chat ID)</Label>
              <Input dir="ltr" className="latin-input" value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} placeholder="123456789 یا @channel" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveTg} disabled={tgBusy} className="brand-gradient text-white hover:opacity-90 font-bold">
              {tgBusy && <Spinner className="h-4 w-4" />} ذخیره تنظیمات
            </Button>
            <Button variant="outline" onClick={testTg} disabled={tgBusy}>
              <SendIcon2 className="h-4 w-4" /> ارسال پیام تست
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
