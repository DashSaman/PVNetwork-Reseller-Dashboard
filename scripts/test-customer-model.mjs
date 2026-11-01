import test from 'node:test';
import assert from 'node:assert/strict';
const { expiryFromInput, normalizedLabels, nextUsageObservation, onlineTimestamp } = await import('../src/lib/customer-model.ts');
test('first use expiry is a duration, never an absolute date or unlimited',()=>{
 assert.equal(expiryFromInput({expiryMode:'first-use',expiryDays:30},1000),-2592000000);
 for(const body of [{expiryMode:'first-use',expiryDays:0},{expiryMode:'first-use',expiryDays:1.5},{expiryMode:'first-use',expiryDays:30,expiryDate:'2026-11-10'},{expiryMode:'oops'}])assert.throws(()=>expiryFromInput(body,1000));
 assert.equal(expiryFromInput({expiryDays:2},1000),172801000);
});
test('labels are bounded, deduplicated unicode text',()=>{
 assert.deepEqual(normalizedLabels([' پکیج A ','پکیج A','فروشگاه']),['پکیج A','فروشگاه']);
 assert.throws(()=>normalizedLabels(Array(11).fill('x')));
 assert.throws(()=>normalizedLabels(['x'.repeat(41)]));
});
test('last online supports seconds/milliseconds without inventing missing data',()=>{
 assert.equal(onlineTimestamp(1700000000),1700000000000);
 assert.equal(onlineTimestamp(1700000000000),1700000000000);
 assert.equal(onlineTimestamp(null),null);assert.equal(onlineTimestamp(-1),null);assert.equal(onlineTimestamp(Date.now()+86400000),null);
});
test('usage baseline and reset debit do not double count',()=>{
 let h=nextUsageObservation(null,10,1000);assert.deepEqual(h.days,[]);
 h=nextUsageObservation(h,12,2000);assert.equal(h.days[0].usedGB,2);
 // After a dashboard reset, committed 12 plus current 1 = lifetime 13.
 h=nextUsageObservation(h,13,3000);assert.equal(h.days[0].usedGB,3);
 h=nextUsageObservation(h,13,3000);assert.equal(h.days[0].usedGB,3);
});
test('unexplained native reset rebaselines and marks incomplete interval',()=>{
 let h=nextUsageObservation(null,10,1000);h=nextUsageObservation(h,1,2000);h=nextUsageObservation(h,3,3000);
 assert.equal(h.days[0].usedGB,2);assert.equal(h.gaps,1);
});
test('history rejects bad samples and retains at most 90 UTC days',()=>{
 assert.throws(()=>nextUsageObservation(null,NaN,1000));
 let h=null;for(let i=0;i<100;i++)h=nextUsageObservation(h,i,i*86400000+1);
 assert.ok(h.days.length<=90);assert.equal(h.days.at(-1).usedGB,1);
});
