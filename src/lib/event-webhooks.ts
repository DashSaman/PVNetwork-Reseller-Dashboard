import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { decryptSecret } from './crypto';
import { operationInstallation } from './operation-installation';
import { deliverWebhook, parseWebhookUrl } from './webhook-target';

export const webhookKey = 'eventWebhookConfig';
const outbox = 'eventWebhookOutbox:';
const MAX_ATTEMPTS = 8;

type Configuration = { id: string; installation: string; url: string; encryptedSecret: string };
type EventName = 'subscription.renewed' | 'subscription.deleted' | 'quota.refunded';
type Event = {
  id: string; event: EventName; at: string; resellerId: string; customerId: string; data: Record<string, number | boolean>;
};
type Delivery = {
  event: Event; status: 'pending' | 'sent' | 'failed'; attempts: number; nextAttempt: number; lease?: string;
};

export function readWebhookConfig(value?: string): Configuration | null {
  if (!value) return null;
  try {
    const config = JSON.parse(value) as Configuration;
    return typeof config.id === 'string' && /^[a-f0-9-]{36}$/.test(config.id)
      && typeof config.encryptedSecret === 'string' && parseWebhookUrl(config.url)
      && config.installation === operationInstallation() ? config : null;
  } catch { return null; }
}

function readDelivery(value: string): Delivery | null {
  try {
    const row = JSON.parse(value) as Delivery;
    return row.event?.id && ['pending', 'sent', 'failed'].includes(row.status)
      && Number.isSafeInteger(row.nextAttempt) && Number.isSafeInteger(row.attempts) && row.attempts >= 0 ? row : null;
  } catch { return null; }
}

const prefix = (config: Configuration) => outbox + config.id + ':';

export async function queueAccountingEvents(
  tx: Pick<Prisma.TransactionClient, 'setting'>,
  identity: { id: string; resellerId: string; customerId: string },
  events: { event: EventName; data: Event['data'] }[],
) {
  const config = readWebhookConfig((await tx.setting.findUnique({ where: { key: webhookKey } }))?.value);
  if (!config) return;
  const now = Date.now();
  for (const event of events) {
    const id = identity.id + ':' + event.event, key = prefix(config) + id;
    const delivery: Delivery = { event: { ...event, id, at: new Date(now).toISOString(), resellerId: identity.resellerId, customerId: identity.customerId },
      status: 'pending', attempts: 0, nextAttempt: now };
    await tx.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(delivery) }, update: {} });
  }
}

export async function webhookDeliveryStatus(config: Configuration) {
  const rows = await db.setting.findMany({ where: { key: { startsWith: prefix(config) } }, orderBy: { updatedAt: 'desc' }, take: 20 });
  return rows.flatMap(row => {
    const delivery = readDelivery(row.value);
    return delivery ? [{ id: delivery.event.id, event: delivery.event.event, at: row.updatedAt,
      status: delivery.status, attempts: delivery.attempts, nextAttempt: delivery.status === 'pending' ? delivery.nextAttempt : null }] : [];
  });
}

export async function dispatchDueWebhooks(send = deliverWebhook) {
  const stored = await db.setting.findUnique({ where: { key: webhookKey } });
  const config = readWebhookConfig(stored?.value);
  const secret = config && decryptSecret(config.encryptedSecret);
  const url = config && parseWebhookUrl(config.url);
  if (!config || !secret || !url) return;
  const now = Date.now();
  await db.setting.deleteMany({
    where: { key: { startsWith: outbox }, updatedAt: { lt: new Date(now - 30 * 86400000) } },
  });
  const rows = await db.$queryRaw<{ key: string; value: string }[]>`
    SELECT key, value FROM "Setting"
    WHERE key LIKE ${prefix(config) + '%'}
      AND CASE WHEN json_valid(value) THEN json_extract(value, '$.status') = 'pending'
        AND json_extract(value, '$.nextAttempt') <= ${now} ELSE 0 END
    ORDER BY updatedAt ASC LIMIT 10
  `;
  const pending = rows.flatMap(row => {
    const delivery = readDelivery(row.value);
    return delivery && delivery.status === 'pending' && delivery.nextAttempt <= now ? [{ row, delivery }] : [];
  });
  for (const { row, delivery } of pending) {
    if ((await db.setting.findUnique({ where: { key: webhookKey } }))?.value !== stored?.value) break;
    const claim = JSON.stringify({ ...delivery, lease: randomUUID(), nextAttempt: Date.now() + 30000 });
    const claimed = await db.setting.updateMany({ where: { key: row.key, value: row.value }, data: { value: claim } });
    if (!claimed.count) continue;
    let sent = false;
    try {
      await send(url, delivery.event.id, secret, JSON.stringify(delivery.event));
      sent = true;
    } catch { /* Retry delivery without logging destinations or payloads. */ }
    const attempts = delivery.attempts + 1;
    const status = sent ? 'sent' : attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    const nextAttempt = Date.now() + Math.min(3600000, 30000 * 2 ** attempts);
    const value = JSON.stringify({ ...delivery, status, attempts, nextAttempt });
    await db.setting.updateMany({ where: { key: row.key, value: claim }, data: { value } });
  }
}

export function initializeEventWebhooks() {
  const state = globalThis as { __pvnetWebhookWorker?: boolean };
  if (state.__pvnetWebhookWorker) return;
  state.__pvnetWebhookWorker = true;
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void dispatchDueWebhooks().catch(() => undefined).finally(() => { running = false; });
  }, 30000).unref();
}
