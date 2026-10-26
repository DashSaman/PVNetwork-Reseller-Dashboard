import { NextRequest, NextResponse } from "next/server";
import { requireReseller } from "@/lib/session";
import { rotateUserSubscription } from "@/lib/subscription-rotation";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ email: string }> }) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  try {
    const { email } = await ctx.params;
    const result = await rotateUserSubscription(session.uid, email);
    return NextResponse.json(result, { status: result.ok ? 200 : result.status, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "تغییر لینک کامل نشد؛ پس از رفع خطا همان عملیات را ادامه دهید" }, { status: 500 });
  }
}
