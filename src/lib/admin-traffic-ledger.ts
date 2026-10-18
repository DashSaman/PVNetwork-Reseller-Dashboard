const GIB = 1024 ** 3;
const ACTIVE_RESERVATION_STATUSES = ["PENDING", "RUNNING", "PARTIAL", "NEEDS_REPAIR"];

export type LedgerPanel = {
  panelId: string;
  inbounds: { id: number; clientStats: { email: string; up?: unknown; down?: unknown }[] }[];
};
type CanonicalPanel = { panelId: string; inbounds: { clientStats: { email: string; up?: number; down?: number }[] }[] };

type LedgerSnapshot = {
  ok: boolean;
  pending?: boolean;
  stale?: boolean;
  panels: LedgerPanel[];
};

type LedgerResellerInput = {
  id: string;
  username: string;
  name: string | null;
  trafficPoolGB: number;
  consumedGB: number;
};

type LedgerUserInput = {
  resellerId: string;
  email: string;
  trafficGB: number;
  inboundIds: string;
  panelId: string;
};

type LedgerReservationInput = { resellerId: string; reservedGB: number; type: string; status: string };

export type AdminTrafficLedger = {
  available: boolean;
  totals: {
    allocatedToResellersGB: number | null;
    soldToUsersGB: number;
    soldUnlimitedUsers: number;
    unsoldGB: number | null;
    soldButUnusedGB: number | null;
    actualUsedGB: number | null;
    consumedHistoricalGB: number;
    reservedGB: number;
  };
  resellers: {
    id: string;
    name: string;
    unlimitedPool: boolean;
    poolGB: number | null;
    soldGB: number;
    unlimitedUsers: number;
    unsoldGB: number | null;
    soldButUnusedGB: number | null;
    actualUsedGB: number | null;
    consumedHistoricalGB: number;
    reservedGB: number;
    usageKnownUsers: number;
    users: number;
  }[];
};

/** Pure accounting view, shared by the local overview and the live panel summary. */
export function calculateAdminTrafficLedger(input: {
  resellers: LedgerResellerInput[];
  users: LedgerUserInput[];
  reservations: LedgerReservationInput[];
  snapshot?: LedgerSnapshot;
  primaryPanelId?: string;
  canonicalUsage: (panels: CanonicalPanel[], email: string) => { usedBytes: number };
}): AdminTrafficLedger {
  const panelIds = new Set(input.snapshot?.panels.map((p) => p.panelId) ?? []);
  const groups = new Map<string, LedgerUserInput[]>();
  for (const user of input.users) groups.set(user.resellerId, [...(groups.get(user.resellerId) ?? []), user]);

  let allocatedToResellersGB = 0;
  let anyUnlimitedPool = false;
  let soldTotal = 0;
  let unlimitedUsersTotal = 0;
  let unsoldTotal = 0;
  let soldButUnusedTotal = 0;
  let actualUsedTotal = 0;
  let historicalTotal = 0;
  let reservedTotal = 0;
  let allRemainingKnown = true;
  let allUnusedKnown = true;
  let allUsageKnown = Boolean(input.snapshot?.ok && !input.snapshot.pending && !input.snapshot.stale);

  const resellers = input.resellers.map((reseller) => {
    const users = groups.get(reseller.id) ?? [];
    const reservations = input.reservations
      .filter((r: LedgerReservationInput & { resellerId: string }) => r.resellerId === reseller.id && (r.type === "CREATE" || r.type === "UPDATE") && ACTIVE_RESERVATION_STATUSES.includes(r.status))
      .reduce((sum, row) => sum + (row.reservedGB || 0), 0);
    const soldGB = users.reduce((sum, user) => sum + Math.max(0, user.trafficGB || 0), 0);
    const unlimitedUsers = users.filter((user) => user.trafficGB <= 0).length;
    const unlimitedPool = reseller.trafficPoolGB <= 0;
    if (unlimitedPool) anyUnlimitedPool = true;
    else allocatedToResellersGB += reseller.trafficPoolGB;

    const remainingGB = unlimitedPool
      ? null
      : Math.max(0, reseller.trafficPoolGB - soldGB - (reseller.consumedGB || 0) - reservations);
    if (remainingGB === null) allRemainingKnown = false;

    let usageKnownUsers = 0;
    let actualUsedGB: number | null = 0;
    let soldButUnusedGB: number | null = 0;
    let resellerUsageKnown = Boolean(input.snapshot?.ok && !input.snapshot.pending && !input.snapshot.stale);
    for (const user of users) {
      let refs: { panelId: string; inboundId: number }[] = [];
      try {
        const parsed = JSON.parse(user.inboundIds || "[]");
        refs = Array.isArray(parsed) ? parsed.map((ref): { panelId: string; inboundId: number } | null => {
          if (typeof ref === "number" && Number.isFinite(ref)) return { panelId: user.panelId || input.primaryPanelId || "", inboundId: ref };
          if (!ref || typeof ref !== "object" || !Number.isFinite(Number(ref.inboundId))) return null;
          return { panelId: String(ref.panelId || user.panelId || input.primaryPanelId || ""), inboundId: Number(ref.inboundId) };
        }).filter((ref): ref is { panelId: string; inboundId: number } => ref !== null) : [];
      } catch { refs = []; }
      const requiredPanelIds: string[] = [...new Set(refs.map((ref) => ref.panelId).filter((id): id is string => typeof id === "string" && id.length > 0))];
      const complete = requiredPanelIds.length > 0 && requiredPanelIds.every((id) => panelIds.has(id)) && refs.every((ref) =>
        input.snapshot?.panels.some((panel) => panel.panelId === ref.panelId && panel.inbounds.some((inbound) => inbound.id === ref.inboundId))
      );
      if (!complete || !input.snapshot?.ok || input.snapshot.pending || input.snapshot.stale) {
        resellerUsageKnown = false;
        continue;
      }

      const relevantPanels: CanonicalPanel[] = input.snapshot.panels.filter((panel) => requiredPanelIds.includes(panel.panelId)).map((panel) => ({
        ...panel,
        inbounds: panel.inbounds.map((inbound) => ({
          clientStats: inbound.clientStats.filter((stat): stat is { email: string; up: number; down: number } => stat.email === user.email && typeof stat.up === "number" && Number.isFinite(stat.up) && stat.up >= 0 && typeof stat.down === "number" && Number.isFinite(stat.down) && stat.down >= 0),
        })),
      }));
      const userPresentOnEveryPanel = requiredPanelIds.every((id) => relevantPanels.some((panel) => panel.panelId === id && panel.inbounds.some((inbound) => inbound.clientStats.some((stat) => stat.email === user.email))));
      if (!userPresentOnEveryPanel) {
        resellerUsageKnown = false;
        continue;
      }
      // Restrict canonical counters to this user's fully observed target panels.
      const usedGB = input.canonicalUsage(relevantPanels, user.email).usedBytes / GIB;
      usageKnownUsers++;
      actualUsedGB = (actualUsedGB ?? 0) + usedGB;
      if (user.trafficGB <= 0) soldButUnusedGB = null;
      else if (soldButUnusedGB !== null) soldButUnusedGB += Math.max(0, user.trafficGB - usedGB);
    }
    if (!resellerUsageKnown) {
      actualUsedGB = null;
      soldButUnusedGB = null;
    }
    if (unlimitedUsers > 0) soldButUnusedGB = null;
    if (actualUsedGB === null) allUsageKnown = false;
    else actualUsedTotal += actualUsedGB;
    if (soldButUnusedGB === null) allUnusedKnown = false;
    else soldButUnusedTotal += soldButUnusedGB;

    soldTotal += soldGB;
    unlimitedUsersTotal += unlimitedUsers;
    historicalTotal += reseller.consumedGB || 0;
    reservedTotal += reservations;
    if (remainingGB !== null) unsoldTotal += remainingGB;

    return {
      id: reseller.id,
      name: reseller.name || reseller.username,
      unlimitedPool,
      poolGB: unlimitedPool ? null : reseller.trafficPoolGB,
      soldGB,
      unlimitedUsers,
      unsoldGB: remainingGB,
      soldButUnusedGB,
      actualUsedGB,
      consumedHistoricalGB: reseller.consumedGB || 0,
      reservedGB: reservations,
      usageKnownUsers,
      users: users.length,
    };
  });

  return {
    available: Boolean(input.snapshot?.ok && !input.snapshot.pending && !input.snapshot.stale && allUsageKnown),
    totals: {
      allocatedToResellersGB: anyUnlimitedPool ? null : allocatedToResellersGB,
      soldToUsersGB: soldTotal,
      soldUnlimitedUsers: unlimitedUsersTotal,
      unsoldGB: allRemainingKnown ? unsoldTotal : null,
      soldButUnusedGB: allUnusedKnown ? soldButUnusedTotal : null,
      actualUsedGB: allUsageKnown ? actualUsedTotal : null,
      consumedHistoricalGB: historicalTotal,
      reservedGB: reservedTotal,
    },
    resellers,
  };
}

/** Local-only mode is safe for the fast /overview endpoint; live metrics stay null. */
export async function getAdminTrafficLedger(snapshot?: LedgerSnapshot, primaryPanelId = ""): Promise<AdminTrafficLedger> {
  const [{ db }, { canonicalUserUsage }] = await Promise.all([import("./db"), import("./reseller-helpers")]);
  const [resellers, users, reservations] = await Promise.all([
    db.reseller.findMany({ select: { id: true, username: true, name: true, trafficPoolGB: true, consumedGB: true } }),
    db.resellerUser.findMany({ select: { resellerId: true, email: true, trafficGB: true, inboundIds: true, panelId: true } }),
    db.operationJournal.findMany({
      where: { type: { in: ["CREATE", "UPDATE"] }, status: { in: ACTIVE_RESERVATION_STATUSES } },
      select: { resellerId: true, reservedGB: true, type: true, status: true },
    }),
  ]);
  return calculateAdminTrafficLedger({
    resellers,
    users,
    reservations,
    snapshot,
    primaryPanelId,
    canonicalUsage: canonicalUserUsage,
  });
}
