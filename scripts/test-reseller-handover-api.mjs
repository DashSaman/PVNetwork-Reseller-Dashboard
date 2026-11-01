// All remote writes target loopback mocks and an isolated SQLite database only.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=realpathSync(process.cwd()),dir=path.join(root,'.local-dev','handover-'+Date.now());mkdirSync(dir,{recursive:true});
process.chdir(root);writeFileSync(path.join(dir,'test.db'),'');
process.env.DATABASE_URL='file:../.local-dev/'+path.basename(dir)+'/test.db';process.env.APP_SECRET='isolated-lifecycle-secret';
// This unattended, isolated fixture cannot answer interactive CLI upgrade prompts.
process.env.CI='1';process.env.__NEXT_AGENT_UPGRADE='security';
const {PrismaClient}=await import('@prisma/client');const {encryptSecret,hashPassword,signAccountSession}=await import('../src/lib/crypto.ts');
const GB=1024**3,clients=new Map(),mode=new Map();const nativeWrites=[];let db,app,server,checks=0;const failures=[];
function check(name,fn){try{fn();checks++;console.log('PASS',name)}catch(e){failures.push(name+': '+e.message);console.error('FAIL',name,e.message)}}
const key=(p,e)=>p+':'+e;
function inbound(p,id){const members=[...clients.entries()].filter(([k,c])=>k.startsWith(p+':')&&c.ids.has(id)).map(([,c])=>c);return {id,tag:'loc-'+id,port:4400+id,protocol:'vless',settings:JSON.stringify({clients:members.map(c=>({...c,uuid:undefined,ids:undefined,used:undefined}))}),clientStats:members.map(c=>({email:c.email,up:c.used,down:0,total:c.totalGB,enable:c.enable,expiryTime:c.expiryTime})),streamSettings:'{}'};}
async function child(args){await new Promise((resolve,reject)=>{const c=spawn(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});c.on('error',reject);c.on('exit',n=>n===0?resolve():reject(Error('child '+n)))})}
try{
 await child(['node_modules/prisma/build/index.js','db','push','--skip-generate']);db=new PrismaClient();
 server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw||'{}');const p=req.url.startsWith('/b/')?'b':'a',url=req.url.replace(/^\/[ab]/,'');let success=true,obj,msg='';
  if(/clients\/(add|update|del|resetTraffic)/.test(url))nativeWrites.push(url);
  const email=decodeURIComponent(url.split('/').at(-1)),c=clients.get(key(p,email)),m=mode.get(email)||{};
  if(url==='/panel/api/inbounds/list'){if(mode.get('delay'))await new Promise(r=>setTimeout(r,1500));obj=[1,2,3].map(id=>inbound(p,id));}
  else if(url==='/panel/api/clients/list')obj=[...clients.entries()].filter(([k])=>k.startsWith(p+':')).map(([,c])=>c);
  else if(url.startsWith('/panel/api/clients/get/')){if(c)obj={client:{...c,uuid:c.id,ids:undefined,used:undefined},inboundIds:[...c.ids],usedTraffic:c.used};else{success=false;msg='Obtain (record not found)'}}
  else if(url==='/panel/api/clients/add'){const v=body.client;clients.set(key(p,v.email),{...v,used:0,ids:new Set((mode.get('partial-add')?body.inboundIds.slice(0,1):body.inboundIds))});if(mode.get('node-pending'))obj={nodePending:true};}
  else if(url.endsWith('/attach')){const e=decodeURIComponent(url.split('/').at(-2));const target=clients.get(key(p,e));if(target)body.inboundIds.forEach(id=>target.ids.add(id));else{success=false;msg='client not found'}if(mode.get('node-pending'))obj={nodePending:true};}
  else if(url.startsWith('/panel/api/clients/update/')){if(c)Object.assign(c,body);else{success=false;msg='client not found'}}
  else if(url.startsWith('/panel/api/clients/del/')){if(m.deleteAckOnly){}else if(m.badMissing){success=false;msg='API route not found'}else if(m.failB&&p==='b'){success=false;msg='temporarily unavailable'}else clients.delete(key(p,email));}
  else if(url.startsWith('/panel/api/clients/resetTraffic/')){if(c){c.used=0;m.resets=(m.resets||0)+1;if(m.loseResetResponse){m.loseResetResponse=false;success=false;msg='connection closed after reset'}}}
  else if(url==='/panel/api/clients/onlines')obj=[];
  else{success=false;msg='unimplemented fixture route'}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success,obj,msg}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const native='http://127.0.0.1:'+server.address().port;
 const panel=await db.panelConfig.create({data:{name:'mock',baseUrl:native+'/a',subBase:native,username:'mock',password:encryptSecret('mock'),apiToken:encryptSecret('mock')}});
 const tmp=net.createServer();await new Promise(r=>tmp.listen(0,'127.0.0.1',r));const port=tmp.address().port;await new Promise(r=>tmp.close(r));const base='http://127.0.0.1:'+port;
 const log=createWriteStream(path.join(dir,'next.log'));app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true});app.stdout.pipe(log);app.stderr.pipe(log);
 for(let n=0;n<150;n++){if(app.exitCode!==null)throw Error('Next exited during startup; inspect fixture next.log');try{if((await fetch(base,{signal:AbortSignal.timeout(3000)})).ok)break}catch{}await new Promise(r=>setTimeout(r,500));if(n===149)throw Error('startup timeout')}
 async function owner(name,pool=100){const r=await db.reseller.create({data:{username:name,password:hashPassword('test'),trafficPoolGB:pool,multiLocation:true}});for(const id of [1,2,3])await db.resellerInbound.create({data:{resellerId:r.id,panelId:panel.id,inboundId:id,inboundTag:'loc-'+id,protocol:'vless',port:4400+id}});return r}
 async function seed(r,email,used=0,extraPanel){const refs=[{panelId:panel.id,inboundId:1},...(extraPanel?[{panelId:extraPanel.id,inboundId:1}]:[])];const v={id:'uuid-'+email,email,subId:'sub-'+email,totalGB:10*GB,expiryTime:Date.now()+86400000*30,enable:true,limitIp:0,flow:'',used:used*GB,ids:new Set([1])};clients.set(key('a',email),v);if(extraPanel)clients.set(key('b',email),{...v,used:2*GB,ids:new Set([1])});await db.resellerUser.create({data:{resellerId:r.id,email,subId:v.subId,trafficGB:10,panelId:panel.id,inboundIds:JSON.stringify(refs)}});return v}
 async function api(r,route,method='GET',body){const cookie='rp_session='+signAccountSession('RESELLER',r,'dashboard',Date.now()+3600000);const response=await fetch(base+route,{method,headers:{Cookie:cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()}}

 const admin=await db.adminUser.create({data:{username:'handover_admin',password:hashPassword('Admin123!')}});
 const adminCookie='rp_session='+signAccountSession('ADMIN',admin,'dashboard',Date.now()+3600000);
 async function adminApi(route,method='GET',body,cookie=adminCookie){const r=await fetch(base+route,{method,headers:{Cookie:cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json().catch(()=>null)}}
 const source=await owner('handover_source');const first=await seed(source,'handover_first',2);const second=await seed(source,'handover_second',1);
 await db.reseller.update({where:{id:source.id},data:{mirzaEnabled:true}});
 const unrelated=await owner('unrelated');await seed(unrelated,'unrelated_live',3);
 const originalRows=await db.resellerUser.findMany({where:{resellerId:source.id},orderBy:{id:'asc'}});
 const snapshot=JSON.stringify([...clients].map(([k,v])=>[k,{...v,ids:[...v.ids]}]));
 const overviewBefore=await adminApi('/api/admin/overview');
 let preview=await adminApi('/api/admin/resellers/'+source.id);
 check('remove preview lists both current accounts and a signed handover token',()=>{assert.equal(preview.status,200);assert.equal(preview.data.reseller.users.length,2);assert.equal(typeof preview.data.handover?.token,'string')});
 let result=await adminApi('/api/admin/resellers/'+source.id,'DELETE');check('plain deletion still cannot orphan existing native clients',()=>assert.equal(result.status,409));
 const route='/api/admin/resellers/'+source.id+'/handover';
 result=await adminApi(route,'POST',{},'');check('anonymous handover denied',()=>assert.equal(result.status,401));
 const repCookie='rp_session='+signAccountSession('RESELLER',source,'dashboard',Date.now()+3600000);
 result=await adminApi(route,'POST',{},repCookie);check('reseller cannot transfer itself to escape accounting',()=>assert.equal(result.status,401));
 result=await adminApi(route,'POST',{confirmUsername:'wrong',token:preview.data.handover?.token});check('handover requires exact typed source identity',()=>assert.equal(result.status,400));
 const extra=await seed(source,'added_after_preview',0);
 result=await adminApi(route,'POST',{confirmUsername:source.username,token:preview.data.handover?.token});check('changed user list rejects a stale confirmation',()=>assert.equal(result.status,409));
 await db.resellerUser.deleteMany({where:{resellerId:source.id,email:extra.email}});clients.delete(key('a',extra.email));
 const operation=await db.operationJournal.create({data:{resellerId:source.id,email:first.email,type:'CREATE',status:'NEEDS_REPAIR',idempotencyKey:'handover-block-fixture',reservedGB:2}});
 preview=await adminApi('/api/admin/resellers/'+source.id);
 result=await adminApi(route,'POST',{confirmUsername:source.username,token:preview.data.handover?.token});check('unknown incomplete work blocks handover without releasing reservations',()=>{assert.equal(result.status,409)});
 await db.operationJournal.delete({where:{id:operation.id}});
 preview=await adminApi('/api/admin/resellers/'+source.id);const confirmation={confirmUsername:source.username,token:preview.data.handover?.token};
 result=await adminApi(route,'POST',confirmation);check('admin can remove a reseller by handing all existing users to admin management',()=>{assert.equal(result.status,200);assert.equal(result.data.managedUsers,2)});
 const closed=await db.reseller.findUnique({where:{id:source.id}});
 check('closed ownership retains accounting and disables reseller access',()=>{assert.equal(closed.active,false);assert.equal(closed.trafficPoolGB,source.trafficPoolGB);assert.equal(closed.consumedGB,source.consumedGB)});
 const afterRows=await db.resellerUser.findMany({where:{resellerId:source.id},orderBy:{id:'asc'}});check('handover preserves every tracked user field and native identity/limits/counters',()=>{assert.deepEqual(afterRows,originalRows);assert.equal(JSON.stringify([...clients].map(([k,v])=>[k,{...v,ids:[...v.ids]}])),snapshot);assert.equal(nativeWrites.length,0)});

 result=await adminApi('/api/admin/resellers');check('closed reseller disappears from active reseller management',()=>assert.ok(!result.data.resellers.some(r=>r.id===source.id)));
 result=await adminApi('/api/admin/overview');check('active reseller count excludes the closed group while total users and ledger remain intact',()=>{assert.equal(result.data.stats.resellers,1);assert.equal(result.data.stats.users,3);assert.equal(result.data.charts.resellersBreakdown.find(r=>r.name==='تحت مدیریت ادمین').users,2);assert.deepEqual(result.data.trafficLedger.totals,overviewBefore.data.trafficLedger.totals)});
 result=await adminApi('/api/admin/users','GET',undefined,'');check('anonymous access cannot list global users',()=>assert.equal(result.status,401));
 result=await adminApi('/api/admin/users','GET',undefined,repCookie);check('reseller access cannot list global users',()=>assert.equal(result.status,401));
 result=await adminApi('/api/admin/users');check('admin can see all accounts and both transferred users with their source',()=>{assert.equal(result.status,200);assert.equal(result.data.users.length,3);assert.equal(result.data.users.filter(u=>u.adminManaged).length,2);assert.ok(result.data.users.every(u=>u.usedGB===null));assert.ok(result.data.users.filter(u=>u.adminManaged).every(u=>u.sourceUsername===source.username))});
 result=await adminApi('/api/admin/users?live=1');check('transferred users retain live usage expiry and status in the administrator view',()=>{assert.equal(result.status,200);const u=result.data.users.find(u=>u.email===first.email);assert.equal(u.usedGB,2);assert.equal(u.expiryTime,first.expiryTime);assert.equal(u.enable,true)});
 first.used=NaN;await db.panelConfig.update({where:{id:panel.id},data:{name:'invalid-counter-snapshot'}});
 result=await adminApi('/api/admin/users?live=1');check('malformed live counters remain unknown instead of appearing as zero usage',()=>assert.equal(result.data.users.find(u=>u.email===first.email).usedGB,null));
 first.used=2*GB;await db.panelConfig.update({where:{id:panel.id},data:{name:'valid-counter-snapshot'}});
 result=await adminApi(route,'POST',confirmation);check('handover retry is idempotent',()=>{assert.equal(result.status,200);assert.equal(result.data.alreadyTransferred,true)});
 result=await adminApi('/api/reseller/bootstrap','GET',undefined,repCookie);check('old reseller session is revoked by handover',()=>assert.equal(result.status,401));
 result=await adminApi('/api/admin/resellers/'+source.id,'PUT',{active:true});check('admin ordinary edit cannot reactivate a closed ownership group',()=>assert.equal(result.status,409));
 await db.reseller.update({where:{id:source.id},data:{active:true}});
 result=await adminApi('/api/reseller/bootstrap','GET',undefined,repCookie);check('ownership marker prevents session access even after an accidental active-flag change',()=>assert.equal(result.status,401));
 result=await adminApi('/api/auth/login','POST',{username:source.username,password:'test'},'');check('ownership marker also prevents fresh reseller login',()=>assert.equal(result.status,403));
 result=await adminApi('/api/bridge/'+source.username+'/login','POST',{username:source.username,password:'test'},'');check('ownership marker prevents fresh bridge login after an accidental active-flag change',()=>assert.equal(result.data.success,false));
 await db.reseller.update({where:{id:source.id},data:{active:false}});
 const sub=await fetch(base+'/api/s/'+first.subId+'?format=json');const subscription=await sub.json();check('existing subscription survives closed reseller and retains current quota and expiry',()=>{assert.equal(sub.status,200);assert.equal(subscription.totalGB,10);assert.equal(subscription.expiryTime,first.expiryTime);assert.equal(subscription.links.length,1)});
 check('handover and verification made no native mutation call',()=>assert.equal(nativeWrites.length,0));
 if(process.env.PLAYWRIGHT_MODULE){
  const {chromium}=await import(path.isAbsolute(process.env.PLAYWRIGHT_MODULE)?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:process.env.PLAYWRIGHT_MODULE);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
   const context=await browser.newContext({viewport:{width:1440,height:1000}});
   await context.addCookies([{name:'rp_session',value:adminCookie.slice('rp_session='.length),url:base}]);
   const page=await context.newPage();const browserErrors=[];page.on('pageerror',e=>browserErrors.push(e.message));
   await page.goto(base);await page.getByRole('button',{name:'نماینده‌ها',exact:true}).click();
   await page.getByRole('button',{name:'حذف نماینده unrelated',exact:true}).click();
   const dialog=page.getByRole('dialog');await dialog.getByText('unrelated_live',{exact:true}).first().waitFor();
   const confirm=dialog.getByRole('button',{name:'انتقال کاربران و حذف نماینده',exact:true});
   check('browser shows current users and prevents an unconfirmed handover',()=>{assert.equal(browserErrors.length,0)});
   assert.equal(await confirm.isDisabled(),true);
   await dialog.getByRole('button',{name:'انصراف',exact:true}).click();
   check('browser cancellation leaves source account and users unchanged',()=>assert.equal(nativeWrites.length,0));
   assert.equal((await db.reseller.findUnique({where:{id:unrelated.id}})).active,true);
   await page.getByRole('button',{name:'حذف نماینده unrelated',exact:true}).click();
   await page.getByLabel('نام کاربری نماینده برای تأیید').fill(unrelated.username);
   const accepted=page.waitForResponse(r=>r.url().endsWith('/'+unrelated.id+'/handover')&&r.request().method()==='POST');
   await page.getByRole('dialog').getByRole('button',{name:'انتقال کاربران و حذف نماینده',exact:true}).click();
   assert.equal((await accepted).status(),200);
   await page.getByRole('dialog').waitFor({state:'hidden'});
   check('browser transfers through the confirmed action without native mutations',()=>assert.equal(nativeWrites.length,0));
   await page.getByRole('button',{name:'کاربران',exact:true}).click();
   await page.getByLabel('فیلتر مالک کاربران').selectOption('admin');
   await page.getByText('unrelated_live',{exact:true}).first().waitFor();
   check('admin users browser view includes transferred source accounts',()=>{assert.equal(browserErrors.length,0)});
   await page.screenshot({path:path.join(dir,'admin-users-desktop.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:path.join(dir,'admin-users-mobile.png'),fullPage:true});
   const size=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:innerWidth}));
   check('admin users mobile view contains table scrolling within viewport',()=>assert.ok(size.content<=size.viewport+1,JSON.stringify(size)));
   check('browser completed without client-side errors',()=>assert.deepEqual(browserErrors,[]));
  }finally{await browser.close()}
 }
 console.log(JSON.stringify({checks,failures,fixture:dir}));if(failures.length)process.exitCode=1;
}catch(e){console.error(e);console.error('Fixture:',dir);process.exitCode=1}
finally{if(app){if(process.platform==='win32')await new Promise(resolve=>{const p=spawn('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{windowsHide:true});p.on('exit',resolve)});else app.kill('SIGTERM')}if(server){server.closeAllConnections();server.close()}if(db)await db.$disconnect()}
