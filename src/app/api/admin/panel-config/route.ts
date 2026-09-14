import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { invalidatePanelCache, getPrimaryPanel } from "@/lib/panel-manager";
import { logActivity } from "@/lib/logger";

/** لیست همه پنل‌ها */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const panels = await db.panelConfig.findMany({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
  const counts = await db.resellerInbound.groupBy({ by: ["panelId"], _count: { _all: true } });
  const countMap = new Map(counts.map((c) => [c.panelId, c._count._all]));

  return NextResponse.json({
    panels: panels.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      username: p.username,
      hasPassword: !!p.password,
      hasApiToken: !!p.apiToken,
      subBase: p.subBase || "",
      subPath: p.subPath || "sub",
      active: p.active,
      sortOrder: p.sortOrder,
      inboundsAssigned: countMap.get(p.id) || 0,
      updatedAt: p.updatedAt,
    })),
    // سازگاری با UI قدیمی: پنل اصلی
    config: panels[0]
      ? {
          id: panels[0].id,
          name: panels[0].name,
          baseUrl: panels[0].baseUrl,
          username: panels[0].username,
          hasPassword: !!panels[0].password,
          hasApiToken: !!panels[0].apiToken,
          subBase: panels[0].subBase || "",
          subPath: panels[0].subPath || "sub",
          updatedAt: panels[0].updatedAt,
        }
      : null,
  });
}

/** افزودن پنل جدید */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const body = (await req.json()) as {
      name?: string;
      baseUrl?: string;
      username?: string;
      password?: string;
      apiToken?: string;
      subBase?: string;
      subPath?: string;
    };
    if (!body.baseUrl || !body.username) {
      return NextResponse.json({ error: "آدرس پنل و نام کاربری الزامی است" }, { status: 400 });
    }
    if (!body.apiToken && !body.password) {
      return NextResponse.json({ error: "یا API Token وارد کنید یا رمز عبور پنل" }, { status: 400 });
    }
    if (!/^https?:\/\//.test(body.baseUrl.trim())) {
      return NextResponse.json({ error: "آدرس پنل باید با http:// یا https:// شروع شود" }, { status: 400 });
    }
    const baseUrl = body.baseUrl.trim().replace(/\/+$/, "");
    const dup = await db.panelConfig.findUnique({ where: { baseUrl } });
    if (dup) {
      return NextResponse.json({ error: "این آدرس پنل قبلاً ثبت شده است" }, { status: 409 });
    }

    const maxSort = await db.panelConfig.aggregate({ _max: { sortOrder: true } });
    const panel = await db.panelConfig.create({
      data: {
        name: body.name?.trim() || `پنل ${(maxSort._max.sortOrder || 0) + 2}`,
        baseUrl,
        username: body.username.trim(),
        password: body.password ? encryptSecret(body.password) : encryptSecret("token-only"),
        apiToken: body.apiToken ? encryptSecret(body.apiToken) : null,
        subBase: body.subBase?.trim() || null,
        subPath: body.subPath?.trim() || "sub",
        active: true,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
      },
    });
    invalidatePanelCache();
    await logActivity({
      actorType: "ADMIN",
      actorName: admin.username,
      action: "افزودن پنل جدید",
      detail: `${panel.name} — ${panel.baseUrl}`,
    });
    return NextResponse.json({ ok: true, id: panel.id });
  } catch (e) {
    console.error("panel add error:", e);
    return NextResponse.json({ error: "خطا در افزودن پنل" }, { status: 500 });
  }
}

/** ویرایش پنل (با id؛ بدون id = پنل اصلی — سازگاری با نسخه قبلی) */
export async function PUT(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const body = (await req.json()) as {
      id?: string;
      name?: string;
      baseUrl?: string;
      username?: string;
      password?: string;
      apiToken?: string;
      subBase?: string;
      subPath?: string;
      active?: boolean;
    };
    const existing = body.id
      ? await db.panelConfig.findUnique({ where: { id: body.id } })
      : await getPrimaryPanel();
    if (!existing) return NextResponse.json({ error: "پنل پیدا نشد" }, { status: 404 });
    if (!body.baseUrl || !body.username) {
      return NextResponse.json({ error: "آدرس پنل و نام کاربری الزامی است" }, { status: 400 });
    }
    if (!body.apiToken && !body.password && !existing.apiToken && !existing.password) {
      return NextResponse.json({ error: "یا API Token وارد کنید یا رمز عبور پنل" }, { status: 400 });
    }
    if (!/^https?:\/\//.test(body.baseUrl.trim())) {
      return NextResponse.json({ error: "آدرس پنل باید با http:// یا https:// شروع شود" }, { status: 400 });
    }
    const baseUrl = body.baseUrl.trim().replace(/\/+$/, "");
    const dup = await db.panelConfig.findUnique({ where: { baseUrl } });
    if (dup && dup.id !== existing.id) {
      return NextResponse.json({ error: "این آدرس پنل قبلاً ثبت شده است" }, { status: 409 });
    }

    const data: Record<string, unknown> = {
      name: body.name?.trim() || existing.name,
      baseUrl,
      username: body.username.trim(),
      subBase: body.subBase?.trim() || null,
      subPath: body.subPath?.trim() || "sub",
    };
    if (body.active !== undefined) data.active = !!body.active;
    if (body.password) data.password = encryptSecret(body.password);
    if (body.apiToken !== undefined) data.apiToken = body.apiToken ? encryptSecret(body.apiToken) : null;

    await db.panelConfig.update({ where: { id: existing.id }, data });
    invalidatePanelCache();
    await logActivity({
      actorType: "ADMIN",
      actorName: admin.username,
      action: "ویرایش پنل",
      detail: `${data.name as string} — ${baseUrl}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("panel update error:", e);
    return NextResponse.json({ error: "خطا در ذخیره تنظیمات" }, { status: 500 });
  }
}

/** حذف پنل — اگر اینباندی به نماینده‌ها اختصاص یافته باشد اجازه داده نمی‌شود */
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "شناسه پنل الزامی است" }, { status: 400 });

  const panel = await db.panelConfig.findUnique({ where: { id } });
  if (!panel) return NextResponse.json({ error: "پنل پیدا نشد" }, { status: 404 });

  const total = await db.panelConfig.count();
  if (total <= 1) {
    return NextResponse.json({ error: "حداقل یک پنل باید باقی بماند" }, { status: 400 });
  }
  const assigned = await db.resellerInbound.count({ where: { panelId: id } });
  if (assigned > 0) {
    return NextResponse.json(
      { error: `این پنل به ${assigned} اینباند اختصاص‌یافته در نماینده‌ها ارجاع دارد. ابتدا دسترسی‌ها را ویرایش کنید.` },
      { status: 400 }
    );
  }

  await db.panelConfig.delete({ where: { id } });
  invalidatePanelCache();
  await logActivity({
    actorType: "ADMIN",
    actorName: admin.username,
    action: "حذف پنل",
    detail: `${panel.name} — ${panel.baseUrl}`,
  });
  return NextResponse.json({ ok: true });
}
