import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCreateAttempt, finishCreateAttempt } from '../src/lib/create-attempt.ts';
test('an uncertain create retains its request identity across reload and account switches',()=>{
 const rows=new Map(),storage={getItem:k=>rows.get(k),setItem:(k,v)=>rows.set(k,v)};let issued=0;const id=()=>String(++issued);
 const first=getCreateAttempt(storage,'owner-a','same order',id,1);
 assert.equal(getCreateAttempt(storage,'owner-a','same order',id,2).requestId,first.requestId);
 assert.notEqual(getCreateAttempt(storage,'owner-b','same order',id,2).requestId,first.requestId);
 assert.notEqual(getCreateAttempt(storage,'owner-a','changed order',id,2).requestId,first.requestId);
 assert.equal(getCreateAttempt(storage,'owner-a','same order',id,3).requestId,first.requestId);
 finishCreateAttempt(storage,'owner-a',first.requestId);
 assert.notEqual(getCreateAttempt(storage,'owner-a','same order',id,4).requestId,first.requestId);
});
test('expired attempts and disabled storage cannot block legitimate new creation',()=>{
 const storage={getItem:()=>JSON.stringify([{payload:'x',requestId:'old',at:1}]),setItem:()=>{throw Error('disabled')}};
 assert.equal(getCreateAttempt(storage,'owner','x',()=> 'new',86400002).requestId,'new');
 assert.doesNotThrow(()=>finishCreateAttempt(storage,'owner','old'));assert.equal(getCreateAttempt(null,'owner','x',()=> 'memory').requestId,'memory');
});
