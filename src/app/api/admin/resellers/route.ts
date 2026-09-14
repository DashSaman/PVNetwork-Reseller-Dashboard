import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { hashPassword } from "@/lib/crypto";
import { logActivity } from "@/lib/logger";
import { validateUsername, type InboundRef } from "@/lib/reseller-helpers";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const resellers = await db.reseller.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      inbounds: true,
      users: { select: { id: true, trafficGB: true } },
    },
  });
  return NextResponse.json({
    resellers: resellers.map((r) => ({
      id: r.id,
      username: r.username,
      name: r.name,
      active: r.active,
      multiLocation: r.multiLocation,
      trafficPoolGB: r.trafficPoolGB,
      allocatedGB: r.users.reduce((s, u) => s + (u.trafficGB || 0), 0),
      usersCount: r.users.length,
      allowWhitelabel: r.allowWhitelabel,
      brandName: r.brandName,
      customDomain: r.customDomain,
      domainVerified: r.domainVerified,
      inbounds: r.inbounds.map((i) => ({
        panelId: i.panelId,
        inboundId: i.inboundId,
        inboundTag: i.inboundTag,
        protocol: i.protocol,
        port: i.port,
        remark: i.remark,
      })),
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const body = (await req.json()) as {
      username?: string;
      password?: string;
      name?: string;
      multiLocation?: boolean;
      trafficPoolGB?: number;
      allowIpLimit?: boolean;
      allowWhitelabel?: boolean;
      inbounds?: InboundRef[]; // فرمت جدید: {panelId, inboundId}
      inboundIds?: number[]; // سازگاری با فرمت قدیمی (پنل اصلی)
    };

    // نام کاربری نماینده: حروف انگلیسی بزرگ/کوچک، عدد، - و _ (به درخواست کارفرما)
    const username = body.username?.trim() || "";
    const uname = validateUsername(username);
    if (!uname.ok) return NextResponse.json({ error: uname.msg }, { status: 400 });
    if (!body.password || body.password.length < 4) {
      return NextResponse.json({ error: "رمز عبور حداقل ۴ کاراکتر باشد" }, { status: 400 });
    }

    // تجمیع refs از فرمت جدید یا قدیمی
    const refs: InboundRef[] = (body.inbounds && body.inbounds.length > 0
      ? body.inbounds
      : (body.inboundIds || []).map((inboundId) => ({ panelId: "", inboundId }))
    )
      .map((r) => ({ panelId: r.panelId || "", inboundId: Number(r.inboundId) }))
      .filter((r) => Number.isFinite(r.inboundId));
    if (refs.length === 0) {
      return NextResponse.json({ error: "حداقل یک اینباند باید برای نماینده انتخاب شود" }, { status: 400 });
    }

    // بررسی تکراری بودن نام کاربری (بدون حساسیت به حروف بزرگ/کوچک)
    const allResellers = await db.reseller.findMany({ select: { username: true } });
    const duplicate = allResellers.some((r) => r.username.toLowerCase() === username.toLowerCase());
    if (duplicate) {
      return NextResponse.json({ error: "این نام کاربری قبلاً استفاده شده است" }, { status: 409 });
    }

    // متادیتای اینباندها از همه پنل‌ها (در صورت دسترس بودن)
    const { getAllPanelInbounds } = await import("@/lib/panel-manager");
    const panelResult = await getAllPanelInbounds();
    const metaMap = new Map<string, { tag: string; protocol: string; port: number; remark: string }>();
    if (panelResult.ok) {
      for (const p of panelResult.panels) {
        for (const i of p.inbounds) {
          metaMap.set(`${p.panelId}::${i.id}`, { tag: i.tag, protocol: i.protocol, port: i.port, remark: i.remark });
        }
      }
    }

    const trafficPoolGB = Math.max(0, Math.round(Number(body.trafficPoolGB) || 0));

    const reseller = await db.reseller.create({
      data: {
        username,
        password: hashPassword(body.password),
        name: body.name?.trim() || null,
        multiLocation: !!body.multiLocation,
        trafficPoolGB,
        allowIpLimit: body.allowIpLimit ?? true,
        maxUsers: 0,
        maxTrafficGB: 0,
        maxExpiryDays: 0,
        maxIpLimit: 0,
        inbounds: {
          create: refs.map((r) => {
            const meta = metaMap.get(`${r.panelId}::${r.inboundId}`);
            return {
              panelId: r.panelId,
              inboundId: r.inboundId,
              inboundTag: meta?.tag || `inbound-${r.inboundId}`,
              protocol: meta?.protocol || "-",
              port: meta?.port || 0,
              remark: meta?.remark || null,
            };
          }),
        },
      },
    });

    await logActivity({
      actorType: "ADMIN",
      actorName: admin.username,
      action: "ایجاد نماینده",
      detail: `نماینده ${username} — پول: ${trafficPoolGB > 0 ? `${trafficPoolGB} گیگ` : "نامحدود"} — ${refs.length} اینباند`,
      resellerId: reseller.id,
    });
    return NextResponse.json({ ok: true, id: reseller.id });
  } catch (e) {
    console.error("create reseller error:", e);
    return NextResponse.json({ error: "خطا در ایجاد نماینده" }, { status: 500 });
  }
}
