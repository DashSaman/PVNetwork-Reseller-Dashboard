import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess, refKey } from "@/lib/reseller-helpers";
import { getPrimaryPanel } from "@/lib/panel-manager";
import { getSelectableInboundCatalog } from '@/lib/inbound-catalog';
import { publicLocationLabel } from '@/lib/reseller-presentation';

/**
 * تست اتصال ربات به پل 3x-ui — همان چیزی که ربات هنگام اتصال انجام می‌دهد:
 * بررسی سوییچ اتصال، دسترسی به پنل(ها) و شمارش اینباندهای در دسترس ربات.
 * (رمز عبور ربات همان رمز داشبورد نماینده است و اینجا نیازی به آن نیست)
 */
export async function POST() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  if (!reseller.mirzaEnabled) {
    return NextResponse.json({ ok: false, msg: "سوییچ اتصال ربات خاموش است — ابتدا آن را روشن و ذخیره کنید", inbounds: 0 }, { status: 400 });
  }

  const primary = (await getPrimaryPanel())?.id || "";
  const panelResult = await getSelectableInboundCatalog();
  if (!panelResult.panels.length) {
    return NextResponse.json({ ok: false, msg: "بررسی زندهٔ سرویس فعلاً ممکن نیست", inbounds: 0 }, { status: 400 });
  }

  const allowed = new Set(
    reseller.inbounds.map((i) => refKey({ panelId: i.panelId || primary, inboundId: i.inboundId }))
  );
  let inbounds = 0;
  const list: { id: number; tag: string; protocol: string; port: number }[] = [];
  for (const bundle of panelResult.panels) {
    for (const inb of bundle.inbounds) {
      if (allowed.has(refKey({ panelId: bundle.panelId, inboundId: inb.id })) && panelResult.available.has(refKey({ panelId: bundle.panelId, inboundId: inb.id }))) {
        inbounds++;
        list.push({ id: inb.id, tag: publicLocationLabel(inb.remark || inb.tag, bundle.panelName), protocol: inb.protocol, port: inb.port });
      }
    }
  }

  return NextResponse.json({
    ok: inbounds > 0,
    msg: inbounds > 0 ? `دسترسی API بررسی شد — ${inbounds} لوکیشن آمادهٔ انتخاب است` : "فعلاً لوکیشن آنلاین و مجازی در دسترس نیست",
    inbounds,
    list,
  });
}
