import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireReseller } from '@/lib/session';
import { getResellerWithAccess, withResellerLock } from '@/lib/reseller-helpers';
import { bridgeApiTokenKey, bridgeApiTokenMetadata, rotateBridgeApiToken } from '@/lib/bridge-api-token';
import { logActivity } from '@/lib/logger';

const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401, headers });
  const account = await getResellerWithAccess(session.uid);
  if (!account) return NextResponse.json({ error: 'حساب فعال نیست' }, { status: 403, headers });
  return NextResponse.json(await bridgeApiTokenMetadata(account), { headers });
}

export async function POST() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401, headers });
  return withResellerLock(session.uid, async () => {
    const account = await getResellerWithAccess(session.uid);
    if (!account?.mirzaEnabled) return NextResponse.json({ error: 'ابتدا اتصال فروش میرزا را روشن و ذخیره کنید' }, { status: 403, headers });
    const result = await rotateBridgeApiToken(account);
    await logActivity({ actorType: 'RESELLER', actorName: account.username, resellerId: account.id, action: 'صدور توکن API مخصوص اتصال فروش' });
    return NextResponse.json(result, { headers });
  });
}

export async function DELETE() {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401, headers });
  return withResellerLock(session.uid, async () => {
    const account = await getResellerWithAccess(session.uid);
    if (!account) return NextResponse.json({ error: 'حساب فعال نیست' }, { status: 403, headers });
    await db.setting.deleteMany({ where: { key: bridgeApiTokenKey(account.id) } });
    await logActivity({ actorType: 'RESELLER', actorName: account.username, resellerId: account.id, action: 'لغو توکن API اتصال فروش' });
    return NextResponse.json({ ok: true }, { headers });
  });
}
