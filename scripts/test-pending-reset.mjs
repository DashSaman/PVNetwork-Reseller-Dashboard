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

test('unstarted delete cancellation preserves its allocation and denies any native work evidence', () => {
  const deletion = fixture({ type: 'DELETE', reservedGB: 0 });
  assert.equal(policy.canCancelUnstartedOperation(deletion, installation), true);
  assert.equal(policy.canCancelUnstartedReset(deletion, installation), false);
  for (const patch of [{ reservedGB: 1 }, { accountingCommitted: true }, { metadata: JSON.stringify({ explicitDestructive: true, operationInstallation: installation, usageByPanel: {} }) }, { completedPanels: '["panel"]' }, { status: 'NEEDS_REPAIR' }]) assert.equal(policy.canCancelUnstartedOperation({ ...deletion, ...patch }, installation), false);
});

const acknowledgedDelete = (patch={}) => fixture({ type:'DELETE',reservedGB:0,targetPanels:'["panel"]',completedPanels:'["panel"]',metadata:JSON.stringify({explicitDestructive:true,operationInstallation:installation,usageByPanel:{panel:3},nodeSync:{panel:{version:1,email:'customer_email',op:'delete',deleteVerified:true,deleteTargets:['master'],steps:[{key:'master',identity:'customer-id',status:'DONE'}]}}}),...patch });
test('an acknowledged delete can finalize after synchronization without dispatching a new operation',()=>{
 assert.equal(policy.canFinalizeAcknowledgedDeletion?.(acknowledgedDelete(),installation)??false,true);
 assert.equal(policy.canFinalizeAcknowledgedDeletion?.(acknowledgedDelete({accountingCommitted:true}),installation)??false,true);
});
test('read-triggered deletion finalization never accepts incomplete, ambiguous or foreign progress',()=>{
 const bad=[{type:'RESET'},{status:'SUCCESS'},{reservedGB:1},{usageSnapshotGB:null},{usageSnapshotGB:-1},{completedPanels:'[]'},{completedPanels:'["panel","unknown"]'},{targetPanels:'[]'},{failedPanels:'["panel:UNREACHABLE"]'},{metadata:'{}'},...['STARTED','PENDING'].map(status=>({metadata:JSON.stringify({explicitDestructive:true,operationInstallation:installation,usageByPanel:{panel:3},nodeSync:{panel:{version:1,email:'customer_email',op:'delete',steps:[{key:'master',identity:'customer-id',status}]}}})}))];
 for(const patch of bad)assert.equal(policy.canFinalizeAcknowledgedDeletion?.(acknowledgedDelete(patch),installation)??false,false,JSON.stringify(patch));
 assert.equal(policy.canFinalizeAcknowledgedDeletion?.(acknowledgedDelete(),null)??false,false);
 assert.equal(policy.canFinalizeAcknowledgedDeletion?.(acknowledgedDelete(),'other-installation')??false,false);
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

for (const changed of ['CANCELLED','SUCCESS','identity','owner','installation','progress']) {
 test(`acknowledged deletion confirmation rechecks ${changed} after acquiring its lock`,async()=>{
  const row=acknowledgedDelete();let writes=0,nativeCalls=0,lockCalls=0;
  const db={operationJournal:{findMany:async()=>[structuredClone(row)],findUnique:async()=>row,create:async()=>{writes++;throw Error('Unexpected journal creation')},update:async()=>{writes++;throw Error('Unexpected journal update')}},reseller:{findUnique:async()=>({id:'owner',active:true})},resellerUser:{findUnique:async()=>({id:'customer',email:'customer_email',resellerId:'owner',panelId:'panel',inboundIds:'[{"panelId":"panel","inboundId":1}]'})},panelConfig:{findMany:async()=>[{id:'panel'}]}};
  const exports={};vm.runInNewContext(compiled,{exports,require(name){
   if(name==='./db'||name==='@/lib/db')return{db};if(name==='./pending-reset')return policy;if(name==='./operation-installation')return{operationInstallation:()=>installation};if(name==='./queued-update')return{updateMetadata:v=>JSON.parse(v||'{}')};
   if(name==='./reseller-helpers')return{parseInboundRefs:v=>JSON.parse(v),withResellerLock:async(_id,fn)=>{lockCalls++;if(changed==='identity')row.userId='replacement';else if(changed==='owner')row.resellerId='other';else if(changed==='installation')row.metadata=JSON.stringify({...JSON.parse(row.metadata),operationInstallation:'other'});else if(changed==='progress')row.completedPanels='[]';else row.status=changed;return fn()}};
   if(name==='./panel-manager')return{getPrimaryPanel:async()=>({id:'panel'}),getAllPanelInboundsFresh:async()=>{nativeCalls++;throw Error('Unexpected native action')}};return{};
  }},{filename:'acknowledged-accounting.cjs'});
  await exports.confirmAcknowledgedDeletions?.('owner');assert.equal(lockCalls,1);assert.equal(nativeCalls,0);assert.equal(writes,0);
 });
}

test('synchronous bot confirmation recognizes an already-completed exact deletion race',async()=>{
 const row=acknowledgedDelete({status:'SUCCESS',accountingCommitted:true}),exports={};
 const db={operationJournal:{findFirst:async()=>row},resellerUser:{findUnique:async()=>null}};
 vm.runInNewContext(compiled,{exports,require(name){if(name==='./db'||name==='@/lib/db')return{db};if(name==='./pending-reset')return policy;if(name==='./operation-installation')return{operationInstallation:()=>installation};return{};}});
 assert.equal(await exports.confirmAcknowledgedDeletion('owner','customer','customer_email'),true);
});
test('already-completed bot confirmation still requires the exact proof and original customer absence',async()=>{
 for(const [patch,present] of [[{accountingCommitted:false},false],[{metadata:'{}'},false],[{resellerId:'other'},false],[{userId:'replacement'},false],[{email:'other'},false],[{},true]]){
  const row=acknowledgedDelete({status:'SUCCESS',accountingCommitted:true,...patch}),exports={},db={operationJournal:{findFirst:async()=>row},resellerUser:{findUnique:async()=>present?{id:'customer'}:null}};
  vm.runInNewContext(compiled,{exports,require(name){if(name==='./db'||name==='@/lib/db')return{db};if(name==='./pending-reset')return policy;if(name==='./operation-installation')return{operationInstallation:()=>installation};return{};}});
  assert.equal(await exports.confirmAcknowledgedDeletion('owner','customer','customer_email'),false);
 }
});
