import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const hooks=registerHooks({resolve(s,c,next){return next(s.startsWith('./')&&c.parentURL?.includes('/src/lib/')&&!s.endsWith('.ts')?s+'.ts':s,c)}});
const {creationMetadata,isSavedQueuedCreation}=await import('../src/lib/queued-create.ts');hooks.deregister();
const refs=[{panelId:'p1',inboundId:1},{panelId:'p1',inboundId:2}];
const m={name:'Customer',uuid:'original-uuid',subId:'original-sub',trafficGB:20,expiryTime:-30*86400000,ipLimit:0,refs,localCommitted:true,nativePending:true,done:false};
const user={id:'u',email:'customer',resellerId:'r',trafficGB:20,subId:'original-sub',inboundIds:JSON.stringify(refs)};
const journal={type:'CREATE',status:'PARTIAL',userId:'u',email:'customer',resellerId:'r',reservedGB:0,metadata:JSON.stringify(m)};
test('queued creation funding requires matching owner, identity, allocation and complete references',()=>{
 assert.equal(isSavedQueuedCreation(user,journal),true);assert.equal(isSavedQueuedCreation(user,{...journal,status:'NEEDS_REPAIR'}),true);
 for(const change of [{userId:'other'},{resellerId:'other'},{email:'other'},{reservedGB:20},{type:'UPDATE'},{status:'RUNNING'}])assert.equal(isSavedQueuedCreation(user,{...journal,...change}),false);
 for(const change of [{trafficGB:30},{subId:'other-sub'},{email:'other'},{refs:refs.slice(0,1)},{localCommitted:false},{nativePending:false},{done:true}])assert.equal(isSavedQueuedCreation(user,{...journal,metadata:JSON.stringify({...m,...change})}),false);
});
test('incomplete or malformed legacy metadata cannot qualify for automatic registration',()=>{
 for(const value of ['broken','null','[]',JSON.stringify({...m,uuid:''}),JSON.stringify({...m,trafficGB:0.5}),JSON.stringify({...m,expiryTime:'bad'}),JSON.stringify({...m,refs:[]}),JSON.stringify({...m,refs:[{panelId:'p1',inboundId:'2'}]})])assert.equal(creationMetadata(value),null);
 assert.equal(creationMetadata(JSON.stringify(m)).expiryTime,-30*86400000);
});
