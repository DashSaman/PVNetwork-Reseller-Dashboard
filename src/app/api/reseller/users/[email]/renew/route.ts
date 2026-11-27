import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireReseller } from '@/lib/session';
import { withResellerLock } from '@/lib/reseller-helpers';
import { operationInstallation } from '@/lib/operation-installation';
import { parseRenewalPlan, readAutoRenewal, renewalSettingKey } from '@/lib/renewal-plan';
import { renewUserByJournal } from '@/lib/accounting-ops';

type Context = { params: Promise<{ email: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const { email } = await params;
  const customer = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId: session.uid, email } } });
  if (!customer) return NextResponse.json({ error: 'کاربر پیدا نشد' }, { status: 404 });
  const configured = await db.setting.findUnique({ where: { key: renewalSettingKey(customer.id) } });
  const plan = readAutoRenewal(configured?.value, operationInstallation());
  return NextResponse.json({ plan: plan && { trafficGB: plan.trafficGB, days: plan.days } }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PUT(request: NextRequest, { params }: Context) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const { email } = await params;
  const body = await request.json().catch(() => null);
  const plan = parseRenewalPlan(body);
  if (typeof body?.enabled !== 'boolean' || body.enabled && !plan) return NextResponse.json({ error: 'حجم و مدت تمدید خودکار نامعتبر است' }, { status: 400 });
  return withResellerLock(session.uid, async () => {
    const customer = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId: session.uid, email } } });
    if (!customer) return NextResponse.json({ error: 'کاربر پیدا نشد' }, { status: 404 });
    const key = renewalSettingKey(customer.id);
    if (body.enabled && plan) {
      const value = JSON.stringify({ ...plan, installation: operationInstallation(true) });
      await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    } else {
      await db.setting.deleteMany({ where: { key } });
    }
    return NextResponse.json({ plan: body.enabled ? plan : null });
  });
}

export async function POST(request: NextRequest, { params }: Context) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const { email } = await params;
  const body = await request.json().catch(() => null);
  const plan = parseRenewalPlan(body);
  if (!plan || typeof body?.requestId !== 'string' || !/^[a-z0-9-]{12,64}$/i.test(body.requestId)) {
    return NextResponse.json({ error: 'حجم و مدت بستهٔ جدید یا شناسهٔ درخواست نامعتبر است' }, { status: 400 });
  }
  const result = await renewUserByJournal(session.uid, email, { plan, requestId: body.requestId });
  if (!result.ok) return NextResponse.json({ error: result.msg }, { status: result.status });
  return NextResponse.json(result, { status: result.pending ? 202 : 200 });
}
