import { onlineTimestamp } from './customer-model';
import type { PanelInbound } from './panel';

export function subscriptionFetchTimes(panels: { inbounds: PanelInbound[] }[], users: { email: string; subId: string | null }[]) {
  const ownership = new Map(users.filter(user => user.subId).map(user => [user.email, user.subId]));
  const result = new Map<string, number>();
  for (const { inbounds } of panels) {
    for (const inbound of inbounds) {
      const owned = new Set(inbound.clients.filter(client => ownership.has(client.email) && ownership.get(client.email) === client.subId).map(client => client.email));
      for (const stat of inbound.clientStats) {
        const expected = ownership.get(stat.email);
        if (!expected || !(stat.subId ? stat.subId === expected : owned.has(stat.email))) continue;
        const stamp = onlineTimestamp(stat.lastSubFetch);
        if (stamp !== null) result.set(stat.email, Math.max(stamp, result.get(stat.email) ?? 0));
      }
    }
  }
  return result;
}
