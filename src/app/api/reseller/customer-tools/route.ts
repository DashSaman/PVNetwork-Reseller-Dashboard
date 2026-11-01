import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireReseller } from '@/lib/session';
import { getResellerWithAccess } from '@/lib/reseller-helpers';
import { customerMetadata, customerLastOnline, setCustomerLabels } from '@/lib/customer-management';

export async function GET(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  if (!await getResellerWithAccess(session.uid)) return NextResponse.json({ error: 'حساب فعال نیست' }, { status: 403 });
  const tracked = await db.resellerUser.findMany({ where: { resellerId: session.uid } });
  const users = await customerMetadata(tracked);
  const online = req.nextUrl.searchParams.get('live') === '1' ? await customerLastOnline(tracked) : null;
  return NextResponse.json({ users: users.map(u => ({ ...u, lastOnline: online?.get(u.email) ?? null })) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PATCH(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  if (!await getResellerWithAccess(session.uid)) return NextResponse.json({ error: 'حساب فعال نیست' }, { status: 403 });
  try {
    const body = await req.json();
    if (!body || Object.keys(body).some(k => !['emails', 'labels'].includes(k))) throw Error('فیلد درخواست نامعتبر است');
    if (!await setCustomerLabels(session.uid, body.emails, body.labels)) return NextResponse.json({ error: 'کاربر پیدا نشد' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
