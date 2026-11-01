import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { collectCustomerObservations } from '@/lib/customer-observations';
import { customerHistory, customerLastOnline, customerMetadata } from '@/lib/customer-management';
export const maxDuration = 300;
export async function POST() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
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
