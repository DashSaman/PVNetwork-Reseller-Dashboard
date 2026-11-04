export type AvailabilityInbound = { id: number; enable?: boolean; nodeId?: number | null };
export type InboundRuntimeHealth = { observedAt: number; localRunning: boolean; nodes: unknown };
const MAX_HEARTBEAT_AGE_MS = 120000;

/** Availability is a selection policy, never a filter on accounting snapshots. */
export function inboundAvailable(inbound: AvailabilityInbound, health: InboundRuntimeHealth | undefined, now = Date.now()): boolean {
  if (inbound.enable !== true || !health || !Number.isFinite(health.observedAt) || now - health.observedAt > 10000 || health.observedAt - now > 30000) return false;
  if (inbound.nodeId === null) return health.localRunning === true;
  if (!Number.isSafeInteger(inbound.nodeId) || inbound.nodeId! <= 0 || !Array.isArray(health.nodes)) return false;
  // Child IDs belong to their parent panel's namespace. They cannot override a direct node.
  const matches = health.nodes.filter(n => n && typeof n === 'object' && n.id === inbound.nodeId && n.transitive !== true && !n.parentGuid);
  if (matches.length !== 1) return false;
  const node = matches[0];
  const heartbeat = typeof node.lastHeartbeat === 'number' ? node.lastHeartbeat : NaN;
  const stamp = heartbeat < 1e12 ? heartbeat * 1000 : heartbeat;
  return node.enable === true && node.status === 'online' && node.xrayState === 'running' && node.configDirty === false && Number.isFinite(stamp) && stamp > 0 && now - stamp <= MAX_HEARTBEAT_AGE_MS && stamp - now <= 30000;
}
