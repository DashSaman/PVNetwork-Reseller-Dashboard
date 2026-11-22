import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { getSupportContact, parseSupportTelegramUsername, setSupportTelegramUsername } from "@/lib/support-contact";

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const { username } = await getSupportContact();
  return NextResponse.json({ username });
}

export async function PUT(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const body = await req.json().catch(() => null) as { username?: unknown } | null;
  const username = parseSupportTelegramUsername(body?.username);
  if (username === null) {
    return NextResponse.json({ error: "آیدی تلگرام باید ۵ تا ۳۲ کاراکتر از حروف انگلیسی، اعداد یا زیرخط باشد." }, { status: 400 });
  }
  await setSupportTelegramUsername(username);
  return NextResponse.json({ username });
}
