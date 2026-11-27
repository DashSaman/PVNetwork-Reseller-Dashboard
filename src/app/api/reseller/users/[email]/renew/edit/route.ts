import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { renewUserByJournal } from '@/lib/accounting-ops';
import { db } from '@/lib/db';
import { updateMetadata } from '@/lib/queued-update';
import {
  isManualRenewalDraftId, manualRenewalDraftKey, parseRenewalPlan,
  readManualRenewalDraft, readRenewalJournal, type PreviousRenewalPeriod,
} from '@/lib/renewal-plan';
import { withResellerLock } from '@/lib/reseller-helpers';
import { requireReseller } from '@/lib/session';
import { isTrafficQuotaGB } from '@/lib/traffic-quota';

type Context = { params: Promise<{ email: string }> };
const headers = { 'Cache-Control': 'private, no-store' };
const terminalStatuses = ['SUCCESS', 'FAILED', 'CANCELLED'];

function denied() {
  return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ error: 'کاربر پیدا نشد' }, { status: 404 });
}

function ownedCustomer(resellerId: string, email: string) {
  return db.resellerUser.findUnique({ where: { resellerId_email: { resellerId, email } }, select: { id: true } });
}

async function savedDraft(key: string, userId: string) {
  const row = await db.setting.findUnique({ where: { key } });
  const draft = readManualRenewalDraft(row?.value);
  if (!draft) return { draft: null, inProgress: false };
  const operation = await db.operationJournal.findUnique({
    where: { idempotencyKey: `renew:${userId}:${draft.requestId}` }, select: { status: true },
  });
  return {
    draft: operation && terminalStatuses.includes(operation.status) ? null : draft,
    inProgress: !!operation && !terminalStatuses.includes(operation.status),
  };
}

async function previousPeriod(resellerId: string, userId: string, email: string) {
  const rows = await db.operationJournal.findMany({
    where: { resellerId, userId, email, type: 'RESET', status: 'SUCCESS', accountingCommitted: true,
      metadata: { contains: '"renewal":' } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, metadata: true, usageSnapshotGB: true },
  });
  for (const row of rows) {
    const metadata = updateMetadata(row.metadata);
    const renewal = readRenewalJournal(metadata.renewal);
    if (!renewal) continue;
    const period: PreviousRenewalPeriod = {
      id: row.id, usedGB: row.usageSnapshotGB,
      trafficGB: isTrafficQuotaGB(metadata.displayPreviousGB) ? metadata.displayPreviousGB : renewal.previousGB,
    };
    return { period, metadata };
  }
  return null;
}

export async function GET(_request: NextRequest, { params }: Context) {
  const session = await requireReseller();
  if (!session) return denied();
  const { email } = await params;
  const customer = await ownedCustomer(session.uid, email);
  if (!customer) return notFound();
  const [saved, previous] = await Promise.all([
    savedDraft(manualRenewalDraftKey(session.uid, customer.id), customer.id),
    previousPeriod(session.uid, customer.id, email),
  ]);
  return NextResponse.json({ ...saved, previousPeriod: previous?.period ?? null }, { headers });
}

export async function PUT(request: NextRequest, { params }: Context) {
  const session = await requireReseller();
  if (!session) return denied();
  const { email } = await params;
  const plan = parseRenewalPlan(await request.json().catch(() => null));
  if (!plan) return NextResponse.json({ error: 'حجم کل و مدت بستهٔ جدید نامعتبر است' }, { status: 400 });
  return withResellerLock(session.uid, async () => {
    const customer = await ownedCustomer(session.uid, email);
    if (!customer) return notFound();
    const key = manualRenewalDraftKey(session.uid, customer.id);
    const saved = await savedDraft(key, customer.id);
    if (saved.draft?.trafficGB === plan.trafficGB && saved.draft.days === plan.days) {
      return NextResponse.json(saved);
    }
    if (saved.inProgress) {
      return NextResponse.json({ error: 'شروع بستهٔ ثبت‌شده در جریان است. ابتدا نتیجهٔ آن را بررسی کنید.' }, { status: 409 });
    }
    const draft = { ...plan, requestId: randomUUID() };
    const value = JSON.stringify(draft);
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return NextResponse.json({ draft, inProgress: false });
  });
}

export async function POST(request: NextRequest, { params }: Context) {
  const session = await requireReseller();
  if (!session) return denied();
  const { email } = await params;
  const body = await request.json().catch(() => null);
  if (!isManualRenewalDraftId(body?.requestId)) {
    return NextResponse.json({ error: 'شناسهٔ بستهٔ ثبت‌شده نامعتبر است' }, { status: 400 });
  }
  const result = await renewUserByJournal(session.uid, email, { requestId: body.requestId, useSavedDraft: true });
  if (!result.ok) return NextResponse.json({ error: result.msg }, { status: result.status });
  return NextResponse.json(result, { status: result.pending ? 202 : 200 });
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await requireReseller();
  if (!session) return denied();
  const { email } = await params;
  const body = await request.json().catch(() => null);
  const trafficGB: unknown = body?.trafficGB;
  if (typeof body?.periodId !== 'string' || !isTrafficQuotaGB(trafficGB)) {
    return NextResponse.json({ error: 'سهمیهٔ دورهٔ قبلی نامعتبر است' }, { status: 400 });
  }
  return withResellerLock(session.uid, async () => {
    const customer = await ownedCustomer(session.uid, email);
    if (!customer) return notFound();
    const previous = await previousPeriod(session.uid, customer.id, email);
    if (!previous || previous.period.id !== body.periodId) {
      return NextResponse.json({ error: 'سابقهٔ این دوره در دسترس نیست. پنجره را دوباره باز کنید.' }, { status: 409 });
    }
    if (previous.period.trafficGB !== trafficGB) {
      // This field is for display. The renewal's accounting intent and usage snapshot stay intact.
      await db.$transaction([
        db.operationJournal.update({ where: { id: previous.period.id },
          data: { metadata: JSON.stringify({ ...previous.metadata, displayPreviousGB: trafficGB }) } }),
        db.activityLog.create({ data: { actorType: 'RESELLER', actorName: session.username,
          resellerId: session.uid, action: 'اصلاح سهمیهٔ دورهٔ قبلی',
          detail: `${email} | ${previous.period.trafficGB} → ${trafficGB} گیگ | ${previous.period.id}` } }),
      ]);
    }
    return NextResponse.json({ previousPeriod: { ...previous.period, trafficGB } });
  });
}