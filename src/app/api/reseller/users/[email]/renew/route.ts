import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireReseller } from '@/lib/session';
import { withResellerLock } from '@/lib/reseller-helpers';
import { operationInstallation } from '@/lib/operation-installation';
import { parseAutoRenewalLimits, parseRenewalPlan, readAutoRenewal, renewalCap, renewalSettingKey } from '@/lib/renewal-plan';
import { renewUserByJournal } from '@/lib/accounting-ops';
import { completedAutoRenewals, renewalStatusKey } from '@/lib/renewal-status';

type Context = { params: Promise<{ email: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const { email } = await params;
  const customer = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId: session.uid, email } } });
  if (!customer) return NextResponse.json({ error: 'کاربر پیدا نشد' }, { status: 404 });
  const configured = await db.setting.findUnique({ where: { key: renewalSettingKey(customer.id) } });
  const plan = readAutoRenewal(configured?.value, operationInstallation());
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!plan) return NextResponse.json({ plan: null }, { headers });
  const completed = await completedAutoRenewals(session.uid, customer.id, plan);
  const status = await db.setting.findUnique({ where: { key: renewalStatusKey(customer.id) } });
  let balanceBlocked = false;
  try {
    const value = JSON.parse(status?.value || '{}');
    balanceBlocked = value.reason === 'balance' && value.cycleId === plan.cycleId;
  } catch { /* Ignore malformed restored status. */ }
  return NextResponse.json({
    plan: { trafficGB: plan.trafficGB, days: plan.days, maxRenewals: plan.maxRenewals, stopAt: plan.stopAt },
    completed, stopped: renewalCap(plan, completed) || (balanceBlocked ? 'balance' : null),
  }, { headers });
}

export async function PUT(request: NextRequest, { params }: Context) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const { email } = await params;
  const body = await request.json().catch(() => null);
  const plan = parseRenewalPlan(body);
  const limits = parseAutoRenewalLimits(body);
  if (typeof body?.enabled !== 'boolean' || body.enabled && (!plan || !limits)) return NextResponse.json({ error: 'حجم و مدت تمدید خودکار نامعتبر است' }, { status: 400 });
  return withResellerLock(session.uid, async () => {
    const customer = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId: session.uid, email } } });
    if (!customer) return NextResponse.json({ error: 'کاربر پیدا نشد' }, { status: 404 });
    const key = renewalSettingKey(customer.id);
    if (body.enabled && plan) {
      const installation = operationInstallation(true);
      const stored = await db.setting.findUnique({ where: { key } });
      const cycleId = readAutoRenewal(stored?.value, installation)?.cycleId || randomUUID();
      const value = JSON.stringify({ ...plan, ...limits, installation, cycleId });
      await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    } else {
      await db.setting.deleteMany({ where: { key } });
    }
    await db.setting.deleteMany({ where: { key: renewalStatusKey(customer.id) } });
    return NextResponse.json({ plan: body.enabled ? { ...plan, ...limits } : null });
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
