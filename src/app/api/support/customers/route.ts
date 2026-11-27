import { db } from '@/lib/db';
import { inspectDashboardSession } from '@/lib/session';
import { getAllPanelInboundsForUi } from '@/lib/panel-manager';

export async function GET(request: Request) {
  const session = await inspectDashboardSession();
  if (!session || session.payload.role !== 'SUPPORT' || session.resellerDisabled || !session.supportOwnerId) {
    return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  }
  const page = Number(new URL(request.url).searchParams.get('page') || '0');
  if (!Number.isSafeInteger(page) || page < 0 || page > 5000) return Response.json({ error: 'شماره صفحه نامعتبر است' }, { status: 400 });
  const tracked = await db.resellerUser.findMany({
    where: { resellerId: session.supportOwnerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 26, skip: page * 25, select: { email: true, name: true, subId: true },
  });
  const snapshot = await getAllPanelInboundsForUi();
  const users = tracked.slice(0, 25).map(user => {
    const profiles = !user.subId ? [] : snapshot.panels.flatMap(panel => panel.inbounds.flatMap(inbound =>
      inbound.clients.filter(client => client.email === user.email && client.subId === user.subId)));
    const fresh = snapshot.ok && !snapshot.pending && !snapshot.stale && !snapshot.errors.length && profiles.length > 0;
    return { email: user.email, name: user.name,
      enabled: fresh ? profiles.every(client => client.enable ?? true) : null,
      expiry: fresh ? Math.max(...profiles.map(client => client.expiryTime || 0)) : null,
    };
  });
  return Response.json({ users, more: tracked.length > 25 }, { headers: { 'Cache-Control': 'private, no-store' } });
}
