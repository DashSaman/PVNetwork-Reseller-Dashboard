import { getAllPanels, getPanelConnection, type AllPanelsResult, type PanelBundle } from './panel-manager';
import { getInboundRuntimeHealth, getInbounds, INBOUND_CATALOG_TIMEOUT_MS } from './panel';
import { inboundAvailable } from './inbound-availability';
import type { InboundRef } from './reseller-helpers';

type Catalog = { panels: PanelBundle[]; available: Set<string>; failedPanelIds: string[]; observedAt: number };
const key = (panelId: string, id: number) => `${panelId}::${id}`;
const UNAVAILABLE = 'بعضی لوکیشن‌های انتخابی حذف، غیرفعال یا از دسترس خارج شده‌اند؛ فهرست لوکیشن‌ها را بازخوانی و دوباره انتخاب کنید';

/** Direct, bounded reads. No DB fallback and no last-known-good availability. */
async function readCatalog(): Promise<Catalog> {
  const configs = (await getAllPanels()).filter(p => p.active);
  const results = await Promise.all(configs.map(async p => {
    const connection = await getPanelConnection(p.id);
    if (!connection.ok) return { panelId: p.id, failed: true as const };
    const snapshot = await getInbounds(connection.conn, { timeoutMs: INBOUND_CATALOG_TIMEOUT_MS });
    if (!snapshot.ok || !snapshot.data) return { panelId: p.id, failed: true as const };
    return { panelId: p.id, panelName: p.name, inbounds: snapshot.data, auth: connection.conn, failed: false as const };
  }));
  // Refresh every successful panel after all large payloads finish. A slower
  // independent panel must not age a healthy panel's evidence out of the batch.
  const observed = await Promise.all(results.map(async r => r.failed ? r : { ...r, health: await getInboundRuntimeHealth(r.auth) }));
  const panels: PanelBundle[] = [], available = new Set<string>(), failedPanelIds: string[] = [];
  for (const r of observed) {
    if (r.failed) { failedPanelIds.push(r.panelId);continue; }
    panels.push({ panelId: r.panelId, panelName: r.panelName, inbounds: r.inbounds });
    for (const inbound of r.inbounds) if (inboundAvailable(inbound, r.health)) available.add(key(r.panelId, inbound.id));
  }
  return { panels, available, failedPanelIds, observedAt: Date.now() };
}

const flight: { current?: { started: number; promise: Promise<Catalog> } } = ((globalThis as { __pvnetInboundCatalog?: object }).__pvnetInboundCatalog ??= {});
export async function getSelectableInboundCatalog(): Promise<Catalog> {
  if (flight.current) return flight.current.promise;
  const promise = readCatalog();flight.current = { started: Date.now(), promise };
  try { return await promise; } finally { if (flight.current?.promise === promise) flight.current = undefined; }
}

/** Call after the grant check, before any reservation or native write. */
export async function validateAvailableInboundSelection(refs: InboundRef[], snapshot: AllPanelsResult): Promise<{ ok: true } | { ok: false; status: number; msg: string }> {
  if (!refs.length) return { ok: true };
  if (snapshot.pending || snapshot.stale || !snapshot.ok) return { ok: false, status: 409, msg: UNAVAILABLE };
  const available = new Set<string>();
  await Promise.all([...new Set(refs.map(r => r.panelId))].map(async panelId => {
    const bundle = snapshot.panels.find(p => p.panelId === panelId);if (!bundle) return;
    const connection = await getPanelConnection(panelId);if (!connection.ok) return;
    const health = await getInboundRuntimeHealth(connection.conn);
    for (const inbound of bundle.inbounds) if (inboundAvailable(inbound, health)) available.add(key(panelId, inbound.id));
  }));
  return refs.every(r => available.has(key(r.panelId, r.inboundId))) ? { ok: true } : { ok: false, status: 409, msg: UNAVAILABLE };
}
