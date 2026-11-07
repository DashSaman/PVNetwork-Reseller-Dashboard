import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import * as policy from '../src/lib/pending-reset.ts';

const installation = 'a'.repeat(48);
const fixture = (patch = {}) => ({ id: 'old-request', resellerId: 'owner', userId: 'customer', email: 'customer_email', type: 'RESET', status: 'RUNNING', reservedGB: 3, usageSnapshotGB: 3, accountingCommitted: false, completedPanels: '[]', failedPanels: '[]', metadata: JSON.stringify({ explicitDestructive: true, operationInstallation: installation }), ...patch });

test('only a demonstrably unexecuted reset can be cancelled', () => {
  assert.equal(policy.canCancelUnstartedReset(fixture(), installation), true);
  const unsafe = [
    { status: 'NEEDS_REPAIR' }, { status: 'SUCCESS' }, { type: 'DELETE' },
    { accountingCommitted: true }, { completedPanels: '["some-panel"]' },
    { failedPanels: '[{"panelId":"some-panel"}]' }, { completedPanels: 'broken' },
    { reservedGB: NaN }, { usageSnapshotGB: null },
    ...[{ nodeSync: {} }, { usageByPanel: {} }, { nodeSync: { some: { steps: [{ status: 'PENDING' }] } } }]
      .map(progress => ({ metadata: JSON.stringify({ explicitDestructive: true, operationInstallation: installation, ...progress }) })),
    { metadata: '{broken' }, { metadata: '[]' },
  ];
  for (const patch of unsafe) assert.equal(policy.canCancelUnstartedReset(fixture(patch), installation), false, JSON.stringify(patch));
  assert.equal(policy.canCancelUnstartedReset(fixture(), null), false);
  assert.equal(policy.canCancelUnstartedReset(fixture(), 'another-installation'), false);
});

const source = process.argv.includes('--baseline')
  ? execFileSync('git', ['show', 'HEAD:src/lib/accounting-ops.ts'], { encoding: 'utf8' })
  : fs.readFileSync(new URL('../src/lib/accounting-ops.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

// Exercise the real observation caller and journal service across the lock gap:
// its SELECT sees RUNNING, then cancellation/completion happens before execution.
for (const type of ['RESET', 'DELETE']) for (const changed of ['CANCELLED', 'SUCCESS', 'identity', 'owner', 'installation']) {
  test(`stale ${type} observation after ${changed} never creates or resumes a destructive request`, async () => {
    const row = fixture({ type });let nativeCalls = 0, writes = 0, lockCalls = 0;
    const db = {
      operationJournal: {
        findMany: async input => input.where.type?.in?.includes('DELETE') ? [structuredClone(row)] : [],
        findUnique: async () => row,
        create: async () => { writes++;throw Error('Unexpected journal creation'); },
        update: async () => { writes++;throw Error('Unexpected journal update'); },
      },
      reseller: { findUnique: async () => ({ id: 'owner', active: true }) },
      resellerUser: { findUnique: async () => ({ id: 'customer', email: row.email, resellerId: 'owner', panelId: 'panel', inboundIds: '[{"panelId":"panel","inboundId":1}]' }) },
      panelConfig: { findMany: async () => [{ id: 'panel' }] },
    };
    const exports = {};
    vm.runInNewContext(compiled, { exports, require(name) {
      if (name === './db' || name === '@/lib/db') return { db };
      if (name === './pending-reset') return policy;
      if (name === './operation-installation') return { operationInstallation: () => installation };
      if (name === './queued-update') return { updateMetadata: value => JSON.parse(value || '{}') };
      if (name === './reseller-helpers') return { parseInboundRefs: value => JSON.parse(value), withResellerLock: async (_id, fn) => {
        lockCalls++;
        if (changed === 'identity') row.userId = 'replacement-customer';
        else if (changed === 'owner') row.resellerId = 'different-owner';
        else if (changed === 'installation') row.metadata = JSON.stringify({ explicitDestructive: true, operationInstallation: 'another-installation' });
        else row.status = changed;
        return fn();
      } };
      if (name === './panel-manager') return { getPrimaryPanel: async () => ({ id: 'panel' }), getAllPanelInboundsFresh: async () => { nativeCalls++;throw Error('Unexpected native work'); } };
      return {};
    } }, { filename: 'accounting-ops.cjs' });
    await exports.continuePendingDestructiveOperations('owner');
    assert.equal(lockCalls, 1, 'the observation must reach the lock gap');assert.equal(nativeCalls, 0);assert.equal(writes, 0);
  });
}
