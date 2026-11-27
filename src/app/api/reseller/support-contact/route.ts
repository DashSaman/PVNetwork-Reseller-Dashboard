import { db } from '@/lib/db';
import { requireReseller } from '@/lib/session';
import { parseSupportTelegramUsername, resellerSupportContact } from '@/lib/support-contact';

export async function GET() {
  const session = await requireReseller();
  if (!session) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  return Response.json(await resellerSupportContact(session.uid), { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PUT(request: Request) {
  const session = await requireReseller();
  if (!session) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const username = parseSupportTelegramUsername(body?.username);
  if (username === null) return Response.json({ error: 'آیدی تلگرام معتبر وارد کنید' }, { status: 400 });
  const key = 'resellerSupport:' + session.uid;
  if (username) await db.setting.upsert({ where: { key }, create: { key, value: username }, update: { value: username } });
  else await db.setting.deleteMany({ where: { key } });
  return Response.json({ username });
}
