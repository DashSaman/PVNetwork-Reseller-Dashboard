import { onlineTimestamp } from './customer-model';
import type { PanelInbound } from './panel';

export function subscriptionFetchTimes(panels: { inbounds: PanelInbound[] }[], users: { email: string; subId: string | null }[]) {
  const ownerBySubscription = new Map(users.flatMap(user => user.subId ? [[user.subId, user.email] as const] : []));
  const result = new Map<string, number>();
  for (const { inbounds } of panels) {
    for (const inbound of inbounds) {
      const subscriptions = new Map<string, Set<string | undefined>>();
      for (const client of inbound.clients) {
        const ids = subscriptions.get(client.email) ?? new Set<string | undefined>();
        ids.add(client.subId);
        subscriptions.set(client.email, ids);
      }
      for (const stat of inbound.clientStats) {
        const ids = subscriptions.get(stat.email);
        const subId = stat.subId || (ids?.size === 1 ? ids.values().next().value : undefined);
        if (!subId || ownerBySubscription.get(subId) !== stat.email) continue;
        const stamp = onlineTimestamp(stat.lastSubFetch);
        if (stamp !== null) result.set(subId, Math.max(stamp, result.get(subId) ?? 0));
      }
    }
  }
  return result;
}
