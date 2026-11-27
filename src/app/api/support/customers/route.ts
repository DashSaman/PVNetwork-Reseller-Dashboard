import { db } from '@/lib/db';
import { inspectDashboardSession } from '@/lib/session';
import { getAllPanelInboundsForUi, getPrimaryPanel } from '@/lib/panel-manager';
import { parseInboundRefs } from '@/lib/reseller-helpers';

export async function GET(request: Request) {
  const session = await inspectDashboardSession();
  if (!session || session.payload.role !== 'SUPPORT' || session.resellerDisabled || !session.supportOwnerId) {
    return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  }
  const page = Number(new URL(request.url).searchParams.get('page') || '0');
  if (!Number.isSafeInteger(page) || page < 0 || page > 5000) return Response.json({ error: 'شماره صفحه نامعتبر است' }, { status: 400 });
  const headers = { 'Cache-Control': 'private, no-store' };
  const tracked = await db.resellerUser.findMany({
    where: { resellerId: session.supportOwnerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 26, skip: page * 25, select: { email: true, name: true, subId: true, panelId: true, inboundIds: true },
  });
  if (!tracked.length) return Response.json({ users: [], more: false, pending: false }, { headers });

  const [snapshot, primary] = await Promise.all([getAllPanelInboundsForUi(), getPrimaryPanel()]);
  const fresh = new Set(snapshot.freshPanelIds);
  const pendingPanels = new Set(snapshot.pendingPanelIds);
  const panels = new Map(snapshot.panels.map(panel => [panel.panelId, panel.inbounds]));
  let pending = false;
  const users = tracked.slice(0, 25).map(user => {
    const refs = parseInboundRefs(user.inboundIds, user.panelId || primary?.id || '');
    if (refs.some(ref => pendingPanels.has(ref.panelId))) pending = true;
    const profiles = !user.subId ? [] : refs.flatMap(ref => {
      if (!fresh.has(ref.panelId)) return [];
      const profile = panels.get(ref.panelId)?.find(inbound => inbound.id === ref.inboundId)?.clients
        .find(client => client.email === user.email && client.subId === user.subId);
      return profile ? [profile] : [];
    });
    const confirmed = refs.length > 0 && profiles.length === refs.length
      && profiles.every(client => typeof client.enable === 'boolean' && Number.isSafeInteger(client.expiryTime));
    return { email: user.email, name: user.name,
      enabled: confirmed ? profiles.every(client => client.enable === true) : null,
      expiry: confirmed ? Math.max(...profiles.map(client => client.expiryTime!)) : null,
    };
  });
  return Response.json({ users, more: tracked.length > 25, pending }, { headers });
}
