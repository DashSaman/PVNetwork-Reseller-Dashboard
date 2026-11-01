import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireReseller } from '@/lib/session';
import { getResellerWithAccess, withResellerLock } from '@/lib/reseller-helpers';
import { loadAlertPreferences } from '@/lib/customer-observations';
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  return NextResponse.json(await loadAlertPreferences(session.uid), { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function PUT(req: NextRequest) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  try {
    const body = await req.json();
    if (!body || Object.keys(body).some(k => !['usagePercent', 'expiryDays'].includes(k)) || !Number.isInteger(body.usagePercent) || body.usagePercent < 1 || body.usagePercent > 100 || !Number.isInteger(body.expiryDays) || body.expiryDays < 0 || body.expiryDays > 30) throw Error('آستانهٔ مصرف ۱ تا ۱۰۰ و انقضا صفر تا ۳۰ روز مجاز است');
    const ok = await withResellerLock(session.uid, async () => {
      if (!await getResellerWithAccess(session.uid)) return false;
      const key = `customerAlertPreferences:${session.uid}`, value = JSON.stringify(body);
      await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });return true;
    });
    return NextResponse.json(ok ? { ok: true } : { error: 'حساب فعال نیست' }, { status: ok ? 200 : 403 });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
