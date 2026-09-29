import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { hashPassword } from "@/lib/crypto";
import { getAllPanelInbounds } from "@/lib/panel-manager";
import { logActivity } from "@/lib/logger";
import { refKey, type InboundRef } from "@/lib/reseller-helpers";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const { id } = await ctx.params;
  const r = await db.reseller.findUnique({ where: { id }, include: { inbounds: true, users: true } });
  if (!r) return NextResponse.json({ error: "نماینده پیدا نشد" }, { status: 404 });
  return NextResponse.json({
    reseller: {
      id: r.id,
      username: r.username,
      name: r.name,
      active: r.active,
      multiLocation: r.multiLocation,
      trafficPoolGB: r.trafficPoolGB,
      allocatedGB: r.users.reduce((s, u) => s + (u.trafficGB || 0), 0),
      allowIpLimit: r.allowIpLimit,
      inbounds: r.inbounds,
      users: r.users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        inboundIds: u.inboundIds,
        trafficGB: u.trafficGB,
        createdAt: u.createdAt,
      })),
    },
  });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const body = (await req.json()) as {
      password?: string;
      name?: string;
      active?: boolean;
      multiLocation?: boolean;
      trafficPoolGB?: number;
      allowIpLimit?: boolean;
      allowWhitelabel?: boolean;
      disable2fa?: boolean;
    overrideSafety?: boolean; // تایید صریح کاهش پول زیر تعهدات // اضطراری: خاموش‌سازی ورود دومرحله‌ای نماینده توسط ادمین
      inbounds?: InboundRef[]; // فرمت جدید
      inboundIds?: number[]; // سازگاری قدیمی
    };

    const current = await db.reseller.findUnique({ where: { id }, include: { inbounds: true } });
    if (!current) return NextResponse.json({ error: "نماینده پیدا نشد" }, { status: 404 });

    // اگر پول کوچک‌تر از تعهدات قطعی (تخصیص + رزروهای فعال + مصرف) شود، اجازه داده نمی‌شود
    if (body.trafficPoolGB !== undefined) {
      const newPool = Math.max(0, Math.round(Number(body.trafficPoolGB) || 0));
      if (newPool > 0) {
        const { getQuotaState } = await import("@/lib/accounting-ops");
        const q = await getQuotaState(id, current);
        const obligations = q.allocated + q.reserved + q.consumed;
        if (newPool < obligations && body.overrideSafety !== true) {
          return NextResponse.json(
            { error: `پول جدید (${newPool} گیگ) کمتر از تعهدات فعلی (${Math.round(obligations * 100) / 100} گیگ = تخصیص ${q.allocated} + رزرو ${q.reserved} + مصرف ${q.consumed}) است — برای تایید صریح، overrideSafety ارسال کنید` },
            { status: 409 }
          );
        }
        if (newPool < obligations && body.overrideSafety === true) {
          await logActivity({ actorType: "ADMIN", actorName: "admin", action: "تغییر پول زیر تعهدات (override صریح)", detail: `new=${newPool} obligations=${obligations}` });
        }
      }
    }

    const data: Record<string, unknown> = {
      name: body.name?.trim() || null,
      active: body.active ?? current.active,
      multiLocation: body.multiLocation ?? current.multiLocation,
      allowIpLimit: body.allowIpLimit ?? current.allowIpLimit,
      allowWhitelabel: body.allowWhitelabel ?? current.allowWhitelabel,
    };
    if (body.trafficPoolGB !== undefined) data.trafficPoolGB = Math.max(0, Math.round(Number(body.trafficPoolGB) || 0));
    if (body.password && body.password.length >= 4) {
      data.password = hashPassword(body.password);
    }
    // خاموش‌سازی اضطراری ورود دومرحله‌ای نماینده (اگر اپ Authenticator را از دست داده باشد)
    if (body.disable2fa === true) {
      data.totpSecret = null;
      data.totpEnabled = false;
    }

    // به‌روزرسانی اینباندهای مجاز (فرمت refs جدید یا ids قدیمی)
    const newRefs: InboundRef[] | null =
      body.inbounds && body.inbounds.length > 0
        ? body.inbounds.map((r) => ({ panelId: r.panelId || "", inboundId: Number(r.inboundId) })).filter((r) => Number.isFinite(r.inboundId))
        : body.inboundIds && body.inboundIds.length > 0
          ? body.inboundIds.map((inboundId) => ({ panelId: "", inboundId }))
          : null;

    if (newRefs && newRefs.length > 0) {
      const panelResult = await getAllPanelInbounds();
      const metaMap = new Map<string, { tag: string; protocol: string; port: number; remark: string }>();
      if (panelResult.ok) {
        for (const p of panelResult.panels) {
          for (const i of p.inbounds) {
            metaMap.set(`${p.panelId}::${i.id}`, { tag: i.tag, protocol: i.protocol, port: i.port, remark: i.remark });
          }
        }
      }
      const currentKeys = new Set(current.inbounds.map((i) => refKey({ panelId: i.panelId, inboundId: i.inboundId })));
      const newKeys = new Set(newRefs.map(refKey));
      const toRemove = current.inbounds.filter((i) => !newKeys.has(refKey({ panelId: i.panelId, inboundId: i.inboundId }))).map((i) => i.id);
      const toAdd = newRefs.filter((r) => !currentKeys.has(refKey(r)));
      if (toRemove.length) {
        await db.resellerInbound.deleteMany({ where: { id: { in: toRemove } } });
      }
      if (toAdd.length) {
        await db.resellerInbound.createMany({
          data: toAdd.map((r) => {
            const meta = metaMap.get(`${r.panelId}::${r.inboundId}`);
            return {
              resellerId: id,
              panelId: r.panelId,
              inboundId: r.inboundId,
              inboundTag: meta?.tag || `inbound-${r.inboundId}`,
              protocol: meta?.protocol || "-",
              port: meta?.port || 0,
              remark: meta?.remark || null,
            };
          }),
        });
      }
    }

    await db.reseller.update({ where: { id }, data });
    await logActivity({
      actorType: "ADMIN",
      actorName: admin.username,
      action: "ویرایش نماینده",
      detail: `نماینده ${current.username} به‌روزرسانی شد${data.trafficPoolGB !== undefined ? ` — پول جدید: ${data.trafficPoolGB as number} گیگ` : ""}`,
      resellerId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("update reseller error:", e);
    return NextResponse.json({ error: "خطا در ویرایش نماینده" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const { id } = await ctx.params;

  const current = await db.reseller.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "نماینده پیدا نشد" }, { status: 404 });

  // حذف ناامن ممنوع: کاربران tracked یا عملیات فعال یعنی کلاینت‌های ریموتِ متعلق به این نماینده زنده‌اند
  const userCount = await db.resellerUser.count({ where: { resellerId: id } });
  const activeOps = await db.operationJournal.count({ where: { resellerId: id, status: { in: ["PENDING", "RUNNING", "PARTIAL", "NEEDS_REPAIR"] } } });
  if (userCount > 0 || activeOps > 0) {
    return NextResponse.json(
      { error: `این نماینده ${userCount} کاربر فعال و ${activeOps} عملیات در جریان دارد — ابتدا کاربران را مدیریت کنید و سپس حذف را تکرار کنید (حذف رکورد محلی، کلاینت‌های VPN ریموت را زنده نگه می‌دارد)` },
      { status: 409 }
    );
  }

  await db.reseller.delete({ where: { id } });
  await logActivity({
    actorType: "ADMIN",
    actorName: admin.username,
    action: "حذف نماینده",
    detail: `نماینده ${current.username} حذف شد`,
  });
  return NextResponse.json({ ok: true });
}
