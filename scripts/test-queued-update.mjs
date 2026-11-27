import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const hooks=registerHooks({resolve(s,c,next){return next(s.startsWith('./')&&c.parentURL?.includes('/src/lib/')&&!s.endsWith('.ts')?s+'.ts':s,c)}});
const {isSavedQueuedUpdate,nodesSynchronized}=await import('../src/lib/queued-update.ts');
hooks.deregister();
const user={id:'u1',resellerId:'r1',email:'customer',trafficGB:50};
const meta={newTrafficGB:50,localCommitted:true,nativePending:true};
const journal={type:'UPDATE',status:'PARTIAL',userId:'u1',resellerId:'r1',email:'customer',reservedGB:0,metadata:JSON.stringify(meta)};
test('only a saved, fully paid ordinary update qualifies as background sync',()=>{
 assert.equal(isSavedQueuedUpdate(user,journal),true);
 for(const override of [{type:'CREATE'},{status:'RUNNING'},{userId:'u2'},{resellerId:'r2'},{email:'other'},{reservedGB:1},{metadata:'broken'},{metadata:'null'},{metadata:'[]'}])assert.equal(isSavedQueuedUpdate(user,{...journal,...override}),false);
 for(const change of [{newTrafficGB:40},{newTrafficGB:'50'},{localCommitted:false},{nativePending:false},{kind:'CUSTOMER_STATUS'},{bulkJobId:'batch'}])assert.equal(isSavedQueuedUpdate(user,{...journal,metadata:JSON.stringify({...meta,...change})}),false);
});
test('unknown, disabled, dirty and unreachable nodes cannot settle queued edits',()=>{
 const ready={id:1,enable:true,status:'online',configDirty:false};
 assert.equal(nodesSynchronized([ready]),true);
 for(const input of [null,{},[],[{}],[{...ready,status:'offline'}],[{...ready,enable:false}],[{...ready,configDirty:true}],[{...ready,configDirty:undefined}],[{...ready,children:{}}],[{...ready,children:[{...ready,id:2,status:'offline'}]}]])assert.equal(nodesSynchronized(input),false);
 assert.equal(nodesSynchronized([{...ready,children:[{...ready,id:2}]}]),true);
});
