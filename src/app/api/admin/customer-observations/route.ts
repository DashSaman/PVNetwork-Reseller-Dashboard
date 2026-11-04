import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { collectCustomerObservations } from '@/lib/customer-observations';
import { customerHistory, customerLastOnline, customerMetadata } from '@/lib/customer-management';
import { confirmQueuedCreations } from '@/lib/user-create';
import { logActivity } from '@/lib/logger';
export const maxDuration = 300;
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  // Operator reconciliation only: no observation lease, threshold delivery or native mutation.
  if (req.nextUrl.searchParams.get('reconcileCreations') === '1') {
    let registered = 0, confirmed = 0;
    for (const owner of await db.reseller.findMany({ where: { active: true }, select: { id: true } })) {
      const result = await confirmQueuedCreations(owner.id, { recoverUntracked: true });
      registered += result.registered;confirmed += result.confirmed;
    }
    if (registered || confirmed) await logActivity({ actorType: 'ADMIN', actorName: admin.username, action: 'پیگیری ساخت‌های ثبت‌شده', detail: `${registered} ثبت محلی؛ ${confirmed} تأیید همگام‌سازی` });
    return NextResponse.json({ ok: true, registered, confirmed }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const result = await collectCustomerObservations();
  return NextResponse.json(result, { status: result.busy ? 409 : 200 });
}
export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    const user = await db.resellerUser.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: 'کاربر پیدا نشد' }, { status: 404 });
    const operations = await db.operationJournal.findMany({ where: { userId: id, resellerId: user.resellerId }, orderBy: { createdAt: 'desc' }, take: 30, select: { type: true, status: true, createdAt: true, updatedAt: true } });
    return NextResponse.json({ history: await customerHistory(id), operations }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  const users = await db.resellerUser.findMany();
  const [meta, online] = await Promise.all([customerMetadata(users), customerLastOnline(users)]);
  return NextResponse.json({ users: meta.map(u => ({ ...u, lastOnline: online.get(u.email) ?? null })) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
