import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { testTelegram } from "@/lib/telegram";
import { logActivity } from "@/lib/logger";

/** تنظیمات تلگرام نماینده */
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const r = await db.reseller.findUnique({ where: { id: session.uid }, select: { tgBotToken: true, tgChatId: true, tgEnabled: true } });
  if (!r) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });

  return NextResponse.json({
    telegram: {
      enabled: r.tgEnabled,
      chatId: r.tgChatId || "",
      hasToken: !!r.tgBotToken,
      tokenPreview: r.tgBotToken ? "••••••••" : "",
    },
  });
}

/** ذخیره تنظیمات — PUT { botToken?, chatId, enabled } */
export async function PUT(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const { botToken, chatId, enabled } = (await req.json()) as { botToken?: string; chatId?: string; enabled?: boolean };
    const current = await db.reseller.findUnique({ where: { id: session.uid }, select: { id: true, tgBotToken: true, username: true } });
    if (!current) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });

    const data: { tgBotToken?: string; tgChatId?: string; tgEnabled: boolean } = {
      tgEnabled: !!enabled,
      tgChatId: (chatId || "").trim(),
    };
    if (botToken && botToken.trim()) {
      const clean = botToken.trim();
      if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(clean)) {
        return NextResponse.json({ error: "فرمت توکن بات صحیح نیست — از @BotFather بگیرید (مثل 123456789:AAE...)" }, { status: 400 });
      }
      data.tgBotToken = encryptSecret(clean);
    } else if (!current.tgBotToken && enabled) {
      return NextResponse.json({ error: "برای فعال‌سازی، توکن بات الزامی است" }, { status: 400 });
    }

    await db.reseller.update({ where: { id: current.id }, data });
    await logActivity({
      actorType: "RESELLER",
      actorName: current.username,
      action: enabled ? "فعال‌سازی اعلان تلگرام" : "ذخیره تنظیمات تلگرام",
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

  const result = await testTelegram(r);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
