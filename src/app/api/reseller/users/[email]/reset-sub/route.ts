import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getAllPanelInbounds, getPanelConnection, buildSubLink } from "@/lib/panel-manager";
import { getResellerWithAccess } from "@/lib/reseller-helpers";
import { updateClient, type PanelAuth, type PanelClient } from "@/lib/panel";
import { randomHex } from "@/lib/crypto";
import { logActivity } from "@/lib/logger";

type Ctx = { params: Promise<{ email: string }> };

/**
 * دوباره‌سازی لینک اشتراک کاربر — subId جدید برای همه پنل‌ها اعمال می‌شود
 * (وقتی لینک قبلی لو رفته یا می‌خواهیم دسترسی مشترک قبلی قطع شود)
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
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

    // ---- وضعیت فعلی کلاینت از همه پنل‌ها ----
    const panelResult = await getAllPanelInbounds();
    if (!panelResult.ok) {
      return NextResponse.json({ error: panelResult.msg || "هیچ پنلی در دسترس نیست" }, { status: 502 });
    }

    // مشخصات کامل کلاینت (برای حفظ تنظیمات فعلی هنگام ویرایش)
    type Found = {
      panelId: string;
      inboundIds: number[];
      protocol: string;
      client: PanelClient;
    };
    const found: Found[] = [];
    for (const bundle of panelResult.panels) {
      for (const inb of bundle.inbounds) {
        const c = inb.clients.find((x) => x.email === email);
        const st = inb.clientStats.find((x) => x.email === email);
        if (!c && !st) continue;
        found.push({
          panelId: bundle.panelId,
          inboundIds: [inb.id],
          protocol: inb.protocol,
          client: {
            email,
            id: c?.id || "",
            password: c?.password || "",
            flow: c?.flow || "",
            limitIp: c?.limitIp ?? 0,
            totalGB: st?.total ?? c?.totalGB ?? 0,
            expiryTime: st?.expiryTime ?? c?.expiryTime ?? 0,
            enable: st?.enable ?? c?.enable ?? true,
            reset: c?.reset ?? 0,
          },
        });
      }
    }
    if (found.length === 0) {
      return NextResponse.json({ error: "کاربر در پنل یافت نشد (احتمالاً حذف شده)" }, { status: 404 });
    }

    // ---- subId جدید روی همه پنل‌ها ----
    const newSubId = randomHex(16);
    const errors: string[] = [];
    const touchedPanels = new Set<string>();
    for (const f of found) {
      if (touchedPanels.has(f.panelId)) continue;
      touchedPanels.add(f.panelId);
      const conn = await getPanelConnection(f.panelId);
      if (!conn.ok) {
        errors.push(`اتصال به پنل ناموفق: ${conn.msg}`);
        continue;
      }
      const r = await updateClient(conn.conn as PanelAuth, email, f.protocol, {
        ...f.client,
        subId: newSubId,
      });
      if (!r.ok) errors.push(r.msg || "ویرایش ناموفق بود");
    }
    if (errors.length) {
      return NextResponse.json(
        { error: `دوباره‌سازی لینک ناموفق بود: ${errors.join(" | ")}` },
        { status: 502 }
      );
    }

    // ---- به‌روزرسانی دیتابیس + لاگ ----
    await db.resellerUser.update({
      where: { resellerId_email: { resellerId: reseller.id, email } },
      data: { subId: newSubId },
    });
    const subLink = await buildSubLink(newSubId, reseller, tracked.panelId || found[0].panelId);
    await logActivity({
      actorType: "RESELLER",
      actorName: reseller.username,
      action: "دوباره‌سازی لینک اشتراک",
      detail: email,
      resellerId: reseller.id,
    });

    return NextResponse.json({ ok: true, subId: newSubId, subLink });
  } catch (e) {
    console.error("reset sub error:", e);
    return NextResponse.json({ error: "خطای داخلی در دوباره‌سازی لینک" }, { status: 500 });
  }
}
