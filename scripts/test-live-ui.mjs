// Isolated regression fixture: never use the production DB or a real VPN panel.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'.local-dev',`live-test-${Date.now()}`);mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'test.db'),'');
process.env.DATABASE_URL=`file:../.local-dev/${path.basename(dir)}/test.db`;process.env.APP_SECRET='isolated-live-test-key';
const {PrismaClient}=await import('@prisma/client');
const {hashPassword,encryptSecret,signSession}=await import('../src/lib/crypto.ts');
const GB=1073741824,expiry=2000000000000;let db,app,mock,checks=0,reads=0,delay=2600,fail=false;
const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
async function run(cmd,args){await new Promise((resolve,reject)=>{const c=spawn(cmd,args,{cwd:root,env:process.env,windowsHide:true,stdio:'inherit'});c.on('error',reject);c.on('exit',n=>n===0?resolve():reject(Error('child exit '+n)));});}
try{
 await run(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate']);db=new PrismaClient();
 mock=http.createServer(async(req,res)=>{
  if(req.url==='/control') { let raw='';for await(const x of req)raw+=x;const body=JSON.parse(raw);delay=body.delay??delay;res.end('{}');return; }
  if(req.url==='/panel/api/inbounds/list'){
   reads++;res.writeHead(200,{'Content-Type':'application/json'});res.write('{"success":');
   await new Promise(r=>setTimeout(r,delay));
   res.end(JSON.stringify(!fail)+',"obj":'+JSON.stringify(fail?null:[{id:1,port:443,protocol:'vless',tag:'mock',up:GB,down:2*GB,
    settings:JSON.stringify({clients:[{email:'u1',id:'uuid-u1',totalGB:10*GB,expiryTime:expiry,enable:false},{email:'u2',id:'uuid-u2',totalGB:0,expiryTime:0,enable:true}]}),
    clientStats:[{email:'u1',up:GB,down:2*GB,total:10*GB,expiryTime:expiry,enable:false},{email:'u2',up:0,down:0,total:0,expiryTime:0,enable:true}]}])+',"msg":"mock unavailable"}');return;
  }
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({success:true,obj:[]}));
 });await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const panel=await db.panelConfig.create({data:{name:'Delayed panel',baseUrl:`http://127.0.0.1:${mock.address().port}`,username:'mock',password:encryptSecret('mock'),apiToken:encryptSecret('mock')}});
 const admin=await db.adminUser.create({data:{username:'admin',password:hashPassword('LocalDemo123!')}});
 const owner=await db.reseller.create({data:{username:'live_owner',password:hashPassword('LocalDemo123!'),trafficPoolGB:100}});
 await db.resellerInbound.create({data:{resellerId:owner.id,panelId:panel.id,inboundId:1,inboundTag:'mock',protocol:'vless',port:443}});
 for(const email of ['u1','u2'])await db.resellerUser.create({data:{resellerId:owner.id,email,trafficGB:10,subId:'sub-'+email,panelId:panel.id,inboundIds:JSON.stringify([{panelId:panel.id,inboundId:1}])}});
 const cookie=(role,u)=>'rp_session='+signSession({role,uid:u.id,username:u.username,exp:Date.now()+3600000});const ac=cookie('ADMIN',admin),rc=cookie('RESELLER',owner);
 const portServer=net.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));const base=`http://127.0.0.1:${port}`;
 const log=createWriteStream(path.join(dir,'next.log'));app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true});app.stdout.pipe(log);app.stderr.pipe(log);
 for(let n=0;n<120;n++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(n===119)throw Error('dev startup failed');}
 async function api(url,cookie=ac){const t=performance.now();const r=await fetch(base+url,{headers:cookie?{Cookie:cookie}:{}});return{status:r.status,data:await r.json(),ms:performance.now()-t};}
 for(const route of ['/api/reseller/bootstrap','/api/reseller/live-users','/api/admin/panel-summary','/api/reseller/stats','/api/admin/inbounds'])await api(route,'');
 let r=await api('/api/reseller/bootstrap',rc);
 check('bootstrap must not fake zero usage or unlimited expiry or active state',()=>{assert.equal(r.data.users[0].usedGB,null);assert.equal(r.data.users[0].expiryTime,null);assert.equal(r.data.users[0].enable,null);});
 check('bootstrap never exposes upstream panel identity',()=>{assert.ok(!JSON.stringify(r.data).includes('Delayed panel'));assert.equal(r.data.inbounds[0].panelName,'سرویس');});
 const cold=await Promise.all([api('/api/admin/panel-summary'),api('/api/reseller/live-users',rc),api('/api/reseller/stats',rc),api('/api/admin/inbounds')]);
 check('cold admin and representative reads return promptly while remote body is delayed',()=>{for(const x of cold){assert.ok(x.ms<2200,`read took ${x.ms}ms`);assert.equal(x.data.pending,true);}});
 check('simultaneous admin and representative use one remote snapshot request',()=>assert.equal(reads,1));
 await new Promise(r=>setTimeout(r,3000));
 r=await api('/api/reseller/live-users',rc);const live=r.data.users.find(u=>u.email==='u1');
 check('delayed snapshot eventually reports true nonzero usage, expiration and disabled state',()=>{assert.equal(live.usedGB,3);assert.equal(live.expiryTime,expiry);assert.equal(live.enable,false);assert.equal(r.data.pending,false);});
 const unlimited=r.data.users.find(u=>u.email==='u2');check('known zero usage and unlimited expiry stay legitimate zeros',()=>{assert.equal(unlimited.usedGB,0);assert.equal(unlimited.expiryTime,0);});
 r=await api('/api/admin/panel-summary');check('admin receives real traffic totals and chart after background completion',()=>{assert.equal(r.data.panel.totalUp,GB);assert.equal(r.data.panel.totalDown,2*GB);assert.equal(r.data.trafficByInbound.length,1);assert.equal(r.data.pending,false);});
 check('admin owned-user ledger reports allocation, actual usage and sold-unused once',()=>{const t=r.data.trafficLedger.totals;assert.equal(t.allocatedToResellersGB,100);assert.equal(t.soldToUsersGB,20);assert.equal(t.unsoldGB,80);assert.equal(t.actualUsedGB,3);assert.equal(t.soldButUnusedGB,17);});
 const overview=await api('/api/admin/overview');check('local overview provides inventory without inventing live usage',()=>{assert.equal(overview.data.trafficLedger.totals.soldToUsersGB,20);assert.equal(overview.data.trafficLedger.totals.actualUsedGB,null);});
 const readCount=reads;await Promise.all([api('/api/admin/panel-summary'),api('/api/reseller/live-users',rc)]);check('warm UI reads reuse completed snapshot',()=>assert.equal(reads,readCount));
 const {registerHooks}=await import('node:module');
 const hooks=registerHooks({resolve(s,c,next){return next(s.startsWith('./')&&c.parentURL?.includes('/src/lib/')&&!s.endsWith('.ts')?s+'.ts':s,c);}});
 const {getInbounds}=await import('../src/lib/panel.ts');hooks.deregister();
 const nativeStart=performance.now();const native=await getInbounds({baseUrl:panel.baseUrl,token:'mock'},{timeoutMs:150});check('explicit read timeout covers delayed response body',()=>{assert.equal(native.ok,false);assert.ok(performance.now()-nativeStart<1200);});
 delay=20400;const large=await getInbounds({baseUrl:panel.baseUrl,token:'mock'});check('authoritative large read can finish after the old 20s cutoff',()=>assert.equal(large.ok,true));
 // Config change invalidates display data; failed upstream must not manufacture user state.
 fail=true;delay=0;await db.panelConfig.update({where:{id:panel.id},data:{name:'Unavailable panel'}});
 r=await api('/api/reseller/live-users',rc);check('failed remote read leaves all live fields unknown',()=>{for(const u of r.data.users){assert.equal(u.usedGB,null);assert.equal(u.expiryTime,null);assert.equal(u.enable,null);}});
 check('upstream failure hides panel name and internal message',()=>{const data=JSON.stringify(r.data);assert.ok(!data.includes('Unavailable panel'));assert.ok(!data.includes('mock unavailable'));});
 if(process.env.PLAYWRIGHT_MODULE){
  const {pathToFileURL}=await import('node:url');const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
   const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'rp_session',value:ac.slice(11),url:base}]);
   const page=await context.newPage();await page.goto(base);await page.getByRole('button',{name:'به‌روزرسانی',exact:true}).waitFor();
   await page.screenshot({path:path.join(dir,'admin-traffic-desktop.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'admin-traffic-mobile.png'),fullPage:true});
   const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
   check('admin dashboard fits mobile viewport',()=>assert.ok(width.scroll<=width.client+1,JSON.stringify(width)));
   await context.clearCookies();await page.getByRole('button',{name:'به‌روزرسانی',exact:true}).click();
   await page.getByRole('button',{name:'ورود به پنل',exact:true}).waitFor({timeout:15000});
   check('expired session leaves stale dashboard and returns to login',()=>assert.ok(true));
   await page.screenshot({path:path.join(dir,'session-expired-login.png'),fullPage:true});
   await context.addCookies([{name:'rp_session',value:rc.slice(11),url:base}]);
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await page.getByRole('button',{name:'کاربران من',exact:true}).waitFor({timeout:15000});
   check('changed cookie role mounts actual representative session',()=>assert.ok(true));
   assert.ok(!(await page.locator('body').innerText()).includes('Delayed panel'));
   check('representative page hides upstream identity',()=>assert.ok(true));
   await context.close();
  }finally{await browser.close();}
 }
 fail=false;await db.panelConfig.update({where:{id:panel.id},data:{name:'Delayed panel'}});delay=2600;
 delay=7000;
 writeFileSync(path.join(root,'.local-dev/live-ui.json'),JSON.stringify({base,cookie:ac,representativeCookie:rc,fixtureDir:dir,mockBase:panel.baseUrl}));
 console.log(`LIVE REGRESSION PASS ${checks}; fixture ${base}`);
 if(process.argv.includes('--keep')){console.log('UI_READY');await new Promise(r=>process.stdin.once('data',r));}
}catch(e){console.error(e);console.error('Fixture logs:',dir);process.exitCode=1;}
finally{if(app){if(process.platform==='win32')await run('taskkill.exe',['/PID',String(app.pid),'/T','/F']).catch(()=>{});else app.kill('SIGTERM');}if(mock)mock.close();if(db)await db.$disconnect();}
