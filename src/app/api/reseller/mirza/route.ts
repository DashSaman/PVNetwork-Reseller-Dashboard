import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { testMirza } from "@/lib/telegram";
import { logActivity } from "@/lib/logger";

/** تنظیمات ربات میرزا پنل نماینده — کانال دوم اعلان‌ها با همان امکانات تلگرام */
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const r = await db.reseller.findUnique({ where: { id: session.uid }, select: { mirzaBotToken: true, mirzaChatId: true, mirzaEnabled: true } });
  if (!r) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });

  return NextResponse.json({
    mirza: {
      enabled: r.mirzaEnabled,
      chatId: r.mirzaChatId || "",
      hasToken: !!r.mirzaBotToken,
      tokenPreview: r.mirzaBotToken ? "••••••••" : "",
    },
  });
}

/** ذخیره تنظیمات — PUT { botToken?, chatId, enabled } */
export async function PUT(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const { botToken, chatId, enabled } = (await req.json()) as { botToken?: string; chatId?: string; enabled?: boolean };
    const current = await db.reseller.findUnique({ where: { id: session.uid }, select: { id: true, mirzaBotToken: true, username: true } });
    if (!current) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });

    const data: { mirzaBotToken?: string; mirzaChatId?: string; mirzaEnabled: boolean } = {
      mirzaEnabled: !!enabled,
      mirzaChatId: (chatId || "").trim(),
    };
    if (botToken && botToken.trim()) {
      const clean = botToken.trim();
      if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(clean)) {
        return NextResponse.json({ error: "فرمت توکن بات صحیح نیست — توکن بات تلگرامی خود را وارد کنید (مثل 123456789:AAE...)" }, { status: 400 });
      }
      data.mirzaBotToken = encryptSecret(clean);
    } else if (!current.mirzaBotToken && enabled) {
      return NextResponse.json({ error: "برای فعال‌سازی ربات میرزا، توکن بات الزامی است" }, { status: 400 });
    }

    await db.reseller.update({ where: { id: current.id }, data });
    await logActivity({
      actorType: "RESELLER",
      actorName: current.username,
      action: enabled ? "فعال‌سازی ربات میرزا پنل" : "ذخیره تنظیمات ربات میرزا پنل",
      resellerId: current.id,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "خطای داخلی سرور" }, { status: 500 });
  }
}

/** تست ارسال پیام — POST */
export async function POST() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const r = await db.reseller.findUnique({ where: { id: session.uid } });
  if (!r) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });

  const result = await testMirza(r);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
