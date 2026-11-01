import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { registerHooks } from 'node:module';
const hooks=registerHooks({resolve(s,c,next){return next(s.startsWith('./')&&c.parentURL?.includes('/src/lib/')&&!s.endsWith('.ts')?s+'.ts':s,c)}});
const {getLastOnline}=await import('../src/lib/panel.ts');
const {sharedDisplayCache}=await import('../src/lib/display-cache.ts');hooks.deregister();
test('last-online read cannot invalidate or abort live traffic display',async()=>{
 const server=http.createServer((req,res)=>{assert.equal(req.method,'POST');assert.equal(req.url,'/panel/api/clients/lastOnline');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success:true,obj:{owned:1700000000}}))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const cache=sharedDisplayCache(),controller=new AbortController();cache.entries.set('retained-traffic',{value:{traffic:123},at:Date.now(),retryAt:0,controller});
 try{const result=await getLastOnline({baseUrl:'http://127.0.0.1:'+server.address().port,token:'fixture'});assert.equal(result.ok,true);assert.equal(result.data.owned,1700000000);assert.equal(controller.signal.aborted,false);assert.equal(cache.entries.has('retained-traffic'),true)}finally{cache.entries.delete('retained-traffic');await new Promise(r=>server.close(r))}
});
