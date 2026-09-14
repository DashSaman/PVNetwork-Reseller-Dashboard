import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess } from "@/lib/reseller-helpers";
import {
  ensureVerifyToken,
  verifyDomain,
  normalizeDomain,
  isValidDomain,
} from "@/lib/whitelabel";

/** دریافت تنظیمات وایت‌لیبل نماینده */
export async function GET(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  const verifyToken = reseller.customDomain || reseller.brandName ? await ensureVerifyToken(reseller.id) : null;

  // پورت و هاست عمومی سابسکریپشن (برای راهنمای دامنه اختصاصی)
  // پیش‌فرض: همان هاستی که پنل با آن باز شده — اگر پنل اصلی subBase داشته باشد همان ملاک است
  const primaryPanel = await db.panelConfig.findFirst({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
  const reqHost = (req.headers.get("host") || "").split(":")[0];
  let subPort = 2053;
  let subHost = reqHost || "panel.example.com";
  if (primaryPanel?.subBase) {
    try {
      const u = new URL(primaryPanel.subBase.trim());
      subPort = Number(u.port) || 443;
      subHost = u.hostname;
    } catch {
      // پیش‌فرض می‌ماند
    }
  }

  return NextResponse.json({
    whitelabel: {
      allowWhitelabel: reseller.allowWhitelabel,
      brandName: reseller.brandName,
      customDomain: reseller.customDomain,
      domainVerified: reseller.domainVerified,
      verifyToken,
      subPort,
      subHost,
    },
  });
}

/** ذخیره برند و دامنه */
export async function PUT(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  if (!reseller.allowWhitelabel) {
    return NextResponse.json({ error: "حساب شما اجازه وایت‌لیبل ندارد. با مدیر سامانه تماس بگیرید." }, { status: 403 });
  }

  const body = (await req.json()) as { brandName?: string; customDomain?: string };
  const brandName = body.brandName?.trim().slice(0, 60) || null;

  let customDomain: string | null = null;
  if (body.customDomain?.trim()) {
    customDomain = normalizeDomain(body.customDomain);
    if (!isValidDomain(customDomain)) {
      return NextResponse.json({ error: "قالب دامنه معتبر نیست (مثال: sub.myshop.ir)" }, { status: 400 });
    }
  }

  // اگر دامنه تغییر کرد، تأیید قبلی باطل می‌شود
  const domainChanged = customDomain !== reseller.customDomain;
  const verifyToken = await ensureVerifyToken(reseller.id);

  await db.reseller.update({
    where: { id: reseller.id },
    data: {
      brandName,
      customDomain,
      domainVerified: domainChanged ? false : reseller.domainVerified,
      verifyToken,
    },
  });

  return NextResponse.json({ ok: true, domainVerified: domainChanged ? false : reseller.domainVerified });
}

/** بررسی (تأیید) دامنه */
export async function POST() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

  if (!reseller.allowWhitelabel) {
    return NextResponse.json({ error: "حساب شما اجازه وایت‌لیبل ندارد" }, { status: 403 });
  }

  const result = await verifyDomain(reseller.id);
  return NextResponse.json(
    { ...result, error: result.ok ? undefined : result.msg },
    { status: result.ok ? 200 : 400 }
  );
}
