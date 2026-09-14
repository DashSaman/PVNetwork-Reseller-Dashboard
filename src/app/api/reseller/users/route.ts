import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { buildSubLink } from "@/lib/panel-manager";
import { getResellerWithAccess, bytesToGB, type InboundRef } from "@/lib/reseller-helpers";
import { createResellerUserCore } from "@/lib/user-create";
import { sendThresholdAlerts, type ThresholdAlert } from "@/lib/telegram";

/** لیست کاربران نماینده از روی همه پنل‌ها */
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  const trackedUsers = await db.resellerUser.findMany({ where: { resellerId: reseller.id } });
  const primaryPanel = await db.panelConfig.findFirst({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
  const primaryPanelId = primaryPanel?.id || "";

  const { getAllPanelInbounds } = await import("@/lib/panel-manager");
  const panelResult = await getAllPanelInbounds();
  if (!panelResult.ok) {
    return NextResponse.json({ error: panelResult.msg || "هیچ پنلی در دسترس نیست" }, { status: 502 });
  }

  const trackedMap = new Map(trackedUsers.map((u) => [u.email, u]));
  type UserRow = {
    email: string;
    name: string | null;
    inboundTags: string[];
    protocol: string;
    totalGB: number;
    usedGB: number;
    expiryTime: number;
    enable: boolean;
    subId: string | null;
    subLink: string | null;
    trafficGB: number;
    createdAt?: Date;
  };
  const rows: UserRow[] = [];
  const seen = new Set<string>();

  // آمار هر ایمیل به تفکیک پنل: داخل هر پنل بیشینه (رکورد یکتا)، بین پنل‌ها جمع (ورک‌لود واقعی)
  const tagsByEmail = new Map<string, string[]>();
  const protoByEmail = new Map<string, string>();
  const panelByEmail = new Map<string, string>(); // اولین پنلی که کاربر را دارد

  type StatAgg = { up: number; down: number; total: number; expiryTime: number; enable: boolean };
  const aggByEmail = new Map<string, StatAgg>();

  for (const bundle of panelResult.panels) {
    const statByEmail = new Map<string, StatAgg>();
    for (const inb of bundle.inbounds) {
      for (const stat of inb.clientStats) {
        const prev = statByEmail.get(stat.email);
        if (!prev || stat.up + stat.down > prev.up + prev.down) {
          statByEmail.set(stat.email, {
            up: stat.up || 0,
            down: stat.down || 0,
            total: stat.total || 0,
            expiryTime: stat.expiryTime || 0,
            enable: stat.enable ?? true,
          });
        }
        const tags = tagsByEmail.get(stat.email) || [];
        tags.push(panelResult.panels.length > 1 ? `${bundle.panelName} · ${inb.tag}` : inb.tag);
        tagsByEmail.set(stat.email, tags);
        if (!protoByEmail.has(stat.email)) protoByEmail.set(stat.email, inb.protocol);
      }
    }
    for (const email of statByEmail.keys()) {
      if (!panelByEmail.has(email)) panelByEmail.set(email, bundle.panelId);
    }
    // ادغام آمار این پنل در تجمیع کلی (بین پنل‌ها: جمع مصرف، بیشینه سهمیه/انقضا، AND وضعیت)
    for (const [email, st] of statByEmail) {
      const cur = aggByEmail.get(email);
      if (!cur) {
        aggByEmail.set(email, { ...st });
      } else {
        cur.up += st.up;
        cur.down += st.down;
        cur.total = Math.max(cur.total, st.total);
        cur.expiryTime = Math.max(cur.expiryTime, st.expiryTime);
        cur.enable = cur.enable && st.enable;
      }
    }
  }

  // ساخت ردیف‌ها بر اساس ایمیل کاربر (کلید trackedMap = ایمیل)
  for (const [email, agg] of aggByEmail) {
    const tracked = trackedMap.get(email);
    if (!tracked) continue;
    seen.add(email);
    const subPanelId = tracked.panelId || panelByEmail.get(email) || primaryPanelId;
    const subLink = await buildSubLink(tracked.subId || "", reseller, subPanelId);
    rows.push({
      email,
      name: tracked.name,
      inboundTags: tagsByEmail.get(email) || [],
      protocol: protoByEmail.get(email) || "-",
      totalGB: agg.total ? bytesToGB(agg.total) : 0,
      usedGB: bytesToGB(agg.up + agg.down),
      expiryTime: agg.expiryTime,
      enable: agg.enable,
      subId: tracked.subId || null,
      subLink,
      trafficGB: tracked.trafficGB,
      createdAt: tracked.createdAt,
    });
  }

  // کاربرانی که در هیچ پنلی پیدا نشدند (احتمالاً مستقیم از پنل ثنایی حذف شده‌اند)
  for (const tracked of trackedUsers) {
    if (!seen.has(tracked.email)) {
      rows.push({
        email: tracked.email,
        name: tracked.name,
        inboundTags: ["در پنل یافت نشد"],
        protocol: "-",
        totalGB: 0,
        usedGB: 0,
        expiryTime: 0,
        enable: false,
        subId: tracked.subId,
        subLink: null,
        trafficGB: tracked.trafficGB,
        createdAt: tracked.createdAt,
      });
    }
  }

  const allocatedGB = trackedUsers.reduce((s, u) => s + (u.trafficGB || 0), 0);

  // ---- هشدارها: مصرف ≥ ۸۰٪ و انقضای نزدیک (≤ ۳ روز) ----
  const alerts: { email: string; type: "usage" | "expiry"; pct?: number; days?: number }[] = [];
  for (const row of rows) {
    if (row.totalGB > 0) {
      const pct = Math.round((row.usedGB / row.totalGB) * 100);
      if (pct >= 80) alerts.push({ email: row.email, type: "usage", pct });
    }
    if (row.expiryTime > 0) {
      const days = Math.ceil((row.expiryTime - Date.now()) / 86400000);
      if (days >= 0 && days <= 3) alerts.push({ email: row.email, type: "expiry", days });
    }
  }
  // اعلان تلگرام — ناهمزمان و بدون بلاک کردن پاسخ (نرخ محدود داخل تابع)
  void sendThresholdAlerts(reseller, alerts as ThresholdAlert[]).catch(() => undefined);

  return NextResponse.json({
    users: rows,
    alerts,
    usage: {
      users: rows.length,
      trafficPoolGB: reseller.trafficPoolGB,
      allocatedGB,
      remainingGB: reseller.trafficPoolGB > 0 ? Math.max(0, reseller.trafficPoolGB - allocatedGB) : 0,
    },
  });
}

/** ساخت کاربر جدید — مدل پول ترافیک: نماینده آزادانه سهمیه هر کاربر را از پول خودش تعیین می‌کند */
export async function POST(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const reseller = await getResellerWithAccess(session.uid);
    if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

    const body = (await req.json()) as {
      name?: string;
      trafficGB?: number;
      expiryDate?: string;
      expiryDays?: number;
      ipLimit?: number;
      inbounds?: InboundRef[]; // فرمت جدید {panelId, inboundId}
      inboundIds?: number[]; // سازگاری قدیمی (پنل اصلی)
    };

    const primaryPanel = await db.panelConfig.findFirst({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
    const primaryPanelId = primaryPanel?.id || "";
    const refs: InboundRef[] = (body.inbounds && body.inbounds.length > 0
      ? body.inbounds
      : (body.inboundIds || []).map((inboundId) => ({ panelId: primaryPanelId, inboundId }))
    )
      .map((r) => ({ panelId: r.panelId || primaryPanelId, inboundId: Number(r.inboundId) }))
      .filter((r) => Number.isFinite(r.inboundId));

    let expiryTime = 0; // ۰ = نامحدود
    if (body.expiryDate) {
      expiryTime = new Date(body.expiryDate + "T23:59:59").getTime();
    } else if (body.expiryDays && body.expiryDays > 0) {
      expiryTime = Date.now() + body.expiryDays * 24 * 60 * 60 * 1000;
    }
    const ipLimit = reseller.allowIpLimit ? Math.max(0, Number(body.ipLimit) || 0) : 0;
    const trafficGB = Math.max(0, Number(body.trafficGB) || 0);

    const r = await createResellerUserCore(reseller, { name: body.name || "", trafficGB, expiryTime, ipLimit, refs });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

    // اعلان تلگرام — ناهمزمان بدون بلاک کردن پاسخ
    void (async () => {
      try {
        const { notifyUserCreated } = await import("@/lib/telegram");
        await notifyUserCreated(reseller, [{ email: r.email, subLink: r.subLink, trafficGB }], "single");
      } catch {
        /* بی‌صدا — اعلان نباید ساخت کاربر را خراب کند */
      }
    })();

    return NextResponse.json({ ok: true, email: r.email, subId: r.subId, subLink: r.subLink, trafficGB });
  } catch (e) {
    console.error("create user error:", e);
    return NextResponse.json({ error: "خطای داخلی در ساخت کاربر" }, { status: 500 });
  }
}
