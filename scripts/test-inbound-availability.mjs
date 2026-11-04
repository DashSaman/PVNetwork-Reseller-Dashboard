import test from 'node:test';
import assert from 'node:assert/strict';
import {inboundAvailable} from '../src/lib/inbound-availability.ts';

const now=1793817000000;
const node={id:1,enable:true,status:'online',xrayState:'running',configDirty:false,lastHeartbeat:now/1000};
const health={observedAt:now,localRunning:true,nodes:[node]};
const local={id:1,enable:true,nodeId:null},remote={id:2,enable:true,nodeId:1};

test('only explicitly enabled inbounds with fresh runtime evidence are selectable',()=>{
 assert.equal(inboundAvailable(local,health,now),true);assert.equal(inboundAvailable(remote,health,now),true);
 for(const enable of [false,undefined,null,'true'])assert.equal(inboundAvailable({...local,enable},health,now),false);
 for(const h of [undefined,{...health,observedAt:now-10001},{...health,observedAt:now+30001},{...health,observedAt:NaN}])assert.equal(inboundAvailable(local,h,now),false);
 for(const nodeId of [undefined,0,-1,1.5,'1'])assert.equal(inboundAvailable({...remote,nodeId},health,now),false);
});
test('local runtime failure does not hide a healthy independent remote node',()=>{
 assert.equal(inboundAvailable(local,{...health,localRunning:false},now),false);
 assert.equal(inboundAvailable(remote,{...health,localRunning:false},now),true);
 assert.equal(inboundAvailable(local,{...health,nodes:null},now),true);
 assert.equal(inboundAvailable(remote,{...health,nodes:null},now),false);
});
test('offline, disabled, unsynchronized and stopped nodes fail closed',()=>{
 for(const patch of [{enable:false},{status:'offline'},{status:'unknown'},{xrayState:'stopped'},{xrayState:undefined},{configDirty:true},{configDirty:undefined}])assert.equal(inboundAvailable(remote,{...health,nodes:[{...node,...patch}]},now),false,JSON.stringify(patch));
});
test('heartbeat freshness is bounded and supports the native second and millisecond forms',()=>{
 assert.equal(inboundAvailable(remote,{...health,nodes:[{...node,lastHeartbeat:now}]},now),true);
 assert.equal(inboundAvailable(remote,{...health,nodes:[{...node,lastHeartbeat:(now-120000)/1000}]},now),true);
 for(const lastHeartbeat of [0,undefined,'online',NaN,(now-120001)/1000,(now+30001)/1000])assert.equal(inboundAvailable(remote,{...health,nodes:[{...node,lastHeartbeat}]},now),false,String(lastHeartbeat));
});
test('unknown or ambiguous direct node IDs cannot inherit a child node health',()=>{
 assert.equal(inboundAvailable(remote,{...health,nodes:[]},now),false);
 assert.equal(inboundAvailable(remote,{...health,nodes:[node,node]},now),false);
 for(const child of [{...node,transitive:true},{...node,parentGuid:'parent-guid'}]){
  assert.equal(inboundAvailable(remote,{...health,nodes:[child]},now),false);
  assert.equal(inboundAvailable(remote,{...health,nodes:[node,child]},now),true);
 }
});
test('a direct native node may name this controller as its parent',()=>{
 const scoped={...health,controllerGuid:'this-controller',nodes:[{...node,parentGuid:'this-controller'}]};
 assert.equal(inboundAvailable(remote,scoped,now),true);
 assert.equal(inboundAvailable(remote,{...scoped,controllerGuid:'other-controller'},now),false);
 assert.equal(inboundAvailable(remote,{...scoped,controllerGuid:undefined},now),false);
 assert.equal(inboundAvailable(remote,{...scoped,nodes:[{...node,parentGuid:'this-controller',transitive:true}]},now),false);
});
