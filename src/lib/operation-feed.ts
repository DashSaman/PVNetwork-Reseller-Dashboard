import { db } from './db';
import { readRenewalJournal } from './renewal-plan';
import { updateMetadata } from './queued-update';
import { operationInstallation } from './operation-installation';
import { parseInboundRefs, refKey } from './reseller-helpers';
import { publicLocationLabel } from './reseller-presentation';

const awaiting = ['PENDING', 'RUNNING', 'PARTIAL', 'NEEDS_REPAIR'];

function entries(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch { return []; }
}

export async function operationFeed(ownerId: string | undefined, pending: boolean, before?: string) {
  const rows = await db.operationJournal.findMany({
    where: { resellerId: ownerId, ...(pending ? { status: { in: awaiting } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 31,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });
  const visible = rows.slice(0, 30);
  const owners = ownerId ? [] : await db.reseller.findMany({
    where: { id: { in: [...new Set(visible.map(row => row.resellerId))] } }, select: { id: true, username: true },
  });
  const names = new Map(owners.map(row => [row.id, row.username]));
  const panelIds = [...new Set(visible.flatMap(row => entries(row.targetPanels)))];
  const [panels, grants, customers] = await Promise.all([
    db.panelConfig.findMany({ where: { id: { in: panelIds } }, select: { id: true, name: true } }),
    ownerId ? db.resellerInbound.findMany({ where: { resellerId: ownerId }, select: { panelId: true, inboundId: true, remark: true, inboundTag: true } }) : [],
    ownerId ? db.resellerUser.findMany({
      where: { resellerId: ownerId, id: { in: visible.flatMap(row => row.userId ? [row.userId] : []) } },
      select: { id: true, inboundIds: true, panelId: true },
    }) : [],
  ]);
  const panelNames = new Map(panels.map(panel => [panel.id, panel.name]));
  const locationNames = new Map(grants.map(grant => [refKey(grant), publicLocationLabel(grant.remark || grant.inboundTag, panelNames.get(grant.panelId))] as const));
  const userRefs = new Map(customers.map(user => [user.id, parseInboundRefs(user.inboundIds, user.panelId)] as const));
  let installation: string | null = null;
  try { installation = operationInstallation(); } catch { /* Leave retry guidance unavailable. */ }
  return { next: rows.length > 30 ? visible.at(-1)?.id : undefined, operations: visible.map(row => {
    const completed = new Set(entries(row.completedPanels));
    const failures = entries(row.failedPanels);
    const metadata = updateMetadata(row.metadata);
    const renewal = row.type === 'RESET' && readRenewalJournal(metadata.renewal);
    const locations = Array.isArray(metadata.refs) ? parseInboundRefs(JSON.stringify(metadata.refs), '') : userRefs.get(row.userId || '') || [];
    const retry = awaiting.includes(row.status) ? row.status === 'NEEDS_REPAIR' ? 'review'
      : installation && metadata.operationInstallation === installation && (renewal || metadata.explicitDestructive === true) ? 'automatic'
      : 'unknown' : null;
    return {
      id: row.id, customer: row.email, owner: names.get(row.resellerId), kind: renewal ? 'RENEW' : row.type,
      status: row.status, updatedAt: row.updatedAt, reservedGB: row.reservedGB, accounted: row.accountingCommitted, retry,
      targets: entries(row.targetPanels).map((id, index) => ({
        number: index + 1,
        label: ownerId ? [...new Set(locations.filter(location => location.panelId === id).flatMap(location => locationNames.get(refKey(location)) || []))].join('، ') || undefined : panelNames.get(id),
        status: row.status === 'SUCCESS' ? 'done' : failures.some(item => item === id || item.startsWith(id + ':')) ? 'failed' : completed.has(id) ? 'confirmed' : 'waiting',
      })),
    };
  }) };
}
