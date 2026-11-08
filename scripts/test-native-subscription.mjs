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

const customer={email:'owned-user',subId:'owned-subscription'};
const ownClient={...customer,id:'11111111-1111-4111-8111-111111111111'};
const customerInbound=(extra={})=>({tag:'owned-inbound',remark:'فنلاند',protocol:'vless',port:443,clients:[ownClient],...extra});

test('another customer with the same inbound name cannot hide an authorized native URI',()=>{
 const allowed=customerInbound(),unrelated=customerInbound({tag:'unrelated-inbound',clients:[{email:'other-user',subId:'other-subscription',id:'other-credential'}]});
 const actual=nativeLinksForInbounds(parseNativeSubscription(uri),[allowed],[allowed,unrelated],customer);
 assert.deepEqual(actual.map(x=>x.uri),[uri]);
});

test('customer-scoped matching still rejects denied same-customer names and unnamed shared ports',()=>{
 const allowed=customerInbound(),hidden=customerInbound({tag:'denied-inbound'});
 assert.equal(nativeLinksForInbounds(parseNativeSubscription(uri),[allowed],[allowed,hidden],customer).length,0);
 const onSamePort={...allowed,port:8443},hiddenSamePort={...hidden,port:8443};
 assert.equal(nativeLinksForInbounds(parseNativeSubscription(uri.replace(/#.*$/,'')),[onSamePort],[onSamePort,hiddenSamePort],customer).length,0);
});

test('customer matching requires verified email and subscription membership',()=>{
 const absent=customerInbound({clients:[]});
 assert.equal(nativeLinksForInbounds(parseNativeSubscription(uri),[absent],[absent],customer).length,0);
 const wrongSub=customerInbound({clients:[{...ownClient,subId:'different-subscription'}]});
 assert.equal(nativeLinksForInbounds(parseNativeSubscription(uri),[wrongSub],[wrongSub],customer).length,0);
});

test('a matching native name cannot authorize a different VLESS credential',()=>{
 const allowed=customerInbound(),foreign=uri.replace(ownClient.id,'22222222-2222-4222-8222-222222222222');
 assert.equal(nativeLinksForInbounds(parseNativeSubscription(foreign),[allowed],[allowed],customer).length,0);
});

test('another native email sharing the subscription identifier is rejected',()=>{
 const allowed=customerInbound(),foreign=customerInbound({remark:'different-name',port:4433,clients:[{email:'other-user',subId:customer.subId,id:'other-credential'}]});
 assert.equal(nativeLinksForInbounds(parseNativeSubscription(uri),[allowed],[allowed,foreign],customer).length,0);
});

test('native VMess and Trojan customer credentials are checked without rewriting their URI',()=>{
 const vm='vmess://'+Buffer.from(JSON.stringify({add:'vpn.example',port:443,id:ownClient.id,ps:'فنلاند'})).toString('base64');
 const trojan='trojan://kept%3Asecret@vpn.example:443#'+encodeURIComponent('فنلاند');
 const v=customerInbound({protocol:'vmess'}),t=customerInbound({protocol:'trojan',clients:[{...customer,password:'kept:secret'}]});
 assert.deepEqual(nativeLinksForInbounds(parseNativeSubscription(vm),[v],[v],customer).map(x=>x.uri),[vm]);
 assert.deepEqual(nativeLinksForInbounds(parseNativeSubscription(trojan),[t],[t],customer).map(x=>x.uri),[trojan]);
 assert.equal(nativeLinksForInbounds(parseNativeSubscription(vm.replace(Buffer.from(JSON.stringify({add:'vpn.example',port:443,id:ownClient.id,ps:'فنلاند'})).toString('base64'),Buffer.from(JSON.stringify({add:'vpn.example',port:443,id:'foreign-id',ps:'فنلاند'})).toString('base64'))),[v],[v],customer).length,0);
 assert.equal(nativeLinksForInbounds(parseNativeSubscription(trojan.replace('kept%3Asecret','foreign-secret')),[t],[t],customer).length,0);
});

test('unsupported credential formats keep the original global ambiguity restrictions',()=>{
 const ss='ss://'+Buffer.from('2022-blake3-aes-128-gcm:kept-password').toString('base64url')+'@vpn.example:8388#'+encodeURIComponent('فنلاند');
 const allowed=customerInbound({protocol:'shadowsocks',port:8388,clients:[{...customer,password:'kept-password'}]}),other=customerInbound({protocol:'shadowsocks',port:8388,clients:[{email:'other-user',subId:'other-subscription',password:'other-password'}]});
 assert.equal(nativeLinksForInbounds(parseNativeSubscription(ss),[allowed],[allowed,other],customer).length,0);
 assert.deepEqual(nativeLinksForInbounds(parseNativeSubscription(ss),[allowed],[allowed],customer).map(x=>x.uri),[ss]);
});
test('empty, HTML, mixed and malformed subscriptions never produce fabricated working configurations',()=>{
 for(const body of ['', '<html>login</html>',uri+'\nnot-a-config','vless://x@host:99999'])assert.throws(()=>parseNativeSubscription(body));
});
test('fetch uses only saved native origin and refuses redirects, failures, and oversized bodies',async()=>{
 let mode='ok',seen=[];const server=http.createServer((req,res)=>{seen.push(req.url);if(mode==='redirect'){res.writeHead(302,{location:'/elsewhere'});res.end();return}if(mode==='failure'){res.writeHead(503);res.end();return}res.writeHead(200,{'content-type':'text/plain',...(mode==='large'?{'content-length':3*1024**2}:{})});res.end(Buffer.from(uri).toString('base64'))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const panel={subBase:'http://127.0.0.1:'+server.address().port,subPath:'native-sub'};
 try{assert.equal((await readNativeSubscription(panel,'owned-sub-123'))[0].uri,uri);assert.deepEqual(seen,['/native-sub/owned-sub-123']);for(mode of ['redirect','failure','large'])await assert.rejects(readNativeSubscription(panel,'owned-sub-123'));await assert.rejects(readNativeSubscription(panel,'../escape'));assert.equal(seen.length,4)}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
