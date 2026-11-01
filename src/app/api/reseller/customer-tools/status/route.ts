import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireReseller } from '@/lib/session';
import { getResellerWithAccess, withResellerLock } from '@/lib/reseller-helpers';
import { CUSTOMER_ACTIVE, ownedCustomers, parseSetting, setCustomerStatus } from '@/lib/customer-management';
type Batch = { enable: boolean; users: { id: string; email: string }[]; cancelled?: boolean };

export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const prefix = `customerStatusBatch:${session.uid}:`;
  const entries = await db.setting.findMany({ where: { key: { startsWith: prefix } }, orderBy: { updatedAt: 'desc' }, take: 100 });
  for (const entry of entries) {
    const value = parseSetting<Batch | null>(entry.value, null);
    if (!value || value.cancelled || !Array.isArray(value.users)) continue;
    const requestId = entry.key.slice(prefix.length);
    const completed = await db.operationJournal.count({ where: { resellerId: session.uid, idempotencyKey: { in: value.users.map(u => `customer-status:${session.uid}:${requestId}:${u.email}`) }, status: 'SUCCESS' } });
    if (completed < value.users.length) return NextResponse.json({ batch: { enable: value.enable, emails: value.users.map(u => u.email), requestId } }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  return NextResponse.json({ batch: null }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/** Only unattempted failures can be closed; unknown native partials stay protected. */
export async function DELETE(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || Object.keys(body).some(k => k !== 'requestId') || typeof body.requestId !== 'string' || !/^[\w-]{8,64}$/.test(body.requestId)) return NextResponse.json({ error: 'شناسهٔ درخواست نامعتبر است' }, { status: 400 });
  return withResellerLock(session.uid, async () => {
    if (!await getResellerWithAccess(session.uid)) return NextResponse.json({ error: 'حساب فعال نیست' }, { status: 403 });
    const key = `customerStatusBatch:${session.uid}:${body.requestId}`;
    const row = await db.setting.findUnique({ where: { key } });
    const value = parseSetting<Batch | null>(row?.value, null);
    if (!value) return NextResponse.json({ ok: true });
    const active = await db.operationJournal.count({ where: { resellerId: session.uid, status: { in: CUSTOMER_ACTIVE }, idempotencyKey: { in: value.users.map(u => `customer-status:${session.uid}:${body.requestId}:${u.email}`) } } });
    if (active) return NextResponse.json({ error: 'تغییر ناقص در لوکیشن‌ها وجود دارد؛ برای حفظ وضعیت کاربر، ابتدا همان عملیات را ادامه دهید' }, { status: 409 });
    await db.setting.update({ where: { key }, data: { value: JSON.stringify({ ...value, cancelled: true }) } });
    return NextResponse.json({ ok: true });
  });
}

export async function POST(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  if (!await getResellerWithAccess(session.uid)) return NextResponse.json({ error: 'حساب فعال نیست' }, { status: 403 });
  try {
    const body = await req.json();
    if (!body || Object.keys(body).some(k => !['emails', 'enable', 'requestId'].includes(k)) || typeof body.enable !== 'boolean' || typeof body.requestId !== 'string' || !/^[\w-]{8,64}$/.test(body.requestId)) throw Error('درخواست تغییر وضعیت نامعتبر است');
    const batch = await withResellerLock(session.uid, async () => {
      if (!await getResellerWithAccess(session.uid)) return { error: 'حساب فعال نیست', status: 403 } as const;
      const users = await ownedCustomers(session.uid, body.emails);
      if (!users) return { error: 'کاربر پیدا نشد', status: 404 } as const;
      const key = `customerStatusBatch:${session.uid}:${body.requestId}`;
      const previous = await db.setting.findUnique({ where: { key } });
      const value: Batch = { enable: body.enable, users: users.map(u => ({ id: u.id, email: u.email })).sort((a, b) => a.email.localeCompare(b.email)) };
      if (previous && JSON.stringify(parseSetting(previous.value, null)) !== JSON.stringify(value)) return { error: 'شناسهٔ درخواست قبلاً با هدف دیگری ثبت شده است', status: 409 } as const;
      if (!previous) await db.setting.create({ data: { key, value: JSON.stringify(value) } });
      return { value };
    });
    if ('error' in batch) return NextResponse.json({ error: batch.error }, { status: batch.status });
    const results: Awaited<ReturnType<typeof setCustomerStatus>>[] = [];
    for (const user of batch.value.users) results.push(await setCustomerStatus(session.uid, user.id, user.email, body.enable, body.requestId));
    return NextResponse.json({ results, complete: results.every(r => r.ok), requestId: body.requestId });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
