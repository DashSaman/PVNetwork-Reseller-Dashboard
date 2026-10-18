import test from 'node:test';
import assert from 'node:assert/strict';

const ledgerModule = await import(new URL('../src/lib/admin-traffic-ledger.ts', import.meta.url));
const { calculateAdminTrafficLedger } = ledgerModule;
const GiB = 1024 ** 3;
const canonicalUsage = (panels, email) => {
  let upBytes = 0;
  let downBytes = 0;
  for (const bundle of panels) {
    let winner = null;
    for (const inbound of bundle.inbounds) {
      const stats = inbound.clientStats.filter((row) => row.email === email);
      for (const row of stats) {
        if (!winner || row.up + row.down > winner.up + winner.down) winner = row;
      }
    }
    if (winner) { upBytes += winner.up; downBytes += winner.down; }
  }
  return { usedBytes: upBytes + downBytes };
};
const withCanonical = (input) => calculateAdminTrafficLedger({ ...input, canonicalUsage });
const reseller = (id, trafficPoolGB, consumedGB = 0) => ({ id, username: id, name: null, trafficPoolGB, consumedGB });
const user = (resellerId, email, trafficGB, inboundIds, panelId = '') => ({ resellerId, email, trafficGB, inboundIds, panelId });
const panel = (panelId, stats, ids = stats.map((_, i) => i + 1)) => ({ panelId, inbounds: stats.map((clientStats, i) => ({ id: ids[i], clientStats })) });

test('deduplicates inbound copies per panel, sums distinct target panels, and accounts reserves', () => {
  const result = withCanonical({
    resellers: [reseller('r1', 30, 1.5)],
    users: [user('r1', 'owned@example.test', 10, '[{"panelId":"A","inboundId":1},{"panelId":"B","inboundId":7}]')],
    reservations: [
      { resellerId: 'r1', reservedGB: 2, type: 'CREATE', status: 'NEEDS_REPAIR' },
      { resellerId: 'r1', reservedGB: 50, type: 'CREATE', status: 'SUCCESS' },
      { resellerId: 'r1', reservedGB: 50, type: 'DELETE', status: 'RUNNING' },
    ],
    snapshot: {
      ok: true,
      panels: [
        panel('A', [
          [{ email: 'owned@example.test', up: 1 * GiB, down: 2 * GiB }],
          [{ email: 'owned@example.test', up: 2 * GiB, down: 3 * GiB }],
        ]),
        panel('B', [[{ email: 'owned@example.test', up: 1 * GiB, down: 1 * GiB }]], [7]),
        panel('unrelated', [[{ email: 'someone-else@example.test', up: 100 * GiB, down: 0 }]], [99]),
      ],
    },
  });

  assert.equal(result.totals.allocatedToResellersGB, 30);
  assert.equal(result.totals.soldToUsersGB, 10);
  assert.equal(result.totals.unsoldGB, 16.5);
  assert.equal(result.totals.reservedGB, 2);
  assert.equal(result.totals.actualUsedGB, 7);
  assert.equal(result.totals.soldButUnusedGB, 3);
  assert.equal(result.resellers[0].usageKnownUsers, 1);
});

test('reports actual usage and sold-unused as unknown when any owned user panel is missing', () => {
  const result = withCanonical({
    resellers: [reseller('r1', 20)],
    users: [user('r1', 'missing@example.test', 5, '[{"panelId":"MISSING","inboundId":2}]')],
    reservations: [],
    snapshot: { ok: true, panels: [panel('A', [[{ email: 'other@example.test', up: 0, down: 0 }]], [2])] },
  });

  assert.equal(result.resellers[0].actualUsedGB, null);
  assert.equal(result.resellers[0].soldButUnusedGB, null);
  assert.equal(result.totals.actualUsedGB, null);
  assert.equal(result.totals.soldButUnusedGB, null);
  assert.equal(result.totals.unsoldGB, 15);
});

test('requires a finite nonnegative live counter for the owned email on every target panel', () => {
  for (const stats of [
    [{ email: 'u@example.test', up: Infinity, down: 0 }],
    [{ email: 'u@example.test', up: 0, down: NaN }],
    [{ email: 'u@example.test', up: -1, down: 0 }],
    [{ email: 'u@example.test', up: '0', down: 0 }],
  ]) {
    const result = withCanonical({
      resellers: [reseller('r1', 10)],
      users: [user('r1', 'u@example.test', 4, '[{"panelId":"A","inboundId":1}]')],
      reservations: [],
      snapshot: { ok: true, panels: [panel('A', [stats])] },
    });
    assert.equal(result.totals.actualUsedGB, null);
    assert.equal(result.totals.soldButUnusedGB, null);
  }
});

test('an explicitly partial snapshot cannot report zero usage', () => {
  const result = withCanonical({
    resellers: [reseller('r1', 10)],
    users: [user('r1', 'u@example.test', 4, '[{"panelId":"A","inboundId":1}]')],
    reservations: [],
    snapshot: { ok: false, panels: [panel('A', [[{ email: 'u@example.test', up: 0, down: 0 }]])] },
  });
  assert.equal(result.totals.actualUsedGB, null);
  assert.equal(result.totals.soldButUnusedGB, null);
});

test('legacy numeric inbound references use the user primary panel before global fallback', () => {
  const result = withCanonical({
    resellers: [reseller('r1', 10)],
    users: [user('r1', 'u@example.test', 4, '[5]', 'A')],
    reservations: [],
    primaryPanelId: 'B',
    snapshot: { ok: true, panels: [
      panel('A', [[{ email: 'u@example.test', up: 0, down: 0 }]], [5]),
      panel('B', [[{ email: 'u@example.test', up: 90 * GiB, down: 0 }]]),
    ] },
  });
  assert.equal(result.totals.actualUsedGB, 0);
  assert.equal(result.totals.soldButUnusedGB, 4);
});

test('pending or stale snapshots never turn missing live usage into zero', () => {
  for (const snapshot of [{ ok: true, pending: true, panels: [] }, { ok: true, stale: true, panels: [] }]) {
    const result = withCanonical({
      resellers: [reseller('r1', 10)],
      users: [user('r1', 'u@example.test', 4, '[{"panelId":"A","inboundId":1}]')],
      reservations: [],
      snapshot,
    });
    assert.equal(result.totals.actualUsedGB, null);
    assert.equal(result.totals.soldButUnusedGB, null);
  }
});

test('unlimited reseller pools and unlimited user quotas remain explicit', () => {
  const result = withCanonical({
    resellers: [reseller('r1', 0)],
    users: [user('r1', 'u@example.test', 0, '[{"panelId":"A","inboundId":1}]')],
    reservations: [],
    snapshot: { ok: true, panels: [panel('A', [[{ email: 'u@example.test', up: 0, down: 0 }]])] },
  });

  assert.equal(result.totals.allocatedToResellersGB, null);
  assert.equal(result.totals.unsoldGB, null);
  assert.equal(result.resellers[0].poolGB, null);
  assert.equal(result.totals.soldUnlimitedUsers, 1);
  assert.equal(result.totals.actualUsedGB, 0);
  assert.equal(result.totals.soldButUnusedGB, null);
});
