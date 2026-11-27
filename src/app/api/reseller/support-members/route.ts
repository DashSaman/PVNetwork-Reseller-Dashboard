import { db } from '@/lib/db';
import { requireReseller } from '@/lib/session';
import { hashPassword } from '@/lib/crypto';
import { withResellerLock } from '@/lib/reseller-helpers';
import { decodeSupportMember, supportLogin, SUPPORT_MEMBER_PREFIX } from '@/lib/support-members';

async function localMembers(id: string) {
  const rows = await db.setting.findMany({ where: { key: { startsWith: SUPPORT_MEMBER_PREFIX } } });
  return rows.map(decodeSupportMember).filter(member => member?.resellerId === id).map(member => member!.username);
}

export async function GET() {
  const owner = await requireReseller();
  if (!owner) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  return Response.json({ members: await localMembers(owner.uid) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const owner = await requireReseller();
  if (!owner) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const username = supportLogin(body?.username);
  if (!username || typeof body?.password !== 'string' || body.password.length < 12 || body.password.length > 128) {
    return Response.json({ error: 'نام کاربری معتبر و رمز عبور حداقل ۱۲ حرفی وارد کنید' }, { status: 400 });
  }
  return withResellerLock(owner.uid, async () => {
    if ((await localMembers(owner.uid)).length >= 10) return Response.json({ error: 'سقف ۱۰ حساب همکار پر شده است' }, { status: 409 });
    const key = SUPPORT_MEMBER_PREFIX + username;
    const [admin, reseller] = await Promise.all([
      db.adminUser.findUnique({ where: { username } }), db.reseller.findUnique({ where: { username } }),
    ]);
    if (admin || reseller) return Response.json({ error: 'این نام کاربری در دسترس نیست' }, { status: 409 });
    const value = JSON.stringify({ resellerId: owner.uid, password: hashPassword(body.password) });
    try { await db.setting.create({ data: { key, value } }); }
    catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return Response.json({ error: 'این نام کاربری در دسترس نیست' }, { status: 409 });
    }
    return Response.json({ username }, { status: 201 });
  });
}

export async function DELETE(request: Request) {
  const owner = await requireReseller();
  if (!owner) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const username = supportLogin(new URL(request.url).searchParams.get('username'));
  const row = username && await db.setting.findUnique({ where: { key: SUPPORT_MEMBER_PREFIX + username } });
  if (!row || decodeSupportMember(row)?.resellerId !== owner.uid) return Response.json({ error: 'حساب همکار پیدا نشد' }, { status: 404 });
  const result = await db.setting.deleteMany({ where: { key: row.key, value: row.value } });
  return result.count ? new Response(null, { status: 204 }) : Response.json({ error: 'حساب همکار تغییر کرده است' }, { status: 409 });
}
