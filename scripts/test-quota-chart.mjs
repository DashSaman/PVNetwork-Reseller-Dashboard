import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quotaChartModel } from '../src/lib/quota-chart.ts';
const row={poolGB:100,soldGB:30,unsoldGB:60,actualUsedGB:8,soldButUnusedGB:22,consumedHistoricalGB:7,reservedGB:3,unlimitedUsers:0};
test('pool partitions include sold only once, and used/unused partition that sale',()=>{
 const m=quotaChartModel(row);assert.equal(m.pool.reduce((s,x)=>s+x.value,0),100);assert.equal(m.sales.reduce((s,x)=>s+x.value,0),30);assert.deepEqual(m.sales.map(s=>s.value),[8,22]);assert.equal(m.overQuotaGB,0);
});
test('unknown live values never produce zero usage slices',()=>{
 assert.equal(quotaChartModel({...row,actualUsedGB:null,soldButUnusedGB:null}).sales,null);
 assert.equal(quotaChartModel({...row,actualUsedGB:8,soldButUnusedGB:null}).sales,null);
});
test('unlimited pools and users are not represented as finite zero quotas',()=>{
 const m=quotaChartModel({...row,poolGB:null,unsoldGB:null,unlimitedUsers:1,soldButUnusedGB:null});assert.deepEqual(m.pool,[]);assert.equal(m.sales,null);
});
test('over-quota usage is reported separately and never inflates sale slices',()=>{
 const m=quotaChartModel({...row,soldGB:10,actualUsedGB:13,soldButUnusedGB:0});assert.equal(m.sales.reduce((s,x)=>s+x.value,0),10);assert.equal(m.overQuotaGB,3);
});
test('empty accounts have no artificial sliver or nonfinite percentage',()=>{
 const m=quotaChartModel({...row,poolGB:0,soldGB:0,unsoldGB:0,actualUsedGB:0,soldButUnusedGB:0,consumedHistoricalGB:0,reservedGB:0});assert.deepEqual(m.pool,[]);assert.deepEqual(m.sales,[]);assert.equal(m.overQuotaGB,0);
});

test('donut replaces sold with amber used and purple unused without double counting',()=>{
 const m=quotaChartModel(row);assert.equal(m.donut.reduce((s,x)=>s+x.value,0),100);assert.deepEqual(m.donut.slice(0,2).map(s=>[s.value,s.color]),[[8,'#f59e0b'],[22,'#8b5cf6']]);assert.ok(!m.donut.some(s=>s.color==='#0ea5e9'));
});
test('unknown sales retain unsplit sold donut instead of fabricating purple',()=>{
 const m=quotaChartModel({...row,actualUsedGB:null,soldButUnusedGB:null});assert.deepEqual(m.donut,m.pool);
 assert.deepEqual(quotaChartModel({...row,poolGB:null,unsoldGB:null}).donut,[]);
});
