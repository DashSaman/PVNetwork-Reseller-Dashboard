// Disposable red/green audit fixture. Every remote destination is a loopback mock.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
const root=process.cwd(), dir=path.join(root,'.local-dev','audit-'+Date.now());
mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'test.db'),'');
process.env.DATABASE_URL='file:../.local-dev/'+path.basename(dir)+'/test.db';
process.env.APP_SECRET='isolated-panel-audit-key';process.env.CI='1';process.env.__NEXT_AGENT_UPGRADE='security';
const {PrismaClient}=await import('@prisma/client');
const cryptoApi=await import(pathToFileURL(path.join(root,'src/lib/crypto.ts')));
const {encryptSecret,hashPassword,signSession}=cryptoApi;
const GB=1024**3, clients=new Map(), requests=[];let db,app,mock,checks=0,holdRotation,loseRotationReply=false;const failures=[];
function check(name,fn){try{fn();checks++;console.log('PASS',name)}catch(e){failures.push({name,message:e.message});console.error('FAIL',name,e.message)}}
async function run(args){await new Promise((resolve,reject)=>{const c=spawn(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});c.on('error',reject);c.on('exit',n=>n===0?resolve():reject(Error('child '+n)));})}
try{
 await run(['node_modules/prisma/build/index.js','db','push','--skip-generate']);db=new PrismaClient();
 mock=http.createServer(async(req,res)=>{
  let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw||'{}'),url=req.url;
  requests.push({url,body});let obj,success=true,msg='';
  const email=decodeURIComponent(url.split('/').at(-1)),c=clients.get(email);
  if(url==='/panel/api/inbounds/list')obj=[1,2].map(id=>({id,tag:'loc-'+id,port:4400+id,protocol:'vless',settings:JSON.stringify({clients:[...clients.values()].filter(v=>v.ids.has(id)).map(v=>({...v,ids:undefined,used:undefined}))}),streamSettings:JSON.stringify({network:'tcp',security:'reality',realitySettings:{privateKey:'PRIVATE-FIXTURE-SENTINEL',settings:{publicKey:'PUBLIC-FIXTURE-KEY'}}}),clientStats:[...clients.values()].filter(v=>v.ids.has(id)).map(v=>({email:v.email,up:v.used,down:0,total:v.totalGB,expiryTime:v.expiryTime,enable:v.enable}))}));
  else if(url.startsWith('/panel/api/clients/get/')){if(c)obj={client:{...c,uuid:c.id,ids:undefined,used:undefined},inboundIds:[...c.ids],usedTraffic:c.used};else{success=false;msg='Obtain (record not found)'}}
  else if(url.startsWith('/panel/api/clients/update/')){if(c){const rotating=body.subId&&body.subId!==c.subId;if(holdRotation && rotating){const hold=holdRotation;holdRotation=null;hold.reached();await hold.promise;}Object.assign(c,body);if(rotating&&loseRotationReply){loseRotationReply=false;success=false;msg='lost reply after native update';}}else{success=false;msg='client not found'}}
  else if(url==='/panel/api/clients/onlines')obj=[];
  else if(url==='/panel/api/clients/list')obj=[...clients.values()];
  else{success=false;msg='unimplemented fixture route '+url}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success,obj,msg}));
 });await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const panel=await db.panelConfig.create({data:{name:'mock',baseUrl:'http://127.0.0.1:'+mock.address().port,username:'mock',password:encryptSecret('mock'),apiToken:encryptSecret('mock')}});
 const admin=await db.adminUser.create({data:{username:'audit_admin',password:hashPassword('AuditPass123!')}});
 const rep=await db.reseller.create({data:{username:'audit_rep',name:'Keep this name',password:hashPassword('AuditPass123!'),trafficPoolGB:100,multiLocation:true,mirzaEnabled:true}});
 await db.resellerInbound.create({data:{resellerId:rep.id,panelId:panel.id,inboundId:1,inboundTag:'loc-1',protocol:'vless',port:4401}});
 const user={id:'uuid-edit',email:'edit',subId:'edit-sub-id-123456',totalGB:10*GB,expiryTime:Date.now()+30*86400000,enable:false,limitIp:3,flow:'xtls-rprx-vision',reset:7,used:GB,ids:new Set([1])};clients.set(user.email,user);
 await db.resellerUser.create({data:{resellerId:rep.id,email:user.email,subId:user.subId,trafficGB:10,panelId:panel.id,inboundIds:JSON.stringify([{panelId:panel.id,inboundId:1}])}});
 const tmp=net.createServer();await new Promise(r=>tmp.listen(0,'127.0.0.1',r));const port=tmp.address().port;await new Promise(r=>tmp.close(r));const base='http://127.0.0.1:'+port;
 const log=createWriteStream(path.join(dir,'next.log'));app=spawn(process.execPath,['node_modules/next/dist/bin/next',...(process.env.AUDIT_FIXTURE_PRODUCTION==='1'?['start']:['dev','--webpack']),'--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true});app.stdout.pipe(log);app.stderr.pipe(log);
 for(let n=0;n<150;n++){if(app.exitCode!==null)throw Error('Next exited; inspect '+dir);try{if((await fetch(base,{signal:AbortSignal.timeout(3000)})).ok)break}catch{}await new Promise(r=>setTimeout(r,500));if(n===149)throw Error('startup timeout')}
 const cookie=(role,u)=>'rp_session='+(cryptoApi.signAccountSession?cryptoApi.signAccountSession(role,u,'dashboard',Date.now()+3600000):signSession({role,uid:u.id,username:u.username,exp:Date.now()+3600000}));let ac=cookie('ADMIN',admin),rc=cookie('RESELLER',rep);
 async function api(route,method='GET',body,ck=rc){const r=await fetch(base+route,{method,headers:{'content-type':'application/json',...(ck?{Cookie:ck}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 const bridge=await api('/api/bridge/'+rep.username+'/login','POST',{username:rep.username,password:'AuditPass123!'},'');
 check('enabled bridge authenticates using its own password flow',()=>{assert.equal(bridge.status,200);assert.ok(bridge.data.obj?.token)});
 const bridgeToken=bridge.data.obj?.token;
 let r=await api('/api/reseller/bootstrap','GET',undefined,'rp_session='+bridgeToken);
 check('bridge token cannot be replayed as dashboard authentication',()=>assert.equal(r.status,401));
 const bridgeList=await fetch(base+'/api/bridge/'+rep.username+'/panel/api/inbounds/list',{headers:{Authorization:'Bearer '+bridgeToken}});
 const bridgeData=await bridgeList.json();check('bridge keeps private native stream keys out of reseller output',()=>{assert.equal(bridgeData.success,true);assert.ok(!JSON.stringify(bridgeData).includes('PRIVATE-FIXTURE-SENTINEL'));assert.ok(JSON.stringify(bridgeData).includes('PUBLIC-FIXTURE-KEY'))});
 const noKey=spawnSync(process.execPath,['-e','require("./scripts/runtime-secret.cjs").runtimeSecret()'],{cwd:root,env:{...process.env,NODE_ENV:'production',APP_SECRET:'',DATABASE_URL:'file:'+path.join(dir,'missing-key.db')},windowsHide:true,encoding:'utf8'});
 check('production without a signing key fails closed',()=>assert.notEqual(noKey.status,0));
 r=await api('/api/reseller/users/edit','PUT',{name:'renamed'});
 check('name-only user edit preserves device, expiry, disable and connection settings',()=>{assert.equal(r.status,200);assert.equal(user.limitIp,3);assert.equal(user.enable,false);assert.equal(user.reset,7);assert.equal(user.flow,'xtls-rprx-vision')});
 r=await api('/api/admin/resellers/'+rep.id,'PUT',{trafficPoolGB:101},ac);
 check('pool-only reseller edit preserves display name',()=>{assert.equal(r.status,200)});
 const refreshed=await db.reseller.findUnique({where:{id:rep.id}});check('reseller display name was retained',()=>assert.equal(refreshed.name,'Keep this name'));
 r=await api('/api/admin/resellers','POST',{username:'no_brand',password:'Fixture123!',allowWhitelabel:false,trafficPoolGB:10,inbounds:[{panelId:panel.id,inboundId:1}]},ac);
 check('reseller creation persists an explicitly disabled whitelabel permission',()=>assert.equal(r.status,200));
 const noBrand=await db.reseller.findUnique({where:{username:'no_brand'}});check('new reseller has no whitelabel permission',()=>assert.equal(noBrand.allowWhitelabel,false));
 const resetReservation=await db.operationJournal.create({data:{idempotencyKey:'audit-reset-reserve',resellerId:rep.id,email:'reserved-fixture',type:'RESET',status:'PARTIAL',reservedGB:2}});
 r=await api('/api/admin/overview','GET',undefined,ac);const ledger=r.data.trafficLedger.resellers.find(x=>x.id===rep.id);
 check('admin ledger includes outstanding reset reservations',()=>{assert.equal(ledger.reservedGB,2);assert.equal(ledger.unsoldGB,89)});await db.operationJournal.delete({where:{id:resetReservation.id}});
 r=await api('/api/reseller/users/edit','PUT',{ipLimit:7});check('explicit permitted device limit applies',()=>{assert.equal(r.status,200);assert.equal(user.limitIp,7)});
 await db.reseller.update({where:{id:rep.id},data:{allowIpLimit:false}});
 r=await api('/api/reseller/users/edit','PUT',{ipLimit:99});check('device-limit permission cannot be bypassed by direct user update',()=>{assert.ok([400,403].includes(r.status));assert.equal(user.limitIp,7)});
 await db.reseller.update({where:{id:rep.id},data:{active:false}});
 r=await api('/api/reseller/2fa');check('disabled reseller session cannot reach security settings',()=>assert.ok([401,403].includes(r.status)));
 r=await api('/api/auth/me');check('disabled reseller disappears from current session',()=>assert.equal(r.data.user,null));
 await db.reseller.update({where:{id:rep.id},data:{active:true,allowIpLimit:true}});
 let releaseRotation,reachedRotation;const rotationReached=new Promise(r=>reachedRotation=r);
 holdRotation={promise:new Promise(r=>releaseRotation=r),reached:reachedRotation};
 const rotation=api('/api/reseller/users/edit/reset-sub','POST',{});
 await Promise.race([rotationReached,new Promise((_,reject)=>setTimeout(()=>reject(Error('rotation never reached controlled write')),15000).unref())]);
 const edit=api('/api/reseller/users/edit','PUT',{trafficGB:5});
 // Correct implementations serialize the edit behind rotation. Release after it queues.
 await new Promise(r=>setTimeout(r,700));releaseRotation();
 const results=await Promise.all([rotation,edit]);
 check('subscription rotation cannot replay stale quota over a concurrent reduction',()=>{assert.equal(results[0].status,200);assert.ok([200,409].includes(results[1].status));const expected=results[1].status===200?5:10;assert.equal(user.totalGB,expected*GB)});
 const stableQuota=user.totalGB,oldSub=user.subId;loseRotationReply=true;
 r=await api('/api/reseller/users/edit/reset-sub','POST',{});
 check('lost rotation reply remains partial and does not publish a new local subscription',()=>{assert.equal(r.status,502);assert.equal(r.data.partial,true)});
 const pending=await db.operationJournal.findFirst({where:{resellerId:rep.id,email:'edit',status:'PARTIAL',type:'UPDATE'}});const plannedSub=JSON.parse(pending.metadata).newSubId;
 check('partial rotation stores one absolute subscription target',()=>{assert.notEqual(plannedSub,oldSub);assert.equal(user.subId,plannedSub)});
 r=await api('/api/reseller/users/edit','PUT',{trafficGB:5});check('partial rotation blocks quota edits until reconciled',()=>assert.equal(r.status,409));
 r=await api('/api/reseller/users/edit/reset-sub','POST',{});
 check('rotation retry completes the same target and preserves native quota and device state',()=>{assert.equal(r.status,200);assert.equal(r.data.subId,plannedSub);assert.equal(user.totalGB,stableQuota);assert.equal(user.limitIp,7)});
 r=await api('/api/reseller/users/edit','PUT',{trafficGB:5.5});check('fractional quota cannot mutate native state before integer database validation',()=>{assert.equal(r.status,403);assert.equal(user.totalGB,stableQuota)});
 r=await api('/api/reseller/users/edit','PUT',{expiryDate:'not-a-date'});check('invalid expiration is rejected before native writes',()=>{assert.equal(r.status,400);assert.equal(user.totalGB,stableQuota)});
 r=await api('/api/reseller/account','POST',{currentPassword:'AuditPass123!',newPassword:'ChangedPass123!'});check('password change succeeds',()=>assert.equal(r.status,200));
 r=await api('/api/auth/me');check('old reseller cookie is revoked after password change',()=>assert.equal(r.data.user,null));
 // Re-login creates a current credential-bound session when implemented.
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:rep.username,password:'ChangedPass123!'})});rc=login.headers.get('set-cookie')?.split(';')[0]||rc;
 await db.reseller.update({where:{id:rep.id},data:{totpEnabled:true,totpSecret:encryptSecret('JBSWY3DPEHPK3PXP')}});
 rc=cookie('RESELLER',await db.reseller.findUnique({where:{id:rep.id}}));
 r=await api('/api/reseller/2fa','POST',{action:'setup'});
 check('TOTP setup cannot silently disable an already enabled second factor',()=>assert.ok([400,403,409].includes(r.status)));
 const factor=await db.reseller.findUnique({where:{id:rep.id}});check('enabled second factor remains enabled after rejected setup',()=>assert.equal(factor.totpEnabled,true));
 await db.reseller.update({where:{id:rep.id},data:{totpEnabled:true,totpSecret:encryptSecret('JBSWY3DPEHPK3PXP')}});
 let last;for(let i=0;i<11;i++)last=await api('/api/auth/login','POST',{username:rep.username,password:'ChangedPass123!',totpCode:'not-six-digits'},'');
 check('wrong TOTP attempts count toward login rate limit',()=>assert.equal(last.status,429));
 const phantom=cookie('ADMIN',{id:'deleted-admin',username:'deleted-admin'});
 r=await api('/api/admin/overview','GET',undefined,phantom);check('deleted admin cannot use an unexpired signed cookie',()=>assert.equal(r.status,401));
 await db.adminUser.update({where:{id:admin.id},data:{totpEnabled:true,totpSecret:encryptSecret('JBSWY3DPEHPK3PXP')}});ac=cookie('ADMIN',await db.adminUser.findUnique({where:{id:admin.id}}));
 r=await api('/api/admin/2fa','POST',{action:'setup'},ac);check('admin second-factor setup preserves an enabled factor',()=>assert.equal(r.status,409));
 for(let i=0;i<11;i++)last=await api('/api/auth/login','POST',{username:admin.username,password:'AuditPass123!',totpCode:'invalid'},'');check('admin wrong-code attempts also trigger lockout',()=>assert.equal(last.status,429));
 rc=cookie('RESELLER',await db.reseller.findUnique({where:{id:rep.id}}));
 r=await api('/api/auth/logout','POST',{});check('logout succeeds',()=>assert.equal(r.status,200));
 r=await api('/api/auth/me');check('saved cookie cannot be replayed after logout',()=>assert.equal(r.data.user,null));
 for(const bad of [{username:123,password:'x'},{username:'valid',password:[]},{username:'valid',password:'x'.repeat(100000)}]){r=await api('/api/auth/login','POST',bad,'');check('invalid or oversized login fields rejected as client error',()=>assert.equal(r.status,400))}
 let enrolledCookie=cookie('RESELLER',noBrand);
 r=await api('/api/reseller/2fa','POST',{action:'setup'},enrolledCookie);check('disabled factor can enroll normally',()=>assert.equal(r.status,200));
 const enrollmentSecret=new URL(r.data.otpauth).searchParams.get('secret');const bits=[...enrollmentSecret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');const key=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const mac=createHmac('sha1',key).update(counter).digest(),offset=mac.at(-1)&15,code=String((mac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
 r=await api('/api/reseller/2fa','POST',{action:'enable',code},enrolledCookie);check('valid enrollment enables factor and issues refreshed cookie',()=>{assert.equal(r.status,200);assert.ok(r.cookie)});
 const enabledCookie=r.cookie;r=await api('/api/auth/me','GET',undefined,enrolledCookie);check('pre-enrollment cookie cannot survive factor activation',()=>assert.equal(r.data.user,null));
 r=await api('/api/reseller/2fa','GET',undefined,enabledCookie);check('refreshed cookie survives factor activation',()=>{assert.equal(r.status,200);assert.equal(r.data.totpEnabled,true)});
 r=await api('/api/reseller/2fa','DELETE',{password:'Fixture123!'},enabledCookie);check('verified factor removal issues a usable fresh cookie',()=>{assert.equal(r.status,200);assert.ok(r.cookie)});enrolledCookie=r.cookie;
 r=await api('/api/auth/me','GET',undefined,enabledCookie);check('old enabled-factor cookie is revoked after factor removal',()=>assert.equal(r.data.user,null));
 r=await api('/api/reseller/2fa','GET',undefined,enrolledCookie);check('current cookie retains access after factor removal',()=>{assert.equal(r.status,200);assert.equal(r.data.totpEnabled,false)});
 r=await api('/api/admin/account','POST',{currentPassword:'AuditPass123!',newUsername:'audit_admin_new',newPassword:'NewAdminPass123!'},ac);check('admin credential change refreshes the current session',()=>{assert.equal(r.status,200);assert.ok(r.cookie)});const changedAdminCookie=r.cookie;
 r=await api('/api/auth/me','GET',undefined,ac);check('old admin cookie is invalid after credential change',()=>assert.equal(r.data.user,null));
 r=await api('/api/auth/me','GET',undefined,changedAdminCookie);check('new admin cookie uses current identity',()=>assert.equal(r.data.user.username,'audit_admin_new'));
 r=await api('/api/admin/account','POST',{currentPassword:'NewAdminPass123!',newPassword:'  SpacedAdminPass123!  '},changedAdminCookie);const spacedCookie=r.cookie;
 r=await api('/api/admin/account','POST',{currentPassword:'  SpacedAdminPass123!  ',newPassword:'FinalAdminPass123!'},spacedCookie);check('admin password changes preserve significant leading and trailing spaces',()=>assert.equal(r.status,200));
 writeFileSync(path.join(dir,'result.json'),JSON.stringify({checks,failures},null,2));console.log(JSON.stringify({checks,failures,dir}));if(failures.length)process.exitCode=1;
}catch(e){console.error(e);console.error('Fixture',dir);process.exitCode=1}
finally{if(app){if(process.platform==='win32')await new Promise(resolve=>{const p=spawn('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{windowsHide:true});p.on('exit',resolve)});else app.kill('SIGTERM')}if(mock){mock.closeAllConnections();mock.close()}if(db)await db.$disconnect()}
