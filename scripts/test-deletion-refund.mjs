import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deletionRefundPolicy,deletionSettlement,readDeletionSettlement} from '../src/lib/deletion-refund.ts';
const now=Date.UTC(2026,10,18),week=7*86400000;
test('refund cutoff is strictly greater than seven days with no rounded-day loophole',()=>{
 assert.equal(deletionRefundPolicy([now+week+1],now).eligible,true);
 for(const e of [now+week,now+week-1,now,now-1])assert.equal(deletionRefundPolicy([e],now).eligible,false);
});
test('unactivated duration and unlimited dates are explicit, and the strictest panel wins',()=>{
 assert.equal(deletionRefundPolicy([0,-30*86400000],now).eligible,true);
 assert.equal(deletionRefundPolicy([-week],now).eligible,false);
 assert.equal(deletionRefundPolicy([now+30*86400000,now+86400000],now).reason,'final-week');
 for(const e of [[],[null],[NaN],[Infinity],[1.1]])assert.equal(deletionRefundPolicy(e,now).reason,'unknown-expiry');
});
test('deletion settlement refunds only unused allocation, with overshoot still paid in full',()=>{
 const early=deletionRefundPolicy([now+week+1],now),late=deletionRefundPolicy([now+week],now);
 assert.deepEqual(deletionSettlement(early,20,3.25),{version:1,allocatedGB:20,usedGB:3.25,refundedGB:16.75,forfeitedGB:0,reason:'eligible'});
 assert.equal(deletionSettlement(late,20,3.25).forfeitedGB,16.75);
 assert.equal(deletionSettlement(late,20,20.25).forfeitedGB,0);
 assert.equal(deletionSettlement(early,20,20.25).refundedGB,0);
 assert.throws(()=>deletionSettlement(early,20,NaN));
});
test('durable financial entries are validated and old journals remain compatible',()=>{
 assert.equal(readDeletionSettlement(null),null);
 const v=deletionSettlement(deletionRefundPolicy([now],now),20,3.25);
 assert.deepEqual(readDeletionSettlement(JSON.stringify({deletionSettlement:v})),v);
 for(const value of [{...v,forfeitedGB:0},{...v,usedGB:-1},{...v,refundedGB:1},{...v,version:2}])assert.throws(()=>readDeletionSettlement(JSON.stringify({deletionSettlement:value})));
});
