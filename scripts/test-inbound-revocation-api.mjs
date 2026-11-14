// Real HTTP handlers and isolated SQLite; native calls go only to this loopback fixture.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,createWriteStream} from 'node:fs';
import path from 'node:path';
const root=process.cwd(),dir=path.join(root,'.local-dev','revocation-'+Date.now());mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'test.db'),'');
process.env.DATABASE_URL='file:../.local-dev/'+path.basename(dir)+'/test.db';process.env.APP_SECRET='isolated-revocation-secret';process.env.CI='1';process.env.__NEXT_AGENT_UPGRADE='security';
const {PrismaClient}=await import('@prisma/client');const {encryptSecret,hashPassword,signAccountSession}=await import('../src/lib/crypto.ts');
const GB=1024**3,clients=new Map(),writes=[],mode={};let db,server,app,checks=0;const failures=[];
function check(name,fn){try{fn();checks++;console.log('PASS',name)}catch(e){failures.push(name+': '+e.message);console.error('FAIL',name,e.message)}}
async function child(args){await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('child '+code)))})}
async function stopApp(){const current=app;if(!current)return;app=null;if(current.exitCode!==null)return;const exited=new Promise(resolve=>current.once('exit',resolve));if(process.platform==='win32')await new Promise(resolve=>{const p=spawn('taskkill.exe',['/PID',String(current.pid),'/T','/F'],{windowsHide:true});p.on('exit',resolve)});else current.kill('SIGTERM');await exited}
try{
 await child(['node_modules/prisma/build/index.js','db','push','--skip-generate']);db=new PrismaClient();
 server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw||'{}'),second=req.url.startsWith('/b/'),prefix=second?'b:':'',url=second?req.url.slice(2):req.url,email=decodeURIComponent(url.split('/').at(-1));let success=true,msg='',obj;const c=clients.get(prefix+email),visible=[...clients.entries()].filter(([key])=>second?key.startsWith('b:'):!key.startsWith('b:')).map(([,c])=>c);
  if(req.method==='POST')writes.push({url:req.url,body});
  if(url==='/panel/api/inbounds/list'){if(mode.catalogGate){const gate=mode.catalogGate;mode.catalogGate=null;gate.started();await gate.wait;}obj=[1,2,3].map(id=>({id,enable:true,tag:'loc-'+id,remark:'loc-'+id,port:4400+id,protocol:'vless',settings:JSON.stringify({clients:visible.filter(c=>c.ids.has(id)).map(({ids,used,...c})=>c)}),clientStats:visible.filter(c=>c.ids.has(id)).map(c=>({email:c.email,up:c.used,down:0,total:c.totalGB,expiryTime:c.expiryTime,enable:c.enable})),streamSettings:'{}'}));}
  else if(url==='/panel/api/inbounds/options')obj=[1,2,3].map(id=>({id,enable:true,tag:'loc-'+id,port:4400+id,protocol:'vless'}));
  else if(url==='/panel/api/nodes/list')obj=[];
  else if(url==='/panel/api/server/status')obj={xray:{state:'running'}};
  else if(url.startsWith('/panel/api/clients/get/')){if(c)obj={client:{...c,uuid:c.id,ids:undefined,used:undefined},inboundIds:[...c.ids],usedTraffic:c.used};else{success=false;msg='Obtain (record not found)'}}
  else if(url.startsWith('/panel/api/clients/traffic/')){if(c)obj={up:c.used,down:0,total:c.totalGB};else{success=false;msg='Obtain (record not found)'}}
  else if(url.endsWith('/detach')){const target=clients.get(prefix+decodeURIComponent(url.split('/').at(-2)));if(mode.failDetach){success=false;msg='fixture node unavailable'}else if(target){body.inboundIds.forEach(id=>target.ids.delete(id));if(mode.lostDetach){mode.lostDetach=false;success=false;msg='lost acknowledgement'}}else{success=false;msg='Obtain (record not found)'}}
  else if(url.endsWith('/attach')){const target=clients.get(prefix+decodeURIComponent(url.split('/').at(-2)));if(target)body.inboundIds.forEach(id=>target.ids.add(id));else{success=false;msg='Obtain (record not found)'}}
  else if(url.startsWith('/panel/api/clients/update/')){if(c)Object.assign(c,body);else{success=false;msg='Obtain (record not found)'}}
  else if(url.startsWith('/panel/api/clients/del/')){if(second&&mode.failDeleteB){success=false;msg='fixture delete unavailable'}else clients.delete(prefix+email);}
  else if(url==='/panel/api/clients/onlines')obj=[];
  else{success=false;msg='unsupported fixture endpoint'}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success,msg,obj}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const panel=await db.panelConfig.create({data:{name:'mock',baseUrl:'http://127.0.0.1:'+server.address().port,username:'fixture',password:encryptSecret('fixture'),apiToken:encryptSecret('fixture')}});
 const admin=await db.adminUser.create({data:{username:'admin',password:hashPassword('fixture')}}),owner=await db.reseller.create({data:{username:'reseller',password:hashPassword('fixture'),active:true,multiLocation:true,trafficPoolGB:100}}),foreign=await db.reseller.create({data:{username:'foreign',password:hashPassword('fixture'),active:true,multiLocation:true,trafficPoolGB:100}});
 for(const id of [1,2,3])await db.resellerInbound.create({data:{resellerId:owner.id,panelId:panel.id,inboundId:id,inboundTag:'loc-'+id,protocol:'vless',port:4400+id}});
 async function seed(who,email,ids,used=3){const c={id:'uuid-'+email,email,subId:'sub-'+email,totalGB:10*GB,expiryTime:Date.now()+30*86400000,enable:true,limitIp:2,used:used*GB,ids:new Set(ids)};clients.set(email,c);await db.resellerUser.create({data:{resellerId:who.id,email,subId:c.subId,trafficGB:10,panelId:panel.id,inboundIds:JSON.stringify(ids.map(inboundId=>({panelId:panel.id,inboundId})))}});return c}
 const customer=await seed(owner,'original',[1,2]),other=await seed(foreign,'other',[1]),originalId=customer.id,originalExpiry=customer.expiryTime,originalForeign=JSON.stringify({...other,ids:[...other.ids]});
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const base='http://127.0.0.1:'+port;
 async function startApp(){const log=createWriteStream(path.join(dir,'next.log'),{flags:'a'});app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true});app.stdout.pipe(log);app.stderr.pipe(log);
 for(let i=0;i<150;i++){if(app.exitCode!==null)throw Error('Next exited; inspect '+dir);try{if((await fetch(base,{signal:AbortSignal.timeout(3000)})).ok)break}catch{}await new Promise(r=>setTimeout(r,500));if(i===149)throw Error('startup timeout')}}await startApp();
 async function api(who,route,method='GET',body){const cookie='rp_session='+signAccountSession(who===admin?'ADMIN':'RESELLER',who,'dashboard',Date.now()+3600000);const r=await fetch(base+route,{method,headers:{Cookie:cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json().catch(()=>({}))}}
 const grants=ids=>({inbounds:ids.map(inboundId=>({panelId:panel.id,inboundId}))}),pathOwner='/api/admin/resellers/'+owner.id;
 let result=await api(admin,pathOwner,'PUT',grants([2,3]));assert.equal(result.status,200);
 for(let i=0;i<30&&clients.get('original').ids.has(1);i++)await new Promise(r=>setTimeout(r,100));
 check('saving revoked grants automatically removes only those existing customer memberships',()=>{assert.deepEqual([...customer.ids],[2]);assert.equal(customer.id,originalId);assert.equal(customer.used,3*GB);assert.equal(customer.totalGB,10*GB);assert.equal(customer.expiryTime,originalExpiry)});
 result=await api(admin,pathOwner+'/reconcile-inbounds','POST',{});
 check('explicit reconciliation is available to the administrator',()=>assert.equal(result.status,200));
 let tracked=await db.resellerUser.findFirstOrThrow({where:{email:'original'}});
 check('tracked customer refs converge without adding newly granted locations or changing funding',()=>{assert.deepEqual(JSON.parse(tracked.inboundIds),[{panelId:panel.id,inboundId:2}]);assert.equal(customer.ids.has(3),false);assert.equal(tracked.trafficGB,10)});
 result=await api(owner,'/api/reseller/users/original','PUT',{expiryDays:40});
 check('renewal after grant removal succeeds using the remaining authorized locations',()=>{assert.equal(result.status,200);assert.equal(customer.id,originalId);assert.equal(customer.used,3*GB)});
 result=await api(owner,'/api/reseller/users/original','PUT',{subId:'legitimate-rotated-sub'});const rotated=await api(owner,'/api/reseller/users/original');
 check('legitimate subscription rotation does not invalidate retained accounting history',()=>{assert.equal(result.status,200);assert.equal(rotated.status,200);assert.equal(rotated.data.user.usedGB,3);assert.equal(customer.id,originalId)});
 check('another reseller customer is untouched',()=>assert.equal(JSON.stringify({...other,ids:[...other.ids]}),originalForeign));
 result=await api(owner,pathOwner+'/reconcile-inbounds','POST',{});check('resellers cannot run administrative grant reconciliation',()=>assert.equal(result.status,401));
 await api(admin,pathOwner,'PUT',grants([]));await api(admin,pathOwner+'/reconcile-inbounds','POST',{});tracked=await db.resellerUser.findFirstOrThrow({where:{email:'original'}});
 check('revoking every grant parks the existing native account and retains its paid allocation and usage',()=>{assert.equal(customer.ids.size,0);assert.deepEqual(JSON.parse(tracked.inboundIds),[]);assert.equal(customer.id,originalId);assert.equal(customer.used,3*GB);assert.equal(tracked.trafficGB,10)});
 result=await api(owner,'/api/reseller/users/original');check('a deliberately unassigned customer still has authoritative edit data',()=>{assert.equal(result.status,200);assert.equal(result.data.user.usedGB,3);assert.equal(result.data.user.totalGB,10)});
 result=await api(owner,'/api/reseller/users/original','PUT',{expiryDays:45});const parkedExpiry=customer.expiryTime;
 check('an intentional parked account can renew its date without losing its paid profile',()=>{assert.equal(result.status,200);assert.equal(customer.ids.size,0);assert.equal(customer.used,3*GB);assert.ok(parkedExpiry>Date.now()+44*86400000)});
 await api(admin,pathOwner,'PUT',grants([3]));result=await api(owner,'/api/reseller/users/original','PUT',{inbounds:[{panelId:panel.id,inboundId:3}],trafficGB:12});
 check('a parked customer renews onto a newly granted location without recreating identity, zeroing traffic or clearing expiry',()=>{assert.equal(result.status,200);assert.deepEqual([...customer.ids],[3]);assert.equal(customer.id,originalId);assert.equal(customer.used,3*GB);assert.equal(customer.totalGB,12*GB);assert.equal(customer.expiryTime,parkedExpiry)});
 await api(admin,pathOwner,'PUT',grants([]));await api(admin,pathOwner+'/reconcile-inbounds','POST',{});result=await api(owner,'/api/reseller/users/original','DELETE');const balance=await db.reseller.findUniqueOrThrow({where:{id:owner.id}}),poolView=await api(owner,'/api/reseller/bootstrap');
 check('delete after all-location revocation cannot recover the three GB already consumed',()=>{assert.equal(result.status,200);assert.equal(balance.consumedGB,3);assert.equal(poolView.data.permissions.remainingGB,97);assert.equal(poolView.data.permissions.allocatedGB,0)});
 async function raceOwner(name){const r=await db.reseller.create({data:{username:name,password:hashPassword('fixture'),active:true,multiLocation:true,trafficPoolGB:100}});for(const id of [1,2])await db.resellerInbound.create({data:{resellerId:r.id,panelId:panel.id,inboundId:id,inboundTag:'loc-'+id,protocol:'vless',port:4400+id}});return r}
 function holdCatalog(){let started,release;const signal=new Promise(r=>{started=r}),wait=new Promise(r=>{release=r});mode.catalogGate={started,wait};return{signal,release}}
 async function isolateRace(){for(let i=0;i<100&&await db.setting.count({where:{key:{startsWith:'inboundGrantQueue:'}}});i++)await new Promise(r=>setTimeout(r,50));assert.equal(await db.setting.count({where:{key:{startsWith:'inboundGrantQueue:'}}}),0);await stopApp();await startApp()}
 // Each race starts without unrelated background requests that could consume
 // the native read barrier before the intended customer request reaches it.
 await isolateRace();
 const addRaceOwner=await raceOwner('grant-race-add'),addRace=await seed(addRaceOwner,'race_add',[2]),addGate=holdCatalog();const adding=api(addRaceOwner,'/api/reseller/users/race_add','PUT',grants([1,2]));await addGate.signal;await api(admin,'/api/admin/resellers/'+addRaceOwner.id,'PUT',grants([2]));addGate.release();const addedRace=await adding;
 check('a renewal prepared before grant revocation cannot add a location using stale authorization',()=>{assert.equal(addedRace.status,403);assert.deepEqual([...addRace.ids],[2]);assert.equal(addRace.used,3*GB)});
 await isolateRace();
 const renewRaceOwner=await raceOwner('grant-race-renew'),renewRace=await seed(renewRaceOwner,'race_renew',[1,2]),renewGate=holdCatalog();const renewing=api(renewRaceOwner,'/api/reseller/users/race_renew','PUT',{expiryDays:60});await renewGate.signal;await api(admin,'/api/admin/resellers/'+renewRaceOwner.id,'PUT',grants([2]));await api(admin,'/api/admin/resellers/'+renewRaceOwner.id+'/reconcile-inbounds','POST',{});renewGate.release();const renewedRace=await renewing,renewedRow=await db.resellerUser.findFirstOrThrow({where:{email:'race_renew'}});
 check('a stale ordinary renewal cannot restore local memberships removed by the administrator',()=>{assert.equal(renewedRace.status,409);assert.deepEqual([...renewRace.ids],[2]);assert.deepEqual(JSON.parse(renewedRow.inboundIds),[{panelId:panel.id,inboundId:2}])});
 const extraOwner=await raceOwner('native-extra'),extra=await seed(extraOwner,'native_extra',[2]);extra.ids.add(1);await api(admin,'/api/admin/resellers/'+extraOwner.id,'PUT',grants([2]));await api(admin,'/api/admin/resellers/'+extraOwner.id+'/reconcile-inbounds','POST',{});
 check('native revoked memberships missing from local tracked refs are also removed without changing usage',()=>{assert.deepEqual([...extra.ids],[2]);assert.equal(extra.used,3*GB);assert.equal(extra.totalGB,10*GB)});
 const partialOwner=await raceOwner('grant-partial'),partial=await seed(partialOwner,'partial_revoke',[1,2]);mode.failDetach=true;await api(admin,'/api/admin/resellers/'+partialOwner.id,'PUT',grants([2]));let partialResult=await api(admin,'/api/admin/resellers/'+partialOwner.id+'/reconcile-inbounds','POST',{});const partialRow=await db.resellerUser.findFirstOrThrow({where:{email:'partial_revoke'}});result=await api(partialOwner,'/api/reseller/users/partial_revoke','DELETE');
 check('an unacknowledged revocation retains tracked refs, allocation and traffic and blocks conflicting deletion',()=>{assert.equal(partialResult.data.pending,1);assert.equal(JSON.parse(partialRow.inboundIds).length,2);assert.equal(partial.used,3*GB);assert.equal(result.status,409)});
 mode.failDetach=false;partialResult=await api(admin,'/api/admin/resellers/'+partialOwner.id+'/reconcile-inbounds','POST',{});const repairedRow=await db.resellerUser.findFirstOrThrow({where:{email:'partial_revoke'}});
 check('the same failed revocation completes after recovery without resetting the account or its usage',()=>{assert.equal(partialResult.data.pending,0);assert.deepEqual([...partial.ids],[2]);assert.equal(partial.used,3*GB);assert.equal(repairedRow.trafficGB,10)});
 const secondPanel=await db.panelConfig.create({data:{name:'second',baseUrl:'http://127.0.0.1:'+server.address().port+'/b',username:'fixture',password:encryptSecret('fixture'),apiToken:encryptSecret('fixture'),sortOrder:1}}),multiOwner=await raceOwner('retained-multi');
 await db.resellerInbound.create({data:{resellerId:multiOwner.id,panelId:secondPanel.id,inboundId:1,inboundTag:'loc-1',protocol:'vless',port:4401}});const multi=await seed(multiOwner,'bare_multi',[1]);clients.set('b:bare_multi',{...multi,used:5*GB,ids:new Set([1])});await db.resellerUser.updateMany({where:{resellerId:multiOwner.id,email:multi.email},data:{inboundIds:JSON.stringify([{panelId:panel.id,inboundId:1},{panelId:secondPanel.id,inboundId:1}])}});
 await api(admin,'/api/admin/resellers/'+multiOwner.id,'PUT',{inbounds:[{panelId:secondPanel.id,inboundId:1}]});await api(admin,'/api/admin/resellers/'+multiOwner.id+'/reconcile-inbounds','POST',{});mode.failDeleteB=true;
 result=await api(multiOwner,'/api/reseller/users/bare_multi','DELETE');const partialMulti=await api(multiOwner,'/api/reseller/bootstrap');
 check('a partial delete keeps allocation when a completed target was a retained bare record',()=>{assert.equal(result.status,502);assert.equal(clients.has('bare_multi'),false);assert.equal(clients.has('b:bare_multi'),true);assert.equal(partialMulti.data.permissions.allocatedGB,10);assert.equal(partialMulti.data.permissions.consumedGB,0)});
 // Crash window: native P deletion happened, but its final DONE verification
 // and completedPanels write did not survive. The paid per-panel ledger did.
 const crashed=await db.operationJournal.findFirstOrThrow({where:{resellerId:multiOwner.id,type:'DELETE'}}),crashMeta=JSON.parse(crashed.metadata);crashMeta.nodeSync[panel.id].steps.forEach(step=>step.status='STARTED');crashMeta.nodeSync[panel.id].deleteVerified=false;
 await db.operationJournal.update({where:{id:crashed.id},data:{completedPanels:'[]',metadata:JSON.stringify(crashMeta)}});
 mode.failDeleteB=false;result=await api(multiOwner,'/api/reseller/users/bare_multi','DELETE');const completedMulti=await api(multiOwner,'/api/reseller/bootstrap');
 check('a crash after bare native deletion resumes from its durable ledger and charges all eight GB once',()=>{assert.equal(result.status,200);assert.equal(completedMulti.data.permissions.consumedGB,8);assert.equal(completedMulti.data.permissions.remainingGB,92);assert.equal(writes.filter(w=>w.url==='/panel/api/clients/del/bare_multi').length,1)});
 const blockedOwner=await raceOwner('deferred-grants'),blocked=await seed(blockedOwner,'deferred_grants',[1,2]),blockedUser=await db.resellerUser.findFirstOrThrow({where:{email:blocked.email}}),blocking=await db.operationJournal.create({data:{idempotencyKey:'fixture-blocking-edit',resellerId:blockedOwner.id,userId:blockedUser.id,email:blocked.email,type:'UPDATE',status:'PENDING',reservedGB:0,targetPanels:JSON.stringify([panel.id]),metadata:'{}'}});
 await api(admin,'/api/admin/resellers/'+blockedOwner.id,'PUT',grants([2]));
 check('a grant change blocked by an earlier operation remains in a durable owner queue',()=>{assert.ok(blocked.ids.has(1));});
 const queue=await db.setting.findUnique({where:{key:'inboundGrantQueue:'+blockedOwner.id}});check('the durable queue exists even before a revocation journal can be scheduled',()=>assert.ok(queue));
 await db.operationJournal.update({where:{id:blocking.id},data:{status:'CANCELLED'}});
 await stopApp();await startApp();
 for(let i=0;i<100&&(blocked.ids.has(1)||await db.setting.findUnique({where:{key:'inboundGrantQueue:'+blockedOwner.id}}));i++)await new Promise(r=>setTimeout(r,100));
 const recovered=await db.resellerUser.findUniqueOrThrow({where:{id:blockedUser.id}});
 check('server restart automatically resumes the saved grant change without an operator HTTP mutation',()=>{assert.deepEqual([...blocked.ids],[2]);assert.deepEqual(JSON.parse(recovered.inboundIds),[{panelId:panel.id,inboundId:2}]);assert.equal(blocked.used,3*GB);assert.equal(blocked.totalGB,10*GB);assert.equal(recovered.trafficGB,10)});
 for(let i=0;i<30&&await db.setting.findUnique({where:{key:'inboundGrantQueue:'+blockedOwner.id}});i++)await new Promise(r=>setTimeout(r,100));
 check('restart recovery preserves the existing connection and subscription identity',()=>{assert.equal(blocked.id,'uuid-deferred_grants');assert.equal(blocked.subId,'sub-deferred_grants')});
 const finishedQueue=await db.setting.findUnique({where:{key:'inboundGrantQueue:'+blockedOwner.id}});check('no completed grant queue is left waiting for the next observation job',()=>assert.equal(finishedQueue,null));
 const restoredOwner=await raceOwner('restored-grants'),restored=await seed(restoredOwner,'restored_grants',[1,2]),restoredUser=await db.resellerUser.findFirstOrThrow({where:{email:restored.email}});
 await db.resellerInbound.deleteMany({where:{resellerId:restoredOwner.id,inboundId:1}});
 const foreignQueue=JSON.stringify({version:1,installation:'another-installation',revision:'restored-revision'});
 await db.setting.create({data:{key:'inboundGrantQueue:'+restoredOwner.id,value:foreignQueue}});
 const foreignJournal=await db.operationJournal.create({data:{idempotencyKey:'foreign-installation-revocation',resellerId:restoredOwner.id,userId:restoredUser.id,email:restored.email,type:'REVOKE',status:'PENDING',targetPanels:JSON.stringify([panel.id]),metadata:JSON.stringify({version:1,kind:'INBOUND_REVOCATION',installation:'another-installation',sourceRefs:restoredUser.inboundIds,sourceMemberships:JSON.parse(restoredUser.inboundIds),removed:[{panelId:panel.id,inboundId:1}],node:{}})}});
 const writesBeforeRestore=writes.length;await stopApp();await startApp();await new Promise(r=>setTimeout(r,1500));
 check('startup never executes a membership queue restored from a different installation',()=>{assert.deepEqual([...restored.ids],[1,2]);assert.equal(writes.length,writesBeforeRestore);assert.equal(restored.used,3*GB)});
 const foreignSaved=await db.operationJournal.findUniqueOrThrow({where:{id:foreignJournal.id}}),foreignSetting=await db.setting.findUniqueOrThrow({where:{key:'inboundGrantQueue:'+restoredOwner.id}});
 check('foreign restoration leaves its journal and queue guarded instead of reauthorizing them',()=>{assert.equal(foreignSaved.status,'PENDING');assert.equal(foreignSetting.value,foreignQueue)});
 console.log(JSON.stringify({checks,failures,fixture:dir}));if(failures.length)process.exitCode=1;
}catch(e){console.error(e);console.error('Fixture:',dir);process.exitCode=1}
finally{await stopApp();if(server){server.closeAllConnections();server.close()}if(db)await db.$disconnect()}
