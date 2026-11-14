import { db } from './db';

export type MembershipUser = { id: string; email: string; subId?: string | null; resellerId?: string };
export type MembershipState = {
  version: 1; userId: string; resellerId: string; email: string; subId: string;
  installation: string; panels: string[];
};
export const membershipStateKey = (id: string) => `customerMembershipState:${id}`;

/** An exact customer record retains accounting targets after its last location
 * is detached. The installation/subId are audit values: backups and legitimate
 * subscription rotations preserve this read-only target history. Every native
 * read still verifies the customer's CURRENT subscription; automatic mutations
 * additionally require their own current-installation journal. */
export async function readMembershipState(user: MembershipUser): Promise<MembershipState | null> {
  const row = await db.setting.findUnique({ where: { key: membershipStateKey(user.id) } });
  if (!row) return null;
  const state = JSON.parse(row.value) as MembershipState;
  if (state.version !== 1 || state.userId !== user.id || state.email !== user.email || typeof state.subId !== 'string' || !state.subId
    || user.resellerId && state.resellerId !== user.resellerId || typeof state.installation !== 'string' || !state.installation
    || !Array.isArray(state.panels) || !state.panels.length || state.panels.some(p => typeof p !== 'string' || !p)
    || new Set(state.panels).size !== state.panels.length) throw Error('اطلاعات حسابداری لوکیشن‌های جداشده معتبر نیست؛ بررسی مدیر لازم است');
  return state;
}
