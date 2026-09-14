"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { api, StatCard, faDate, gbLabel, faNum, PvLogo } from "./shared";
import { ResellersTab } from "./resellers-tab";
import { PanelSettingsTab, LogsTab } from "./settings-logs";
import { ThemeToggle } from "./theme";
import type { InboundInfo, ActivityLogRow, Session } from "./types";
import {
  LayoutDashboard,
  Users,
  Plug,
  History,
  LogOut,
  Server,
  UserCheck,
  ArrowUpDown,
  ShieldCheck,
  Globe,
  TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

type Tab = "overview" | "resellers" | "settings" | "logs";

type OverviewData = {
  stats: {
    resellers: number;
    activeResellers: number;
    users: number;
    logs: number;
    panel: { connected: boolean; inbounds: number; clients: number; totalUp: number; totalDown: number; panelsCount: number };
  };
  recentLogs: ActivityLogRow[];
  charts: {
    usersSeries: { date: string; label: string; count: number }[];
    resellersBreakdown: { name: string; users: number }[];
    trafficByInbound: { tag: string; usedGB: number }[];
    usersPerInbound: { tag: string; users: number }[];
  };
};

const CHART_COLORS = ["#0f9e99", "#f37021", "#6366f1", "#f59e0b", "#8b5cf6", "#14b8a6", "#fb7185", "#84cc16"];

/** تول‌تیپ سفارشی نمودارها */
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

export function AdminView({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [inbounds, setInbounds] = useState<InboundInfo[]>([]);
  const [panelConnected, setPanelConnected] = useState(false);
  const [brand, setBrand] = useState("PvNetwork");

  useEffect(() => {
    api<{ brand: string }>("/api/public/brand").then((r) => {
      if (r.ok && r.data?.brand) setBrand(r.data.brand);
    });
  }, []);

  const loadInbounds = useCallback(async () => {
    const r = await api<{ inbounds: InboundInfo[] }>("/api/admin/inbounds");
    if (r.ok && r.data) {
      setInbounds(r.data.inbounds);
      setPanelConnected(true);
    } else {
      setPanelConnected(false);
    }
  }, []);

  useEffect(() => {
    void loadInbounds();
  }, [loadInbounds]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "داشبورد", icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: "resellers", label: "نماینده‌ها", icon: <Users className="h-4 w-4" /> },
    { id: "settings", label: "تنظیمات و پنل‌ها", icon: <Plug className="h-4 w-4" /> },
    { id: "logs", label: "گزارش‌ها", icon: <History className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* هدر */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <PvLogo size={38} />
            <div className="leading-tight">
              <div className="text-sm font-extrabold">
                سامانه نمایندگی <span className="brand-gradient-text">{brand}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">مدیریت کل سامانه</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-muted-foreground">
              ادمین: <span dir="ltr" className="font-semibold">{session.username}</span>
            </span>
            <ThemeToggle />
            <Button size="sm" variant="outline" onClick={logout} className="hover:border-red-300 hover:text-red-500">
              <LogOut className="h-4 w-4" /> خروج
            </Button>
          </div>
        </div>
      </header>

      {/* تب‌ها */}
      <nav className="border-b border-border/60 bg-background/60">
        <div className="mx-auto max-w-7xl px-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm whitespace-nowrap border-b-2 font-medium transition-colors ${
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

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">
        {tab === "overview" && <OverviewTab inbounds={inbounds} panelConnected={panelConnected} reloadInbounds={loadInbounds} />}
        {tab === "resellers" && <ResellersTab inbounds={inbounds} panelConnected={panelConnected} />}
        {tab === "settings" && <PanelSettingsTab />}
        {tab === "logs" && <LogsTab />}
      </main>

      <footer className="border-t border-border/60 py-4 text-center text-xs text-muted-foreground mt-auto bg-background/50">
        سامانه نمایندگی {brand} — مدیریت نماینده‌ها، کاربران و دسترسی‌ها
      </footer>
    </div>
  );
}

function OverviewTab({
  inbounds,
  panelConnected,
  reloadInbounds,
}: {
  inbounds: InboundInfo[];
  panelConnected: boolean;
  reloadInbounds: () => void;
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<OverviewData>("/api/admin/overview");
    setLoading(false);
    if (r.ok && r.data) setData(r.data);
    else toast({ title: "خطا", description: r.error, variant: "destructive" });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        در حال بارگذاری...
      </div>
    );
  }

  const { stats, charts } = data;
  const totalTraffic = (stats.panel.totalUp + stats.panel.totalDown) / 1073741824;
  const donutData = charts.trafficByInbound.slice(0, 8);

  return (
    <div className="space-y-6">
      {/* وضعیت پنل */}
      <Card className={`border card-soft ${stats.panel.connected ? "tone-ok" : "tone-danger"}`}>
        <CardContent className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl flex items-center justify-center bg-black/5 dark:bg-white/5">
              <Server className={`h-5 w-5 ${stats.panel.connected ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`} />
            </div>
            <div>
              <div className="font-bold">
                {stats.panel.connected
                  ? stats.panel.panelsCount > 1
                    ? `${faNum(stats.panel.panelsCount)} پنل ثنایی متصل است`
                    : "پنل ثنایی متصل است"
                  : "پنل ثنایی متصل نیست"}
              </div>
              <div className="text-xs text-muted-foreground">
                {stats.panel.connected
                  ? `${faNum(stats.panel.inbounds)} اینباند · ${faNum(stats.panel.clients)} کلاینت`
                  : "از تب «تنظیمات» مشخصات را وارد و ذخیره کنید"}
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => { reloadInbounds(); void load(); }}>
            <ArrowUpDown className="h-4 w-4" /> به‌روزرسانی
          </Button>
        </CardContent>
      </Card>

      {/* آمار */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="نماینده‌ها" value={faNum(stats.resellers)} sub={`فعال: ${faNum(stats.activeResellers)}`} icon={<Users className="h-4 w-4" />} tone="brand" />
        <StatCard title="کل کاربران نماینده‌ها" value={faNum(stats.users)} icon={<UserCheck className="h-4 w-4" />} tone="orange" />
        <StatCard title="ترافیک کل (آپلود)" value={gbLabel(Math.round((stats.panel.totalUp / 1073741824) * 100) / 100)} icon={<ArrowUpDown className="h-4 w-4" />} />
        <StatCard title="ترافیک کل (دانلود)" value={gbLabel(Math.round((stats.panel.totalDown / 1073741824) * 100) / 100)} icon={<ArrowUpDown className="h-4 w-4" />} tone="success" />
      </div>

      {/* نمودارها */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* روند ساخت کاربران */}
        <Card className="bg-card card-soft lg:col-span-3">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[var(--brand)]" />
                روند ساخت کاربران (۱۴ روز اخیر)
              </h3>
            </div>
            <div dir="ltr" className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={charts.usersSeries} margin={{ top: 5, right: 5, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gBrand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0f9e99" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0f9e99" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gOrange" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f37021" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#f37021" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--tick-text)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--tick-text)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#0f9e99", strokeWidth: 1, strokeDasharray: "4 4" }} />
                  <Area type="monotone" dataKey="count" name="کاربر جدید" stroke="#0f9e99" strokeWidth={2.5} fill="url(#gBrand)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* مصرف ترافیک به تفکیک اینباند */}
        <Card className="bg-card card-soft lg:col-span-2">
          <CardContent className="p-5">
            <h3 className="font-bold text-sm flex items-center gap-2 mb-4">
              <Globe className="h-4 w-4 text-[var(--brand-orange)]" />
              ترافیک به تفکیک لوکیشن
            </h3>
            {donutData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">داده مصرفی موجود نیست</p>
            ) : (
              <div dir="ltr" className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="usedGB"
                      nameKey="tag"
                      innerRadius={52}
                      outerRadius={85}
                      paddingAngle={3}
                      strokeWidth={2}
                      stroke="var(--card)"
                    >
                      {donutData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      verticalAlign="bottom"
                      height={36}
                      iconType="circle"
                      iconSize={8}
                      formatter={(v) => <span style={{ fontSize: 11, color: "var(--tick-text)" }}>{v}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* کاربران به تفکیک نماینده */}
        <Card className="bg-card card-soft lg:col-span-3">
          <CardContent className="p-5">
            <h3 className="font-bold text-sm flex items-center gap-2 mb-4">
              <Users className="h-4 w-4 text-[var(--brand)]" />
              کاربران به تفکیک نماینده
            </h3>
            {charts.resellersBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">هنوز نماینده‌ای ساخته نشده است</p>
            ) : (
              <div dir="ltr" className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts.resellersBreakdown} margin={{ top: 5, right: 5, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f37021" />
                        <stop offset="100%" stopColor="#0f9e99" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--tick-text)" }} axisLine={false} tickLine={false} interval={0} angle={-12} height={40} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--tick-text)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15,158,153,0.06)" }} />
                    <Bar dataKey="users" name="کاربران" fill="url(#gBar)" radius={[6, 6, 0, 0]} maxBarSize={44} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* کاربران به تفکیک اینباند */}
        <Card className="bg-card card-soft lg:col-span-2">
          <CardContent className="p-5">
            <h3 className="font-bold text-sm flex items-center gap-2 mb-4">
              <ShieldCheck className="h-4 w-4 text-[var(--brand-orange)]" />
              کاربران به تفکیک اینباند
            </h3>
            {charts.usersPerInbound.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">داده‌ای موجود نیست</p>
            ) : (
              <div dir="ltr" className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts.usersPerInbound} layout="vertical" margin={{ top: 5, right: 12, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "var(--tick-text)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="tag" width={92} tick={{ fontSize: 10, fill: "var(--tick-text)" }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(243,112,33,0.06)" }} />
                    <Bar dataKey="users" name="کاربران" fill="#0f9e99" radius={[0, 6, 6, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* اینباندها */}
      <Card className="bg-card card-soft">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--brand)]" />
              اینباندهای پنل ({faNum(inbounds.length)})
            </h3>
          </div>
          {inbounds.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {panelConnected ? "پنل فاقد اینباند است." : "پنل متصل نیست — از تب «اتصال پنل» تنظیم کنید."}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {inbounds.map((i, idx) => (
                <div key={`${i.panelId}-${i.inboundId}-${idx}`} className="rounded-xl border border-border p-3 hover:border-[var(--brand)]/40 transition-colors bg-card">
                  <div className="text-sm font-semibold truncate" dir="ltr">{i.remark || i.tag}</div>
                  <div className="text-xs text-muted-foreground mt-1" dir="ltr">
                    {i.protocol} : {i.port} · {faNum(i.clientsCount ?? 0)} کاربر
                  </div>
                  {i.panelName && (
                    <div className="text-[10px] mt-1 text-[var(--brand-deep)] flex items-center gap-1">
                      <Server className="h-3 w-3" /> {i.panelName}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* آخرین فعالیت‌ها */}
      <Card className="bg-card card-soft">
        <CardContent className="p-4 sm:p-5">
          <h3 className="font-bold text-sm mb-3">آخرین فعالیت‌ها</h3>
          {data.recentLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">هنوز فعالیتی ثبت نشده است.</p>
          ) : (
            <div className="space-y-2">
              {data.recentLogs.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 text-sm border-b border-border/50 pb-2 last:border-0">
                  <div className="min-w-0">
                    <span className={l.actorType === "ADMIN" ? "text-[var(--brand-deep)] font-semibold" : "text-[var(--brand-orange)] font-semibold"}>{l.actorName}</span>
                    <span className="text-muted-foreground"> — {l.action}</span>
                    {l.detail && <div className="text-xs text-muted-foreground truncate mt-0.5" dir="auto">{l.detail}</div>}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{faDate(l.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
