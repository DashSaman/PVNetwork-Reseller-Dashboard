import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseNativeSubscription, readNativeSubscription, nativeLinksForInbounds } from '../src/lib/native-subscription.ts';
const uri='vless://11111111-1111-4111-8111-111111111111@connect.example:8443?encryption=none&type=ws&security=tls&host=front.example&fp=chrome&ech=test-value&path=%2Fvpn#%D9%81%D9%86%D9%84%D8%A7%D9%86%D8%AF';
test('plain and base64 native subscriptions preserve every URI byte, including ECH and escaped parameters',()=>{
  for(const body of [uri,Buffer.from(uri).toString('base64')]){const links=parseNativeSubscription(body);assert.equal(links[0].uri,uri);assert.equal(links[0].remark,'فنلاند');assert.equal(links[0].port,8443)}
});
test('matching available native names supports public port overrides and retains the original URI',()=>{
  const links=parseNativeSubscription(uri),inbounds=[{tag:'in-1',remark:'فنلاند',protocol:'vless',port:443}];assert.equal(nativeLinksForInbounds(links,inbounds)[0].uri,uri);assert.equal(nativeLinksForInbounds(links,[]).length,0);
});
test('native VMess and Shadowsocks passwords are not reconstructed',()=>{
  const vm='vmess://'+Buffer.from(JSON.stringify({add:'vpn.example',port:443,id:'kept-id',ps:'name',net:'grpc',path:'kept-service',fp:'firefox'})).toString('base64');
  const ss='ss://'+Buffer.from('2022-blake3-aes-128-gcm:kept-password').toString('base64url')+'@vpn.example:8388#name';
  assert.deepEqual(parseNativeSubscription(vm+'\n'+ss).map(v=>v.uri),[vm,ss]);
});
test('shared ports cannot expose a hidden or unavailable inbound',()=>{
 const available={tag:'online',remark:'online',protocol:'vless',port:8443},hidden={tag:'offline',remark:'فنلاند',protocol:'vless',port:8443};
 assert.equal(nativeLinksForInbounds(parseNativeSubscription(uri),[available],[available,hidden]).length,0);
 assert.equal(nativeLinksForInbounds(parseNativeSubscription(uri.replace(/#.*$/,'')),[available],[available,hidden]).length,0);
});
test('empty, HTML, mixed and malformed subscriptions never produce fabricated working configurations',()=>{
 for(const body of ['', '<html>login</html>',uri+'\nnot-a-config','vless://x@host:99999'])assert.throws(()=>parseNativeSubscription(body));
});
test('fetch uses only saved native origin and refuses redirects, failures, and oversized bodies',async()=>{
 let mode='ok',seen=[];const server=http.createServer((req,res)=>{seen.push(req.url);if(mode==='redirect'){res.writeHead(302,{location:'/elsewhere'});res.end();return}if(mode==='failure'){res.writeHead(503);res.end();return}res.writeHead(200,{'content-type':'text/plain',...(mode==='large'?{'content-length':3*1024**2}:{})});res.end(Buffer.from(uri).toString('base64'))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const panel={subBase:'http://127.0.0.1:'+server.address().port,subPath:'native-sub'};
 try{assert.equal((await readNativeSubscription(panel,'owned-sub-123'))[0].uri,uri);assert.deepEqual(seen,['/native-sub/owned-sub-123']);for(mode of ['redirect','failure','large'])await assert.rejects(readNativeSubscription(panel,'owned-sub-123'));await assert.rejects(readNativeSubscription(panel,'../escape'));assert.equal(seen.length,4)}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
