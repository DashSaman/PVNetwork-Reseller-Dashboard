// Mirza 0.8.1 wire contract. Disposable SQLite + loopback native mock only.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,createWriteStream,realpathSync} from 'node:fs';
const root=realpathSync(process.cwd()),dir=path.join(root,'.local-dev','mirza-'+Date.now());mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'test.db'),'');
process.env.DATABASE_URL='file:../.local-dev/'+path.basename(dir)+'/test.db';process.env.APP_SECRET='isolated-mirza-contract-secret';process.env.CI='1';process.env.__NEXT_AGENT_UPGRADE='security';
const {PrismaClient}=await import('@prisma/client');const {encryptSecret,hashPassword,signAccountSession}=await import('../src/lib/crypto.ts');
const GB=1024**3,clients=new Map(),writes=[],failures=[],mode={dropAttach:false,remoteTwo:false,offline:false,dirty:false,unavailable:false};let db,app,mock,checks=0;
function check(name,fn){try{fn();checks++;console.log('PASS',name)}catch(e){failures.push(name+': '+e.message);console.error('FAIL',name,e.message)}}
async function child(args){await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});p.on('error',reject);p.on('exit',n=>n===0?resolve():reject(Error('child '+n)))})}
try{
 await child(['node_modules/prisma/build/index.js','db','push','--skip-generate']);db=new PrismaClient();
 mock=http.createServer(async(req,res)=>{
  let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw||'{}'),url=req.url,email=decodeURIComponent(url.split('/').at(-1));let obj,success=true,msg='';const c=clients.get(email);
  if(/clients\/(add|update|del|resetTraffic)|\/(attach|detach)$/.test(url))writes.push(url);
  if(url==='/panel/api/inbounds/list'){if(mode.slowRead)await new Promise(r=>setTimeout(r,1500));if(mode.unavailable){success=false;msg='unavailable'}else obj=[1,2,3].map(id=>{const members=[...clients.values()].filter(c=>c.ids.has(id));return{id,enable:true,nodeId:id===2&&mode.remoteTwo?1:null,tag:'loc-'+id,protocol:'vless',port:4400+id,settings:JSON.stringify({clients:members.map(c=>({...c,used:undefined,ids:undefined}))}),clientStats:members.map(c=>({email:c.email,up:c.used,down:0,total:c.totalGB,expiryTime:c.expiryTime,enable:c.enable})),streamSettings:'{}'}})}
  else if(url==='/panel/api/server/status')obj={panelGuid:'fixture-controller',xray:{state:'running'}};
  else if(url==='/panel/api/nodes/list'){if(mode.dirtyUntil&&Date.now()>=mode.dirtyUntil){mode.dirty=false;mode.dirtyUntil=0;}obj=mode.remoteTwo?[{id:1,enable:true,status:mode.offline?'offline':'online',xrayState:'running',configDirty:mode.dirty,parentGuid:'fixture-controller',lastHeartbeat:Math.floor(Date.now()/1000)}]:[];}
  else if(url==='/panel/api/clients/list')obj=[...clients.values()].map(c=>({...c,used:undefined,ids:undefined}));
  else if(url.startsWith('/panel/api/clients/get/')){if(c)obj={client:{...c,uuid:c.id,used:undefined,ids:undefined},inboundIds:[...c.ids],usedTraffic:c.used};else{success=false;msg='Obtain (record not found)'}}
  else if(url==='/panel/api/clients/add'){const v=body.client;clients.set(v.email,{...v,used:0,ids:new Set(body.inboundIds)});if(mode.pendingCreate)obj={nodePending:true}}
  else if(url.startsWith('/panel/api/clients/update/')){if(c)Object.assign(c,body);else{success=false;msg='client not found'}}
  else if(url.endsWith('/attach')){const target=clients.get(decodeURIComponent(url.split('/').at(-2)));if(target){if(!mode.dropAttach)body.inboundIds.forEach(id=>target.ids.add(id));if(mode.dirty)obj={nodePending:true}}else{success=false;msg='client not found'}}
  else if(url.endsWith('/detach')){const target=clients.get(decodeURIComponent(url.split('/').at(-2)));if(target)body.inboundIds.forEach(id=>target.ids.delete(id));else{success=false;msg='client not found'}}
  else if(url.startsWith('/panel/api/clients/resetTraffic/')){if(c)c.used=0;else{success=false;msg='client not found'}}
  else if(url.startsWith('/panel/api/clients/del/')){if(!mode.deleteAckOnly)clients.delete(email);if(mode.dirtyOnDelete){mode.dirty=true;mode.dirtyUntil=Date.now()+250;}}
  else if(url==='/panel/api/clients/onlines')obj=[];
  else if(url==='/panel/api/clients/lastOnline')obj={};
  else{success=false;msg='unimplemented fixture endpoint'}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success,obj,msg}));
 });await new Promise(r=>mock.listen(0,'127.0.0.1',r));const native='http://127.0.0.1:'+mock.address().port;
 const panel=await db.panelConfig.create({data:{name:'native fixture',baseUrl:native,subBase:native,username:'fixture',password:encryptSecret('fixture'),apiToken:encryptSecret('fixture')}});
 async function owner(username){const r=await db.reseller.create({data:{username,password:hashPassword('MirzaPass123!'),trafficPoolGB:100,multiLocation:true,mirzaEnabled:true}});for(const inboundId of [1,2,3])await db.resellerInbound.create({data:{resellerId:r.id,panelId:panel.id,inboundId,inboundTag:'loc-'+inboundId,protocol:'vless',port:4400+inboundId}});return r}
 async function seed(r,email){const c={id:'uuid-'+email,email,subId:'sub-'+email,totalGB:10*GB,expiryTime:Date.now()+30*86400000,enable:true,limitIp:0,flow:'',used:2*GB,ids:new Set([1])};clients.set(email,c);await db.resellerUser.create({data:{resellerId:r.id,email,subId:c.subId,trafficGB:10,panelId:panel.id,inboundIds:JSON.stringify([{panelId:panel.id,inboundId:1}])}});return c}
 let rep=await owner('mirza_owner');const other=await owner('mirza_other'),existing=await seed(rep,'mirza_existing');await seed(other,'foreign_customer');
 const temp=net.createServer();await new Promise(r=>temp.listen(0,'127.0.0.1',r));const port=temp.address().port;await new Promise(r=>temp.close(r));const base='http://127.0.0.1:'+port;
 const log=createWriteStream(path.join(dir,'next.log'));app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true});app.stdout.pipe(log);app.stderr.pipe(log);
 for(let n=0;n<150;n++){if(app.exitCode!==null)throw Error('Next exited; inspect '+dir);try{if((await fetch(base,{signal:AbortSignal.timeout(3000)})).ok)break}catch{}await new Promise(r=>setTimeout(r,500));if(n===149)throw Error('startup timeout')}
 const cookie=r=>'rp_session='+signAccountSession('RESELLER',r,'dashboard',Date.now()+3600000);
 async function request(route,method='GET',body,headers={}){const r=await fetch(base+route,{method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json().catch(()=>({})),headers:r.headers}}
 const own=(route,method='GET',body)=>request(route,method,body,{Cookie:cookie(rep)});
 let result=await own('/api/reseller/mirza');check('sales bridge does not require a Telegram notification token',()=>{assert.equal(result.status,200);assert.equal(result.data.mirza.enabled,true);assert.equal(result.data.mirza.hasToken,false)});
 result=await request('/api/bridge/'+rep.username+'/login','POST',{username:rep.username,password:'MirzaPass123!'});const legacy=result.data.obj?.token;check('legacy bridge login remains compatible',()=>assert.ok(legacy));
 result=await own('/api/reseller/mirza/api-token','POST',{});const token=result.data.token;
 check('owner can issue a persistent scoped API token for current Mirza',()=>{assert.equal(result.status,200);assert.equal(typeof token,'string');assert.ok(token.length>=32);assert.match(result.headers.get('cache-control')||'',/no-store/)});
 const wireToken=token||legacy;const bridge=(suffix,method='GET',body,key=wireToken,user=rep.username)=>request('/api/bridge/'+encodeURIComponent(user)+'/'+suffix,method,body,{Authorization:'Bearer '+key});
 result=await own('/api/reseller/mirza/api-token');const stored=await db.setting.findMany();check('API token metadata and database never disclose its raw value',()=>{assert.equal(result.status,200);assert.equal(result.data.hasToken,true);assert.ok(token);assert.ok(!JSON.stringify(result.data).includes(token));assert.ok(!JSON.stringify(stored).includes(token))});
 result=await bridge('panel/api/server/status');check('Mirza status probe accepts its Bearer token',()=>{assert.equal(result.status,200);assert.equal(result.data.success,true);assert.equal(result.data.obj.xray.state,'running')});
 result=await bridge('panel/api/clients/get/mirza_existing');check('Mirza direct client read has nested client and membership fields',()=>{assert.equal(result.status,200);assert.equal(result.data.obj?.client?.email,existing.email);assert.equal(result.data.obj.client.totalGB,10*GB);assert.deepEqual(result.data.obj.inboundIds,[1])});
 await own('/api/reseller/users/mirza_existing','PUT',{name:'Existing fixture'});mode.slowRead=true;result=await bridge('panel/api/clients/get/mirza_existing');mode.slowRead=false;check('cold or slower native reads still return the owned sample used for Mirza protocol setup',()=>{assert.equal(result.status,200);assert.equal(result.data.obj?.client?.email,existing.email)});
 result=await bridge('panel/api/clients/traffic/mirza_existing');check('Mirza direct traffic read reports canonical bytes and a lastOnline field',()=>{assert.equal(result.status,200);assert.equal(result.data.obj?.up+result.data.obj?.down,2*GB);assert.equal(typeof result.data.obj.lastOnline,'number')});
 const safeWrites=writes.length;result=await bridge('panel/api/clients/get/foreign_customer');check('direct client read cannot escape reseller ownership',()=>{assert.equal(result.data.success,false);assert.ok(!JSON.stringify(result.data).includes('sub-foreign_customer'));assert.equal(writes.length,safeWrites)});
 result=await bridge('panel/api/clients/traffic/foreign_customer');check('direct traffic read cannot escape reseller ownership',()=>{assert.equal(result.data.success,false);assert.equal(writes.length,safeWrites)});
 const create={inboundIds:[1],client:{email:'mirza_new',totalGB:10*GB,expiryTime:-30*86400000,tgId:0,comment:'fixture order',enable:true,subId:'0123456789abcdef'}};
 result=await bridge('panel/api/clients/add','POST',create);check('native Mirza create payload is accepted once with first-use validity preserved',()=>{assert.equal(result.status,200);assert.equal(result.data.success,true);assert.equal(clients.get('mirza_new')?.expiryTime,-30*86400000);assert.equal(clients.get('mirza_new')?.subId,create.client.subId)});
 mode.pendingCreate=true;result=await bridge('panel/api/clients/add','POST',{...create,client:{...create.client,email:'mirza_pending',subId:'abcdef0000000000',totalGB:GB}});mode.pendingCreate=false;const fundedPending=await db.resellerUser.findFirst({where:{resellerId:rep.id,email:'mirza_pending'}});check('a funded queued Mirza creation is accepted, never misreported as a refundable failed sale',()=>{assert.equal(result.status,200);assert.equal(result.data.success,true);assert.equal(result.data.obj.nodePending,true);assert.equal(fundedPending.trafficGB,1)});await bridge('panel/api/clients/del/mirza_pending','POST',{});
 const writesAfterCreate=writes.length;result=await bridge('panel/api/clients/add','POST',create);const replayCount=await db.resellerUser.count({where:{resellerId:rep.id,email:'mirza_new'}});check('replayed Mirza create cannot charge or create a second customer',()=>{assert.ok([200,400,409].includes(result.status));assert.equal(writes.length,writesAfterCreate);assert.equal(replayCount,1)});
 const future=Date.now()+45*86400000;result=await bridge('panel/api/clients/update/mirza_existing','POST',{email:'mirza_existing',totalGB:20*GB,expiryTime:future,enable:true,tgId:0});check('Mirza renewal preserves UUID, usage and absolute expiry',()=>{assert.equal(result.status,200);assert.equal(result.data.success,true);assert.equal(existing.totalGB,20*GB);assert.equal(existing.expiryTime,future);assert.equal(existing.used,2*GB);assert.equal(existing.id,'uuid-mirza_existing')});
 const beforeOffline=writes.length;mode.remoteTwo=true;mode.offline=true;result=await bridge('panel/api/clients/mirza_existing/attach','POST',{inboundIds:[1,2]});check('offline attach is denied before any new native mutation',()=>{assert.equal(result.data.success,false);assert.equal(writes.length,beforeOffline)});mode.remoteTwo=false;mode.offline=false;
 mode.dropAttach=true;result=await bridge('panel/api/clients/mirza_existing/attach','POST',{inboundIds:[1,2]});const partial=await db.operationJournal.findFirst({where:{resellerId:rep.id,email:existing.email,type:'UPDATE',status:'PARTIAL'}});check('unverified attach preserves a resumable journal and original tracked memberships',()=>{assert.equal(result.data.success,false);assert.ok(partial);assert.match(JSON.parse(partial.metadata).intent,/^BRIDGE_ATTACH:/);assert.equal(partial.reservedGB,0);assert.deepEqual([...existing.ids],[1])});
 const beforeHijack=writes.length;result=await own('/api/reseller/users/mirza_existing','PUT',{trafficGB:20});check('ordinary edits cannot falsely complete an unfinished membership change',()=>{assert.equal(result.status,409);assert.equal(writes.length,beforeHijack)});
 result=await bridge('panel/api/clients/mirza_existing/attach','POST',{inboundIds:[1,3]});check('a partial attach cannot be resumed with a different target',()=>{assert.equal(result.data.success,false);assert.equal(writes.length,beforeHijack)});mode.dropAttach=false;
 result=await bridge('panel/api/clients/mirza_existing/attach','POST',{inboundIds:[1,2]});check('Mirza renewal attach adds every permitted membership without resetting traffic',()=>{assert.equal(result.status,200);assert.equal(result.data.success,true);assert.deepEqual([...existing.ids].sort(),[1,2]);assert.equal(existing.used,2*GB)});
 const finishedAttach=partial?await db.operationJournal.findUnique({where:{id:partial.id}}):null;check('retry finishes the original attach journal without a second reservation',()=>{assert.equal(finishedAttach?.status,'SUCCESS');assert.equal(finishedAttach?.reservedGB,0)});
 mode.remoteTwo=true;mode.dirty=true;result=await bridge('panel/api/clients/mirza_existing/attach','POST',{inboundIds:[1,2,3]});const syncedLater=await db.operationJournal.findFirst({where:{resellerId:rep.id,email:existing.email,type:'UPDATE',status:'PARTIAL'}});check('committed attach reports pending while its native node is dirty',()=>{assert.equal(result.data.success,true);assert.equal(result.data.obj?.nodePending,true);assert.ok(syncedLater);assert.equal(JSON.parse(syncedLater.metadata).localCommitted,true)});
 mode.dirty=false;const beforeCompletedRetry=writes.length;result=await bridge('panel/api/clients/mirza_existing/attach','POST',{inboundIds:[1,2,3]});const afterSync=syncedLater?await db.operationJournal.findUnique({where:{id:syncedLater.id}}):null;check('already attached retry closes its original journal after node synchronization',()=>{assert.equal(result.data.success,true);assert.equal(afterSync?.status,'SUCCESS');assert.equal(writes.length,beforeCompletedRetry)});mode.remoteTwo=false;
 mode.unavailable=true;await new Promise(r=>setTimeout(r,1700));result=await bridge('panel/api/clients/get/mirza_existing');check('missing native data is an error instead of an unlimited zero-traffic customer',()=>assert.equal(result.data.success,false));mode.unavailable=false;await new Promise(r=>setTimeout(r,1700));
 const beforeDenied=writes.length;result=await bridge('panel/api/clients/mirza_existing/attach','POST',{inboundIds:[999]});check('attach cannot add an unassigned location',()=>{assert.equal(result.data.success,false);assert.equal(writes.length,beforeDenied)});
 result=await bridge('panel/api/clients/foreign_customer/attach','POST',{inboundIds:[2]});check('attach cannot mutate another reseller customer',()=>{assert.equal(result.data.success,false);assert.equal(writes.length,beforeDenied)});
 result=await bridge('panel/api/inbounds/add','POST',{});check('API token never grants infrastructure write permission',()=>{assert.equal(result.data.success,false);assert.equal(writes.length,beforeDenied)});
 result=await request('/api/reseller/bootstrap','GET',undefined,{Cookie:'rp_session='+wireToken});check('bridge API token is not a dashboard session',()=>assert.equal(result.status,401));
 result=await bridge('panel/api/clients/list','GET',undefined,wireToken,other.username);check('bridge API token is bound to its reseller URL',()=>assert.equal(result.data.success,false));
 result=await bridge('panel/api/clients/resetTraffic/mirza_existing','POST',{});check('Mirza reset debits consumed quota once',()=>{assert.equal(result.data.success,true);assert.equal(existing.used,0)});
 existing.used=GB;result=await bridge('panel/api/clients/del/mirza_existing','POST',{});const ownerAfterDelete=await db.reseller.findUnique({where:{id:rep.id}});check('Mirza delete preserves all spent traffic as permanent debit',()=>{assert.equal(result.data.success,true);assert.equal(ownerAfterDelete.consumedGB,3);assert.equal(clients.has('mirza_existing'),false)});
 result=await own('/api/reseller/bootstrap');check('Mirza cannot recover spent pool by reset/delete',()=>assert.equal(result.data.permissions.remainingGB,87));
 const settling=await seed(rep,'settling_delete');settling.ids=new Set([1,2]);await db.resellerUser.update({where:{resellerId_email:{resellerId:rep.id,email:settling.email}},data:{inboundIds:JSON.stringify([1,2].map(inboundId=>({panelId:panel.id,inboundId})))}});mode.remoteTwo=true;mode.dirtyOnDelete=true;const deleteWrites=writes.filter(x=>x.includes('/clients/del/')).length;
 result=await bridge('panel/api/clients/del/'+settling.email,'POST',{});const settlingRow=await db.resellerUser.findFirst({where:{resellerId:rep.id,email:settling.email}}),settlingJournal=await db.operationJournal.findFirst({where:{resellerId:rep.id,email:settling.email,type:'DELETE'}});
 check('Mirza waits for an acknowledged deletion to synchronize before reporting success',()=>{assert.equal(result.status,200);assert.equal(result.data.success,true);assert.equal(settlingRow,null);assert.equal(settlingJournal.status,'SUCCESS');assert.equal(settlingJournal.accountingCommitted,true)});
 check('Mirza synchronization confirmation never sends a second native delete',()=>assert.equal(writes.filter(x=>x.includes('/clients/del/')).length,deleteWrites+1));mode.remoteTwo=false;mode.dirtyOnDelete=false;mode.dirty=false;mode.dirtyUntil=0;
 const uncertain=await seed(rep,'unverified_delete');mode.deleteAckOnly=true;result=await bridge('panel/api/clients/del/'+uncertain.email,'POST',{});mode.deleteAckOnly=false;const retained=await db.resellerUser.findFirst({where:{resellerId:rep.id,email:uncertain.email}});
 check('Mirza cannot turn an unverified native acknowledgement into deletion or a refund',()=>{assert.equal(result.data.success,false);assert.ok(retained);assert.equal(retained.trafficGB,10);assert.ok(clients.has(uncertain.email))});
 const beforeInvalid=writes.length;result=await bridge('panel/api/clients/add','POST',{...create,client:{...create.client,email:'fractional_trial',subId:'1111111111111111',totalGB:GB/2}});check('unsupported fractional plans fail without charging or creating native users',()=>{assert.equal(result.data.success,false);assert.equal(writes.length,beforeInvalid)});
 result=await bridge('panel/api/clients/add','POST',{...create,client:{...create.client,email:'fractional_near',subId:'2222222222222222',totalGB:GB+1}});check('fractional bytes are rejected before quota conversion can round them away',()=>{assert.equal(result.data.success,false);assert.equal(writes.length,beforeInvalid)});
 result=await bridge('panel/api/clients/add','POST',{...create,client:{...create.client,email:'mirza.dot',subId:'abcdef0123456789',totalGB:GB}});check('native dotted email stays exact throughout creation',()=>{assert.equal(result.data.success,true);assert.equal(clients.get('mirza.dot')?.email,'mirza.dot')});await bridge('panel/api/clients/del/mirza.dot','POST',{});
 result=await own('/api/reseller/mirza/api-token','POST',{});const rotated=result.data.token;check('owner can rotate the integration API token',()=>{assert.equal(result.status,200);assert.ok(rotated&&rotated!==token)});
 result=await bridge('panel/api/server/status','GET',undefined,token||'missing');check('rotated API token is immediately rejected',()=>assert.equal(result.data.success,false));
 result=await bridge('panel/api/server/status','GET',undefined,rotated||'missing');check('new API token works without any login cookie',()=>assert.equal(result.data.success,true));
 result=await own('/api/reseller/mirza','PUT',{enabled:false,chatId:''});check('owner can disable sales without changing customer records',()=>assert.equal(result.status,200));
 result=await bridge('panel/api/server/status','GET',undefined,rotated||'missing');check('disabled integration rejects its existing API token',()=>assert.equal(result.data.success,false));
 await own('/api/reseller/mirza','PUT',{enabled:true,chatId:''});result=await bridge('panel/api/server/status','GET',undefined,rotated||'missing');check('reenabling integration does not revive the revoked key',()=>assert.equal(result.data.success,false));
 result=await own('/api/reseller/mirza/api-token','POST',{});const passwordKey=result.data.token;rep=await db.reseller.update({where:{id:rep.id},data:{password:hashPassword('ChangedPass123!')}});
 result=await bridge('panel/api/server/status','GET',undefined,passwordKey||'missing');check('account credential changes revoke the old integration key',()=>assert.equal(result.data.success,false));
 result=await own('/api/reseller/mirza/api-token','POST',{});const revoked=result.data.token;await own('/api/reseller/mirza/api-token','DELETE');result=await bridge('panel/api/server/status','GET',undefined,revoked||'missing');check('explicit revocation immediately denies the integration key',()=>assert.equal(result.data.success,false));
 result=await request('/api/reseller/mirza/api-token','POST',{});check('anonymous users cannot issue bridge keys',()=>assert.equal(result.status,401));
 const visualResponse=await fetch(base+'/guide/mirza-bot'),visualHtml=await visualResponse.text();check('public illustrated guide renders without a login or private API credential',()=>{assert.equal(visualResponse.status,200);assert.ok(visualHtml.includes('آموزش تصویری اتصال میرزا'));assert.ok(visualHtml.includes('تصویر مرحله ۱'))});
 if(process.env.PLAYWRIGHT_MODULE){
  const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
   const context=await browser.newContext({viewport:{width:1280,height:950}});await context.addCookies([{name:'rp_session',value:cookie(rep).slice('rp_session='.length),url:base}]);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__mirzaCopied=value}}}));
   await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name:'تنظیمات حساب',exact:true}).click();
   const keyInput=page.getByLabel('توکن API اتصال فروش',{exact:true});await page.getByRole('button',{name:'ساخت توکن API',exact:true}).waitFor();
   const inlineGuide=page.getByTestId('mirza-inline-guide');await inlineGuide.locator('summary').first().click();
   const teaching=inlineGuide.getByTestId('mirza-setup-guide'),beforeTeaching=writes.length;
   for(let index=0;index<10;index++){
    await teaching.getByRole('img',{name:new RegExp('تصویر مرحله '+String(index+1).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)])+':')}).waitFor({state:'visible'});
    if(index<9)await teaching.getByRole('button',{name:'مرحله بعد',exact:true}).click();
   }
   check('inline illustrated tutorial covers all ten steps without native mutations',()=>{assert.equal(writes.length,beforeTeaching)});
   await teaching.getByRole('button',{name:'مرور از ابتدا',exact:true}).click();const beginning=await teaching.getByRole('button',{name:'قبلی',exact:true}).isDisabled();check('tutorial restart and previous-step boundary work',()=>assert.equal(beginning,true));
   await inlineGuide.locator('summary').first().click();
   const notificationValue=await page.getByLabel('توکن تلگرام اعلان‌ها (اختیاری)',{exact:false}).inputValue();check('browser separates sales API key from the optional Telegram credential',()=>assert.equal(notificationValue,''));
   await page.getByRole('button',{name:'ساخت توکن API',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#bridge-api-token')?.value.startsWith('pvnet_bridge_'));
   const uiKey=await keyInput.inputValue(),keyType=await keyInput.getAttribute('type');check('browser can issue a masked sales key without a notification token',()=>{assert.ok(uiKey);assert.equal(keyType,'password')});
   await page.getByRole('button',{name:'کپی توکن API فروش',exact:true}).click();const copied=await page.evaluate(value=>window.__mirzaCopied===value,uiKey);check('copy button provides the issued key without altering the OS clipboard in this test',()=>assert.equal(copied,true));
   await page.screenshot({path:path.join(dir,'mirza-api-key-desktop.png'),fullPage:true});
   await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'تنظیمات حساب',exact:true}).click();await page.getByRole('button',{name:'تعویض توکن API',exact:true}).waitFor();
   const reloaded=await keyInput.inputValue(),persisted=await page.evaluate(value=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]).includes(value),uiKey);check('API secret is shown once and is never persisted in browser storage',()=>{assert.equal(reloaded,'');assert.equal(persisted,false)});
   await page.getByRole('button',{name:'تعویض توکن API',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'انصراف',exact:true}).click();result=await bridge('panel/api/server/status','GET',undefined,uiKey);check('canceling rotation keeps the current integration key usable',()=>assert.equal(result.data.success,true));
   await page.getByRole('button',{name:'تعویض توکن API',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'تأیید تعویض',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#bridge-api-token')?.value.startsWith('pvnet_bridge_'));const uiRotated=await keyInput.inputValue();const oldResponse=await bridge('panel/api/server/status','GET',undefined,uiKey);result=await bridge('panel/api/server/status','GET',undefined,uiRotated);check('confirmed browser rotation revokes only the old key',()=>{assert.notEqual(uiKey,uiRotated);assert.equal(oldResponse.data.success,false);assert.equal(result.data.success,true)});
   await page.getByRole('button',{name:'لغو توکن API',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'تأیید لغو',exact:true}).click();await page.getByRole('button',{name:'ساخت توکن API',exact:true}).waitFor();result=await bridge('panel/api/server/status','GET',undefined,uiRotated);check('browser revocation immediately stops the old robot key',()=>assert.equal(result.data.success,false));
   const tutorialIssued=await own('/api/reseller/mirza/api-token','POST',{});
   const guidePage=await context.newPage();guidePage.on('pageerror',e=>errors.push(e.message));const guideRequests=[];guidePage.on('request',request=>{if(request.url().includes('/api/'))guideRequests.push(request.url())});
   await guidePage.goto(base+'/guide/mirza-bot',{waitUntil:'networkidle'});const publicGuide=guidePage.getByTestId('mirza-setup-guide');
   const stateBeforeGuide=await db.setting.findUnique({where:{key:'bridgeApiToken:'+rep.id}}),writesBeforeGuide=writes.length;
   const navCount=await publicGuide.getByRole('navigation',{name:'انتخاب مرحله آموزش'}).getByRole('button').count();check('public illustrated guide is accessible with ten step controls',()=>assert.equal(navCount,10));
   await publicGuide.getByRole('button',{name:'اتصال دارم؛ ادامه از کاربر نمونه',exact:true}).click();
   await publicGuide.getByRole('heading',{name:'یک کاربر نمونه از پنل خودت بردار',exact:true}).waitFor();
   const namingHelp=await publicGuide.getByLabel('تفاوت نام‌ها').innerText();
   check('existing connections skip key issuance and explain the three distinct names',()=>{assert.ok(namingHelp.includes('نام پنل در میرزا'));assert.ok(namingHelp.includes('نام حساب نمایندگی'));assert.ok(namingHelp.includes('نام کاربری کانفیگ نمونه'));assert.equal(guideRequests.length,0)});
   for(const [index,label] of [[2,'key'],[6,'locations'],[7,'subscription'],[8,'plans']]){
    await publicGuide.getByRole('button',{name:'رفتن به مرحله '+String(index+1).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]),exact:true}).click();
    await publicGuide.screenshot({path:path.join(dir,'mirza-guide-'+label+'-desktop.png')});
   }
   const sampleInstructions=await publicGuide.getByTestId('mirza-guide-step').innerText();check('tutorial explains 1024 MB and hourly trial duration explicitly',()=>{assert.ok(sampleInstructions.includes('۱۰۲۴'));assert.ok(sampleInstructions.includes('ساعت'));assert.ok(sampleInstructions.includes('۲۴'))});
   const sizes=[];for(const width of [390,320]){await guidePage.setViewportSize({width,height:844});for(let index=0;index<10;index++){
    await publicGuide.getByRole('button',{name:'رفتن به مرحله '+String(index+1).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]),exact:true}).click();sizes.push(await guidePage.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth})));
   }}check('every illustrated step fits both 320px and 390px mobile widths',()=>assert.ok(sizes.every(size=>size.content<=size.width+1),JSON.stringify(sizes)));
   await guidePage.setViewportSize({width:390,height:844});await publicGuide.getByRole('button',{name:'رفتن به مرحله ۸',exact:true}).click();await publicGuide.screenshot({path:path.join(dir,'mirza-guide-subscription-mobile.png')});
   await guidePage.evaluate(()=>document.documentElement.classList.add('dark'));await publicGuide.screenshot({path:path.join(dir,'mirza-guide-subscription-dark.png')});
   await publicGuide.locator('summary').click();const troubleshooting=await publicGuide.innerText();const stateAfterGuide=await db.setting.findUnique({where:{key:'bridgeApiToken:'+rep.id}});
   check('guide keeps full sample link and internal username instructions readable',()=>{assert.ok(troubleshooting.includes('نام کاربری ریز'));assert.ok(troubleshooting.includes('لینک کامل'));assert.ok(!troubleshooting.includes(tutorialIssued.data.token))});
   check('tutorial navigation never sends API writes or rotates the real sales key',()=>{assert.equal(writes.length,writesBeforeGuide);assert.deepEqual(stateAfterGuide,stateBeforeGuide);assert.deepEqual(guideRequests,[])});
   await guidePage.close();
   await page.getByRole('button',{name:'تنظیمات حساب',exact:true}).click();await keyInput.waitFor({state:'visible'});
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'mirza-api-key-mobile.png'),fullPage:true});const width=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:innerWidth}));check('Mirza settings fit mobile without page overflow or script errors',()=>{assert.ok(width.content<=width.viewport+1,JSON.stringify(width));assert.deepEqual(errors,[])});
   const cancelNative=await seed(rep,'cancel_ui');cancelNative.ids=new Set([2]);
   await db.resellerUser.update({where:{resellerId_email:{resellerId:rep.id,email:'cancel_ui'}},data:{inboundIds:JSON.stringify([{panelId:panel.id,inboundId:2}])}});
   mode.remoteTwo=true;mode.offline=true;
   result=await own('/api/reseller/users/cancel_ui/reset-traffic','POST',{});assert.equal(result.status,202);
   await page.goto(base,{waitUntil:'networkidle'});
   const cancelButton=page.getByRole('button',{name:'لغو ریست اجرا‌نشدهٔ cancel_ui',exact:true});await cancelButton.waitFor();
   const continueResetEnabled=await page.getByTitle('ادامهٔ ریست ثبت‌شده',{exact:true}).isEnabled();check('a pending reset keeps an explicit continuation action for its owner',()=>assert.equal(continueResetEnabled,true));
   await page.screenshot({path:path.join(dir,'cancel-unstarted-reset-mobile.png'),fullPage:true});
   const cancelledResponse=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes('/cancel_ui/pending-operation'));await cancelButton.click();assert.equal((await cancelledResponse).status(),200);
   await cancelButton.waitFor({state:'hidden'});
   const closedReset=await db.operationJournal.findFirst({where:{resellerId:rep.id,email:'cancel_ui',type:'RESET'}});
   check('owner can cancel an unstarted reset from the actual mobile row without clearing traffic',()=>{assert.equal(closedReset.status,'CANCELLED');assert.equal(closedReset.reservedGB,0);assert.equal(cancelNative.used,2*GB)});
   result=await own('/api/reseller/users/cancel_ui','DELETE');assert.equal(result.status,202);await page.reload({waitUntil:'networkidle'});
   await page.getByRole('button',{name:'لغو درخواست و ویرایش cancel_ui',exact:true}).click();
   const editDialog=page.getByRole('dialog');await editDialog.getByRole('heading',{name:/ویرایش کاربر/}).waitFor();
   const cancelledDelete=await db.operationJournal.findFirst({where:{resellerId:rep.id,email:'cancel_ui',type:'DELETE'}});
   check('owner can move from an offline unstarted deletion directly into the edit form',()=>{assert.equal(cancelledDelete.status,'CANCELLED');assert.equal(cancelNative.used,2*GB)});
   await editDialog.getByLabel('سهمیهٔ کاربر در ویرایش',{exact:true}).fill('20');await editDialog.getByRole('button',{name:'۱ ماه',exact:true}).click();
   const renewalReply=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/api/reseller/users/cancel_ui'));await editDialog.getByRole('button',{name:'ذخیره',exact:true}).click();
   const renewalResponse=await renewalReply;check('the actual renewal form saves after pending-delete cancellation without clearing usage',()=>{assert.ok([200,202].includes(renewalResponse.status()));assert.equal(cancelNative.totalGB,20*GB);assert.equal(cancelNative.used,2*GB)});
  }finally{await browser.close()}
 }
 console.log(JSON.stringify({checks,failures,fixture:dir}));if(failures.length)process.exitCode=1;
}finally{
 if(app){if(process.platform==='win32')await new Promise(resolve=>{const p=spawn('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{windowsHide:true});p.on('exit',resolve)});else app.kill('SIGTERM')}
 if(mock){mock.closeAllConnections();mock.close()}if(db)await db.$disconnect();
}
