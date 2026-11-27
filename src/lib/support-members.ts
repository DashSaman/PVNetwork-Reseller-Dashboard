import { db } from './db';

export const SUPPORT_MEMBER_PREFIX = 'supportMember:';
export function supportLogin(value: unknown) {
  if (typeof value !== 'string') return null;
  const alias = value.trim().toLowerCase().replace(/^support:/, '');
  return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(alias) ? 'support:' + alias : null;
}

export function decodeSupportMember(row: { key: string; value: string }) {
  try {
    const data = JSON.parse(row.value);
    const username = row.key.slice(SUPPORT_MEMBER_PREFIX.length);
    if (row.key !== SUPPORT_MEMBER_PREFIX + supportLogin(username) || !username.startsWith('support:')
      || typeof data.resellerId !== 'string' || typeof data.password !== 'string') return null;
    return { id: username, username, password: data.password as string, resellerId: data.resellerId as string };
  } catch { return null; }
}

export async function getSupportMember(username: string) {
  if (!username.startsWith('support:') || supportLogin(username) !== username) return null;
  const row = await db.setting.findUnique({ where: { key: SUPPORT_MEMBER_PREFIX + username } });
  return row && decodeSupportMember(row);
}
