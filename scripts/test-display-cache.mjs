import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDisplayCache, readDisplayEntry, clearDisplayCache } from '../src/lib/display-cache.ts';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const options={deadlineMs:15,freshMs:100,maxAgeMs:1000,retryMs:30};
test('long running read stays single flight even beyond freshness interval',async()=>{
 const cache=createDisplayCache();let calls=0,resolve;const loader=()=>{calls++;return new Promise(r=>{resolve=r;});};
 const a=await readDisplayEntry(cache,'panel',loader,options);assert.equal(a.pending,true);assert.equal(a.value,undefined);
 await sleep(110);const b=await readDisplayEntry(cache,'panel',loader,options);assert.equal(calls,1);assert.equal(b.pending,true);
 resolve({usage:8});await sleep(0);const c=await readDisplayEntry(cache,'panel',loader,options);assert.equal(c.value.usage,8);assert.equal(c.pending,false);
});
test('stale last known good value remains available during refresh and failure',async()=>{
 const cache=createDisplayCache();await readDisplayEntry(cache,'panel',()=>Promise.resolve(42),options);
 await sleep(105);const r=await readDisplayEntry(cache,'panel',()=>Promise.reject(Error('offline')),options);
 assert.equal(r.value,42);assert.equal(r.stale,true);await sleep(0);
 const failed=await readDisplayEntry(cache,'panel',()=>{throw Error('should wait before retry');},options);assert.equal(failed.value,42);assert.equal(failed.error,'offline');assert.ok(failed.failedAt>0);
 const again=await readDisplayEntry(cache,'panel',()=>{throw Error('still cooling down');},options);assert.equal(again.failedAt,failed.failedAt);
});
test('cache invalidation never publishes an old in-flight result',async()=>{
 const cache=createDisplayCache();let resolve;await readDisplayEntry(cache,'panel',()=>new Promise(r=>{resolve=r;}),options);
 clearDisplayCache(cache);resolve('old');await sleep(0);
 const r=await readDisplayEntry(cache,'panel',()=>Promise.resolve('new'),options);assert.equal(r.value,'new');
});
