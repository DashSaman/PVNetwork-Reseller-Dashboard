import { NextRequest, NextResponse } from "next/server";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess, getAllocatedGB, validateUsername, sanitizeName, type InboundRef } from "@/lib/reseller-helpers";
import { getAllPanelInbounds } from "@/lib/panel-manager";
import { createResellerUserCore } from "@/lib/user-create";
import { db } from "@/lib/db";

const MAX_BULK = 50;

/** ساخت گروهی کاربران — نام = پیشوند + شماره (مثل shop01 … shop20) */
export async function POST(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const reseller = await getResellerWithAccess(session.uid);
    if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

    const body = (await req.json()) as {
      prefix?: string;
      count?: number;
      trafficGB?: number;
      expiryDate?: string;
      expiryDays?: number;
      ipLimit?: number;
      inbounds?: InboundRef[];
      inboundIds?: number[];
    };

    const prefixRaw = (body.prefix || "").trim();
    const prefixCheck = validateUsername(prefixRaw ? prefixRaw : "user");
    if (!prefixCheck.ok) return NextResponse.json({ error: `پیشوند نام: ${prefixCheck.msg}` }, { status: 400 });
    const prefix = sanitizeName(prefixRaw) || "user";

    const count = Math.min(MAX_BULK, Math.max(1, Math.floor(Number(body.count) || 1)));
    const trafficGB = Math.max(0, Number(body.trafficGB) || 0); // ۰ = نامحدود
    const ipLimit = reseller.allowIpLimit ? Math.max(0, Number(body.ipLimit) || 0) : 0;

    // ---- پول ترافیک: کل دسته یک‌جا بررسی می‌شود ----
    if (reseller.trafficPoolGB > 0 && trafficGB <= 0) {
      return NextResponse.json({ error: "پول ترافیک شما محدود است — سهمیه هر کاربر باید عددی مثبت باشد" }, { status: 400 });
    }
    if (reseller.trafficPoolGB > 0) {
      const allocatedGB = await getAllocatedGB(reseller.id);
      const need = trafficGB * count;
      const remaining = reseller.trafficPoolGB - allocatedGB;
      if (need > remaining) {
        return NextResponse.json(
          { error: `ظرفیت پول کافی نیست — برای ${count} کاربر × ${trafficGB} گیگ، ${need} گیگ لازم است اما فقط ${Math.max(0, Math.floor(remaining))} گیگ باقی مانده` },
          { status: 403 }
        );
      }
    }

    // ---- اینباندها ----
    const primaryPanel = await db.panelConfig.findFirst({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
    const primaryPanelId = primaryPanel?.id || "";
    const refs: InboundRef[] = (body.inbounds && body.inbounds.length > 0
      ? body.inbounds
      : (body.inboundIds || []).map((inboundId) => ({ panelId: primaryPanelId, inboundId }))
    )
      .map((r) => ({ panelId: r.panelId || primaryPanelId, inboundId: Number(r.inboundId) }))
      .filter((r) => Number.isFinite(r.inboundId));
    if (refs.length === 0) {
      return NextResponse.json({ error: "حداقل یک اینباند (لوکیشن) انتخاب کنید" }, { status: 400 });
    }

    // ---- انقضا ----
    let expiryTime = 0; // ۰ = نامحدود
    if (body.expiryDate) {
      expiryTime = new Date(body.expiryDate + "T23:59:59").getTime();
    } else if (body.expiryDays && body.expiryDays > 0) {
      expiryTime = Date.now() + body.expiryDays * 24 * 60 * 60 * 1000;
    }

    // ---- اسنپ‌شات یک‌باره اینباندهای زنده (برای کل دسته) ----
    const snapshot = await getAllPanelInbounds();
    if (!snapshot.ok) {
      return NextResponse.json({ error: snapshot.msg || "هیچ پنلی در دسترس نیست" }, { status: 502 });
    }

    // ---- حلقه ساخت ----
    const created: { email: string; subId: string; subLink: string | null }[] = [];
    const failed: { name: string; error: string }[] = [];
    const pad = count >= 10 ? 2 : 1;

    for (let i = 1; i <= count; i++) {
      const name = `${prefix}${String(i).padStart(pad, "0")}`;
      const r = await createResellerUserCore(
        reseller,
        { name, trafficGB, expiryTime, ipLimit, refs },
        snapshot,
        { skipPoolCheck: true } // پیش‌موجه برای کل دسته بررسی شد
      );
      if (r.ok) {
        created.push({ email: r.email, subId: r.subId, subLink: r.subLink });
      } else {
        failed.push({ name, error: r.error });
        // خطای زیرساختی (اتصال پنل) — ادامه بی‌فایده است
        if (r.status === 502) break;
      }
    }

    // اعلان تلگرام — ناهمزمان بدون بلاک کردن پاسخ
    if (created.length > 0) {
      void (async () => {
        try {
          const { notifyUserCreated } = await import("@/lib/telegram");
          await notifyUserCreated(
            reseller,
            created.map((c) => ({ email: c.email, subLink: c.subLink, trafficGB })),
            "bulk"
          );
        } catch {
          /* بی‌صدا */
        }
      })();
    }

    return NextResponse.json({
      ok: created.length > 0,
      requested: count,
      createdCount: created.length,
      failedCount: failed.length,
      created,
      failed,
    });
  } catch (e) {
    console.error("bulk create users error:", e);
    return NextResponse.json({ error: "خطای داخلی در ساخت گروهی کاربران" }, { status: 500 });
  }
}
