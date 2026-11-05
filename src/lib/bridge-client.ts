import { createHash } from 'node:crypto';
import { db } from './db';
import { getAllPanelInbounds, getAllPanelInboundsFresh, getPanelConnection, getPrimaryPanel } from './panel-manager';
import { attachClient, arePanelNodesSynchronized, getLastOnline, type PanelClient } from './panel';
import { canonicalUserUsage, getResellerWithAccess, parseInboundRefs, refKey, stringifyInboundRefs, validateInboundSelection, type InboundRef, type ResellerWithInbounds } from './reseller-helpers';
import { validateAvailableInboundSelection } from './inbound-catalog';
import { updateUserByJournal } from './accounting-ops';
import { onlineTimestamp } from './customer-model';

const unavailable = 'اطلاعات زندهٔ حساب قابل تأیید نیست؛ دوباره تلاش کنید';
const seenCache = new Map<string, { at: number; value: Promise<Record<string, number>> }>();
async function lastSeen(panelId: string): Promise<Record<string, number>> {
  const cached = seenCache.get(panelId);
  if (cached && Date.now() - cached.at < 30000) return cached.value;
  const value = (async () => {
    const connection = await getPanelConnection(panelId);
    if (!connection.ok) return {};
    const result = await getLastOnline(connection.conn, { timeoutMs: 2500 });
    return result.ok && result.data ? result.data : {};
  })();
  seenCache.set(panelId, { at: Date.now(), value });
  return value;
}

/** New native API shape, scoped by tracked ownership; never invent zero usage. */
export async function readBridgeClient(reseller: ResellerWithInbounds, email: string, includeLastOnline = false) {
  const tracked = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId: reseller.id, email } } });
  if (!tracked) return { ok: false as const, error: 'کاربر یافت نشد' };
  const primary = tracked.panelId || (await getPrimaryPanel())?.id || '';
  const refs = parseInboundRefs(tracked.inboundIds, primary);
  const required = [...new Set(refs.map(r => r.panelId))];
  const snapshot = await getAllPanelInbounds();
  if (!required.length || !snapshot.ok || snapshot.pending || snapshot.stale) return { ok: false as const, error: unavailable };
  const bundles = snapshot.panels.filter(p => required.includes(p.panelId));
  if (bundles.length !== required.length) return { ok: false as const, error: unavailable };
  let profile: PanelClient | undefined;
  for (const bundle of bundles) {
    const current = bundle.inbounds.flatMap(i => i.clients).find(c => c.email === email);
    const stats = bundle.inbounds.flatMap(i => i.clientStats).filter(c => c.email === email);
    if (!current || tracked.subId && current.subId !== tracked.subId || !stats.some(s => Number.isFinite(s.up) && s.up >= 0 && Number.isFinite(s.down) && s.down >= 0)) return { ok: false as const, error: unavailable };
    if (!profile || bundle.panelId === primary) profile = current;
  }
  if (!profile || !Number.isSafeInteger(profile.totalGB) || profile.totalGB! < 0 || !Number.isSafeInteger(profile.expiryTime) || typeof profile.enable !== 'boolean') return { ok: false as const, error: unavailable };
  const client = { id: profile.id || profile.password || '', email, subId: tracked.subId || profile.subId || '',
    password: profile.password || '', flow: profile.flow || '', limitIp: profile.limitIp ?? 0,
    totalGB: profile.totalGB!, expiryTime: profile.expiryTime!, enable: profile.enable };
  const inboundIds = bundles.find(b => b.panelId === primary)?.inbounds.filter(i => i.clients.some(c => c.email === email)).map(i => i.id) || [];
  const usage = canonicalUserUsage(bundles, email);
  const stamps = includeLastOnline ? await Promise.all(required.map(async id => onlineTimestamp((await lastSeen(id))[email]))) : [];
  const lastOnline = stamps.length && stamps.every(s => s !== null) ? Math.max(...stamps as number[]) : 0;
  return { ok: true as const, client, inboundIds, usedTraffic: usage.usedBytes,
    traffic: { email, up: usage.upBytes, down: usage.downBytes, total: client.totalGB, expiryTime: client.expiryTime, enable: client.enable, lastOnline } };
}

/** Native attach means an existing central account; no orphan account is created. */
export async function attachBridgeClient(reseller: ResellerWithInbounds, email: string, input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 500 || input.some(n => !Number.isSafeInteger(n) || n <= 0)) return { ok: false as const, error: 'شناسهٔ لوکیشن نامعتبر است' };
  const snapshotStartedAt = Date.now();
  const tracked = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId: reseller.id, email } } });
  if (!tracked) return { ok: false as const, error: 'کاربر یافت نشد' };
  const primary = tracked.panelId || (await getPrimaryPanel())?.id || '';
  const current = parseInboundRefs(tracked.inboundIds, primary);
  const snapshot = await getAllPanelInboundsFresh();
  if (!snapshot.ok) return { ok: false as const, error: unavailable };
  const allowed = new Set(reseller.inbounds.map(i => refKey({ panelId: i.panelId || primary, inboundId: i.inboundId })));
  const requested: InboundRef[] = [];
  for (const inboundId of new Set(input as number[])) {
    const matches = snapshot.panels.filter(p => allowed.has(refKey({ panelId: p.panelId, inboundId })) && p.inbounds.some(i => i.id === inboundId));
    if (matches.length !== 1) return { ok: false as const, error: 'لوکیشن انتخابی مجاز نیست یا شناسهٔ آن مبهم است' };
    requested.push({ panelId: matches[0].panelId, inboundId });
  }
  const combined = [...new Map([...current, ...requested].map(r => [refKey(r), r])).values()];
  const permission = await validateInboundSelection(reseller, combined);
  if (!permission.ok) return { ok: false as const, error: permission.msg };
  const missing = requested.filter(r => !snapshot.panels.find(p => p.panelId === r.panelId)?.inbounds.find(i => i.id === r.inboundId)?.clients.some(c => c.email === email && (!tracked.subId || c.subId === tracked.subId)));
  const currentKeys = new Set(current.map(refKey));
  const selected = requested.filter(r => !currentKeys.has(refKey(r)) || missing.some(m => refKey(m) === refKey(r)));
  // A committed attach can still have a PARTIAL journal until nodes catch up.
  // Do not leave that journal blocking later reset/delete/renew requests.
  if (!selected.length && !await db.operationJournal.findFirst({ where: {
    resellerId: reseller.id, email, type: 'UPDATE', status: { in: ['PENDING', 'RUNNING', 'PARTIAL'] },
  } })) return { ok: true as const, pending: false };
  const availability = await validateAvailableInboundSelection(selected, snapshot);
  if (!availability.ok) return { ok: false as const, error: availability.msg };
  const identities = new Map<string, string>();
  for (const panelId of new Set(requested.map(r => r.panelId))) {
    const profile = snapshot.panels.find(p => p.panelId === panelId)?.inbounds.flatMap(i => i.clients).find(c => c.email === email && (!tracked.subId || c.subId === tracked.subId));
    if (!profile || profile.totalGB !== tracked.trafficGB * 1073741824) return { ok: false as const, error: 'حساب موجود و سهمیهٔ آن در مقصد قابل تأیید نیست' };
    const identity = profile.id || profile.password;
    if (!identity) return { ok: false as const, error: unavailable };
    identities.set(panelId, identity);
  }
  const intent = 'BRIDGE_ATTACH:' + createHash('sha256').update(JSON.stringify(combined.map(refKey).sort())).digest('hex');
  const result = await updateUserByJournal(reseller.id, email, { trafficGB: tracked.trafficGB, snapshotStartedAt, intent }, async () => {
    const owner = await getResellerWithAccess(reseller.id);
    if (!owner?.mirzaEnabled) return { errors: ['اتصال فروش این حساب فعال نیست'], pending: false };
    const access = await validateInboundSelection(owner, combined);
    if (!access.ok) return { errors: [access.msg], pending: false };
    const live = await getAllPanelInboundsFresh();
    const selectable = await validateAvailableInboundSelection(selected, live);
    if (!selectable.ok) return { errors: [selectable.msg], pending: false };
    for (const [panelId, identity] of identities) {
      const profile = live.panels.find(p => p.panelId === panelId)?.inbounds.flatMap(i => i.clients).find(c => c.email === email);
      if (!profile || (profile.id || profile.password) !== identity || tracked.subId && profile.subId !== tracked.subId || profile.totalGB !== tracked.trafficGB * 1073741824) return { errors: [unavailable], pending: false };
    }
    const errors: string[] = [];let pending = false;
    for (const panelId of new Set(requested.map(r => r.panelId))) {
      const connection = await getPanelConnection(panelId);
      if (!connection.ok) { errors.push(unavailable);continue; }
      const ids = missing.filter(r => r.panelId === panelId).map(r => r.inboundId);
      if (ids.length) {
        const attached = await attachClient(connection.conn, email, ids);
        if (!attached.ok && !attached.pending) errors.push(attached.msg || unavailable);
        pending ||= attached.pending === true;
      } else pending ||= !await arePanelNodesSynchronized(connection.conn, true);
    }
    return { errors, pending };
  }, async tx => {
    await tx.resellerUser.update({ where: { id: tracked.id }, data: { inboundIds: stringifyInboundRefs(combined) } });
  });
  return result.ok ? { ok: true as const, pending: result.pending === true } : { ok: false as const, error: result.msg };
}
