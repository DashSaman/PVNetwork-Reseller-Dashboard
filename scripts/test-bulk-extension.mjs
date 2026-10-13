import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const file = new URL('../src/lib/bulk-extension-core.ts', import.meta.url);
let core = {};
if (existsSync(file)) core = await import(file.href);
const GB = 1073741824;
const client = { email: 'u1', id: 'uuid-1', password: 'secret', limitIp: 3, totalGB: 10 * GB, expiryTime: 2000000000000, enable: false, subId: 'sub1', flow: 'xtls-rprx-vision', tgId: '42', reset: 7 };
const user = { id: 'u1', email: 'u1', trafficGB: 10, targets: [{ panelId: 'A', protocol: 'vless', client }] };
const plan = (users = [user], trafficGB = 5, days = 2, remaining = 50) => {
  assert.equal(typeof core.planExtension, 'function', 'bulk extension planner is missing');
  return core.planExtension(users, { trafficGB, days }, { unlimited: false, remaining });
};
test('adds quota and days to existing values without changing connection or disabled state', () => {
  const p = plan();
  assert.equal(p.requiredGB, 5);
  assert.deepEqual(p.users[0].targets[0].client, { ...client, totalGB: 15 * GB, expiryTime: 2000172800000 });
  assert.equal(p.users[0].oldTrafficGB, 10);
  assert.equal(p.users[0].newTrafficGB, 15);
});
test('rejects the entire group before changing anyone when the total exceeds remaining pool', () => {
  assert.throws(() => plan([user, { ...user, id: 'u2', email: 'u2' }], 5, 0, 9), /کافی/);
});
test('time-only operation works with exhausted pool and retains quota', () => {
  const p = plan([user], 0, 1, 0);
  assert.equal(p.requiredGB, 0);
  assert.equal(p.users[0].newTrafficGB, 10);
});
test('unlimited traffic and unlimited expiration stay unlimited; no quota is charged', () => {
  const unlimited = { ...user, trafficGB: 0, targets: [{ ...user.targets[0], client: { ...client, totalGB: 0, expiryTime: 0 } }] };
  const p = plan([unlimited]);
  assert.equal(p.requiredGB, 0);
  assert.equal(p.users.length, 0);
  assert.equal(p.unchanged, 1);
});
test('negative expiry retains first-use duration rather than becoming an absolute date', () => {
  const p = plan([{ ...user, targets: [{ ...user.targets[0], client: { ...client, expiryTime: -86400000 } }] }], 0, 2);
  assert.equal(p.users[0].targets[0].client.expiryTime, -259200000);
});
test('expired users get days added to original expiration, not from today', () => {
  const p = plan([{ ...user, targets: [{ ...user.targets[0], client: { ...client, expiryTime: 1000 } }] }], 0, 1);
  assert.equal(p.users[0].targets[0].client.expiryTime, 86401000);
});
test('rejects malformed numbers, no-op requests, and missing panel targets', () => {
  for (const [gb, days] of [[-1, 2], [1.5, 2], [5, NaN], [Infinity, 2], [0, 0], [5, -1]]) assert.throws(() => plan([user], gb, days));
  assert.throws(() => plan([{ ...user, targets: [] }]));
});
test('refuses mismatched live quota before a volume change', () => {
  assert.throws(() => plan([{ ...user, targets: [{ ...user.targets[0], client: { ...client, totalGB: 20 * GB } }] }]), /سهمیه/);
});
test('partial multi-panel retry uses fixed target values and skips completed panels', async () => {
  assert.equal(typeof core.executeExtensionUser, 'function', 'durable executor is missing');
  const p = plan([{ ...user, targets: [user.targets[0], { ...user.targets[0], panelId: 'B' }] }]).users[0];
  const live = { A: { ...client }, B: { ...client } };
  const completed = [];
  let localQuota = 10;
  let failB = true;
  const deps = {
    apply: async (t) => { if (t.panelId === 'B' && failB) throw new Error('offline'); live[t.panelId] = { ...t.client }; },
    markPanel: async (id) => { completed.push(id); },
    commit: async () => { localQuota = p.newTrafficGB; },
  };
  const r = await core.executeExtensionUser(p, completed, deps);
  assert.equal(r.ok, false);
  assert.equal(localQuota, 10);
  assert.equal(live.A.totalGB, 15 * GB);
  assert.deepEqual(completed, ['A']);
  failB = false;
  assert.equal((await core.executeExtensionUser(p, completed, deps)).ok, true);
  assert.equal(localQuota, 15);
  assert.equal(live.B.expiryTime, 2000172800000);
  assert.deepEqual(completed, ['A', 'B']);
});
test('lost success response can replay absolute targets without adding quota or time twice', async () => {
  assert.equal(typeof core.executeExtensionUser, 'function', 'durable executor is missing');
  const p = plan().users[0];
  let remote = { ...client };
  let loseRecord = true;
  let quota = 10;
  const deps = {
    apply: async (t) => { remote = { ...t.client }; },
    markPanel: async () => { if (loseRecord) throw new Error('lost response'); },
    commit: async () => { quota = p.newTrafficGB; },
  };
  assert.equal((await core.executeExtensionUser(p, [], deps)).ok, false);
  loseRecord = false;
  assert.equal((await core.executeExtensionUser(p, [], deps)).ok, true);
  assert.equal(remote.totalGB, 15 * GB);
  assert.equal(remote.expiryTime, 2000172800000);
  assert.equal(quota, 15);
});
