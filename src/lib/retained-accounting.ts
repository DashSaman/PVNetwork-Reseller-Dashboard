import { readMembershipState, type MembershipUser } from './membership-state';
import { getPanelConnection, type PanelBundle } from './panel-manager';
import { getClientProfile, getVerifiedClientUsage } from './panel';

/** Internal accounting/edit snapshot only: a deliberately detached native
 * record is still authoritative. This synthetic row is never a selectable
 * inbound, grant, subscription link or persisted connection. */
export async function retainDetachedAccounting(panels: PanelBundle[], user: MembershipUser, recordedDeletionPanels: ReadonlySet<string> = new Set()): Promise<PanelBundle[]> {
  const state = await readMembershipState(user);
  if (!state) return panels;
  const result = panels.map(p => ({ ...p, inbounds: [...p.inbounds] }));
  for (const panelId of state.panels) {
    // Only the destructive service supplies this set, from the exact current
    // deletion journal's complete durable usage ledger. Native absence is NOT
    // inferred here; its reconciler must still verify every identity/copy.
    if (recordedDeletionPanels.has(panelId)) continue;
    const bundle = result.find(p => p.panelId === panelId);
    if (!bundle) throw Error('پنل نگهدارندهٔ مصرف حساب قابل خواندن نیست');
    if (bundle.inbounds.some(i => i.clients.some(c => c.email === user.email) && i.clientStats.some(s => s.email === user.email))) continue;
    const connection = await getPanelConnection(panelId);
    if (!connection.ok) throw Error('اتصال حساب جداشده قابل تأیید نیست');
    const profile = await getClientProfile(connection.conn, user.email), record = profile.data?.client;
    const identity = record?.uuid || record?.id;
    if (!profile.ok || !record || record.email !== user.email || record.subId !== user.subId || typeof identity !== 'string' || !identity
      || !Number.isSafeInteger(record.totalGB) || record.totalGB! < 0 || !Number.isSafeInteger(record.expiryTime) || typeof record.enable !== 'boolean') throw Error('هویت و مشخصات حساب جداشده قابل تأیید نیست');
    const usage = await getVerifiedClientUsage(connection.conn, user.email);
    if (!usage.ok || typeof usage.data !== 'number' || !Number.isFinite(usage.data) || usage.data < 0) throw Error('مصرف حساب جداشده قابل تأیید نیست');
    bundle.inbounds.push({ id: -1, enable: false, nodeId: null, port: 0, protocol: '', tag: '', remark: '', up: 0, down: 0, total: 0,
      clients: [{ ...record, id: identity }], clientStats: [{ email: user.email, up: usage.data, down: 0, total: record.totalGB!, expiryTime: record.expiryTime!, enable: record.enable }], stream: null });
  }
  return result;
}
