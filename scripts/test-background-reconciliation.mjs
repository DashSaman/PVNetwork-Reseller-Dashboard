import test from 'node:test';
import assert from 'node:assert/strict';
import {createReconciliationRunner} from '../src/lib/background-reconciliation.ts';

function clock() {
 let serial=0;const timers=new Map();
 return {timers,setTimer(fn,delay){const id=++serial;timers.set(id,{fn,delay});return id},clearTimer(id){timers.delete(id)},
  async next(){assert.ok(timers.size);const [id,item]=timers.entries().next().value;timers.delete(id);item.fn();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));return item.delay}};
}
const options=c=>({setTimer:c.setTimer,clearTimer:c.clearTimer,maxPasses:2,retryMinMs:30,retryMaxMs:120,progressDelayMs:1});

test('a bounded batch continues itself until every saved customer is reconciled',async()=>{
 const c=clock();let remaining=7,calls=0;
 const runner=createReconciliationRunner({...options(c),reconcile:async()=>{calls++;remaining--;return{completed:1,pending:remaining}}});
 await runner.run('owner');assert.equal(remaining,5);assert.equal(c.timers.size,1);
 while(c.timers.size)await c.next();
 assert.equal(remaining,0);assert.equal(calls,7);runner.stop();
});
test('unavailable work retries with bounded backoff and automatically finishes on recovery',async()=>{
 const c=clock();let available=false,calls=0;
 const runner=createReconciliationRunner({...options(c),reconcile:async()=>{calls++;return available?{completed:1,pending:0}:{completed:0,pending:1}}});
 await runner.run('owner');assert.equal(await c.next(),30);assert.equal(await c.next(),60);assert.equal(await c.next(),120);assert.equal(await c.next(),120);
 available=true;await c.next();assert.equal(c.timers.size,0);assert.equal(calls,6);runner.stop();
});
test('periodic recovery discovers work without overriding an existing retry deadline',async()=>{
 const c=clock();let calls=0;
 const runner=createReconciliationRunner({...options(c),reconcile:async()=>{calls++;return{completed:0,pending:1}}});
 await runner.ensure('owner');const first=[...c.timers.keys()][0];await runner.ensure('owner');
 assert.equal(calls,1);assert.equal([...c.timers.keys()][0],first);runner.stop();assert.equal(c.timers.size,0);
});
test('an explicit new grant change wakes a deferred owner immediately',async()=>{
 const c=clock();let calls=0;
 const runner=createReconciliationRunner({...options(c),reconcile:async()=>{calls++;return{completed:0,pending:1}}});
 await runner.run('owner');await runner.run('owner');assert.equal(calls,2);assert.equal(c.timers.size,1);runner.stop();
});
test('duplicate callers share one worker and a change during its final read is not lost',async()=>{
 const c=clock();let release,started,calls=0;
 const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const runner=createReconciliationRunner({...options(c),reconcile:async()=>{calls++;if(calls===1){started();await gate}return{completed:0,pending:0}}});
 const first=runner.run('owner');await entered;const second=runner.run('owner');assert.equal(first,second);release();await first;
 assert.equal(calls,2);assert.equal(c.timers.size,0);runner.stop();
});
test('a transient database failure schedules recovery without an unhandled rejection',async()=>{
 const c=clock();let calls=0;
 const runner=createReconciliationRunner({...options(c),reconcile:async()=>{if(++calls===1)throw Error('fixture unavailable');return{completed:1,pending:0}}});
 await runner.run('owner');assert.equal(c.timers.size,1);await c.next();assert.equal(calls,2);assert.equal(c.timers.size,0);runner.stop();
});
test('owner queues and their retry state remain independent',async()=>{
 const c=clock(),calls=[];
 const runner=createReconciliationRunner({...options(c),reconcile:async id=>{calls.push(id);return{completed:0,pending:id==='blocked'?1:0}}});
 await runner.run('blocked');await runner.run('healthy');assert.deepEqual(calls,['blocked','healthy']);assert.equal(c.timers.size,1);runner.stop();
});
