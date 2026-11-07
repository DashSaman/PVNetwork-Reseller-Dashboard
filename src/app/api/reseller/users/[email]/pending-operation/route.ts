import { NextRequest, NextResponse } from 'next/server';
import { requireReseller } from '@/lib/session';
import { cancelUnstartedOperation } from '@/lib/accounting-ops';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ email: string }> }) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  try {
    const input = await req.json().catch(() => null);
    if (!input || typeof input.operationId !== 'string' || !input.operationId.trim() || input.operationId.length > 100) return NextResponse.json({ error: 'شناسهٔ دقیق درخواست لازم است' }, { status: 400 });
    const { email } = await ctx.params;
    const result = await cancelUnstartedOperation(session.uid, decodeURIComponent(email), input.operationId);
    return result.ok ? NextResponse.json({ ok: true, message: result.message }) : NextResponse.json({ error: result.msg }, { status: result.status });
  } catch (error) {
    console.error('pending operation cancellation:', error);
    return NextResponse.json({ error: 'لغو تأیید نشد؛ وضعیت کاربر را به‌روزرسانی کنید' }, { status: 500 });
  }
}
