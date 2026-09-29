// Final hotfix — one-pass complete fix
const fs = require("fs");
const p = "src/components/panel/admin-view.tsx";
let s = fs.readFileSync(p, "utf8");

// ============ 1) TYPE FIX ============
const t1 = s.indexOf("type OverviewData");
const t2 = s.indexOf("const CHART_COLORS");
if (t1 < 0 || t2 < 0) { console.error("type markers not found"); process.exit(1); }

const newTypes = `type OverviewData = {
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
  trafficByInbound: { panelName: string; tag: string; clients: number; upGB: number; downGB: number }[];
  panelErrors?: { panelName: string; msg: string }[];
  configured: boolean;
  state: "NOT_CONFIGURED" | "CHECKING" | "ONLINE" | "DEGRADED" | "OFFLINE";
  lastSuccessAt: number | null;
  latencyMs: number | null;
};

`;

s = s.slice(0, t1) + newTypes + s.slice(t2);

// ============ 2) IMPORTS ============
s = s.replace(
  'import { api, StatCard, faDate, gbLabel, faNum, PvLogo } from "./shared";',
  'import { api, StatCard, faDate, gbLabel, formatUsageGB, faNum, PvLogo } from "./shared";'
);
s = s.replace('} from "lucide-react";', '  Loader2,\n} from "lucide-react";');

// ============ 3) REPLACE OverviewTab function entirely ============
const fnStart = s.indexOf("function OverviewTab(");
if (fnStart < 0) { console.error("OverviewTab not found"); process.exit(1); }

const newFn = `function OverviewTab({
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

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<OverviewData>("/api/admin/overview");
    setLoading(false);
    if (r.ok && r.data) setData(r.data);
    else toast({ title: "خطا", description: r.error, variant: "destructive" });
  }, []);

  const loadPanel = useCallback(async () => {
    setPanelLoading(true);
    const r = await api<PanelSummaryData>("/api/admin/panel-summary");
    setPanelLoading(false);
    if (r.ok && r.data) setPanelSummary(r.data);
  }, []);

  useEffect(() => {
    void load();
    void loadPanel();
  }, [load, loadPanel]);

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
  const panelState = panelSummary?.state ?? "CHECKING";
  const donutData = (panelSummary?.trafficByInbound || []).map((t) => ({ tag: t.tag, usedGB: t.upGB + t.downGB })).slice(0, 8);
  const usersPerInbound = (panelSummary?.trafficByInbound || []).map((t) => ({ tag: t.tag, users: t.clients }));

  const panelStateColor =
    panelState === "ONLINE" ? "tone-ok"
    : panelState === "DEGRADED" ? "tone-warn"
    : panelState === "OFFLINE" ? "tone-danger"
    : "";
  const panelStateText =
    panelState === "ONLINE" ? (panel && panel.panelsCount > 1 ? \`\${faNum(panel.panelsCount)} پنل ثنایی متصل است\` : "پنل ثنایی متصل است")
    : panelState === "DEGRADED" ? "دریافت وضعیت زنده پنل با اختلال موقت مواجه است"
    : panelState === "OFFLINE" ? "پنل تنظیم شده است اما در حال حاضر پاسخ نمی‌دهد"
    : panelState === "NOT_CONFIGURED" ? "هیچ پنل فعالی تنظیم نشده است"
    : "در حال بررسی وضعیت پنل...";

  return (
    <div className="space-y-6">
      {/* وضعیت پنل — health state صریح */}
      <Card className={\`border card-soft \${panelStateColor}\`}>
        <CardContent className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl flex items-center justify-center bg-black/5 dark:bg-white/5">
              {panelLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <Server className={\`h-5 w-5 \${panelState === "ONLINE" ? "text-emerald-600 dark:text-emerald-400" : panelState === "DEGRADED" ? "text-amber-500" : panelState === "NOT_CONFIGURED" ? "text-muted-foreground" : "text-red-500 dark:text-red-400"}\`} />
              )}
            </div>
            <div>
              <div className="font-bold">{panelStateText}</div>
              <div className="text-xs text-muted-foreground">
                {panelLoading ? "در حال دریافت وضعیت زنده..."
                : panelState === "ONLINE" && panel ? \`\${faNum(panel.inbounds)} اینباند · \${faNum(panel.clients)} کلاینت\`
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
        <StatCard title="نماینده‌ها" value={faNum(stats.resellers)} sub={\`فعال: \${faNum(stats.activeResellers)}\`} icon={<Users className="h-4 w-4" />} tone="brand" />
        <StatCard title="کل کاربران نماینده‌ها" value={faNum(stats.users)} icon={<UserCheck className="h-4 w-4" />} tone="orange" />
        <StatCard
          title="ترافیک کل (آپلود)"
          value={panelLoading ? "—" : panel ? formatUsageGB(Math.round((panel.totalUp / 1073741824) * 100) / 100) : "—"}
          icon={<ArrowUpDown className="h-4 w-4" />}
        />
        <StatCard
          title="ترافیک کل (دانلود)"
          value={panelLoading ? "—" : panel ? formatUsageGB(Math.round((panel.totalDown / 1073741824) * 100) / 100) : "—"}
          icon={<ArrowUpDown className="h-4 w-4" />}
          tone="success"
        />
      </div>

      {/* نمودارها */}
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
                <div key={\`\${i.panelId}-\${i.inboundId}-\${idx}\`} className="rounded-xl border border-border p-3 hover:border-[var(--brand)]/40 transition-colors bg-card">
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
`;

s = s.slice(0, fnStart) + newFn;
fs.writeFileSync(p, s, "utf8");
console.log("COMPLETE FIX APPLIED");
console.log("has stats.panel:", s.includes("stats.panel."));
console.log("has panelSummary:", s.includes("panelSummary"));
console.log("has formatUsageGB:", s.includes("formatUsageGB"));
