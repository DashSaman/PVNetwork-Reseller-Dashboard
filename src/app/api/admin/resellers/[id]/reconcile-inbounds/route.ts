import { NextRequest, NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { reconcileInboundRevocations, runInboundRevocationWorker } from '@/lib/inbound-revocation';
import { isAdminManagedReseller } from '@/lib/reseller-ownership';

/** Explicit administrative continuation, never a native mutation from GET. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const { id } = await ctx.params;
  if (!await db.reseller.findUnique({ where: { id } }) || await isAdminManagedReseller(id)) return NextResponse.json({ error: 'نماینده پیدا نشد' }, { status: 404 });
  const result = await reconcileInboundRevocations(id, { schedule: true, maxUsers: 1, budgetMs: 20000 });
  if (result.pending) after(async () => { await runInboundRevocationWorker(id); });
  return NextResponse.json({ ok: true, ...result });
}
