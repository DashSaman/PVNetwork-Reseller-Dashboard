"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { api, StatCard, faDate, gbLabel, formatUsageGB, faNum, PvLogo } from "./shared";
import { ResellersTab } from "./resellers-tab";
import { PanelSettingsTab, LogsTab } from "./settings-logs";
import { ThemeToggle } from "./theme";
import { BackupsTab } from "./backups-tab";
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
  Loader2,
  Download,
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

type Tab = "overview" | "resellers" | "settings" | "logs" | "backups";

type OverviewData = {
  stats: {
    resellers: number;
    activeResellers: number;
    users: number;
    logs: number;
  };
  recentLogs: ActivityLogRow[];
  charts: {
    usersSeries: { date: string; label: string; count: number }[];
    resellersBreakdown: { name: string; users: number }[];
  };
  trafficLedger: TrafficLedger;
};

type TrafficLedger = {
  available: boolean;
  totals: {
    allocatedToResellersGB: number | null;
    soldToUsersGB: number;
    soldUnlimitedUsers: number;
    unsoldGB: number | null;
    soldButUnusedGB: number | null;
    actualUsedGB: number | null;
    consumedHistoricalGB: number;
    reservedGB: number;
  };
  resellers: {
    id: string;
    name: string;
    unlimitedPool: boolean;
    poolGB: number | null;
    soldGB: number;
    unlimitedUsers: number;
    unsoldGB: number | null;
    soldButUnusedGB: number | null;
    actualUsedGB: number | null;
    consumedHistoricalGB: number;
    reservedGB: number;
    usageKnownUsers: number;
    users: number;
  }[];
};

type PanelSummaryData = {
  panel: {
    connected: boolean;
    panelsCount: number;
    inbounds: number;
    clients: number;
    totalUp: number;
    totalDown: number;
  };
  trafficLedger: TrafficLedger;
  trafficByInbound: { panelName: string; tag: string; clients: number; upGB: number; downGB: number }[];
  panelErrors?: { panelName: string; msg: string }[];
  configured: boolean;
  state: "NOT_CONFIGURED" | "CHECKING" | "ONLINE" | "DEGRADED" | "OFFLINE";
  lastSuccessAt: number | null;
  latencyMs: number | null;
  pending: boolean;
  stale: boolean;
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
  const [panelConnected, setPanelConnected] = useState<boolean | null>(null); // null = هنوز بررسی نشده
  const [brand, setBrand] = useState("PvNetwork");

  useEffect(() => {
    api<{ brand: string }>("/api/public/brand").then((r) => {
      if (r.ok && r.data?.brand) setBrand(r.data.brand);
    });
  }, []);

  const loadInbounds = useCallback(async () => {
    const r = await api<{ inbounds: InboundInfo[]; pending: boolean }>("/api/admin/inbounds", { signal: AbortSignal.timeout(8000) });
    if (r.ok && r.data) {
      setInbounds(r.data.inbounds);
      setPanelConnected(r.data.pending && !r.data.inbounds.length ? null : true);
    } else {
      setPanelConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!['resellers', 'settings'].includes(tab) || panelConnected !== null) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void loadInbounds(); }, 3000);
    return () => clearInterval(timer);
  }, [tab, panelConnected, loadInbounds]);

  // درخواست‌های اینباند فقط با باز شدن تب‌های مربوطه — نه در صفحهٔ اول
  // (tab-change handler در line ~151 loadInbounds را صدا می‌زند)

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "داشبورد", icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: "resellers", label: "نماینده‌ها", icon: <Users className="h-4 w-4" /> },
    { id: "settings", label: "تنظیمات و پنل‌ها", icon: <Plug className="h-4 w-4" /> },
    { id: "logs", label: "گزارش‌ها", icon: <History className="h-4 w-4" /> },
    { id: "backups", label: "بکاپ", icon: <Download className="h-4 w-4" /> },
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
              onClick={() => {
                setTab(t.id);
                if (t.id === "resellers") void loadInbounds();
              }}
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
        {tab === "backups" && <BackupsTab />}
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
  panelConnected: boolean | null;
  reloadInbounds: () => void;
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelSummary, setPanelSummary] = useState<PanelSummaryData | null>(null);
  const [panelLoading, setPanelLoading] = useState(true);
  const [panelRefreshing, setPanelRefreshing] = useState(true);
  const [panelError, setPanelError] = useState("");
  const panelRequestPending = useRef(false);
  const hasPanelData = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<OverviewData>("/api/admin/overview");
    setLoading(false);
    if (r.ok && r.data) setData(r.data);
    else toast({ title: "خطا", description: r.error, variant: "destructive" });
  }, []);

  const loadPanel = useCallback(async () => {
    if (panelRequestPending.current) return;
    panelRequestPending.current = true;
    try {
      setPanelLoading(!hasPanelData.current);
      const r = await api<PanelSummaryData>("/api/admin/panel-summary", { signal: AbortSignal.timeout(8000) });
      if (r.ok && r.data) {
        hasPanelData.current ||= r.data.panel.connected;
        setPanelSummary(r.data); setPanelError("");
        setPanelLoading(r.data.pending && !hasPanelData.current);
        setPanelRefreshing(r.data.pending);
      } else if (r.status !== 401) {
        setPanelLoading(false); setPanelRefreshing(false);
        setPanelError(r.error || "دریافت آمار زنده ناموفق بود؛ دوباره تلاش می‌شود.");
      }
    } finally { panelRequestPending.current = false; }
  }, []);

  useEffect(() => {
    void load();
    void loadPanel();
  }, [load, loadPanel]);

  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") void loadPanel(); }, panelRefreshing ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [panelRefreshing, loadPanel]);

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        در حال بارگذاری...
      </div>
    );
  }

  const { stats, charts } = data;
  const panel = panelSummary?.panel;
  const businessLedger = panelSummary?.trafficLedger ?? data.trafficLedger;
  const panelState = panelError ? "OFFLINE" : panelSummary?.state ?? "CHECKING";
  const donutData = (panelSummary?.trafficByInbound || []).map((t) => ({ tag: t.tag, usedGB: t.upGB + t.downGB })).slice(0, 8);
  const usersPerInbound = (panelSummary?.trafficByInbound || []).map((t) => ({ tag: t.tag, users: t.clients }));

  const panelStateColor =
    panelState === "ONLINE" ? "tone-ok"
    : panelState === "DEGRADED" ? "tone-warn"
    : panelState === "OFFLINE" ? "tone-danger"
    : "";
  const panelStateText =
    panelState === "ONLINE" ? (panel && panel.panelsCount > 1 ? `${faNum(panel.panelsCount)} پنل متصل است` : "پنل متصل است")
    : panelState === "DEGRADED" ? "دریافت وضعیت زنده پنل با اختلال موقت مواجه است"
    : panelState === "OFFLINE" ? "پنل تنظیم شده است اما در حال حاضر پاسخ نمی‌دهد"
    : panelState === "NOT_CONFIGURED" ? "هیچ پنل فعالی تنظیم نشده است"
    : "در حال بررسی وضعیت پنل...";

  return (
    <div className="space-y-6">
      {/* وضعیت پنل — health state صریح */}
      <Card className={`border card-soft ${panelStateColor}`}>
        <CardContent className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl flex items-center justify-center bg-black/5 dark:bg-white/5">
              {panelLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <Server className={`h-5 w-5 ${panelState === "ONLINE" ? "text-emerald-600 dark:text-emerald-400" : panelState === "DEGRADED" ? "text-amber-500" : panelState === "NOT_CONFIGURED" ? "text-muted-foreground" : "text-red-500 dark:text-red-400"}`} />
              )}
            </div>
            <div>
              <div className="font-bold">{panelStateText}</div>
              <div className="text-xs text-muted-foreground">
                {panelLoading ? "در حال دریافت وضعیت زنده..."
                : panelError ? panelError
                : panelState === "ONLINE" && panel ? `${faNum(panel.inbounds)} اینباند · ${faNum(panel.clients)} کلاینت${panelRefreshing ? " · در حال تازه‌سازی" : ""}`
                : panelState === "DEGRADED" ? "آخرین وضعیت موفق حفظ شده — در حال تلاش مجدد"
                : panelState === "NOT_CONFIGURED" ? "از تب تنظیمات یک پنل اضافه کنید"
                : "مهلت دریافت اطلاعات زنده تمام شد"}
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => { void loadPanel(); void load(); }}>
            <ArrowUpDown className="h-4 w-4" /> به‌روزرسانی
          </Button>
        </CardContent>
      </Card>

      {/* آمار */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="نماینده‌ها" value={faNum(stats.resellers)} sub={`فعال: ${faNum(stats.activeResellers)}`} icon={<Users className="h-4 w-4" />} tone="brand" />
        <StatCard title="کل کاربران نماینده‌ها" value={faNum(stats.users)} icon={<UserCheck className="h-4 w-4" />} tone="orange" />
        <StatCard
          title="ترافیک کل زیرساخت (آپلود)"
          value={panel?.connected ? formatUsageGB(Math.round((panel.totalUp / 1073741824) * 100) / 100) : "—"}
          icon={<ArrowUpDown className="h-4 w-4" />}
        />
        <StatCard
          title="ترافیک کل زیرساخت (دانلود)"
          value={panel?.connected ? formatUsageGB(Math.round((panel.totalDown / 1073741824) * 100) / 100) : "—"}
          icon={<ArrowUpDown className="h-4 w-4" />}
          tone="success"
        />
      </div>

      {/* نمودارها */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold text-sm">گردش سهمیه کاربران نماینده‌ها</h3>
          <span className="text-[11px] text-muted-foreground">فقط کاربران ثبت‌شده در پنل نماینده‌ها</span>
        </div>
        <p className="text-xs text-muted-foreground">مصرف واقعی و فروش مصرف‌نشده از شمارنده کاربران متعلق به نماینده‌ها محاسبه می‌شود. ترافیک کل زیرساخت آمار جداگانه‌ای است. مصرف تاریخی حذف/ریست: {faNum(businessLedger.totals.consumedHistoricalGB)} GB؛ رزرو عملیات فعال: {faNum(businessLedger.totals.reservedGB)} GB.</p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard title="سهمیه اختصاص‌یافته به نماینده‌ها" value={businessLedger.totals.allocatedToResellersGB === null ? "نامحدود" : `${faNum(businessLedger.totals.allocatedToResellersGB)} GB`} icon={<ArrowUpDown className="h-4 w-4" />} />
          <StatCard title="سهمیه کاربران فعلی" value={`${faNum(businessLedger.totals.soldToUsersGB)} GB${businessLedger.totals.soldUnlimitedUsers ? " + نامحدود" : ""}`} sub={businessLedger.totals.soldUnlimitedUsers ? `${faNum(businessLedger.totals.soldUnlimitedUsers)} کاربر نامحدود` : undefined} icon={<Users className="h-4 w-4" />} tone="orange" />
          <StatCard title="باقی‌مانده تخصیص‌نیافته" value={businessLedger.totals.unsoldGB === null ? "نامحدود" : `${faNum(businessLedger.totals.unsoldGB)} GB`} icon={<ArrowUpDown className="h-4 w-4" />} tone="brand" />
          <StatCard title="فروش مصرف‌نشده کاربران" value={businessLedger.totals.soldButUnusedGB === null ? "نامشخص" : `${faNum(businessLedger.totals.soldButUnusedGB)} GB`} icon={<TrendingUp className="h-4 w-4" />} />
          <StatCard title="مصرف واقعی کاربران" value={businessLedger.totals.actualUsedGB === null ? "نامشخص" : `${faNum(businessLedger.totals.actualUsedGB)} GB`} sub={!businessLedger.available ? "در انتظار داده زنده کامل" : undefined} icon={<ArrowUpDown className="h-4 w-4" />} tone="success" />
        </div>
        <Card className="bg-card card-soft">
          <CardContent className="p-4 sm:p-5">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm text-right">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 font-medium">نماینده</th><th className="py-2 font-medium">سهمیه نماینده</th><th className="py-2 font-medium">سهمیه کاربران</th><th className="py-2 font-medium">باقی‌مانده</th><th className="py-2 font-medium">مصرف تاریخی</th><th className="py-2 font-medium">رزرو</th><th className="py-2 font-medium">مصرف واقعی</th><th className="py-2 font-medium">مصرف‌نشده</th>
                </tr></thead>
                <tbody>{businessLedger.resellers.map((row) => <tr key={row.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5 font-semibold">{row.name}</td>
                  <td className="py-2.5">{row.poolGB === null ? "نامحدود" : `${faNum(row.poolGB)} GB`}</td>
                  <td className="py-2.5">{faNum(row.soldGB)} GB{row.unlimitedUsers ? ` + ${faNum(row.unlimitedUsers)} نامحدود` : ""}</td>
                  <td className="py-2.5">{row.unsoldGB === null ? "نامحدود" : `${faNum(row.unsoldGB)} GB`}</td>
                  <td className="py-2.5">{faNum(row.consumedHistoricalGB)} GB</td><td className="py-2.5">{faNum(row.reservedGB)} GB</td>
                  <td className="py-2.5">{row.actualUsedGB === null ? "نامشخص" : `${faNum(row.actualUsedGB)} GB`}{row.actualUsedGB === null ? "" : ` (${faNum(row.usageKnownUsers)}/${faNum(row.users)} کاربر)`}</td>
                  <td className="py-2.5">{row.soldButUnusedGB === null ? "نامشخص" : `${faNum(row.soldButUnusedGB)} GB`}</td>
                </tr>)}</tbody>
              </table>
              {businessLedger.totals.reservedGB > 0 && <p className="mt-3 text-xs text-muted-foreground">رزرو در حال انجام: {faNum(businessLedger.totals.reservedGB)} GB</p>}
            </div>
          </CardContent>
        </Card>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* روند ساخت کاربران — local */}
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

        {/* مصرف ترافیک — panel-summary (async) */}
        <Card className="bg-card card-soft lg:col-span-2">
          <CardContent className="p-5">
            <h3 className="font-bold text-sm flex items-center gap-2 mb-4">
              <Globe className="h-4 w-4 text-[var(--brand-orange)]" />
              ترافیک به تفکیک لوکیشن
            </h3>
            {panelLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> در حال دریافت...
              </div>
            ) : donutData.length === 0 ? (
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

        {/* کاربران به تفکیک نماینده — local */}
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

        {/* کاربران به تفکیک اینباند — panel-summary (async) */}
        <Card className="bg-card card-soft lg:col-span-2">
          <CardContent className="p-5">
            <h3 className="font-bold text-sm flex items-center gap-2 mb-4">
              <ShieldCheck className="h-4 w-4 text-[var(--brand-orange)]" />
              کاربران به تفکیک اینباند
            </h3>
            {panelLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> در حال دریافت...
              </div>
            ) : usersPerInbound.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">داده‌ای موجود نیست</p>
            ) : (
              <div dir="ltr" className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={usersPerInbound} layout="vertical" margin={{ top: 5, right: 12, left: 8, bottom: 0 }}>
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
              {panelConnected === null ? "برای مشاهدهٔ جزئیات اینباندها، تب «نماینده‌ها» را باز کنید." : panelConnected ? "پنل فاقد اینباند است." : "پل تنظیم شده — داده زنده موقتاً در دسترس نیست."}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {inbounds.map((i, idx) => (
                <div key={`${i.panelId}-${i.inboundId}-${idx}`} className="rounded-xl border border-border p-3 hover:border-[var(--brand)]/40 transition-colors bg-card">
                  <div className="text-sm font-semibold truncate" dir="ltr">{i.remark || i.tag}</div>
                  <div className="text-xs text-muted-foreground mt-1" dir="ltr">
                    {i.protocol} : {i.port} · {faNum(i.clientsCount ?? 0)} کاربر
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* آخرین فعالیت‌ها */}
      <Card className="bg-card card-soft">
        <CardContent className="p-4 sm:p-5">
          <h3 className="font-bold text-sm flex items-center gap-2 mb-3">
            <History className="h-4 w-4 text-[var(--brand)]" />
            آخرین فعالیت‌ها
          </h3>
          <div className="space-y-1.5">
            {data.recentLogs.map((l) => (
              <div key={l.id} className="flex items-center gap-2 text-sm rounded-lg border border-border px-3 py-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{faDate(l.createdAt)}</span>
                <span className="font-semibold text-xs">{l.actorName}</span>
                <span className="text-xs text-muted-foreground">{l.action}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
