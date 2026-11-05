import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { accountSessionVersion, type SessionAccount } from './crypto';

const PREFIX = 'bridgeApiToken:';
type TokenAccount = SessionAccount & { mirzaEnabled: boolean };
type StoredToken = { version: 1; hash: string; accountVersion: string; createdAt: string };
export const bridgeApiTokenKey = (id: string) => PREFIX + id;
export const isBridgeApiToken = (token: string) => /^pvnet_bridge_[a-f0-9]{64}$/.test(token);

function parseStored(value: string | undefined, account: TokenAccount): StoredToken | null {
  if (!value || !account.mirzaEnabled) return null;
  try {
    const stored = JSON.parse(value) as StoredToken;
    if (stored.version !== 1 || !/^[a-f0-9]{64}$/.test(stored.hash) ||
        stored.accountVersion !== accountSessionVersion('RESELLER', account) ||
        !Number.isFinite(Date.parse(stored.createdAt))) return null;
    return stored;
  } catch { return null; }
}

export async function bridgeApiTokenMetadata(account: TokenAccount): Promise<{ hasToken: boolean; createdAt: string | null }> {
  const row = await db.setting.findUnique({ where: { key: bridgeApiTokenKey(account.id) } });
  const stored = parseStored(row?.value, account);
  return { hasToken: !!stored, createdAt: stored?.createdAt || null };
}

/** One integration key per reseller; the raw secret is returned only on rotation. */
export async function rotateBridgeApiToken(account: TokenAccount): Promise<{ token: string; createdAt: string }> {
  if (!account.mirzaEnabled) throw new Error('Bridge is disabled');
  const token = 'pvnet_bridge_' + randomBytes(32).toString('hex');
  const createdAt = new Date().toISOString();
  const value = JSON.stringify({ version: 1, hash: createHash('sha256').update(token).digest('hex'),
    accountVersion: accountSessionVersion('RESELLER', account), createdAt });
  const key = bridgeApiTokenKey(account.id);
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return { token, createdAt };
}

export async function verifyBridgeApiToken(token: string, account: TokenAccount): Promise<boolean> {
  if (!isBridgeApiToken(token)) return false;
  const row = await db.setting.findUnique({ where: { key: bridgeApiTokenKey(account.id) } });
  const stored = parseStored(row?.value, account);
  return !!stored && timingSafeEqual(Buffer.from(stored.hash, 'hex'), createHash('sha256').update(token).digest());
}
