import test from 'node:test';
import assert from 'node:assert/strict';
import {revokeClientMemberships} from '../src/lib/node-client-sync.ts';

function fixture(options={}) {
 const master={baseUrl:'https://master.example',token:'fixture',nodePeers:[{key:'peer',baseUrl:'https://peer.example',token:'fixture',nativeNodeId:1,masterInboundIds:[2]}]};
 const profile={id:'same-uuid',uuid:'same-uuid',email:'customer',subId:'same-sub',totalGB:20*1024**3,expiryTime:1799000000000,enable:true,limitIp:2,flow:'',password:'preserved'};
 const records={master:{client:{...profile},inboundIds:[1,2],usedTraffic:7*1024**3},peer:{client:{...profile},inboundIds:[22,23],usedTraffic:3*1024**3}};
 const catalog={master:[{id:1,tag:'local',port:4501,protocol:'vless'},{id:2,nodeId:1,tag:'n1-in-4502',port:4502,protocol:'vless'}],peer:[{id:22,tag:'in-4502',port:4502,protocol:'vless'},{id:23,tag:'independent',port:4555,protocol:'vless'}]};
 const writes=[];let state;
 const progress={load:async()=>state?structuredClone(state):undefined,save:async value=>{state=structuredClone(value)}};
 const request=async(auth,path,init)=>{const key=auth===master?'master':'peer',current=records[key];
  if(options.unavailable===key)return{ok:false,msg:'network unavailable'};
  if(path.endsWith('/options'))return{ok:true,data:catalog[key]};
  if(path.includes('/get/'))return current?{ok:true,data:structuredClone(current)}:{ok:false,msg:'Obtain (record not found)'};
  if(path.endsWith('/detach')){writes.push({key,ids:[...init.json.inboundIds]});current.inboundIds=current.inboundIds.filter(id=>!init.json.inboundIds.includes(id));if(options.derivedFlow)current.client.flow='xtls-rprx-vision';if(options.failPeerAfterMaster&&key==='master')options.unavailable='peer';if(options.lostResponse)return{ok:false,msg:'lost reply'};return{ok:true};}
  throw Error('Unexpected native path '+path);
 };
 return{master,records,catalog,writes,progress,options,run:(verifyOnly=false)=>revokeClientMemberships(master,'customer','same-sub',[2],request,progress,verifyOnly)};
}
test('revoking one remote location preserves other native memberships, profiles and counters',async()=>{
 const f=fixture(),before=structuredClone(f.records);const result=await f.run();assert.equal(result.ok,true);assert.deepEqual(f.records.master.inboundIds,[1]);assert.deepEqual(f.records.peer.inboundIds,[23]);for(const key of ['master','peer']){assert.deepEqual(f.records[key].client,before[key].client);assert.equal(f.records[key].usedTraffic,before[key].usedTraffic)}
});
test('an acknowledged readback resolves a lost detach reply without another write',async()=>{
 const f=fixture({lostResponse:true});assert.equal((await f.run()).ok,true);assert.equal(f.writes.length,2);assert.equal((await f.run()).ok,true);assert.equal(f.writes.length,2);
});
test('foreign native identity or ambiguous mapping prevents every write',async()=>{
 for(const change of ['uuid','mapping','unavailable','unknown-node']){const f=fixture();if(change==='uuid')f.records.peer.client.uuid='foreign';if(change==='mapping')f.catalog.peer.push({...f.catalog.peer[0],id:99});if(change==='unavailable')f.options.unavailable='peer';if(change==='unknown-node')f.master.nodePeers=[];assert.equal((await f.run()).ok,false,change);assert.deepEqual(f.writes,[],change)}
});
test('partial revocation resumes the same durable targets without replaying the completed master detach',async()=>{
 const f=fixture({failPeerAfterMaster:true});assert.equal((await f.run()).ok,false);assert.deepEqual(f.records.master.inboundIds,[1]);assert.deepEqual(f.records.peer.inboundIds,[22,23]);f.options.unavailable=null;f.options.failPeerAfterMaster=false;assert.equal((await f.run()).ok,true);assert.deepEqual(f.writes.map(w=>w.key),['master','peer']);
});
test('changing account identity or losing traffic after an earlier detach cannot be accepted as completion',async()=>{
 for(const change of ['identity','traffic']){const f=fixture({failPeerAfterMaster:true});await f.run();f.options.unavailable=null;f.options.failPeerAfterMaster=false;if(change==='identity')f.records.peer.client.uuid='replacement';else f.records.master.usedTraffic=0;const writes=f.writes.length;assert.equal((await f.run()).ok,false);assert.equal(f.writes.length,writes)}
});
test('final read-only proof rejects a late native copy without dispatching another mutation',async()=>{
 const f=fixture();assert.equal((await f.run()).ok,true);f.records.peer.inboundIds.push(22);const writes=f.writes.length;assert.equal((await f.run(true)).ok,false);assert.equal(f.writes.length,writes);assert.equal((await f.run()).ok,true);assert.equal((await f.run(true)).ok,true);assert.deepEqual(f.records.peer.inboundIds,[23]);
});
test('native effective flow may follow remaining inbound overrides without changing paid profile fields',async()=>{
 const f=fixture({derivedFlow:true});assert.equal((await f.run()).ok,true);assert.equal(f.records.master.client.flow,'xtls-rprx-vision');assert.equal(f.records.master.client.totalGB,20*1024**3);assert.equal(f.records.master.usedTraffic,7*1024**3);assert.deepEqual(f.records.master.inboundIds,[1]);
});
test('a journal cannot switch its provisioned endpoint during recovery',async()=>{
 const f=fixture({failPeerAfterMaster:true});assert.equal((await f.run()).ok,false);f.options.unavailable=null;f.options.failPeerAfterMaster=false;f.master.nodePeers[0].baseUrl='https://different.example';const writes=f.writes.length;assert.equal((await f.run()).ok,false);assert.equal(f.writes.length,writes);
});
