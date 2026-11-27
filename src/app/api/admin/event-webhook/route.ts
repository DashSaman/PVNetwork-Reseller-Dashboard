import { randomBytes, randomUUID } from 'node:crypto';
import { requireAdmin } from '@/lib/session';
import { db } from '@/lib/db';
import { encryptSecret } from '@/lib/crypto';
import { operationInstallation } from '@/lib/operation-installation';
import { webhookKey, readWebhookConfig, webhookDeliveryStatus } from '@/lib/event-webhooks';
import { parseWebhookUrl } from '@/lib/webhook-target';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  if (!await requireAdmin()) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401, headers });
  const config = readWebhookConfig((await db.setting.findUnique({ where: { key: webhookKey } }))?.value);
  return Response.json(config ? { enabled: true, url: config.url, deliveries: await webhookDeliveryStatus(config) } : { enabled: false }, { headers });
}

export async function PUT(request: Request) {
  if (!await requireAdmin()) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401, headers });
  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== 'boolean') return Response.json({ error: 'وضعیت وب‌هوک نامعتبر است' }, { status: 400, headers });
  if (!body.enabled) {
    await db.setting.deleteMany({ where: { key: webhookKey } });
    return Response.json({ enabled: false }, { headers });
  }
  const url = parseWebhookUrl(body.url);
  if (!url) return Response.json({ error: 'آدرس HTTPS عمومی و معتبر وارد کنید' }, { status: 400, headers });
  const current = readWebhookConfig((await db.setting.findUnique({ where: { key: webhookKey } }))?.value);
  if (current?.url === url.href && body.rotate !== true) return Response.json({ enabled: true, url: current.url }, { headers });
  const secret = randomBytes(32).toString('hex');
  const value = JSON.stringify({ id: randomUUID(), url: url.href, installation: operationInstallation(true), encryptedSecret: encryptSecret(secret) });
  await db.setting.upsert({ where: { key: webhookKey }, create: { key: webhookKey, value }, update: { value } });
  return Response.json({ enabled: true, url: url.href, secret }, { headers });
}
