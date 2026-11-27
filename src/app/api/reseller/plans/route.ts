import { db } from '@/lib/db';
import { requireReseller } from '@/lib/session';
import { getResellerWithAccess, withResellerLock } from '@/lib/reseller-helpers';
import { checkResellerPlan, listResellerPlans, newPlanId, parseResellerPlan, planKey, readResellerPlan } from '@/lib/reseller-plans';

export async function GET() {
  const session = await requireReseller();
  if (!session) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  return Response.json({ plans: await listResellerPlans(session.uid) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const session = await requireReseller();
  if (!session) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const plan = parseResellerPlan(body);
  if (!plan) return Response.json({ error: 'نام، حجم، مدت یا لوکیشن بسته نامعتبر است' }, { status: 400 });
  return withResellerLock(session.uid, async () => {
    const owner = await getResellerWithAccess(session.uid);
    if (!owner) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
    const error = await checkResellerPlan(owner, plan);
    if (error) return Response.json({ error }, { status: 403 });
    const plans = await listResellerPlans(owner.id);
    const existing = plans.find(item => item.name === plan.name);
    if (!existing && plans.length >= 50) return Response.json({ error: 'سقف ۵۰ بسته پر شده است' }, { status: 409 });
    const id = existing?.id || newPlanId();
    const key = planKey(owner.id, id), value = JSON.stringify(plan);
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return Response.json({ plan: { id, ...plan } }, { status: existing ? 200 : 201 });
  });
}

export async function DELETE(request: Request) {
  const session = await requireReseller();
  if (!session) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  const saved = await readResellerPlan(session.uid, id);
  if (!saved) return Response.json({ error: 'بسته پیدا نشد' }, { status: 404 });
  await db.setting.deleteMany({ where: { key: planKey(session.uid, saved.id) } });
  return Response.json({ ok: true });
}
