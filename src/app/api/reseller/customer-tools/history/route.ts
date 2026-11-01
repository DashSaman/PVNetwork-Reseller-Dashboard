import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireReseller } from '@/lib/session';
import { getResellerWithAccess } from '@/lib/reseller-helpers';
import { customerHistory } from '@/lib/customer-management';
export async function GET(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  if (!await getResellerWithAccess(session.uid)) return NextResponse.json({ error: 'حساب فعال نیست' }, { status: 403 });
  const email = req.nextUrl.searchParams.get('email') || '';
  const user = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId: session.uid, email } } });
  if (!user) return NextResponse.json({ error: 'کاربر پیدا نشد' }, { status: 404 });
  const operations = await db.operationJournal.findMany({ where: { resellerId: session.uid, userId: user.id }, orderBy: { createdAt: 'desc' }, take: 30, select: { type: true, status: true, createdAt: true, updatedAt: true } });
  return NextResponse.json({ history: await customerHistory(user.id), operations }, { headers: { 'Cache-Control': 'private, no-store' } });
}
