// All remote writes target loopback mocks and an isolated SQLite database only.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=realpathSync(process.cwd()),dir=path.join(root,'.local-dev','customers-'+Date.now());mkdirSync(dir,{recursive:true});
process.chdir(root);writeFileSync(path.join(dir,'test.db'),'');
process.env.DATABASE_URL='file:../.local-dev/'+path.basename(dir)+'/test.db';process.env.APP_SECRET='isolated-lifecycle-secret';
// This unattended, isolated fixture cannot answer interactive CLI upgrade prompts.
process.env.CI='1';process.env.__NEXT_AGENT_UPGRADE='security';
const {PrismaClient}=await import('@prisma/client');const {encryptSecret,hashPassword,signAccountSession}=await import('../src/lib/crypto.ts');
const GB=1024**3,clients=new Map(),mode=new Map();const nativeWrites=[];let db,app,server,checks=0;const failures=[];
function check(name,fn){try{fn();checks++;console.log('PASS',name)}catch(e){failures.push(name+': '+e.message);console.error('FAIL',name,e.message)}}
const key=(p,e)=>p+':'+e;
function inbound(p,id){const members=[...clients.entries()].filter(([k,c])=>k.startsWith(p+':')&&c.ids.has(id)).map(([,c])=>c);return {id,enable:!(id===2&&mode.get('disable-inbound-2')),nodeId:(id===3&&mode.get('eligibility-mode')||id===1&&mode.get('sync-targets'))?1:null,tag:'loc-'+id,port:4400+id,protocol:'vless',settings:JSON.stringify({clients:members.map(c=>({...c,uuid:undefined,ids:undefined,used:undefined}))}),clientStats:members.map(c=>({email:c.email,up:c.used,down:0,total:c.totalGB,enable:c.enable,expiryTime:c.expiryTime})),streamSettings:'{}'};}
async function child(args){await new Promise((resolve,reject)=>{const c=spawn(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});c.on('error',reject);c.on('exit',n=>n===0?resolve():reject(Error('child '+n)))})}
try{
 await child(['node_modules/prisma/build/index.js','db','push','--skip-generate']);db=new PrismaClient();
 server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw||'{}');const p=req.url.startsWith('/b/')?'b':'a',url=req.url.replace(/^\/[ab]/,'');let success=true,obj,msg='';
  if(/clients\/(add|update|del|resetTraffic)|\/(attach|detach)$/.test(url))nativeWrites.push(url);
  const email=decodeURIComponent(url.split('/').at(-1)),c=clients.get(key(p,email)),m=mode.get(email)||{};
  if(url.startsWith('/sub/')){const value=[...clients.values()].find(v=>v.subId===email);res.writeHead(value?200:404,{'content-type':'text/plain'});res.end(value?Buffer.from([...value.ids].map(id=>`vless://${value.id}@fixture.example:${4400+id}?encryption=none&type=tcp&security=none&fp=chrome#loc-${id}`).join('\n')).toString('base64'):'missing');return;}
  if(url==='/panel/api/inbounds/list'){if(mode.get('delay'))await new Promise(r=>setTimeout(r,1500));obj=[1,2,3].filter(id=>!(id===1&&mode.get('delete-inbound-1'))).map(id=>inbound(p,id));}
  else if(url==='/panel/api/clients/list')obj=[...clients.entries()].filter(([k])=>k.startsWith(p+':')).map(([,c])=>c);
  else if(url==='/panel/api/nodes/list'){if(mode.get('nodes-unavailable')){success=false;msg='temporarily unavailable'}else obj=[{id:1,enable:true,status:mode.get('nodes-offline')?'offline':'online',configDirty:!mode.get('defer-native-dirty')&&(!!mode.get('node-pending')||[...mode.values()].some(m=>m?.pendingUpdate===true)),xrayState:'running',parentGuid:'fixture-controller',lastHeartbeat:Math.floor(Date.now()/1000)-(mode.get('stale-node')?600:0)}];}
  else if(url==='/panel/api/server/status')obj={panelGuid:'fixture-controller',xray:{state:mode.get('local-stopped')?'stopped':'running'}};
  else if(url.startsWith('/panel/api/clients/get/')){if(c)obj={client:{...c,uuid:c.id,ids:undefined,used:undefined},inboundIds:[...c.ids],usedTraffic:c.used};else{success=false;msg='Obtain (record not found)'}}
  else if(url==='/panel/api/clients/add'){mode.delete('defer-native-dirty');const v=body.client;clients.set(key(p,v.email),{...v,used:0,ids:new Set((mode.get('partial-add')?body.inboundIds.slice(0,1):body.inboundIds))});if(mode.get('node-pending'))obj={nodePending:true};}
  else if(url.endsWith('/attach')){const e=decodeURIComponent(url.split('/').at(-2));const target=clients.get(key(p,e));if(target)body.inboundIds.forEach(id=>target.ids.add(id));else{success=false;msg='client not found'}if(mode.get('node-pending'))obj={nodePending:true};}
  else if(url.startsWith('/panel/api/clients/update/')){if(m.failUpdate){success=false;msg='temporary failure'}else if(c){Object.assign(c,body);if(m.pendingUpdate)obj={nodePending:true}}else{success=false;msg='client not found'}}
  else if(url.startsWith('/panel/api/clients/del/')){if(m.deleteAckOnly){}else if(m.badMissing){success=false;msg='API route not found'}else if(m.failB&&p==='b'){success=false;msg='temporarily unavailable'}else clients.delete(key(p,email));}
  else if(url.startsWith('/panel/api/clients/resetTraffic/')){if(c){c.used=0;m.resets=(m.resets||0)+1;if(m.loseResetResponse){m.loseResetResponse=false;success=false;msg='connection closed after reset'}}}
  else if(url==='/panel/api/clients/onlines')obj=[];
  else if(url==='/panel/api/clients/lastOnline')obj=Object.fromEntries([...clients.entries()].filter(([k])=>k.startsWith(p+':')).map(([,c])=>[c.email,1700000000000]));
  else{success=false;msg='unimplemented fixture route'}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success,obj,msg}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const native='http://127.0.0.1:'+server.address().port;
 const panel=await db.panelConfig.create({data:{name:'mock',baseUrl:native+'/a',subBase:native,username:'mock',password:encryptSecret('mock'),apiToken:encryptSecret('mock')}});
 const tmp=net.createServer();await new Promise(r=>tmp.listen(0,'127.0.0.1',r));const port=tmp.address().port;await new Promise(r=>tmp.close(r));const base='http://127.0.0.1:'+port;
 const log=createWriteStream(path.join(dir,'next.log'));app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true});app.stdout.pipe(log);app.stderr.pipe(log);
 for(let n=0;n<150;n++){if(app.exitCode!==null)throw Error('Next exited during startup; inspect fixture next.log');try{if((await fetch(base,{signal:AbortSignal.timeout(3000)})).ok)break}catch{}await new Promise(r=>setTimeout(r,500));if(n===149)throw Error('startup timeout')}
 async function owner(name,pool=100){const r=await db.reseller.create({data:{username:name,password:hashPassword('test'),trafficPoolGB:pool,multiLocation:true}});for(const id of [1,2,3])await db.resellerInbound.create({data:{resellerId:r.id,panelId:panel.id,inboundId:id,inboundTag:'loc-'+id,protocol:'vless',port:4400+id}});return r}
 async function seed(r,email,used=0,extraPanel){const refs=[{panelId:panel.id,inboundId:1},...(extraPanel?[{panelId:extraPanel.id,inboundId:1}]:[])];const v={id:'uuid-'+email,email,subId:'sub-'+email,totalGB:10*GB,expiryTime:Date.now()+86400000*30,enable:true,limitIp:0,flow:'',used:used*GB,ids:new Set([1])};clients.set(key('a',email),v);if(extraPanel)clients.set(key('b',email),{...v,used:2*GB,ids:new Set([1])});await db.resellerUser.create({data:{resellerId:r.id,email,subId:v.subId,trafficGB:10,panelId:panel.id,inboundIds:JSON.stringify(refs)}});return v}
 async function api(r,route,method='GET',body){const cookie='rp_session='+signAccountSession('RESELLER',r,'dashboard',Date.now()+3600000);const response=await fetch(base+route,{method,headers:{Cookie:cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json().catch(()=>({}))}}


 const admin=await db.adminUser.create({data:{username:'customer_admin',password:hashPassword('Admin123!')}});
 const cookie='rp_session='+signAccountSession('ADMIN',admin,'dashboard',Date.now()+3600000);
 async function adminApi(route,method='GET',body){const r=await fetch(base+route,{method,headers:{Cookie:cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json().catch(()=>null)}}
 let fresh=await adminApi('/api/admin/customer-observations','POST');
 check('collector preserves fresh-install restore eligibility',()=>{assert.equal(fresh.status,200);assert.equal(fresh.data.observed,0)});
 const freshSettings=await db.setting.count();check('fresh collector does not leave settings behind',()=>assert.equal(freshSettings,0));
 const source=await owner('customers_owner');const first=await seed(source,'first_customer',2);await seed(source,'second_customer',1);
 const other=await owner('other_owner');await seed(other,'foreign_customer',3);
 let result=await api(source,'/api/reseller/customer-tools');
 check('scoped tools endpoint exists',()=>assert.equal(result.status,200));
 result=await api(source,'/api/reseller/users/first_customer/links');check('copied configurations preserve native encryption and TLS fingerprint parameters',()=>{assert.equal(result.status,200);assert.match(result.data.links[0].uri,/encryption=none/);assert.match(result.data.links[0].uri,/fp=chrome/);assert.match(result.data.links[0].uri,/@fixture.example:/)});result=await api(source,'/api/reseller/customer-tools');
 check('metadata includes only owned users and labels',()=>{assert.equal(result.data.users?.length,2);assert.ok(result.data.users?.every(u=>Array.isArray(u.labels)));});
 result=await api(source,'/api/reseller/customer-tools','PATCH',{emails:['first_customer'],labels:['فروشگاه','پکیج A']});
 check('owned labels can be assigned without native mutation',()=>{assert.equal(result.status,200);assert.equal(nativeWrites.length,0)});
 result=await api(source,'/api/reseller/customer-tools','PATCH',{emails:['first_customer','foreign_customer'],labels:['private']});
 check('mixed tenant metadata is rejected atomically',()=>assert.equal(result.status,404));
 result=await api(source,'/api/reseller/customer-tools');
 check('cross tenant failure preserved original labels',()=>assert.deepEqual(result.data.users?.find(u=>u.email===first.email)?.labels,['فروشگاه','پکیج A']));
 result=await api(source,'/api/reseller/customer-tools?live=1');
 check('last online has timestamp from read-only native endpoint',()=>assert.equal(result.data.users?.find(u=>u.email===first.email)?.lastOnline,1700000000000));
 const original={...first,ids:[...first.ids]};
 const request={emails:['first_customer','second_customer'],enable:false,requestId:'disable-fixture-1'};
 result=await api(source,'/api/reseller/customer-tools/status','POST',{...request,protocol:'trojan'});
 check('infrastructure fields are rejected',()=>{assert.equal(result.status,400);assert.equal(nativeWrites.length,0)});
 result=await api(source,'/api/reseller/customer-tools/status','POST',{...request,emails:['first_customer','foreign_customer']});
 check('bulk action rejects another tenant before first write',()=>{assert.equal(result.status,404);assert.equal(nativeWrites.length,0)});
 result=await api(source,'/api/reseller/customer-tools/status','POST',request);
 check('bulk disable reports each owned customer',()=>{assert.equal(result.status,200);assert.equal(result.data.results?.length,2);assert.ok(result.data.results.every(r=>r.ok));assert.equal(first.enable,false)});
 check('status changes preserve all customer fields and accounting',()=>{assert.equal(first.uuid,original.id);const {uuid,...normalized}=first;assert.deepEqual({...normalized,enable:original.enable,ids:[...first.ids]},original)});
 const writes=nativeWrites.length;
 result=await api(source,'/api/reseller/customer-tools/status','POST',request);
 check('durable status retry never reapplies successful customers',()=>{assert.equal(result.status,200);assert.equal(nativeWrites.length,writes)});
 result=await api(source,'/api/reseller/customer-tools/status','POST',{...request,enable:true});
 check('same operation key cannot change its target',()=>assert.equal(result.status,409));
 mode.set('second_customer',{failUpdate:true});
 const partialRequest={emails:['first_customer','second_customer'],enable:true,requestId:'enable-partial-fixture'};
 result=await api(source,'/api/reseller/customer-tools/status','POST',partialRequest);
 check('partial native failure reports successful and failed customers separately',()=>{assert.equal(result.status,200);assert.equal(result.data.complete,false);assert.equal(result.data.results.filter(r=>r.ok).length,1)});
 result=await api(source,'/api/reseller/customer-tools/status');
 check('unfinished status is discoverable after page reload',()=>assert.equal(result.data.batch?.requestId,partialRequest.requestId));
 result=await api(source,'/api/reseller/customer-tools/status','DELETE',{requestId:partialRequest.requestId});
 check('unknown native partial status cannot be dismissed to evade repair',()=>assert.equal(result.status,409));
 result=await api(source,'/api/reseller/users/first_customer','PUT',{enable:false});
 // Already successful customer is unlocked; partial customer's operation stays protected.
 result=await api(source,'/api/reseller/users/second_customer','PUT',{enable:false});
 check('ordinary edits cannot hijack a partial status operation',()=>assert.equal(result.status,409));
 mode.delete('second_customer');const firstWrites=nativeWrites.filter(p=>p.endsWith('/first_customer')).length;
 result=await api(source,'/api/reseller/customer-tools/status','POST',partialRequest);
 check('continuing partial status preserves completed customers',()=>{assert.equal(result.data.complete,true);assert.equal(nativeWrites.filter(p=>p.endsWith('/first_customer')).length,firstWrites)});
 const create={name:'FirstUse',trafficGB:5,expiryMode:'first-use',expiryDays:30,ipLimit:0,inbounds:[{panelId:panel.id,inboundId:1}],requestId:'first-use-fixture'};
 result=await api(source,'/api/reseller/users','POST',create);
 check('first use creation succeeds',()=>assert.equal(result.status,200));
 const created=result.data.email;
 check('first use duration is negative and finite in native client',()=>assert.equal(clients.get(key('a',created))?.expiryTime,-30*86400000));
 result=await api(source,'/api/reseller/users','POST',create);
 check('first-use create retry returns same identity',()=>{assert.equal(result.status,200);assert.equal(result.data.email,created)});
 result=await api(source,'/api/reseller/users','POST',{...create,expiryMode:'from-now'});
 check('creation idempotency distinguishes validity modes',()=>assert.equal(result.status,409));
 result=await api(source,'/api/reseller/users','POST',{...create,requestId:'bad-first',expiryDays:0});
 check('zero first-use duration cannot become unlimited',()=>assert.equal(result.status,400));
 result=await api(source,'/api/reseller/users/bulk','POST',{...create,prefix:'BulkFirst',count:2,requestId:'first-use-bulk-fixture'});
 const bulkEmails=result.data.created?.map(u=>u.email)||[];
 check('bulk first-use creation applies duration to every selected customer',()=>{assert.equal(result.status,200);assert.equal(bulkEmails.length,2);assert.ok(bulkEmails.every(e=>clients.get(key('a',e))?.expiryTime===-30*86400000))});
 result=await api(source,'/api/reseller/users','POST',{...create,name:'ForbiddenInbound',inbounds:[{panelId:panel.id,inboundId:99}],requestId:'not-permitted-inbound'});
 check('first-use creation still enforces inbound assignment',()=>assert.equal(result.status,403));
 const revokedOwner=await owner('revoked_owner');await seed(revokedOwner,'revoked_customer',0);
 await db.resellerInbound.deleteMany({where:{resellerId:revokedOwner.id}});const revokedWrites=nativeWrites.length;
 result=await api(revokedOwner,'/api/reseller/customer-tools/status','POST',{emails:['revoked_customer'],enable:true,requestId:'revoked-enable-fixture'});
 check('bulk enable cannot bypass revoked inbound permission',()=>{assert.equal(result.status,200);assert.equal(result.data.results[0].ok,false);assert.equal(nativeWrites.length,revokedWrites)});
 result=await api(revokedOwner,'/api/reseller/customer-tools/status','DELETE',{requestId:'revoked-enable-fixture'});
 check('safe unattempted permission failure can close without native write',()=>{assert.equal(result.status,200);assert.equal(nativeWrites.length,revokedWrites)});
 result=await api(source,'/api/reseller/customer-tools/history?email=foreign_customer');
 check('history cannot read another tenant',()=>assert.equal(result.status,404));
 result=await adminApi('/api/admin/customer-observations','POST');
 check('admin can collect read-only observations',()=>assert.equal(result.status,200));
 result=await api(source,'/api/reseller/customer-tools/history?email=first_customer');
 check('first observation establishes baseline without invented history',()=>{assert.equal(result.status,200);assert.equal(result.data.history?.days?.length,0);assert.ok(result.data.history?.startedAt)});
 result=await api(source,'/api/admin/customer-observations','POST');
 check('reseller cannot run global observation job',()=>assert.equal(result.status,401));
 result=await api(source,'/api/reseller/customer-tools/alerts','PUT',{usagePercent:85,expiryDays:5});
 check('reseller can configure own threshold alerts',()=>assert.equal(result.status,200));
 result=await api(source,'/api/reseller/customer-tools/alerts','PUT',{usagePercent:0,expiryDays:9999});
 check('alert threshold bounds enforced',()=>assert.equal(result.status,400));
 const protectedBefore=JSON.stringify(await db.resellerUser.findMany({orderBy:{id:'asc'}})),beforeJobWrites=nativeWrites.length;
 process.env.PORT=String(port);await child(['scripts/run-customer-observations.cjs']);
 const protectedAfter=JSON.stringify(await db.resellerUser.findMany({orderBy:{id:'asc'}}));
 check('independent signed job changes no customer row or native state',()=>{assert.equal(protectedAfter,protectedBefore);assert.equal(nativeWrites.length,beforeJobWrites)});
 first.used=3*GB;await adminApi('/api/admin/customer-observations','POST');
 result=await api(source,'/api/reseller/users/first_customer/reset-traffic','POST');
 check('history fixture reset passes normal accounting path',()=>assert.equal(result.status,200));
 first.used=0.5*GB;await adminApi('/api/admin/customer-observations','POST');
 result=await api(source,'/api/reseller/customer-tools/history?email=first_customer');
 check('collected history does not lose or double count a committed reset',()=>assert.equal(result.data.history.days.reduce((s,d)=>s+d.usedGB,0),1.5));
 await db.reseller.update({where:{id:source.id},data:{mirzaEnabled:true}});
 const bridgeToken=signAccountSession('RESELLER',source,'bridge',Date.now()+3600000),beforeDenied=nativeWrites.length;
 for(const suffix of ['inbounds/add','inbounds/update/1','inbounds/del/1','routing/update','server/restart','setting/update']){
  const response=await fetch(base+'/api/bridge/'+source.username+'/panel/api/'+suffix,{method:'POST',headers:{Authorization:'Bearer '+bridgeToken,'content-type':'application/json'},body:'{}'});
  const payload=await response.json();check('authenticated bridge cannot configure '+suffix,()=>{assert.equal(response.status,400);assert.equal(payload.success,false);assert.equal(nativeWrites.length,beforeDenied)});
 }
 for(const route of ['/api/reseller/routing','/api/reseller/inbounds/1','/api/bridge/customers_owner/panel/api/inbounds/update/1']){
  const res=await fetch(base+route,{method:'POST',headers:{Cookie:'rp_session='+signAccountSession('RESELLER',source,'dashboard',Date.now()+3600000),'content-type':'application/json'},body:'{}'});
  const body=await res.json().catch(()=>null);
  check('no infrastructure mutation route '+route,()=>assert.ok([401,404,405].includes(res.status)||[200,400].includes(res.status)&&body?.success===false,JSON.stringify({status:res.status,body})));
 }
 const manifest=await fetch(base+'/manifest.webmanifest');
 check('mobile installation manifest is available',()=>assert.equal(manifest.status,200));
 mode.set('sync-targets',true);
 const syncOwner=await owner('sync_owner',50);const syncing=await seed(syncOwner,'sync_customer',2);mode.set('sync_customer',{pendingUpdate:true});
 await api(syncOwner,'/api/reseller/users/sync_customer','PUT',{trafficGB:20});const syncWrites=nativeWrites.length;
 result=await api(syncOwner,'/api/reseller/customer-tools');
 const syncJournal=()=>db.operationJournal.findFirst({where:{resellerId:syncOwner.id,email:'sync_customer',type:'UPDATE'}});
 check('saved dirty queue is distinguished from an unfinished edit',()=>{assert.equal(result.data.users[0].pendingUpdate.localCommitted,true);assert.equal(nativeWrites.length,syncWrites)});
 mode.delete('sync_customer');mode.set('nodes-offline',true);await api(syncOwner,'/api/reseller/customer-tools');let syncStatus=await syncJournal();
 check('offline nodes keep paid queue guarded',()=>assert.equal(syncStatus.status,'PARTIAL'));
 mode.delete('nodes-offline');mode.set('nodes-unavailable',true);await api(syncOwner,'/api/reseller/customer-tools');syncStatus=await syncJournal();
 check('unsupported or unreachable node API never means completion',()=>assert.equal(syncStatus.status,'PARTIAL'));
 mode.delete('nodes-unavailable');const syncSub=syncing.subId;syncing.subId='wrong-identity';await api(syncOwner,'/api/reseller/customer-tools');syncStatus=await syncJournal();
 check('healthy nodes cannot settle a replaced client identity',()=>assert.equal(syncStatus.status,'PARTIAL'));
 syncing.subId=syncSub;const syncRows=JSON.stringify(await db.resellerUser.findMany({where:{resellerId:syncOwner.id}}));result=await api(syncOwner,'/api/reseller/customer-tools');syncStatus=await syncJournal();
 check('read-only confirmation finishes queue without rewriting or billing the customer',()=>{assert.equal(syncStatus.status,'SUCCESS');assert.equal(result.data.users[0].pendingUpdate,null);assert.equal(nativeWrites.length,syncWrites);assert.equal(syncing.used,2*GB)});
 const settledSyncRows=JSON.stringify(await db.resellerUser.findMany({where:{resellerId:syncOwner.id}}));check('confirmation preserves all tracked customer fields',()=>assert.equal(settledSyncRows,syncRows));
 mode.set('sync_customer',{pendingUpdate:true});await api(syncOwner,'/api/reseller/users/sync_customer','PUT',{trafficGB:25});mode.delete('sync_customer');const collectorWrites=nativeWrites.length;await adminApi('/api/admin/customer-observations','POST');syncStatus=await syncJournal();
 check('existing background collector confirms saved updates without replaying mutation',()=>{assert.equal(syncStatus.status,'SUCCESS');assert.equal(nativeWrites.length,collectorWrites);assert.equal(syncing.totalGB,25*GB)});
 const legacyOwner=await owner('legacy_creations',50);mode.set('node-pending',true);mode.set('defer-native-dirty',true);const legacyPayload={name:'LegacySaved',trafficGB:10,expiryDays:30,inbounds:[{panelId:panel.id,inboundId:1}],requestId:'legacy-create-fixture'};
 const legacyResult=await api(legacyOwner,'/api/reseller/users','POST',legacyPayload);let legacyJournal=await db.operationJournal.findFirst({where:{resellerId:legacyOwner.id,type:'CREATE'}});const legacyMeta=JSON.parse(legacyJournal.metadata),legacyTracked=await db.resellerUser.findUnique({where:{resellerId_email:{resellerId:legacyOwner.id,email:legacyJournal.email}}});
 delete legacyMeta.localCommitted;delete legacyMeta.nativePending;delete legacyMeta.done;
 await db.operationJournal.update({where:{id:legacyJournal.id},data:{status:'NEEDS_REPAIR',userId:null,reservedGB:10,lastError:'resume: remote incomplete',metadata:JSON.stringify(legacyMeta)}});await db.resellerUser.delete({where:{id:legacyTracked.id}});
 const legacyWrites=nativeWrites.length;await api(legacyOwner,'/api/reseller/customer-tools');const notRecoveredByGet=await db.resellerUser.count({where:{resellerId:legacyOwner.id}});
 check('a metadata GET does not import legacy untracked customers',()=>assert.equal(notRecoveredByGet,0));
 result=await adminApi('/api/admin/customer-observations','POST');legacyJournal=await db.operationJournal.findUnique({where:{id:legacyJournal.id}});const legacyRestored=await db.resellerUser.findUnique({where:{resellerId_email:{resellerId:legacyOwner.id,email:legacyJournal.email}}});
 check('existing collector registers a verified legacy pending creation without native writes',()=>{assert.equal(result.status,200);assert.equal(result.data.registered,1);assert.equal(legacyResult.status,202);assert.equal(legacyRestored.trafficGB,10);assert.equal(legacyJournal.reservedGB,0);assert.equal(legacyJournal.status,'PARTIAL');assert.equal(nativeWrites.length,legacyWrites)});
 const legacyAllocation=(await db.resellerUser.aggregate({where:{resellerId:legacyOwner.id},_sum:{trafficGB:true}}))._sum.trafficGB;
 check('legacy recovery transfers existing reservation instead of adding a second charge',()=>assert.equal(legacyAllocation+legacyJournal.reservedGB,10));
 const mismatch=await seed(legacyOwner,'legacy_identity_mismatch',0);await db.resellerUser.deleteMany({where:{resellerId:legacyOwner.id,email:mismatch.email}});
 const mismatchJournal=await db.operationJournal.create({data:{idempotencyKey:'legacy-identity-mismatch',resellerId:legacyOwner.id,email:mismatch.email,type:'CREATE',status:'NEEDS_REPAIR',reservedGB:10,targetPanels:JSON.stringify([panel.id]),lastError:'resume: remote incomplete',metadata:JSON.stringify({...legacyMeta,name:'Mismatched',email:mismatch.email,uuid:'wrong-identity',subId:mismatch.subId,expiryTime:mismatch.expiryTime})}});
 const unknownJournal=await db.operationJournal.create({data:{idempotencyKey:'legacy-unknown-absence',resellerId:legacyOwner.id,email:'legacy_unknown_absent',type:'CREATE',status:'NEEDS_REPAIR',reservedGB:10,targetPanels:JSON.stringify([panel.id]),lastError:'(UNKNOWN outcome) timeout',metadata:JSON.stringify({...legacyMeta,name:'Unknown',email:'legacy_unknown_absent',uuid:'unknown-uuid',subId:'unknown-sub'})}});
 result=await adminApi('/api/admin/customer-observations','POST');const preservedLegacy=await db.operationJournal.findMany({where:{id:{in:[mismatchJournal.id,unknownJournal.id]}}});
 check('identity conflicts and unknown old outcomes retain reservations without automatic repair',()=>{assert.equal(result.data.registered,0);assert.ok(preservedLegacy.every(j=>j.reservedGB===10&&j.status==='NEEDS_REPAIR'));assert.equal(nativeWrites.length,legacyWrites)});
 result=await api(source,'/api/admin/customer-observations?reconcileCreations=1','POST');check('reseller cannot invoke operator creation reconciliation',()=>assert.equal(result.status,401));
 const beforeReconcileSettings=JSON.stringify(await db.setting.findMany({orderBy:{key:'asc'}}));result=await adminApi('/api/admin/customer-observations?reconcileCreations=1','POST');const afterReconcileSettings=JSON.stringify(await db.setting.findMany({orderBy:{key:'asc'}}));
 check('operator reconciliation is idempotent and does not run observations or native mutations',()=>{assert.equal(result.status,200);assert.equal(result.data.registered,0);assert.equal(beforeReconcileSettings,afterReconcileSettings);assert.equal(nativeWrites.length,legacyWrites)});
 mode.delete('node-pending');const legacyLive=clients.get(key('a',legacyJournal.email));legacyLive.expiryTime=Date.now()+20*86400000;legacyLive.enable=false;await api(legacyOwner,'/api/reseller/customer-tools');legacyJournal=await db.operationJournal.findUnique({where:{id:legacyJournal.id}});
 check('read-only confirmation preserves native lifecycle changes after saved registration',()=>{assert.equal(legacyJournal.status,'SUCCESS');assert.equal(legacyLive.enable,false);assert.equal(nativeWrites.length,legacyWrites)});
 mode.delete('sync-targets');
 const visibilityOwner=await owner('visibility_owner',100);await db.reseller.update({where:{id:visibilityOwner.id},data:{mirzaEnabled:true}});const retained=await seed(visibilityOwner,'retained_offline',2);retained.ids=new Set([2]);await db.resellerUser.update({where:{resellerId_email:{resellerId:visibilityOwner.id,email:retained.email}},data:{inboundIds:JSON.stringify([{panelId:panel.id,inboundId:2}])}});
 mode.set('eligibility-mode',true);mode.set('disable-inbound-2',true);mode.set('nodes-offline',true);const visibilityWrites=nativeWrites.length;
 result=await api(visibilityOwner,'/api/reseller/inbounds');check('reseller catalog hides disabled and offline inbounds',()=>assert.deepEqual(result.data.inbounds.map(i=>i.inboundId),[1]));
 result=await api(visibilityOwner,'/api/reseller/bootstrap');check('instant bootstrap never exposes unverified DB-only inbound choices or labels',()=>{assert.deepEqual(result.data.inbounds,[]);assert.deepEqual(result.data.users[0].inboundTags,[])});
 const visibilityBridge=signAccountSession('RESELLER',visibilityOwner,'bridge',Date.now()+3600000);let visibilityResponse=await fetch(base+'/api/bridge/'+visibilityOwner.username+'/panel/api/inbounds/list',{headers:{Authorization:'Bearer '+visibilityBridge}});const visibleBridge=await visibilityResponse.json();check('bridge catalog applies the same active-only visibility rule',()=>{assert.equal(visibleBridge.success,true);assert.deepEqual(visibleBridge.obj.map(i=>i.id),[1])});
 const hiddenPayload={name:'HiddenInbound',trafficGB:10,expiryDays:30,inbounds:[{panelId:panel.id,inboundId:3}],requestId:'hidden-inbound-create'};
 result=await api(visibilityOwner,'/api/reseller/users','POST',hiddenPayload);check('crafted offline creation is rejected before reservation or native write',()=>{assert.equal(result.status,409);assert.equal(nativeWrites.length,visibilityWrites)});
 result=await api(visibilityOwner,'/api/reseller/users/bulk','POST',{...hiddenPayload,prefix:'HiddenBulk',count:2,requestId:'hidden-inbound-bulk'});check('bulk cannot create into an offline inbound',()=>{assert.equal(result.data.createdCount||0,0);assert.equal(nativeWrites.length,visibilityWrites)});
 result=await api(visibilityOwner,'/api/reseller/users/'+retained.email,'PUT',{inbounds:[{panelId:panel.id,inboundId:2},{panelId:panel.id,inboundId:3}]});check('reselection cannot attach a newly requested offline location',()=>{assert.equal(result.status,409);assert.equal(nativeWrites.length,visibilityWrites)});
 const noHiddenReservations=await db.operationJournal.count({where:{resellerId:visibilityOwner.id}});check('rejected selections leave no accounting journal or reservation',()=>assert.equal(noHiddenReservations,0));
 visibilityResponse=await fetch(base+'/api/bridge/'+visibilityOwner.username+'/panel/api/inbounds/addClient',{method:'POST',headers:{Authorization:'Bearer '+visibilityBridge,'content-type':'application/json'},body:JSON.stringify({id:3,settings:JSON.stringify({clients:[{id:'bridge-offline-uuid',email:'BridgeOffline',subId:'bridge-offline-sub',totalGB:10*GB,expiryTime:Date.now()+30*86400000}]})})});const blockedBridge=await visibilityResponse.json();check('bridge creation cannot bypass fresh node health validation',()=>{assert.equal(blockedBridge.success,false);assert.equal(nativeWrites.length,visibilityWrites)});
 result=await api(visibilityOwner,'/api/reseller/users/'+retained.email+'/links');check('reseller direct links cannot expose an unavailable location',()=>assert.equal(result.status,503));
 result=await api(visibilityOwner,'/api/reseller/users/'+retained.email,'PUT',{trafficGB:15});check('retaining an existing unavailable location does not freeze a funded quota edit',()=>{assert.equal(result.status,200);assert.equal(retained.totalGB,15*GB);assert.equal(retained.used,2*GB);assert.deepEqual([...retained.ids],[2])});
 result=await api(visibilityOwner,'/api/reseller/users');const retainedRow=result.data.users.find(u=>u.email===retained.email);check('hiding a location preserves real customer usage and quota',()=>{assert.deepEqual(retainedRow.inboundTags,[]);assert.equal(retainedRow.usedGB,2);assert.equal(retainedRow.trafficGB,15)});
 mode.set('delete-inbound-1',true);result=await api(visibilityOwner,'/api/reseller/inbounds');check('deleted grants never reappear as fallback catalog entries',()=>assert.deepEqual(result.data.inbounds,[]));mode.delete('delete-inbound-1');mode.delete('nodes-offline');mode.set('nodes-unavailable',true);
 result=await api(visibilityOwner,'/api/reseller/inbounds');check('unknown remote health hides that node while verified local choices remain',()=>assert.deepEqual(result.data.inbounds.map(i=>i.inboundId),[1]));mode.delete('nodes-unavailable');mode.set('stale-node',true);
 result=await api(visibilityOwner,'/api/reseller/inbounds');check('stale heartbeat cannot be offered as online',()=>assert.deepEqual(result.data.inbounds.map(i=>i.inboundId),[1]));mode.delete('stale-node');mode.set('local-stopped',true);
 result=await api(visibilityOwner,'/api/reseller/inbounds');check('stopped local Xray hides local inbounds without hiding a healthy remote node',()=>assert.deepEqual(result.data.inbounds.map(i=>i.inboundId),[3]));mode.delete('local-stopped');mode.delete('disable-inbound-2');
 result=await api(visibilityOwner,'/api/reseller/inbounds');const grantsRetained=await db.resellerInbound.count({where:{resellerId:visibilityOwner.id}});check('healthy return restores choices without changing admin grants',()=>{assert.deepEqual(result.data.inbounds.map(i=>i.inboundId),[1,2,3]);assert.equal(grantsRetained,3)});mode.delete('eligibility-mode');
 result=await api(visibilityOwner,'/api/reseller/users/'+retained.email+'/links');check('reseller direct links return when their retained location becomes healthy',()=>{assert.equal(result.status,200);assert.equal(result.data.links.length,1)});
 const retryRefs=[{panelId:panel.id,inboundId:3}],retryMeta={name:'RetryOffline',email:'retry_offline',uuid:'retry-offline-uuid',subId:'retry-offline-sub',trafficGB:10,expiryDays:30,expiryTime:Date.now()+30*86400000,ipLimit:0,refs:retryRefs};
 const failedRetry=await db.operationJournal.create({data:{idempotencyKey:'create-req:'+visibilityOwner.id+':offline-retry',resellerId:visibilityOwner.id,email:retryMeta.email,type:'CREATE',status:'FAILED',reservedGB:0,targetPanels:JSON.stringify([panel.id]),metadata:JSON.stringify(retryMeta)}});mode.set('eligibility-mode',true);mode.set('nodes-offline',true);const beforeRetry=nativeWrites.length;
 result=await api(visibilityOwner,'/api/reseller/users','POST',{...hiddenPayload,name:'RetryOffline',inbounds:retryRefs,requestId:'offline-retry'});const failedAfterRetry=await db.operationJournal.findUnique({where:{id:failedRetry.id}});check('failed create retry does not reserve new quota while its inbound is offline',()=>{assert.equal(result.status,409);assert.equal(failedAfterRetry.reservedGB,0);assert.equal(failedAfterRetry.status,'FAILED');assert.equal(nativeWrites.length,beforeRetry)});mode.delete('eligibility-mode');mode.delete('nodes-offline');
 mode.set('sync-targets',true);const deferred=await owner('deferred_delete',100),deferredClient=await seed(deferred,'deferred_customer',1);mode.set('nodes-offline',true);const beforeDeferred=nativeWrites.length;result=await api(deferred,'/api/reseller/users/deferred_customer','DELETE');const deferredMeta=await api(deferred,'/api/reseller/customer-tools');check('explicit pending deletion is visible and cannot credit quota or write to an offline target',()=>{assert.equal(result.status,202);assert.equal(deferredMeta.data.users[0].pendingOperation,'DELETE');assert.equal(nativeWrites.length,beforeDeferred);assert.equal(clients.has(key('a','deferred_customer')),true)});writeFileSync(path.join(dir,'.operation-installation'),'ab'.repeat(24));mode.delete('nodes-offline');await adminApi('/api/admin/customer-observations','POST');check('a restored queue cannot automatically mutate the original panel before renewed owner intent',()=>{assert.equal(clients.has(key('a','deferred_customer')),true);assert.equal(nativeWrites.length,beforeDeferred)});mode.set('nodes-offline',true);await api(deferred,'/api/reseller/users/deferred_customer','DELETE');mode.delete('nodes-offline');await adminApi('/api/admin/customer-observations','POST');let deferredPool=await db.reseller.findUnique({where:{id:deferred.id}});check('existing observation job finishes only the explicit deletion after connectivity returns',()=>{assert.equal(clients.has(key('a','deferred_customer')),false);assert.equal(deferredPool.consumedGB,1)});
 const deferredReset=await owner('deferred_reset',100),resetTarget=await seed(deferredReset,'deferred_reset',10.2);resetTarget.enable=false;mode.set('nodes-offline',true);result=await api(deferredReset,'/api/reseller/users/deferred_reset/reset-traffic','POST',{});check('offline reset reserves funding without resetting any live counter',()=>{assert.equal(result.status,202);assert.equal(resetTarget.used,10.2*GB);assert.equal(resetTarget.enable,false)});mode.delete('nodes-offline');await adminApi('/api/admin/customer-observations','POST');resetTarget.used=GB/2;await adminApi('/api/admin/customer-observations','POST');deferredPool=await db.reseller.findUnique({where:{id:deferredReset.id}});check('recovered overshoot reset runs once and preserves fresh traffic on subsequent jobs',()=>{assert.equal(resetTarget.used,GB/2);assert.equal(resetTarget.enable,true);assert.equal(deferredPool.consumedGB,10.2)});mode.delete('sync-targets');
 if(process.env.PLAYWRIGHT_MODULE){
  const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
   const context=await browser.newContext({viewport:{width:1280,height:950}});
   await context.addCookies([{name:'rp_session',value:signAccountSession('RESELLER',source,'dashboard',Date.now()+3600000),url:base}]);
   await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedConfig=value}}}));
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('heading',{name:'کاربران من',exact:true}).waitFor();
   await page.getByLabel('فیلتر گروه کاربران').selectOption('فروشگاه');
   await page.getByLabel('انتخاب first_customer',{exact:true}).check();
   await page.getByRole('button',{name:'فعال / غیرفعال گروهی',exact:true}).click();
   await page.getByLabel('وضعیت گروهی جدید').selectOption('off');await page.getByRole('button',{name:'تأیید تغییر وضعیت',exact:true}).click();
   await page.getByText('موفق',{exact:true}).first().waitFor();await page.getByRole('button',{name:'بستن',exact:true}).click();
   check('browser selected status action uses own customer only',()=>assert.equal(first.enable,false));
   await page.getByLabel('انتخاب first_customer',{exact:true}).check();await page.getByRole('button',{name:'برچسب‌ها',exact:true}).click();
   await page.getByLabel('برچسب‌های کاربران').fill('فروشگاه، تست رابط');await page.getByRole('button',{name:'ذخیره',exact:true}).click();
   await page.getByRole('dialog').waitFor({state:'hidden'});
   check('browser can edit labels after successful bulk status',()=>assert.ok(true));
   const customerRow=page.getByRole('row').filter({has:page.getByLabel('انتخاب first_customer',{exact:true})});
   await customerRow.getByText('تست رابط',{exact:true}).waitFor();
   const rowText=await customerRow.innerText();
   check('reseller row still shows current usage and last connection',()=>{assert.match(rowText,/GB/);assert.match(rowText,/آخرین اتصال:/)});
   const historyCount=await page.getByRole('button',{name:/^سابقه /}).count();
   check('reseller no longer offers unused consumption history',()=>assert.equal(historyCount,0));
   await customerRow.hover();await page.screenshot({path:path.join(dir,'customer-tools-desktop.png'),fullPage:true});
   mode.set('sync-targets',true);mode.set('first_customer',{pendingUpdate:true});
   const queuedUsage=first.used;const queuedResult=await api(source,'/api/reseller/users/first_customer','PUT',{trafficGB:20});
   await page.reload({waitUntil:'networkidle'});await page.getByLabel('ویرایش first_customer',{exact:true}).click();
   const queuedQuota=await page.getByLabel('سهمیهٔ کاربر در ویرایش').inputValue();
   check('browser normal edit opens saved queued quota without an unfinished action',()=>{assert.equal(queuedResult.status,202);assert.equal(queuedQuota,'20')});
   const resumeCount=await page.getByRole('button',{name:'ادامهٔ ویرایش first_customer',exact:true}).count();check('saved reseller edit does not offer a misleading continuation',()=>assert.equal(resumeCount,0));
   await page.getByRole('dialog').getByRole('switch').click();await page.getByRole('dialog').getByRole('button',{name:'ذخیره',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
   await page.getByRole('button',{name:'ادامهٔ ویرایش first_customer',exact:true}).waitFor({state:'hidden'});
   check('browser queued activation preserves usage and pending status',()=>{assert.equal(first.enable,true);assert.equal(first.used,queuedUsage)});
   await page.screenshot({path:path.join(dir,'queued-update-desktop.png'),fullPage:true});
   mode.delete('first_customer');mode.set('nodes-offline',true);const beforeConfirm=nativeWrites.length;
   await api(source,'/api/reseller/customer-tools');let queuedJournal=await db.operationJournal.findFirst({where:{resellerId:source.id,email:'first_customer',type:'UPDATE',status:'PARTIAL'}});
   check('offline native node keeps the internal queue protected',()=>assert.ok(queuedJournal));
   mode.delete('nodes-offline');mode.set('nodes-unavailable',true);await api(source,'/api/reseller/customer-tools');queuedJournal=await db.operationJournal.findUnique({where:{id:queuedJournal.id}});
   check('unreadable node status cannot falsely finish a saved queue',()=>assert.equal(queuedJournal.status,'PARTIAL'));
   mode.delete('nodes-unavailable');await page.reload({waitUntil:'networkidle'});await page.getByLabel('انتخاب first_customer',{exact:true}).waitFor();
   queuedJournal=await db.operationJournal.findUnique({where:{id:queuedJournal.id}});
   check('metadata automatically confirms healthy nodes without another customer mutation',()=>{assert.equal(queuedJournal.status,'SUCCESS');assert.equal(nativeWrites.length,beforeConfirm);assert.equal(first.used,queuedUsage);assert.equal(first.totalGB,20*GB)});
   mode.set('first_customer',{failUpdate:true});await api(source,'/api/reseller/users/first_customer','PUT',{trafficGB:25});await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'ادامهٔ ویرایش first_customer',exact:true}).click();
   const failedQuota=await page.getByLabel('سهمیهٔ کاربر در ویرایش').inputValue();check('a genuinely incomplete edit still offers its original funded continuation',()=>assert.equal(failedQuota,'25'));
   mode.delete('first_customer');await page.getByRole('dialog').getByRole('button',{name:'ذخیره',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
   mode.delete('sync-targets');await page.getByLabel('فیلتر گروه کاربران').selectOption('');await page.getByRole('button',{name:'کاربر جدید',exact:true}).click();
   await page.getByLabel('شروع اعتبار کاربر').selectOption('first-use');await page.getByLabel('روز اعتبار از اولین اتصال').fill('45');
   await page.waitForTimeout(300);await page.screenshot({path:path.join(dir,'first-use-desktop.png'),fullPage:true});
   const duration=await page.getByLabel('روز اعتبار از اولین اتصال').inputValue();check('browser first-use creation shows finite duration control',()=>assert.equal(duration,'45'));
   const createDialog=page.getByRole('dialog'),choice3=createDialog.getByRole('button',{name:'loc-3',exact:false});
   await choice3.click();mode.set('eligibility-mode',true);mode.set('disable-inbound-2',true);mode.set('nodes-offline',true);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await choice3.waitFor({state:'hidden'});await createDialog.getByRole('button',{name:'loc-2',exact:false}).waitFor({state:'hidden'});
   const blockedSubmit=await createDialog.getByRole('button',{name:'ساخت کاربر',exact:true}).isDisabled();
   check('open create form hides unavailable choices and blocks a vanished selection',()=>assert.equal(blockedSubmit,true));
   await page.screenshot({path:path.join(dir,'inbound-offline-desktop.png'),fullPage:true});
   mode.delete('nodes-offline');mode.delete('disable-inbound-2');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await choice3.waitFor();
   const returnedSelection=await choice3.getAttribute('aria-pressed');check('healthy return preserves the explicit selection without changing its grants',()=>assert.equal(returnedSelection,'true'));await choice3.click();mode.delete('eligibility-mode');
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);await page.screenshot({path:path.join(dir,'first-use-mobile.png'),fullPage:true});
   await page.getByPlaceholder('Ali-Shop').fill('BrowserQueued');await page.getByRole('dialog').getByRole('button',{name:'۵ گیگ',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'loc-1',exact:false}).click();mode.set('sync-targets',true);mode.set('defer-native-dirty',true);mode.set('node-pending',true);await page.getByRole('dialog').getByRole('button',{name:'ساخت کاربر',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
   const browserQueued=await db.resellerUser.findFirst({where:{resellerId:source.id,name:'BrowserQueued'}});const queuedRow=page.getByRole('row').filter({has:page.getByText('BrowserQueued',{exact:true})});await queuedRow.getByText('حساب ثبت‌شده؛ برخی لوکیشن‌ها در انتظار آماده‌سازی',{exact:true}).waitFor();
   check('browser queued create closes form and shows the saved customer with honest pending status',()=>assert.ok(browserQueued));
   await page.screenshot({path:path.join(dir,'queued-create-mobile.png'),fullPage:true});const queuedCreateWrites=nativeWrites.length;mode.delete('node-pending');await page.reload({waitUntil:'networkidle'});await queuedRow.getByText('حساب ثبت‌شده؛ برخی لوکیشن‌ها در انتظار آماده‌سازی',{exact:true}).waitFor({state:'hidden'});
   check('browser clears creation pending state without recreating the customer',()=>assert.equal(nativeWrites.length,queuedCreateWrites));
   mode.delete('sync-targets');
   let droppedCreate=false;const retryIds=[];
   const dropFirst=async route=>{const req=route.request();if(req.method()==='POST'&&req.postDataJSON()?.name==='BrowserRetry'){retryIds.push(req.postDataJSON().requestId);if(!droppedCreate){droppedCreate=true;const response=await route.fetch();assert.ok([200,202].includes(response.status()));await route.abort('failed');return}}await route.continue()};
   await page.route('**/api/reseller/users',dropFirst);
   async function fillRetry(){await page.getByRole('button',{name:'کاربر جدید',exact:true}).click();await page.getByPlaceholder('Ali-Shop').fill('BrowserRetry');await page.getByLabel('شروع اعتبار کاربر').selectOption('first-use');await page.getByLabel('روز اعتبار از اولین اتصال').fill('45');await page.getByRole('dialog').getByRole('button',{name:'۵ گیگ',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'loc-1',exact:false}).click();await page.getByRole('dialog').getByRole('button',{name:'ساخت کاربر',exact:true}).click()}
   await fillRetry();await page.getByText(/خطای شبکه:/).first().waitFor();await page.reload({waitUntil:'networkidle'});await fillRetry();await page.getByRole('button',{name:'کپی همه',exact:true}).waitFor();
   const retries=await db.resellerUser.count({where:{resellerId:source.id,name:'BrowserRetry'}});check('browser lost-response retry survives a full page reload without a second customer or charge',()=>{assert.equal(retries,1);assert.equal(retryIds.length,2);assert.equal(retryIds[0],retryIds[1])});
   await page.getByRole('button',{name:'کپی همه',exact:true}).click();const copied=await page.evaluate(()=>window.__copiedConfig);check('browser copy-all uses the exact native configuration rather than rebuilding its TLS parameters',()=>{assert.match(copied,/encryption=none/);assert.match(copied,/fp=chrome/);assert.match(copied,/@fixture.example:/)});await page.keyboard.press('Escape');await page.unroute('**/api/reseller/users',dropFirst);
   await page.waitForTimeout(300);await page.screenshot({path:path.join(dir,'customer-tools-mobile.png'),fullPage:true});
   const size=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:innerWidth}));check('customer tools mobile has no page overflow',()=>assert.ok(size.content<=size.viewport+1,JSON.stringify(size)));
   const adminContext=await browser.newContext({viewport:{width:1280,height:950}});
   try{
    await adminContext.addCookies([{name:'rp_session',value:cookie.slice('rp_session='.length),url:base}]);
    const adminPage=await adminContext.newPage();adminPage.on('pageerror',e=>errors.push(e.message));
    await adminPage.goto(base,{waitUntil:'networkidle'});await adminPage.getByRole('button',{name:'کاربران',exact:true}).click();
    await adminPage.getByRole('heading',{name:'همهٔ کاربران',exact:true}).waitFor();
    const adminRow=adminPage.getByRole('row').filter({has:adminPage.getByText('first_customer',{exact:true})});
    await adminRow.getByText(/گیگ/).first().waitFor();await adminRow.getByText('تست رابط',{exact:true}).waitFor();
    const adminText=await adminRow.innerText(),adminHistoryCount=await adminPage.getByRole('button',{name:/^سابقه /}).count();
    check('admin keeps current usage and labels',()=>{assert.match(adminText,/گیگ/);assert.match(adminText,/تست رابط/)});
    check('admin no longer offers unused consumption history',()=>assert.equal(adminHistoryCount,0));
    await adminRow.hover();await adminPage.screenshot({path:path.join(dir,'admin-customers-desktop.png'),fullPage:true});
   }finally{await adminContext.close()}
   await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload({waitUntil:'networkidle'});
   const cached=await page.evaluate(async()=>{const keys=await caches.keys();const requests=await Promise.all(keys.filter(k=>k.startsWith('pvnet-panel-static-')).map(async k=>(await (await caches.open(k)).keys()).map(r=>new URL(r.url).pathname)));return requests.flat();});
   check('installed worker caches static assets and no private data',()=>{assert.ok(cached.includes('/offline.html'));assert.ok(cached.every(p=>p==='/offline.html'||p.startsWith('/icons/')||p.startsWith('/fonts/')))});
   await context.setOffline(true);await page.goto(base);await page.getByRole('heading',{name:'اتصال برقرار نیست'}).waitFor();
   check('offline installed app shows generic shell without customer data',()=>assert.ok(true));await context.setOffline(false);
   check('browser has no client errors',()=>assert.deepEqual(errors,[]));
  }finally{await browser.close()}
 }
 console.log(JSON.stringify({checks,failures,fixture:dir}));if(failures.length)process.exitCode=1;
}catch(e){console.error(e);console.error('Fixture:',dir);process.exitCode=1}
finally{if(app){if(process.platform==='win32')await new Promise(resolve=>{const p=spawn('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{windowsHide:true});p.on('exit',resolve)});else app.kill('SIGTERM')}if(server){server.closeAllConnections();server.close()}if(db)await db.$disconnect()}
