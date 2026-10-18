// Synthetic data only. Runs locally or inside an isolated --network none production-image container.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync,copyFileSync,readFileSync,writeFileSync,existsSync,createWriteStream } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.cwd(), container=process.env.RESTORE_FIXTURE_ENTRYPOINT==='1';
const dir=path.join(root,'.local-dev',`restore-api-${Date.now()}`); mkdirSync(dir,{recursive:true});
const data=container?'/app/data':path.join(dir,'data');mkdirSync(data,{recursive:true});
assert.ok(!existsSync(path.join(data,'custom.db')),'fixture refuses existing database');
const template=container?'/app/prisma-template/custom.db':path.join(dir,'template.db');
const secret='destination-fixture-key', sourceSecret='original-fixture-key';
let app,mock,checks=0,writes=0;
const python=process.platform==='win32'?'python':'python3';
function run(cmd,args,env=process.env){return new Promise((resolve,reject)=>{const c=spawn(cmd,args,{cwd:root,env,windowsHide:true,stdio:'inherit'});c.on('error',reject);c.on('exit',n=>n===0?resolve():reject(Error('child exit '+n)));});}
const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const hash=p=>{const salt='12345678901234567890123456789012';return salt+':'+crypto.scryptSync(p,salt,64).toString('hex');};
function enc(plain,key=sourceSecret){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',crypto.createHash('sha256').update(key).digest(),iv);const v=Buffer.concat([c.update(plain),c.final()]);return[iv,c.getAuthTag(),v].map(x=>x.toString('base64')).join('.');}
function cookie(role='ADMIN',uid='bootstrap',key=secret){const body=Buffer.from(JSON.stringify({role,uid,username:uid,exp:Date.now()+3600000})).toString('base64url');return'rp_session='+body+'.'+crypto.createHmac('sha256',key).update(body).digest('base64url');}
try{
 if(!container) { writeFileSync(template,''); await run(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{...process.env,DATABASE_URL:`file:../.local-dev/${path.basename(dir)}/template.db`}); }
 copyFileSync(template,path.join(data,'custom.db'));
 const target=new DatabaseSync(path.join(data,'custom.db'));
 target.prepare('INSERT INTO AdminUser(id,username,password) VALUES(?,?,?)').run('bootstrap','bootstrap',hash('Destination123!'));
 const source=path.join(dir,'source.db');copyFileSync(template,source);const sourceDb=new DatabaseSync(source);
 mock=http.createServer((req,res)=>{if(!['GET','HEAD'].includes(req.method))writes++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,obj:[]}));});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 sourceDb.prepare('INSERT INTO AdminUser(id,username,password) VALUES(?,?,?)').run('original','original',hash('Original123!'));
 sourceDb.prepare('INSERT INTO Reseller(id,username,password,trafficPoolGB,consumedGB) VALUES(?,?,?,?,?)').run('r1','restored_rep',hash('Reseller123!'),100,7.25);
 sourceDb.prepare('INSERT INTO ResellerUser(id,resellerId,email,trafficGB,inboundIds,subId) VALUES(?,?,?,?,?,?)').run('u1','r1','synthetic-client',44,'[]','synthetic-sub');
 sourceDb.prepare('INSERT INTO PanelConfig(id,name,baseUrl,username,password,apiToken,updatedAt) VALUES(?,?,?,?,?,?,?)').run('p1','Mock',`http://127.0.0.1:${mock.address().port}`,'mock',enc('mock-pass'),enc('mock-token'),Date.now());
 sourceDb.prepare('INSERT INTO Setting(key,value,updatedAt) VALUES(?,?,?)').run('nodeSyncPeers:p1',enc(JSON.stringify([{key:'n1',baseUrl:'https://node.invalid',token:'node-token',masterInboundIds:[142],tls:{connectHost:'172.18.0.1',ca:'-----BEGIN CERTIFICATE-----\nfixture'}}])),Date.now());
 sourceDb.close();
 const input=path.join(dir,'input.json');writeFileSync(input,JSON.stringify({panels:[]}));
 await run(python,['scripts/panel-backup.py','create','--database',source,'--directory',path.join(dir,'archives'),'--input',input],{...process.env,APP_SECRET:sourceSecret});
 const {readdirSync}=await import('node:fs');const archive=readFileSync(path.join(dir,'archives',readdirSync(path.join(dir,'archives')).find(n=>n.endsWith('.zip'))));
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const base=`http://127.0.0.1:${port}`;
 const env={...process.env,DATABASE_URL:'file:'+path.join(data,'custom.db').replaceAll('\\','/'),APP_SECRET:secret,DASHBOARD_RESTORE_ENABLED:'1',RESTORE_TEMPLATE:template,PORT:String(port),HOSTNAME:'127.0.0.1',NEXT_TELEMETRY_DISABLED:'1'};
 async function start(){const log=createWriteStream(path.join(dir,`app-${Date.now()}.log`));app=spawn(container?'/bin/sh':process.execPath,container?['/app/entrypoint.sh']:['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env,windowsHide:true});app.stdout.pipe(log);app.stderr.pipe(log);for(let i=0;i<120;i++){try{if((await fetch(base+'/api/auth/me')).ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('startup timeout; logs '+dir);}
 await start();
 async function api(method='GET',body,ck=cookie(),origin=base){const r=await fetch(base+'/api/admin/backups/restore',{method,headers:{...(ck?{Cookie:ck}:{}),...(origin?{Origin:origin}:{}),...(method==='PUT'?{'Content-Type':'application/zip'}:{'Content-Type':'application/json'})},body:body===undefined?undefined:method==='PUT'?body:JSON.stringify(body)});return{status:r.status,data:await r.json()};}
 let r=await api('GET',undefined,'');check('anonymous denied',()=>assert.equal(r.status,401));
 r=await api('PUT',archive,cookie('RESELLER','r1'));check('representative denied',()=>assert.equal(r.status,401));
 r=await api('PUT',archive,cookie(),'https://untrusted.invalid');check('foreign origin denied',()=>assert.equal(r.status,403));
 r=await api();check('fresh install eligible',()=>assert.equal(r.data.allowed,true));
 if(process.env.PLAYWRIGHT_MODULE){
  const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
   const context=await browser.newContext({viewport:{width:1440,height:1000}});
   await context.addCookies([{name:'rp_session',value:cookie().slice(11),url:base}]);
   const page=await context.newPage();await page.goto(base);await page.waitForLoadState('networkidle');
   await page.getByRole('button',{name:'بکاپ',exact:true}).click();
   await page.getByRole('button',{name:'بازیابی بکاپ',exact:true}).click();
   await page.locator('input[type=file]').setInputFiles({name:'fixture.zip',mimeType:'application/zip',buffer:archive});
   await page.getByRole('button',{name:'بارگذاری و بررسی بکاپ',exact:true}).click();
   await page.getByText('فایل سالم و سازگار است',{exact:false}).waitFor();
   const confirmDisabled=await page.getByRole('button',{name:'بازیابی و راه‌اندازی مجدد داشبورد',exact:true}).isDisabled();
   check('desktop upload preview and confirmation guard',()=>assert.equal(confirmDisabled,true));
   await page.screenshot({path:path.join(dir,'restore-desktop.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'restore-mobile.png'),fullPage:true});
   const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
   check('mobile restore form fits viewport',()=>assert.ok(width.scroll<=width.client+1,JSON.stringify(width)));
   await context.close();
  }finally{await browser.close();}
 }
 target.prepare('INSERT INTO Reseller(id,username,password) VALUES(?,?,?)').run('existing','existing',hash('keep'));
 r=await api('PUT',archive);check('populated destination cannot upload',()=>assert.equal(r.status,409));target.exec('DELETE FROM Reseller');
 r=await api('PUT',Buffer.from('not a zip'));check('corrupt ZIP rejected',()=>assert.equal(r.status,409));
 const oversized=await fetch(base+'/api/admin/backups/restore',{method:'PUT',headers:{Cookie:cookie(),Origin:base,'Content-Type':'application/zip'},body:Buffer.alloc(64*1024*1024+1)});
 check('oversized upload rejected',()=>assert.equal(oversized.status,409));
 const concurrent=await Promise.all([api('PUT',archive),api('PUT',archive)]);
 check('concurrent uploads serialize without overwriting each other',()=>assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]));
 r=await api('PUT',archive);check('valid archive preview counts and key checks without disclosure',()=>{assert.equal(r.status,200);assert.equal(r.data.preview.counts.ResellerUser,1);assert.equal(r.data.preview.peerCount,1);assert.ok(!JSON.stringify(r.data).includes(sourceSecret));});
 const token=r.data.token;
 const corruptPath=path.join(data,'.restore',token,'archive.zip'),saved=readFileSync(corruptPath);writeFileSync(corruptPath,Buffer.from('changed'));
 r=await api('POST',{token,password:'Destination123!',confirm:'RESTORE'});check('changed archive rejected at confirmation',()=>assert.equal(r.status,409));writeFileSync(corruptPath,saved);
 target.prepare('INSERT INTO Reseller(id,username,password) VALUES(?,?,?)').run('raced','raced',hash('keep'));
 r=await api('POST',{token,password:'Destination123!',confirm:'RESTORE'});check('freshness rechecked at confirmation',()=>assert.equal(r.status,409));target.exec('DELETE FROM Reseller');
 target.prepare('INSERT INTO AdminUser(id,username,password) VALUES(?,?,?)').run('second','second',hash('Destination123!'));
 r=await api('POST',{token,password:'Destination123!',confirm:'RESTORE'},cookie('ADMIN','second'));check('token bound to uploading admin',()=>assert.equal(r.status,409));
 r=await api('POST',{token,password:'wrong',confirm:'RESTORE'});check('current admin password required',()=>assert.equal(r.status,403));
 r=await api('POST',{token,password:'Destination123!',confirm:'RESTORE'} ,cookie(),'https://foreign.invalid');check('confirmation rejects foreign origin',()=>assert.equal(r.status,403));
 // Expiry and hash are durable server-side state, independent of client claims.
 const previewPath=path.join(data,'.restore',token,'preview.json'),info=JSON.parse(readFileSync(previewPath));writeFileSync(previewPath,JSON.stringify({...info,expiresAt:0}));
 r=await api('POST',{token,password:'Destination123!',confirm:'RESTORE'});check('expired token rejected',()=>assert.equal(r.status,409));writeFileSync(previewPath,JSON.stringify(info));
 target.prepare('UPDATE AdminUser SET totpEnabled=1,totpSecret=? WHERE id=?').run(enc('JBSWY3DPEHPK3PXP',secret),'bootstrap');
 r=await api('POST',{token,password:'Destination123!',confirm:'RESTORE'});check('enabled 2FA required',()=>assert.equal(r.status,403));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=crypto.createHmac('sha1',Buffer.from('48656c6c6f21deadbeef','hex')).update(counter).digest(),off=h[19]&15;const totpCode=String((h.readUInt32BE(off)&0x7fffffff)%1000000).padStart(6,'0');
 target.close();
 r=await api('POST',{token,password:'Destination123!',totpCode,confirm:'RESTORE'});check('valid confirmation queues cold restore',()=>assert.equal(r.status,202));
 r=await fetch(base+'/api/admin/resellers',{method:'POST',headers:{Cookie:cookie(),'Content-Type':'application/json'},body:'{}'});check('pending marker blocks writes during restart',()=>assert.equal(r.status,503));
 await new Promise(r=>setTimeout(r,2500));if(app.exitCode===null)await new Promise(r=>app.once('exit',r));
 if(!container)await run(python,['scripts/dashboard-restore.py','apply',data,template],env);
 await start();
 const restored=new DatabaseSync(path.join(data,'custom.db'));
 check('restored accounting and identity exact',()=>{assert.deepEqual({...restored.prepare('SELECT trafficPoolGB,consumedGB FROM Reseller').get()},{trafficPoolGB:100,consumedGB:7.25});assert.equal(restored.prepare('SELECT subId FROM ResellerUser').get().subId,'synthetic-sub');});restored.close();
 check('original key installed despite different environment',()=>assert.equal(readFileSync(path.join(data,'.app-secret'),'utf8'),sourceSecret));
 r=await api('GET',undefined,cookie());check('old destination session invalidated',()=>assert.equal(r.status,401));
 r=await api('GET',undefined,cookie('ADMIN','original',sourceSecret));check('restored populated install cannot restore again',()=>assert.equal(r.data.allowed,false));
 r=await api('POST',{token,password:'Original123!',confirm:'RESTORE'},cookie('ADMIN','original',sourceSecret));check('consumed restore token cannot be replayed',()=>assert.equal(r.status,409));
 for(const [username,password]of[['original','Original123!'],['restored_rep','Reseller123!']]){const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});check('restored login '+username,()=>assert.equal(response.status,200));}
 const auth=cookie('ADMIN','original',sourceSecret);
 const response=await fetch(base+'/api/admin/backups',{method:'POST',headers:{Cookie:auth,'Content-Type':'application/json'},body:'{}'});check('backup after restore uses effective key',()=>assert.equal(response.status,200));
 await run(process.execPath,['scripts/run-backup.cjs'],env);
 const configured=execFileSync(process.execPath,['scripts/configure-node-sync.cjs','p1'],{cwd:root,env,input:JSON.stringify([{key:'n1',baseUrl:'https://node.invalid',token:'node-token',masterInboundIds:[142]}]),encoding:'utf8'});
 check('peer CLI works with restored effective key',()=>assert.equal(JSON.parse(configured).configured,true));
 check('no external panel writes during restore',()=>assert.equal(writes,0));
 console.log(JSON.stringify({ok:true,checks,container,dir}));
}catch(e){console.error(e);console.error('Fixture logs:',dir);process.exitCode=1;}
finally{if(app&&app.exitCode===null)app.kill();if(mock)mock.close();}
