import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getPanelConnection, getAllPanelInbounds, buildSubLink } from "@/lib/panel-manager";
import {
  getResellerWithAccess,
  validateInboundSelection,
  validatePoolAllocation,
  getAllocatedGB,
  parseInboundRefs,
  stringifyInboundRefs,
  refKey,
  type InboundRef,
} from "@/lib/reseller-helpers";
import {
  updateClient,
  attachClient,
  detachClient,
  deleteClient,
  addClient,
  type PanelAuth,
} from "@/lib/panel";
import { randomUuid } from "@/lib/crypto";
import { logActivity } from "@/lib/logger";

type Ctx = { params: Promise<{ email: string }> };

/** ویرایش کاربر: نام، سهمیه (از پول)، انقضا، دستگاه، لوکیشن‌ها (حتی بین پنل‌ها) */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const { email: rawEmail } = await ctx.params;
  const email = decodeURIComponent(rawEmail);

  try {
    const reseller = await getResellerWithAccess(session.uid);
    if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

    const tracked = await db.resellerUser.findUnique({
      where: { resellerId_email: { resellerId: reseller.id, email } },
    });
    if (!tracked) return NextResponse.json({ error: "کاربر پیدا نشد" }, { status: 404 });

    const primaryPanel = await db.panelConfig.findFirst({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
    const primaryPanelId = primaryPanel?.id || "";
    const currentRefs = parseInboundRefs(tracked.inboundIds, tracked.panelId || primaryPanelId);

    const body = (await req.json()) as {
      name?: string;
      trafficGB?: number;
      expiryDate?: string;
      expiryDays?: number;
      ipLimit?: number;
      enable?: boolean;
      inbounds?: InboundRef[];
      inboundIds?: number[];
      subId?: string;
    };

    // ---- اینباندهای زنده همه پنل‌ها ----
    const panelResult = await getAllPanelInbounds();
    if (!panelResult.ok) return NextResponse.json({ error: panelResult.msg || "هیچ پنلی در دسترس نیست" }, { status: 502 });
    const inboundIndex = new Map<string, { protocol: string }>();
    const emailExistsInPanel = new Map<string, boolean>();
    for (const bundle of panelResult.panels) {
      let exists = false;
      for (const inb of bundle.inbounds) {
        inboundIndex.set(refKey({ panelId: bundle.panelId, inboundId: inb.id }), { protocol: inb.protocol });
        if (inb.clients.some((c) => c.email === email) || inb.clientStats.some((c) => c.email === email)) exists = true;
      }
      emailExistsInPanel.set(bundle.panelId, exists);
    }

    // مشخصات فعلی کاربر (از اولین پنلی که او را دارد)
    let current: { totalGB: number; expiryTime: number; enable: boolean; subId: string; protocol: string } | null = null;
    for (const ref of currentRefs) {
      const bundle = panelResult.panels.find((p) => p.panelId === ref.panelId);
      if (!bundle) continue;
      for (const inb of bundle.inbounds) {
        const st = inb.clientStats.find((c) => c.email === email);
        if (st) {
          current = {
            totalGB: st.total || 0,
            expiryTime: st.expiryTime || 0,
            enable: st.enable ?? true,
            subId: tracked.subId || "",
            protocol: inb.protocol,
          };
          break;
        }
      }
      if (current) break;
    }
    if (!current) {
      const anyRef = currentRefs[0];
      const anyInbound = anyRef ? inboundIndex.get(refKey(anyRef)) : undefined;
      if (!anyInbound && !body.inbounds?.length && !body.inboundIds?.length) {
        return NextResponse.json({ error: "کاربر در پنل یافت نشد (احتمالاً حذف شده)" }, { status: 404 });
      }
      current = { totalGB: 0, expiryTime: 0, enable: true, subId: tracked.subId || "", protocol: anyInbound?.protocol || "vless" };
    }

    // ---- سهمیه و پول ----
    const trafficGB = body.trafficGB !== undefined ? Math.max(0, Number(body.trafficGB) || 0) : tracked.trafficGB;
    if (trafficGB !== tracked.trafficGB) {
      const allocatedGB = await getAllocatedGB(reseller.id, tracked.id);
      const pool = validatePoolAllocation(reseller.trafficPoolGB, allocatedGB, trafficGB, tracked.trafficGB);
      if (!pool.ok) return NextResponse.json({ error: pool.msg }, { status: 403 });
    }

    let expiryTime = current.expiryTime || 0;
    if (body.expiryDate) expiryTime = new Date(body.expiryDate + "T23:59:59").getTime();
    else if (body.expiryDays && body.expiryDays > 0) expiryTime = Date.now() + body.expiryDays * 86400000;
    const expiryDays = expiryTime ? Math.ceil((expiryTime - Date.now()) / 86400000) : 0;
    const ipLimit = body.ipLimit !== undefined ? Math.max(0, Number(body.ipLimit) || 0) : 0;
    const enable = body.enable !== undefined ? !!body.enable : current.enable;

    // ---- اینباندهای جدید ----
    const newRefs: InboundRef[] = body.inbounds
      ? body.inbounds.map((r) => ({ panelId: r.panelId || primaryPanelId, inboundId: Number(r.inboundId) })).filter((r) => Number.isFinite(r.inboundId))
      : body.inboundIds
        ? body.inboundIds.map((inboundId) => ({ panelId: primaryPanelId, inboundId }))
        : currentRefs;
    const selection = validateInboundSelection(reseller, newRefs);
    if (!selection.ok) return NextResponse.json({ error: selection.msg }, { status: 403 });
    for (const ref of newRefs) {
      if (!inboundIndex.has(refKey(ref))) {
        return NextResponse.json({ error: "اینباند انتخابی در پنل در دسترس نیست" }, { status: 400 });
      }
    }

    const curKeys = new Set(currentRefs.map(refKey));
    const newKeys = new Set(newRefs.map(refKey));
    const removed = currentRefs.filter((r) => !newKeys.has(refKey(r)));
    const added = newRefs.filter((r) => !curKeys.has(refKey(r)));

    const errors: string[] = [];

    // گروه‌بندی به تفکیک پنل
    const removedByPanel = new Map<string, number[]>();
    for (const r of removed) {
      const arr = removedByPanel.get(r.panelId) || [];
      arr.push(r.inboundId);
      removedByPanel.set(r.panelId, arr);
    }
    const addedByPanel = new Map<string, number[]>();
    for (const r of added) {
      const arr = addedByPanel.get(r.panelId) || [];
      arr.push(r.inboundId);
      addedByPanel.set(r.panelId, arr);
    }

    // ۱) جدا کردن از اینباندهای حذف‌شده
    for (const [panelId, inboundIds] of removedByPanel) {
      const conn = await getPanelConnection(panelId);
      if (!conn.ok) { errors.push(`اتصال پنل: ${conn.msg}`); continue; }
      const r = await detachClient(conn.conn as PanelAuth, email, inboundIds);
      if (!r.ok) errors.push(`جدا کردن لوکیشن‌ها: ${r.msg}`);
    }

    // ۲) اتصال به اینباندهای جدید (اگر رکورد کاربر در آن پنل نیست، اول بساز)
    for (const [panelId, inboundIds] of addedByPanel) {
      const conn = await getPanelConnection(panelId);
      if (!conn.ok) { errors.push(`اتصال پنل: ${conn.msg}`); continue; }
      const proto = inboundIndex.get(refKey({ panelId, inboundId: inboundIds[0] }))?.protocol || current.protocol;
      const exists = emailExistsInPanel.get(panelId);
      if (!exists) {
        const created = await addClient(conn.conn as PanelAuth, inboundIds, proto, {
          id: randomUuid(),
          password: randomUuid(),
          email,
          limitIp: ipLimit,
          totalGB: trafficGB ? trafficGB * 1024 * 1024 * 1024 : 0,
          expiryTime,
          enable,
          subId: body.subId !== undefined ? body.subId : current.subId,
        });
        if (!created.ok) errors.push(`افزودن به پنل: ${created.msg}`);
        continue;
      }
      const r = await attachClient(conn.conn as PanelAuth, email, inboundIds);
      if (!r.ok) errors.push(`افزودن لوکیشن‌ها: ${r.msg}`);
    }

    // ۳) به‌روزرسانی مشخصات روی همه پنل‌هایی که کاربر را دارند (قدیم + جدید)
    const panelsToUpdate = new Set<string>([
      ...currentRefs.map((r) => r.panelId),
      ...newRefs.map((r) => r.panelId),
    ]);
    for (const panelId of panelsToUpdate) {
      if (!emailExistsInPanel.get(panelId)) continue;
      const conn = await getPanelConnection(panelId);
      if (!conn.ok) { errors.push(`اتصال پنل: ${conn.msg}`); continue; }
      const proto = inboundIndex.get(refKey({ panelId, inboundId: newRefs[0]?.inboundId ?? -1 }))?.protocol || current.protocol;
      const upd = await updateClient(conn.conn as PanelAuth, email, proto, {
        email,
        id: undefined,
        limitIp: ipLimit,
        totalGB: trafficGB ? trafficGB * 1024 * 1024 * 1024 : 0,
        expiryTime,
        enable,
        subId: body.subId !== undefined ? body.subId : current.subId,
      });
      if (!upd.ok) errors.push(`ویرایش: ${upd.msg}`);
    }

    if (errors.length) {
      return NextResponse.json({ error: errors.join(" | ") }, { status: 502 });
    }

    await db.resellerUser.update({
      where: { id: tracked.id },
      data: {
        name: body.name !== undefined ? body.name.trim().slice(0, 60) || null : tracked.name,
        inboundIds: stringifyInboundRefs(newRefs),
        panelId: newRefs[0]?.panelId || tracked.panelId || "",
        trafficGB,
        subId: body.subId !== undefined ? body.subId : tracked.subId,
      },
    });

    await logActivity({
      actorType: "RESELLER",
      actorName: reseller.username,
      action: "ویرایش کاربر",
      detail: `${email} | سهمیه: ${trafficGB || "نامحدود"}GB | وضعیت: ${enable ? "فعال" : "غیرفعال"}`,
      resellerId: reseller.id,
    });

    const subLink = await buildSubLink(body.subId !== undefined ? body.subId : current.subId, reseller, newRefs[0]?.panelId || primaryPanelId);
    return NextResponse.json({ ok: true, subLink });
  } catch (e) {
    console.error("update user error:", e);
    return NextResponse.json({ error: "خطای داخلی در ویرایش کاربر" }, { status: 500 });
  }
}

/** حذف کاربر از همه پنل‌ها */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const { email: rawEmail } = await ctx.params;
  const email = decodeURIComponent(rawEmail);

  try {
    const reseller = await getResellerWithAccess(session.uid);
    if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

    const tracked = await db.resellerUser.findUnique({
      where: { resellerId_email: { resellerId: reseller.id, email } },
    });
    if (!tracked) return NextResponse.json({ error: "کاربر پیدا نشد" }, { status: 404 });

    // حذف از همه پنل‌ها
    const panels = await db.panelConfig.findMany({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
    const errors: string[] = [];
    let deletedFromAny = false;
    for (const panel of panels) {
      const conn = await getPanelConnection(panel.id);
      if (!conn.ok) continue;
      const r = await deleteClient(conn.conn as PanelAuth, email);
      if (r.ok) deletedFromAny = true;
      // "یافت نشد" خطا نیست — کاربر شاید فقط در پنل دیگری باشد
    }
    if (!deletedFromAny && panels.length > 0) {
      // حداقل یک تلاش واقعی انجام شده؛ اگر همه شکست خورده باشند پیام خطا بده
      const conn = await getPanelConnection(panels[0].id);
      if (conn.ok) {
        const r = await deleteClient(conn.conn as PanelAuth, email);
        if (!r.ok) errors.push(r.msg || "حذف ناموفق بود");
      }
    }
    if (errors.length) {
      return NextResponse.json({ error: `حذف ناموفق: ${errors.join(" | ")}` }, { status: 502 });
    }

    await db.resellerUser.delete({ where: { id: tracked.id } });
    await logActivity({
      actorType: "RESELLER",
      actorName: reseller.username,
      action: "حذف کاربر",
      detail: email,
      resellerId: reseller.id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("delete user error:", e);
    return NextResponse.json({ error: "خطای داخلی در حذف کاربر" }, { status: 500 });
  }
}
