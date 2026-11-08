import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
const hooks = registerHooks({ resolve(s, c, next) { return next(s.startsWith('./') && c.parentURL?.includes('/src/lib/') && !s.endsWith('.ts') ? s + '.ts' : s, c); } });
const { updateClient, resetClientTraffic, deleteClient } = await import('../src/lib/panel.ts');
hooks.deregister();
const GB = 1073741824;
const original = () => ({ email: 'user', uuid: 'same-uuid', id: 123, totalGB: 44 * GB, expiryTime: 2000000000000, enable: true, subId: 'same-sub', password: 'keep-secret', limitIp: 3, reset: 7, tgId: '42', flow: 'xtls-rprx-vision', allowedIPs: '', keepAlive: 0 });
async function fixture(fn) {
  const calls = [];
  async function panel(name) {
    const p = { client: original(), ids: [1], fail: false, resets: 0, server: null, pending: false, ignorePatch: false, used: 12345 };
    p.server = http.createServer(async (req, res) => {
      let raw = ''; for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : null;
      calls.push(`${name}:${req.method}:${req.url}`);
      let success = true, obj, msg = '';
      if (p.fail) { success = false; msg = 'unreachable'; }
      else if (req.url.includes('/get/')) {
        if (!p.client) { success = false; msg = 'Obtain (record not found)'; }
        else obj = { client: p.client, inboundIds: p.ids, usedTraffic: p.used };
      } else if (req.url.includes('/update/')) {
        if (name === 'node') assert.equal(body.limitIp, 3);
        if (!p.ignorePatch) p.client = { ...p.client, ...body, id: 123 };
        if (p.pending) obj = { nodePending: true };
      } else if (req.url.includes('/resetTraffic/')) { p.resets++; p.used=0; }
      else if (req.url === '/panel/api/inbounds/list') obj=p.ids.map(id=>p.catalogOmitLocalNode?{id}:{id,nodeId:p.catalogNodeId??null});
      else if (req.url.includes('/del/')) { p.client = null;if(p.afterDelete)p.afterDelete(); }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success, obj, msg }));
    });
    await new Promise(r => p.server.listen(0, '127.0.0.1', r));
    p.baseUrl = `http://127.0.0.1:${p.server.address().port}`; return p;
  }
  const master = await panel('master'), node = await panel('node');
  master.client.limitIp = 0;
  master.ids = [21];
  const auth = { baseUrl: master.baseUrl, token: 'test', nodePeers: [{ key: 'de', baseUrl: node.baseUrl, token: 'test', masterInboundIds: [142] }] };
  try { await fn({ master, node, auth, calls }); }
  finally { for (const p of [master, node]) p.server.closeAllConnections(); await Promise.all([master, node].map(p => new Promise(r => p.server.close(r)))); }
}
const desired = extra => ({ id: 'same-uuid', email: 'user', totalGB: 44 * GB, expiryTime: 2000000000000, enable: true, subId: 'same-sub', limitIp: 0, ...extra });

test('queued master update is distinguished from an unverified native acknowledgement', () => fixture(async ({ master, auth }) => {
  master.pending = true;
  let r = await updateClient(auth, 'user', 'vless', desired({totalGB:50*GB}));
  assert.equal(r.ok,false);assert.equal(r.pending,true);assert.equal(master.client.totalGB,50*GB);
  master.ignorePatch = true;
  r = await updateClient(auth, 'user', 'vless', desired({totalGB:51*GB}));
  assert.equal(r.ok,false);assert.notEqual(r.pending,true);
}));
test('stale unlinked node quota and expiry are updated before master enable; identity/counters/settings preserved', () => fixture(async ({ master, node, auth, calls }) => {
  node.client.totalGB = 20 * GB; node.client.expiryTime = 1800000000000; node.client.enable = false;
  assert.equal((await updateClient(auth, 'user', 'vless', desired())).ok, true);
  assert.equal(node.client.totalGB, 44 * GB); assert.equal(node.client.expiryTime, master.client.expiryTime); assert.equal(node.client.enable, true);
  assert.equal(node.client.uuid, 'same-uuid'); assert.equal(node.client.password, 'keep-secret'); assert.equal(node.client.subId, 'same-sub'); assert.equal(node.client.reset, 7);
  assert.ok(calls.indexOf('node:POST:/panel/api/clients/update/user') < calls.indexOf('master:POST:/panel/api/clients/update/user'));
  assert.ok(!calls.some(c => /resetTraffic|attach|inbounds/.test(c)));
}));
test('intentional disable is retained during quota extension', () => fixture(async ({ master, node, auth }) => {
  master.client.enable = false;
  assert.equal((await updateClient(auth, 'user', 'vless', desired({ enable: false, totalGB: 50 * GB }))).ok, true);
  assert.equal(node.client.enable, false);
}));
test('identity conflict and unavailable peer block master writes', () => fixture(async ({ node, auth, calls }) => {
  node.client.uuid = 'different-owner';
  assert.equal((await updateClient(auth, 'user', 'vless', desired())).ok, false);
  assert.ok(!calls.some(c => c.includes(':POST:')));
  node.client.uuid = 'same-uuid'; node.fail = true;
  assert.equal((await updateClient(auth, 'user', 'vless', desired())).ok, false);
  assert.ok(!calls.some(c => c.includes(':POST:')));
}));
test('absent peer client is never created; linked peer stays in native fan-out', () => fixture(async ({ master, node, auth, calls }) => {
  node.client = null;
  assert.equal((await updateClient(auth, 'user', 'vless', desired())).ok, true);
  assert.ok(!calls.some(c => c.startsWith('node:POST')));
  calls.length = 0; master.ids = [142]; node.fail = true;
  assert.equal((await updateClient(auth, 'user', 'vless', desired())).ok, true);
  assert.ok(!calls.some(c => c.startsWith('node:')));
}));
test('absolute retry and subscription rotation converge after master failure', () => fixture(async ({ master, node, auth }) => {
  // Reject the master POST only, after successful preflight.
  const originalEmit = master.server.emit.bind(master.server);
  let rejectWrite = true;
  master.server.emit = (event, ...args) => {
    if (event === 'request' && args[0].method === 'POST' && rejectWrite) { args[1].end(JSON.stringify({ success: false, msg: 'write failed' })); return true; }
    return originalEmit(event, ...args);
  };
  const change = desired({ subId: 'rotated', totalGB: 50 * GB });
  assert.equal((await updateClient(auth, 'user', 'vless', change)).ok, false);
  assert.equal(node.client.totalGB, 50 * GB); assert.equal(node.client.subId, 'rotated');
  rejectWrite = false;
  assert.equal((await updateClient(auth, 'user', 'vless', change)).ok, true);
  assert.equal(master.client.totalGB, 50 * GB); assert.equal(node.client.totalGB, 50 * GB);
}));
test('journal progress survives partial reset; completed node is not reset again', () => fixture(async ({ master, node, auth }) => {
  let state;
  const progress = { load: async () => structuredClone(state), save: async v => { state = structuredClone(v); } };
  const emit = master.server.emit.bind(master.server);
  master.server.emit = (event, ...args) => {
    if (event === 'request' && args[0].method === 'POST') { args[1].end(JSON.stringify({ success: false, msg: 'write failed' })); return true; }
    return emit(event, ...args);
  };
  assert.equal((await resetClientTraffic(auth, 'user', progress)).ok, false);
  assert.equal(node.resets, 1);
  master.server.emit = emit;
  // A response failure after sending reset is ambiguous: do not replay either reset.
  assert.equal((await resetClientTraffic(auth, 'user', progress)).ok, false);
  assert.equal(node.resets, 1); assert.equal(master.resets, 0);
}));
test('delete retry uses saved identity after master deletion and skips completed node', () => fixture(async ({ master, node, auth, calls }) => {
  let state;
  const progress = { load: async () => structuredClone(state), save: async v => { state = structuredClone(v); } };
  assert.equal((await deleteClient(auth, 'user', progress)).ok, true);
  const writes = calls.filter(c => c.includes(':POST:')).length;
  assert.equal((await deleteClient(auth, 'user', progress)).ok, true);
  assert.equal(calls.filter(c => c.includes(':POST:')).length, writes);
  assert.equal(master.client, null); assert.equal(node.client, null);
}));

test('delete verifies linked peers directly instead of trusting native fan-out',()=>fixture(async({master,node,auth,calls})=>{
 master.ids=[142];let state;const progress={expectedSubId:'same-sub',load:async()=>structuredClone(state),save:async v=>{state=structuredClone(v)}};
 assert.equal((await deleteClient(auth,'user',progress)).ok,true);assert.equal(node.client,null);assert.equal(master.client,null);assert.deepEqual(state.steps.map(s=>s.key),['de','master']);
 assert.ok(calls.indexOf('node:POST:/panel/api/clients/del/user')<calls.indexOf('master:POST:/panel/api/clients/del/user'));
}));
test('linked peer identity, subscription or read failure blocks deletion before every write',()=>fixture(async({master,node,auth,calls})=>{
 master.ids=[142];const progress={expectedSubId:'same-sub',load:async()=>undefined,save:async()=>{}};
 for(const field of ['uuid','subId','unreachable']){node.client=original();node.fail=false;if(field==='unreachable')node.fail=true;else node.client[field]='foreign';calls.length=0;assert.equal((await deleteClient(auth,'user',progress)).ok,false);assert.ok(!calls.some(c=>c.includes(':POST:')));}
}));
test('a legacy master-only deletion journal cannot hide an existing linked copy',()=>fixture(async({master,node,auth})=>{
 master.ids=[142];let state={version:1,email:'user',op:'delete',steps:[{key:'master',identity:'same-uuid',status:'DONE'}]};master.client=null;
 const progress={expectedSubId:'same-sub',load:async()=>structuredClone(state),save:async v=>{state=structuredClone(v)}};
 const r=await deleteClient(auth,'user',progress);assert.ok(!r.ok||node.client===null,'Success requires native absence, including a legacy journal');
}));
test('a completed delete step is checked again before returning success',()=>fixture(async({master,node,auth,calls})=>{
 let state;const progress={expectedSubId:'same-sub',load:async()=>structuredClone(state),save:async v=>{state=structuredClone(v)}};assert.equal((await deleteClient(auth,'user',progress)).ok,true);
 node.client=original();node.client.uuid='replacement';const writes=calls.filter(c=>c.includes(':POST:')).length;assert.equal((await deleteClient(auth,'user',progress)).ok,false);assert.equal(calls.filter(c=>c.includes(':POST:')).length,writes);assert.equal(node.client.uuid,'replacement');
}));
test('legacy deletion extension refuses a foreign UUID or subscription before writing',()=>fixture(async({master,node,auth,calls})=>{
 master.client=null;master.ids=[142];
 for(const field of ['uuid','subId']){node.client=original();node.client[field]='foreign';calls.length=0;let state={version:1,email:'user',op:'delete',steps:[{key:'master',identity:'same-uuid',status:'DONE'}]};const progress={expectedSubId:'same-sub',load:async()=>structuredClone(state),save:async v=>{state=structuredClone(v)}};assert.equal((await deleteClient(auth,'user',progress)).ok,false);assert.ok(!calls.some(c=>c.includes(':POST:')));}
}));
test('delayed native fan-out can recreate only the same copy and is reconciled before success',()=>fixture(async({master,node,auth,calls})=>{
 master.ids=[142];master.afterDelete=()=>{node.client=original();node.client.enable=false};let state;const progress={expectedSubId:'same-sub',checkpointUsage:async()=>{},load:async()=>structuredClone(state),save:async v=>{state=structuredClone(v)}};
 assert.equal((await deleteClient(auth,'user',progress)).ok,true);assert.equal(master.client,null);assert.equal(node.client,null);assert.equal(state.deleteVerified,true);assert.equal(calls.filter(c=>c==='master:POST:/panel/api/clients/del/user').length,1);assert.equal(calls.filter(c=>c==='node:POST:/panel/api/clients/del/user').length,2);assert.ok(!calls.some(c=>c.includes('resetTraffic')));
}));
test('a newly introduced native node needs an authenticated peer before deletion can begin',()=>fixture(async({master,node,auth,calls})=>{
 master.ids=[142];master.catalogNodeId=2;auth.nodePeers[0].nativeNodeId=1;let state;const progress={expectedSubId:'same-sub',load:async()=>structuredClone(state),save:async v=>{state=structuredClone(v)}};assert.equal((await deleteClient(auth,'user',progress)).ok,false);assert.ok(!calls.some(c=>c.includes(':POST:')));auth.nodePeers[0].nativeNodeId=2;assert.equal((await deleteClient(auth,'user',progress)).ok,true);assert.equal(master.client,null);assert.equal(node.client,null);
}));
test('an initially absent peer stays in the durable deletion target set',()=>fixture(async({node,auth,calls})=>{
 node.client=null;let state;const progress={expectedSubId:'same-sub',load:async()=>structuredClone(state),save:async v=>{state=structuredClone(v)}};assert.equal((await deleteClient(auth,'user',progress)).ok,true);assert.ok(state.deleteTargets.includes('de'));auth.nodePeers=[];const writes=calls.filter(c=>c.includes(':POST:')).length;assert.equal((await deleteClient(auth,'user',progress)).ok,false);assert.equal(calls.filter(c=>c.includes(':POST:')).length,writes);
}));

test('native omitempty local node attribution permits deletion with every remote peer still verified',()=>fixture(async({master,node,auth})=>{
 master.catalogOmitLocalNode=true;auth.nodePeers[0].nativeNodeId=1;let state;const progress={expectedSubId:'same-sub',checkpointUsage:async()=>{},load:async()=>structuredClone(state),save:async v=>{state=structuredClone(v)}};
 assert.equal((await deleteClient(auth,'user',progress)).ok,true);assert.equal(master.client,null);assert.equal(node.client,null);assert.equal(state.deleteVerified,true);
}));

test('invalid native node attribution cannot be treated as local',()=>fixture(async({master,auth,calls})=>{
 auth.nodePeers[0].nativeNodeId=1;
 for(const nodeId of [0,-1,'1',true,{}]){master.catalogNodeId=nodeId;calls.length=0;let state;const progress={expectedSubId:'same-sub',load:async()=>structuredClone(state),save:async v=>{state=structuredClone(v)}};assert.equal((await deleteClient(auth,'user',progress)).ok,false);assert.ok(!calls.some(c=>c.includes(':POST:')));}
}));
