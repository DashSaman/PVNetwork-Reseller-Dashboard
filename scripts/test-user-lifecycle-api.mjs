// All remote writes target loopback mocks and an isolated SQLite database only.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
const root=process.cwd(),dir=path.join(root,'.local-dev','lifecycle-'+Date.now());mkdirSync(dir,{recursive:true});
writeFileSync(path.join(dir,'test.db'),'');
process.env.DATABASE_URL='file:'+path.join(dir,'test.db').replaceAll('\\','/');process.env.APP_SECRET='isolated-lifecycle-secret';
// This unattended, isolated fixture cannot answer interactive CLI upgrade prompts.
process.env.CI='1';process.env.__NEXT_AGENT_UPGRADE='security';
const {PrismaClient}=await import('@prisma/client');const {encryptSecret,hashPassword,signAccountSession}=await import('../src/lib/crypto.ts');
const GB=1024**3,clients=new Map(),mode=new Map();let db,app,server,checks=0,nativeAdds=0,nativeAttaches=0,nativeDeletes=0;const failures=[];
function check(name,fn){try{fn();checks++;console.log('PASS',name)}catch(e){failures.push(name+': '+e.message);console.error('FAIL',name,e.message)}}
const key=(p,e)=>p+':'+e;
function inbound(p,id){const members=[...clients.entries()].filter(([k,c])=>k.startsWith(p+':')&&c.ids.has(id)).map(([,c])=>c);return {id,enable:true,nodeId:mode.get('all-remote')?1:null,tag:'loc-'+id,port:4400+id,protocol:'vless',settings:JSON.stringify({clients:members.map(c=>({...c,uuid:undefined,ids:undefined,used:undefined}))}),clientStats:members.map(c=>({email:c.email,up:c.used,down:0,total:c.totalGB,enable:c.enable,expiryTime:c.expiryTime,lastSubFetch:c.lastSubFetch})),streamSettings:'{}'};}
async function child(args){await new Promise((resolve,reject)=>{const c=spawn(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});c.on('error',reject);c.on('exit',n=>n===0?resolve():reject(Error('child '+n)))})}
try{
 await child(['node_modules/prisma/build/index.js','db','push','--skip-generate']);db=new PrismaClient();
 server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw||'{}');const p=req.url.startsWith('/b/')?'b':'a',url=req.url.replace(/^\/[ab]/,'');let success=true,obj,msg='';
  const email=decodeURIComponent(url.split('/').at(-1)),c=clients.get(key(p,email)),m=mode.get(email)||{};
  const reappear=mode.get('reappear-on-health');if(url==='/panel/api/nodes/list'&&reappear&&!clients.has(key('a',reappear.email))&&!clients.has(key('b',reappear.email))){clients.set(key('a',reappear.email),{...reappear.client,ids:new Set(reappear.client.ids)});mode.delete('reappear-on-health');}
  if(url.startsWith('/sub/')){const value=[...clients.values()].find(v=>v.subId===email);res.writeHead(value?200:404,{'content-type':'text/plain'});res.end(value?Buffer.from([...value.ids].map(id=>`vless://${value.id}@fixture.example:${4400+id}?encryption=none&type=tcp&security=none#loc-${id}`).join('\n')).toString('base64'):'missing');return;}
  if(url==='/panel/api/inbounds/list'&&p==='b'&&mode.get('panel-b-unavailable')){success=false;msg='fixture panel unavailable'}
  else if(url==='/panel/api/inbounds/list'){if(mode.get('catalog-delay'))await new Promise(r=>setTimeout(r,mode.get('catalog-delay')));if(mode.get('delay'))await new Promise(r=>setTimeout(r,1500));obj=[1,2,3].map(id=>inbound(p,id));}
  else if(url==='/panel/api/inbounds/options'&&mode.get('options-supported'))obj=[1,2,3].map(id=>({id,nodeId:mode.get('options-invalid-node')?'1':mode.get('all-remote')?1:null,enable:true}));
  else if(url==='/panel/api/clients/list')obj=[...clients.entries()].filter(([k])=>k.startsWith(p+':')).map(([,c])=>c);
  else if(url.startsWith('/panel/api/clients/get/')){if(c)obj={client:{...c,uuid:c.id,ids:undefined,used:undefined},inboundIds:[...c.ids],usedTraffic:c.used};else{success=false;msg='Obtain (record not found)'}}
  else if(url==='/panel/api/nodes/list')obj=[{id:1,enable:true,status:'online',configDirty:!!mode.get('node-pending'),xrayState:'running',lastHeartbeat:Math.floor(Date.now()/1000)},...(mode.get('unrelated-offline')?[{id:99,enable:true,status:'offline',configDirty:true}]:[])];
  else if(url==='/panel/api/server/status')obj={xray:{state:'running'}};
  else if(url==='/panel/api/clients/add'){nativeAdds++;const v=body.client;clients.set(key(p,v.email),{...v,totalGB:mode.get('bad-create-record')?v.totalGB+GB:v.totalGB,used:0,ids:new Set((mode.get('partial-add')?body.inboundIds.slice(0,1):body.inboundIds))});if(mode.get('node-pending'))obj={nodePending:true};}
  else if(url.endsWith('/attach')){nativeAttaches++;const e=decodeURIComponent(url.split('/').at(-2));const target=clients.get(key(p,e));if(target)body.inboundIds.forEach(id=>target.ids.add(id));else{success=false;msg='client not found'}if(mode.get('node-pending'))obj={nodePending:true};}
  else if(url.startsWith('/panel/api/clients/update/')){if(c){if(!m.dropUpdate)Object.assign(c,body);if(m.pendingUpdate)obj={nodePending:true};if(m.useAfterUpdate!==undefined)c.used=m.useAfterUpdate;if(m.enabledQuotas&&body.enable)m.enabledQuotas.push(c.totalGB)}else{success=false;msg='client not found'}}
  else if(url.startsWith('/panel/api/clients/del/')){nativeDeletes++;if(m.deleteAckOnly){}else if(m.badMissing){success=false;msg='API route not found'}else if(m.failB&&p==='b'){success=false;msg='temporarily unavailable'}else clients.delete(key(p,email));if(m.dirtyAfterDelete)mode.set('node-pending',true);}
  else if(url.startsWith('/panel/api/clients/resetTraffic/')){if(c){if(!m.resetAckOnly)c.used=0;m.resets=(m.resets||0)+1;if(m.dirtyAfterReset){mode.set('node-pending',true);setTimeout(()=>mode.delete('node-pending'),750)}if(m.loseResetResponse){m.loseResetResponse=false;success=false;msg='connection closed after reset'}}}
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
 if (process.argv.includes('--features-only')) {
  const rep = await owner('feature-owner', 100);
  const outsider = await owner('feature-outsider', 100);
  const customer = await seed(rep, 'feature-customer', 3);
  customer.lastSubFetch = Date.now() - 5000;
  await seed(outsider, 'feature-foreign', 4);
  const admin = await db.adminUser.create({ data: { username: 'feature-admin', password: hashPassword('fixture-only-admin') } });
  const adminCookie = 'rp_session=' + signAccountSession('ADMIN', admin, 'dashboard', Date.now() + 3600000);
  async function request(route, cookie, method='GET', body) {
    const response = await fetch(base + route, { method, headers: { Cookie: cookie || '', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => null),
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const ownerCookie = 'rp_session=' + signAccountSession('RESELLER', rep, 'dashboard', Date.now() + 3600000);


  const indicatorOwner = await owner('indicator-owner', 100);
  const indicatorClient = await seed(indicatorOwner, 'indicator-current', 3);
  const indicatorSibling = await seed(indicatorOwner, 'indicator-other', 0);
  const indicatorEndpoint = '/api/reseller/users/' + indicatorClient.email + '/renew';
  const indicatorList = async () => (await api(indicatorOwner, '/api/reseller/bootstrap')).data.users;
  const readIndicator = async () => (await indicatorList()).find(user => user.email === indicatorClient.email)?.autoRenewalEnabled;
  const initialIndicator = await readIndicator();
  const configuredIndicator = await api(indicatorOwner, indicatorEndpoint, 'PUT', { enabled: true, trafficGB: 5, days: 30 });
  const listWithIndicator = await indicatorList();
  const foreignIndicator = await api(outsider, '/api/reseller/bootstrap');
  const accountForIndicator = await db.resellerUser.findUniqueOrThrow({ where: { resellerId_email: { resellerId: indicatorOwner.id, email: indicatorClient.email } } });
  await db.setting.update({ where: { key: 'customerAutoRenewal:' + accountForIndicator.id }, data: {
    value: JSON.stringify({ trafficGB: 5, days: 30, installation: '0'.repeat(48) }),
  } });
  const restoredIndicator = await readIndicator();
  await api(indicatorOwner, indicatorEndpoint, 'PUT', { enabled: true, trafficGB: 5, days: 30 });
  await api(indicatorOwner, indicatorEndpoint, 'PUT', { enabled: false });
  const disabledIndicator = await readIndicator();
  check('bootstrap reports each owned auto-renewal preference using the same installation checks as the dialog', () => {
    assert.equal(initialIndicator, false);
    assert.equal(configuredIndicator.status, 200);
    assert.equal(listWithIndicator.find(user => user.email === indicatorClient.email).autoRenewalEnabled, true);
    assert.equal(listWithIndicator.find(user => user.email === indicatorSibling.email).autoRenewalEnabled, false);
    assert.equal(foreignIndicator.data.users.some(user => user.email === indicatorClient.email), false);
    assert.equal(restoredIndicator, false);
    assert.equal(disabledIndicator, false);
    assert.equal(indicatorClient.totalGB, 10 * GB);
    assert.equal(indicatorClient.used, 3 * GB);
  });

  const planBody = { name: 'Fixture 20', trafficGB: 20, days: 30, ipLimit: 1, expiryMode: 'first-use',
    refs: [{ panelId: panel.id, inboundId: 1 }, { panelId: panel.id, inboundId: 2 }] };
  const badPlan = await api(rep, '/api/reseller/plans', 'POST', { ...planBody, refs: [{ panelId: panel.id, inboundId: 999 }] });
  const saved = await api(rep, '/api/reseller/plans', 'POST', planBody);
  const foreign = await api(outsider, '/api/reseller/plans');
  check('plan scope uses current grants and stores no foreign plans', () => {
    assert.equal(badPlan.status, 403); assert.equal(saved.status, 201); assert.deepEqual(foreign.data.plans, []);
  });
  await db.reseller.update({ where: { id: rep.id }, data: { mirzaEnabled: true } });
  const bridgeBase = '/api/bridge/' + rep.username + '/panel/api/pvnetwork/plans';
  const bridgeCookie = 'pv_bridge=' + signAccountSession('RESELLER', rep, 'bridge', Date.now() + 3600000);
  // Login with the supported Mirza wire contract and use its scoped cookie.
  const bridgeLogin = await request('/api/bridge/' + rep.username + '/login', '', 'POST', { username: rep.username, password: 'test' });
  const credential = bridgeLogin.cookie || bridgeCookie;
  const bridgeList = await request(bridgeBase, credential);
  const packageInput = { planId: saved.data.plan.id, email: 'feature-plan-order', requestId: 'feature-plan-request' };
  const placed = await request(bridgeBase + '/create', credential, 'POST', packageInput);
  const retried = await request(bridgeBase + '/create', credential, 'POST', packageInput);
  check('explicit bridge package preserves quota, duration, all locations and idempotency', () => {
    const created = clients.get(key('a', packageInput.email));
    assert.equal(bridgeList.data.success, true, JSON.stringify(bridgeList.data));
    assert.equal(bridgeList.data.obj[0].id, saved.data.plan.id);
    assert.equal(placed.data.success, true, JSON.stringify(placed.data)); assert.equal(retried.data.success, true);
    assert.equal(created.totalGB, 20 * GB); assert.equal(created.expiryTime, -30 * 86400000);
    assert.deepEqual([...created.ids].sort(), [1, 2]);
  });
  const dotted = await request(bridgeBase + '/create', credential, 'POST', { ...packageInput, email: 'feature.plan', requestId: 'feature-dotted-order' });
  check('package bridge supports the same dotted customer names as the standard bridge', () => {
    assert.equal(dotted.data.success, true, JSON.stringify(dotted.data));
    assert.equal(clients.get(key('a', 'feature.plan')).email, 'feature.plan');
  });
  const changedPlan = await api(rep, '/api/reseller/plans', 'POST', { ...planBody, trafficGB: 25, days: 45 });
  assert.equal(changedPlan.status, 200);
  const afterEdit = await request(bridgeBase + '/create', credential, 'POST', packageInput);
  check('saved package retry returns the original funded result after the package changes', () => {
    assert.equal(afterEdit.data.success, true, JSON.stringify(afterEdit.data));
    assert.equal(afterEdit.data.obj.trafficGB, 20);
    assert.equal(afterEdit.data.obj.subId, placed.data.obj.subId);
    assert.equal(clients.get(key('a', packageInput.email)).totalGB, 20 * GB);
  });
  const changedOrder = await request(bridgeBase + '/create', credential, 'POST', { ...packageInput, planId: '00000000-0000-0000-0000-000000000001' });
  check('the same request ID cannot be reused with a different package', () => assert.equal(changedOrder.data.success, false));
  const originalJournal = await db.operationJournal.findUniqueOrThrow({
    where: { idempotencyKey: 'create-req:' + rep.id + ':' + packageInput.requestId },
  });
  const legacyMetadata = JSON.parse(originalJournal.metadata);
  delete legacyMetadata.savedPlanId;
  await db.operationJournal.update({ where: { id: originalJournal.id }, data: { metadata: JSON.stringify(legacyMetadata) } });
  await db.resellerInbound.deleteMany({ where: { resellerId: rep.id, inboundId: 2 } });
  const rejected = await request(bridgeBase + '/create', credential, 'POST', { ...packageInput, email: 'feature-rejected', requestId: 'feature-plan-rejected' });
  check('a revoked location blocks later bridge use of a saved package', () => {
    assert.equal(rejected.data.success, false); assert.equal(clients.has(key('a', 'feature-rejected')), false);
  });

  const live = await api(rep, '/api/reseller/live-users');
  check('native fetch metadata remains distinct and restricted to tracked users', () => {
    assert.equal(live.data.users.find(user => user.email === customer.email).lastSubFetch, customer.lastSubFetch);
    assert.equal(live.data.users.some(user => user.email === 'feature-foreign'), false);
  });

  const contact = await api(rep, '/api/reseller/support-contact', 'PUT', { username: '@fixture_help' });
  const portal = await request('/api/s/' + customer.subId + '?format=json');
  check('public customer portal shows scoped support while preserving the original native link', () => {
    assert.equal(contact.status, 200); assert.equal(portal.data.supportUrl, 'https://t.me/fixture_help');
    assert.equal(portal.data.subLink, native + '/sub/' + customer.subId);
  });

  const member = await api(rep, '/api/reseller/support-members', 'POST', { username: 'fixture-helper', password: 'fixture-only-long-password' });
  const login = await request('/api/auth/login', '', 'POST', { username: member.data.username, password: 'fixture-only-long-password' });
  const help = await request('/api/support/customers', login.cookie);
  const denied = await request('/api/reseller/users/' + customer.email, login.cookie, 'DELETE');
  const deniedAdmin = await request('/api/admin/operations', login.cookie);
  const deniedOthers = await request('/api/reseller/support-members?username=' + encodeURIComponent(member.data.username), 'rp_session=' +
    signAccountSession('RESELLER', outsider, 'dashboard', Date.now() + 3600000), 'DELETE');
  check('helper login is read-only and limited to the owner’s customers', () => {
    assert.equal(login.status, 200, JSON.stringify(login.data)); assert.equal(denied.status, 401); assert.equal(deniedAdmin.status, 401);
    assert.equal(deniedOthers.status, 404); assert.equal(help.status, 200);
    assert.ok(help.data.users.some(user => user.email === customer.email)); assert.ok(!help.data.users.some(user => user.email === 'feature-foreign'));
    assert.ok(help.data.users.every(user => !('subId' in user) && !('trafficGB' in user) && !('subLink' in user)));
  });

  const brokenPanel = await db.panelConfig.create({ data: { name: 'feature-unrelated', baseUrl: native+'/b',
    subBase: native, username: 'mock', password: encryptSecret('mock'), apiToken: encryptSecret('mock'), sortOrder: 42 } });
  const affected = await seed(rep, 'feature-affected', 0, brokenPanel);
  mode.set('panel-b-unavailable', true);
  const duringOutage = await request('/api/support/customers', login.cookie);
  check('an offline panel only suppresses support status for customers who need it', () => {
    assert.equal(duringOutage.status, 200);
    const healthy = duringOutage.data.users.find(row => row.email === customer.email);
    const unreadable = duringOutage.data.users.find(row => row.email === affected.email);
    assert.equal(healthy.enabled, true); assert.equal(healthy.expiry, customer.expiryTime);
    assert.equal(unreadable.enabled, null); assert.equal(unreadable.expiry, null);
  });
  await db.panelConfig.update({ where: { id: brokenPanel.id }, data: { active: false } });
  mode.delete('panel-b-unavailable');

  const stopped = await seed(rep, 'stop-date', 10);
  const stopRoute = '/api/reseller/users/' + stopped.email + '/renew';
  await api(rep, stopRoute, 'PUT', { enabled: true, trafficGB: 5, days: 30, stopAt: Date.now() - 1000 });
  const stoppedConfig = await api(rep, stopRoute);
  check('past renewal deadline is reported and leaves the exhausted quota intact', () => {
    assert.equal(stoppedConfig.data.stopped, 'date'); assert.equal(stopped.used, 10 * GB);
  });

  const webhook = '/api/admin/event-webhook';
  const deniedReceiver = await request(webhook, ownerCookie, 'PUT', { enabled: true, url: 'https://receiver.example' });
  const rejectedTarget = await request(webhook, adminCookie, 'PUT', { enabled: true, url: 'https://127.0.0.1/' });
  const receiver = await request(webhook, adminCookie, 'PUT', { enabled: true, url: 'https://receiver.example/fixture' });
  const settings = await request(webhook, adminCookie);
  check('webhook configuration is admin-only, rejects loopback URLs and never reads the secret back', () => {
    assert.equal(deniedReceiver.status, 401); assert.equal(rejectedTarget.status, 400);
    assert.match(receiver.data.secret, /^[a-f0-9]{64}$/); assert.equal(settings.data.secret, undefined);
  });

  const deleted = await api(rep, '/api/reseller/users/' + customer.email, 'DELETE');
  await api(rep, '/api/reseller/users/' + customer.email, 'DELETE');
  const deliveryRows = await db.setting.findMany({ where: { key: { startsWith: 'eventWebhookOutbox:' } } });
  const events = deliveryRows.map(row => JSON.parse(row.value).event);
  check('confirmed deletion and verified refund enqueue stable events once without links or passwords', () => {
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data)); assert.equal(deleted.data.refundedGB, 7);
    assert.deepEqual(events.map(event => event.event).sort(), ['quota.refunded', 'subscription.deleted']);
    assert.equal(events.find(event => event.event === 'quota.refunded').data.refundedGB, 7);
    assert.ok(events.every(event => !JSON.stringify(event).includes(customer.subId)));
  });

  if (process.env.TEST_WEBHOOK_WORKER === '1') {
    const { registerHooks } = await import('node:module');
    const imports = registerHooks({resolve(specifier, context, next) {
      return next(specifier.startsWith('./') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/src/lib/') ? specifier + '.ts' : specifier, context);
    }});
    try {
      const { dispatchDueWebhooks } = await import('../src/lib/event-webhooks.ts');
      const deliveries = [];
      await dispatchDueWebhooks(async (_url, id, _secret, payload) => {
        deliveries.push({ id, payload: JSON.parse(payload) });
        throw new Error('fixture receiver temporarily rejects the request');
      });
      const pending = await db.setting.findMany({ where: { key: { startsWith: 'eventWebhookOutbox:' } } });
      for (const row of pending) {
        await db.setting.update({ where: { key: row.key }, data: { value: JSON.stringify({ ...JSON.parse(row.value), nextAttempt: 0 }) } });
      }
      const replays = [];
      await dispatchDueWebhooks(async (_url, id, _secret, payload) => { replays.push({ id, payload: JSON.parse(payload) }); });
      const resulting = await db.setting.findMany({ where: { key: { startsWith: 'eventWebhookOutbox:' } } });
      check('delivery retries carry the original event IDs and preserve the committed payload', () => {
        assert.equal(deliveries.length, 2); assert.deepEqual(replays.sort((a,b) => a.id.localeCompare(b.id)), deliveries.sort((a,b) => a.id.localeCompare(b.id)));
        assert.ok(resulting.every(row => JSON.parse(row.value).status === 'sent'));
      });
    } finally { imports.deregister(); }
  }

  const feed = await api(rep, '/api/reseller/operations?pending=0');
  const globalFeed = await request('/api/admin/operations?pending=0', adminCookie);
  check('operations show confirmed accounting and hide private panel details in a reseller session', () => {
    const row = feed.data.operations.find(op => op.customer === customer.email);
    assert.equal(row.kind, 'DELETE'); assert.equal(row.status, 'SUCCESS'); assert.equal(row.accounted, true);
    assert.ok(row.targets.every(target => target.label === undefined && target.status === 'done'));
    assert.equal(globalFeed.data.operations.find(op => op.customer === customer.email).targets[0].label, 'mock');
  });

  if (process.env.PLAYWRIGHT_MODULE) {
    const { pathToFileURL } = await import('node:url');
    const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addCookies([{ name: 'rp_session', value: ownerCookie.slice(11), url: base }]);
      const page = await context.newPage();
      await page.goto(base);
      await page.getByRole('button', { name: 'کاربر جدید', exact: true }).click();
      const selector = page.getByRole('combobox', { name: 'انتخاب بستهٔ آماده' });
      await selector.selectOption(saved.data.plan.id);
      await page.getByText('بعضی لوکیشن‌های انتخابی دیگر در دسترس نیستند.', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'انصراف', exact: true }).click();
      await page.getByRole('button', { name: 'پیگیری عملیات', exact: true }).click();
      await page.getByRole('checkbox', { name: 'فقط عملیات باز' }).uncheck();
      await page.getByText(customer.email, { exact: true }).waitFor();
      await page.getByRole('button', { name: 'پشتیبانی', exact: true }).click();
      await page.getByText(member.data.username, { exact: true }).waitFor();
      await page.goto(base + '/s/' + stopped.subId);
      await page.getByRole('button', { name: 'کامپیوتر', exact: true }).click();
      assert.equal(await page.getByRole('link', { name: 'پیام به پشتیبانی', exact: true }).getAttribute('href'), 'https://t.me/fixture_help');
      check('mobile navigation and customer setup guide work', () => {});

      const indicatorContext = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
      const indicatorCookie = signAccountSession('RESELLER', indicatorOwner, 'dashboard', Date.now() + 3600000);
      await indicatorContext.addCookies([{ name: 'rp_session', value: indicatorCookie, url: base }]);
      try {
        await api(indicatorOwner, '/api/reseller/users/' + indicatorSibling.email + '/renew', 'PUT', { enabled: true, trafficGB: 4, days: 30 });
        const indicatorPage = await indicatorContext.newPage();
        await indicatorPage.route('**/api/reseller/live-users', route => route.fulfill({ status: 503, json: { error: 'fixture live data unavailable' } }));
        await indicatorPage.goto(base);
        const off = indicatorPage.getByRole('button', { name: 'تمدید خودکار خاموش برای ' + indicatorClient.email });
        const on = indicatorPage.getByRole('button', { name: 'تمدید خودکار روشن برای ' + indicatorClient.email });
        const otherOn = indicatorPage.getByRole('button', { name: 'تمدید خودکار روشن برای ' + indicatorSibling.email });
        await off.waitFor();
        await otherOn.waitFor();
        const metrics = await off.evaluate(element => ({left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, width: innerWidth}));
        assert.ok(metrics.left >= 0 && metrics.right <= metrics.width, JSON.stringify(metrics));
        assert.ok(await off.locator('xpath=ancestor::td[1]').getByText(indicatorClient.email, { exact: true }).first().isVisible());
        const red = await off.evaluate(element => getComputedStyle(element).color);
        const blue = await otherOn.evaluate(element => getComputedStyle(element).color);
        assert.notEqual(red, blue);
        assert.match(await off.getAttribute('class'), /text-red-700/);
        assert.match(await otherOn.getAttribute('class'), /text-blue-700/);
        check('mobile shows both renewal colors inside the customer name cells even without live panel stats', () => {});
        await off.tap();
        const settings = indicatorPage.getByRole('dialog', { name: 'دورهٔ جدید و تمدید خودکار' });
        const toggle = settings.getByRole('switch', { name: 'تمدید خودکار این کاربر' });
        await toggle.tap();
        const save = settings.getByRole('button', { name: 'ذخیرهٔ تنظیم تمدید خودکار' });
        await indicatorPage.route('**' + indicatorEndpoint, route => route.request().method() === 'PUT'
          ? route.fulfill({ status: 503, json: { error: 'fixture save unavailable' } }) : route.continue(), { times: 1 });
        await save.tap();
        await settings.getByRole('alert').getByText('fixture save unavailable').waitFor();
        const hiddenOff = indicatorPage.getByRole('button', { name: 'تمدید خودکار خاموش برای ' + indicatorClient.email, includeHidden: true });
        assert.match(await hiddenOff.getAttribute('class'), /text-red-700/);
        await save.tap();
        await settings.waitFor({ state: 'hidden' });
        await on.waitFor();
        await otherOn.waitFor();
        assert.equal(await readIndicator(), true);
        await on.tap();
        await toggle.tap();
        await save.tap();
        await settings.waitFor({ state: 'hidden' });
        await off.waitFor();
        assert.equal(await readIndicator(), false);
        await indicatorPage.reload();
        await off.waitFor();
        await otherOn.waitFor();
        assert.equal(indicatorClient.used, 3 * GB);
        assert.equal(indicatorClient.totalGB, 10 * GB);
        check('mobile renewal icon changes only after saving, persists after reload and leaves other users untouched', () => {});
        await indicatorPage.getByRole('link', { name: 'راهنما', exact: true }).tap();
        await indicatorPage.getByRole('heading', { name: 'منوهای پنل نماینده' }).waitFor();
        await indicatorPage.getByRole('heading', { name: 'آیکون‌های ردیف کاربر' }).waitFor();
        assert.ok(await indicatorPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        check('mobile guide lists menus and row actions and fits a 360px viewport', () => {});
      } finally { await indicatorContext.close(); }
      await db.panelConfig.update({ where: { id: panel.id }, data: { name: 'mock' } });
      mode.set('delay', true);
      try {
        const helperContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await helperContext.addCookies([{ name: 'rp_session', value: login.cookie.slice(11), url: base }]);
        const helperPage = await helperContext.newPage();
        await helperPage.goto(base);
        await helperPage.getByRole('heading', { name: 'پشتیبانی نماینده', exact: true }).waitFor();
        await helperPage.locator('article').filter({ hasText: stopped.email }).getByText('فعال', { exact: true }).waitFor({ timeout: 15000 });
        check('support status fills itself after a slow first snapshot', () => {});
        await helperContext.close();
      } finally { mode.delete('delay'); }
    } finally { await browser.close(); }
  }

  const removed = await request('/api/reseller/support-members?username=' + encodeURIComponent(member.data.username), ownerCookie, 'DELETE');
  const revoked = await request('/api/support/customers', login.cookie);
  check('revocation invalidates an already logged-in helper immediately', () => {
    assert.equal(removed.status, 204); assert.equal(revoked.status, 401);
  });

  const removedPlan = await api(rep, '/api/reseller/plans?id=' + saved.data.plan.id, 'DELETE');
  assert.equal(removedPlan.status, 200);
  const afterRemoval = await request(bridgeBase + '/create', credential, 'POST', packageInput);
  check('an already provisioned package is not reported failed after plan removal and grant revocation', () => {
    assert.equal(afterRemoval.data.success, true, JSON.stringify(afterRemoval.data));
    assert.equal(afterRemoval.data.obj.subId, placed.data.obj.subId);
  });

  const pausedOwner = await owner('manual-auto-pause', 100);
  const pausedClient = await seed(pausedOwner, 'auto-pause-customer', 3);
  const pausedUser = '/api/reseller/users/' + pausedClient.email;
  assert.equal((await api(pausedOwner, pausedUser+'/renew', 'PUT', { enabled: true, trafficGB: 5, days: 30 })).status, 200);
  const pause = await api(pausedOwner, pausedUser, 'PUT', { enable: false });
  assert.equal(pause.status, 200, JSON.stringify(pause.data));
  pausedClient.expiryTime = Date.now() - 1000;

  const limited = await seed(rep, 'stop-count', 10);
  limited.enable = false; // A native quota-exhausted state is separate from an operator action.
  const limitedRoute = '/api/reseller/users/' + limited.email + '/renew';
  await api(rep, limitedRoute, 'PUT', { enabled: true, trafficGB: 5, days: 30, maxRenewals: 1 });
  let limitedStatus;
  const deadline = Date.now() + 75000;
  do {
    limitedStatus = await api(rep, limitedRoute);
    if (limitedStatus.data.stopped === 'count') break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (Date.now() < deadline);
  check('only a completed and funded auto-renewal consumes the configured count', () => {
    assert.equal(limitedStatus.data.completed, 1); assert.equal(limitedStatus.data.stopped, 'count');
    assert.equal(limited.totalGB, 5 * GB); assert.equal(limited.used, 0); assert.equal(stopped.used, 10 * GB);
  });
  const pauseStatus = await api(pausedOwner, pausedUser+'/renew');
  check('automatic renewal neither charges nor reactivates a manually disabled dashboard customer', () => {
    assert.equal(pauseStatus.data.stopped, 'disabled'); assert.equal(pausedClient.enable, false);
    assert.equal(pausedClient.used, 3 * GB); assert.equal(pausedClient.totalGB, 10 * GB);
  });
  const atLeastOneRenewalEvent = (await db.setting.findMany({ where: { key: { startsWith: 'eventWebhookOutbox:' } } }))
    .some(row => JSON.parse(row.value).event.event === 'subscription.renewed');
  check('confirmed renewal creates a durable delivery event', () => assert.equal(atLeastOneRenewalEvent, true));
  await request(webhook, adminCookie, 'PUT', { enabled: false });
 }
 if (process.argv.includes('--renewal-only')) {
  const master=await owner('renewal-owner',60), client=await seed(master,'new-cycle',40);
  client.totalGB=40*GB;client.enable=false;
  await db.resellerUser.update({where:{resellerId_email:{resellerId:master.id,email:client.email}},data:{trafficGB:40}});
  const renew='/api/reseller/users/'+client.email+'/renew', plan={trafficGB:10,days:30,requestId:'renewal-manual-fixture'};
  const enabledQuotas=[];mode.set(client.email,{enabledQuotas});
  const outsider=await owner('renew-outsider');
  const denied=await api(outsider,renew,'POST',plan);
  check('another reseller cannot renew this subscription',()=>assert.equal(denied.status,404));
  const initial=await api(master,renew);
  check('automatic renewal defaults to off',()=>assert.deepEqual(initial.data,{plan:null}));
  const manual=await api(master,renew,'POST',plan);
  const funds=await api(master,'/api/reseller/bootstrap');
  const updated=await db.reseller.findUniqueOrThrow({where:{id:master.id}});
  check('fully used 40 GiB becomes a funded 10 GiB cycle on the same subscription',()=>{
   assert.equal(manual.status,200,JSON.stringify(manual.data));assert.equal(updated.consumedGB,40);
   assert.equal(funds.data.permissions.remainingGB,10);assert.equal(client.totalGB,10*GB);assert.equal(client.used,0);
   assert.equal(client.enable,true);assert.equal(client.subId,'sub-new-cycle');assert.equal(client.id,'uuid-new-cycle');
   assert.deepEqual(enabledQuotas,[10*GB]);
  });
  client.used=GB;
  const replay=await api(master,renew,'POST',plan);
  check('manual retry does not start or bill a second renewal',()=>{assert.equal(replay.status,200);assert.equal(client.used,GB)});
  const tooSoon=await api(master,renew,'POST',{...plan,requestId:'renewal-still-active'});
  check('a usable period cannot be discarded by the start-new-cycle action',()=>assert.equal(tooSoon.status,409));
  const expiredOwner=await owner('renew-partial-owner',50),expired=await seed(expiredOwner,'renew-partial',3);
  expired.expiryTime=Date.now()-86400000;expired.enable=false;
  const partialPlan={trafficGB:7,days:17,requestId:'renewal-retry-fixture'};
  const behavior={dropUpdate:true};mode.set(expired.email,behavior);
  const partial=await api(expiredOwner,'/api/reseller/users/renew-partial/renew','POST',partialPlan);
  let paused=await db.reseller.findUniqueOrThrow({where:{id:expiredOwner.id}});
  check('an incomplete native update keeps the account disabled and defers settlement',()=>{
   assert.equal(partial.status,202,JSON.stringify(partial.data));assert.equal(partial.data.pending,true);
   assert.equal(expired.enable,false);assert.equal(expired.used,0);assert.equal(paused.consumedGB,0);assert.equal(behavior.resets,1);
  });
  behavior.dropUpdate=false;
  const finish=await api(expiredOwner,'/api/reseller/users/renew-partial/renew','POST',partialPlan);
  paused=await db.reseller.findUniqueOrThrow({where:{id:expiredOwner.id}});
  check('retry completes the frozen cycle with the original consumption and no repeated reset',()=>{
   assert.equal(finish.status,200,JSON.stringify(finish.data));assert.equal(expired.totalGB,7*GB);assert.equal(expired.used,0);
   assert.equal(paused.consumedGB,3);assert.equal(behavior.resets,1);assert.equal(expired.enable,true);
  });
  const noFunds=await owner('renew-poor',10),poor=await seed(noFunds,'renew-no-funds',10);
  const deniedFunds=await api(noFunds,'/api/reseller/users/renew-no-funds/renew','POST',{...plan,trafficGB:2});
  check('insufficient pool blocks renewal before resetting usage',()=>{assert.equal(deniedFunds.status,403);assert.equal(poor.used,10*GB);assert.equal(poor.totalGB,10*GB)});
  const autoCases=[];
  for(const trigger of ['usage','expiry','off']){
   const rep=await owner('auto-'+trigger,50),nativeClient=await seed(rep,'auto-'+trigger,trigger==='usage'?10:2);
   if(trigger==='expiry')nativeClient.expiryTime=Date.now()-86400000;
   const route='/api/reseller/users/'+nativeClient.email+'/renew';
   const configured=await api(rep,route,'PUT',{enabled:true,trafficGB:5,days:10});
   check('owner can configure automatic renewal for '+trigger,()=>assert.equal(configured.status,200));
   if(trigger==='off'){await api(rep,route,'PUT',{enabled:false});nativeClient.used=10*GB;}
   autoCases.push({trigger,rep,nativeClient});
  }
  const deadline=Date.now()+75000;
  while(Date.now()<deadline && await db.operationJournal.count({where:{resellerId:{in:autoCases.slice(0,2).map(c=>c.rep.id)},type:'RESET',status:'SUCCESS'}})<2) {
   await new Promise(r=>setTimeout(r,500));
  }
  for(const {trigger,rep,nativeClient} of autoCases) {
   const results=await db.operationJournal.findMany({where:{resellerId:rep.id,type:'RESET',status:'SUCCESS'}});
   check('automatic renewal trigger '+trigger,()=>{
    assert.equal(results.length,trigger==='off'?0:1);
    assert.equal(nativeClient.totalGB,(trigger==='off'?10:5)*GB);
    assert.equal(nativeClient.used,(trigger==='off'?10:0)*GB);
   });
  }
 }
 if(process.argv.includes('--refund-only')) {
  for(const [name,expiry,used,refund,forfeited] of [
   ['early-delete',Date.now()+8*86400000,3,7,0],
   ['last-week-delete',Date.now()+7*86400000,3,0,7],
   ['expired-delete',Date.now()-86400000,0,0,10],
   ['unstarted-short-delete',-3*86400000,0,0,10],
   ['unstarted-long-delete',-30*86400000,0,10,0],
   ['unlimited-date-delete',0,3,7,0],
   ['overspent-delete',Date.now()+30*86400000,10.25,0,0],
  ]) {
   const r=await owner(name,100),c=await seed(r,name,used);c.expiryTime=expiry;
   const result=await api(r,'/api/reseller/users/'+name,'DELETE'),pool=await api(r,'/api/reseller/bootstrap'),after=await db.reseller.findUniqueOrThrow({where:{id:r.id}});
   check(name+' settles only the eligible unused balance, without fabricating consumption',()=>{assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.refundedGB,refund);assert.equal(after.consumedGB,used);assert.equal(pool.data.permissions.remainingGB,100-used-forfeited);if(forfeited)assert.equal(pool.data.permissions.forfeitedGB,forfeited)});
   await api(r,'/api/reseller/users/'+name,'DELETE');const again=await api(r,'/api/reseller/bootstrap');
   check(name+' retry cannot settle the same balance twice',()=>assert.equal(again.data.permissions.remainingGB,100-used-forfeited));
  }
  const r=await owner('native-portal',100),c=await seed(r,'native-portal',0),response=await fetch(base+'/api/s/'+c.subId+'?format=json'),portal=await response.json();
  check('public customer portal supplies the exact native subscription URL instead of its own page URL',()=>{assert.equal(response.status,200);assert.equal(portal.subLink,native+'/sub/'+c.subId)});
  const ownLinks=await api(r,'/api/reseller/users/'+c.email+'/links');
  check('authenticated link delivery keeps the same native subscription origin',()=>{assert.equal(ownLinks.status,200);assert.equal(ownLinks.data.subLink,native+'/sub/'+c.subId)});
  const launch=await fetch(base+'/s/'+c.subId+'/v2box?url=https://untrusted.example/&name=attacker');
  const launchHtml=await launch.text();
  check('Mirza HTTPS launcher resolves the original URL and username only from the tracked subscription',()=>{
   assert.equal(launch.status,200);assert.match(launch.headers.get('cache-control'),/no-store/);
   assert.ok(launchHtml.includes('href="v2box://install-sub?url='+encodeURIComponent(portal.subLink)+'#'+encodeURIComponent(c.email)+'"'));
   assert.ok(!launchHtml.includes('untrusted.example'));assert.ok(!launchHtml.includes('attacker'));
  });
  const unknown=await fetch(base+'/s/nonexistent-fixture/v2box');
  check('Mirza HTTPS launcher rejects missing subscriptions',()=>assert.equal(unknown.status,404));
  if(process.env.PLAYWRIGHT_MODULE){
   const {pathToFileURL}=await import('node:url'),{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)),browser=await chromium.launch({headless:true,channel:'chrome'});
   try{const context=await browser.newContext({viewport:{width:390,height:844}});await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__copiedNative=value}}}));const page=await context.newPage();await page.goto(base+'/s/'+c.subId);await page.waitForLoadState('networkidle');
    await page.getByRole('button',{name:'کپی',exact:true}).first().click();const copied=await page.evaluate(()=>window.__copiedNative);
    check('mobile portal Copy writes native X-UI URL rather than the dashboard page address',()=>assert.equal(copied,native+'/sub/'+c.subId));
    const v2box=await page.getByRole('link',{name:'افزودن با نام در V2Box',exact:true}).getAttribute('href',{timeout:4000}).catch(()=>null);
    check('mobile portal opens V2Box with the original URL and an Android-compatible subscription name',()=>{
     assert.equal(v2box,'v2box://install-sub?url='+encodeURIComponent(copied)+'#'+encodeURIComponent(c.email));
    });
    await page.getByRole('button',{name:'نمایش QR',exact:true}).first().click();await page.locator('svg[height="200"][width="200"]').first().waitFor();
    await page.screenshot({path:path.join(dir,'native-subscription-mobile.png'),fullPage:true});
    check('mobile portal displays the native link and opens its QR',()=>assert.equal(copied,portal.subLink));
   }finally{await browser.close()}
  }
  async function seedTwenty(name,used,expiryTime) {
   const reseller=await owner(name,20),client=await seed(reseller,name,used);
   client.expiryTime=expiryTime;client.totalGB=20*GB;
   await db.resellerUser.update({where:{resellerId_email:{resellerId:reseller.id,email:name}},data:{trafficGB:20}});
   return {reseller,client,path:'/api/reseller/users/'+name};
  }
  const late=await seedTwenty('late-reduction',4,Date.now()+86400000);
  const originalExpiry=late.client.expiryTime,originalSubId=late.client.subId;
  let result=await api(late.reseller,late.path,'PUT',{trafficGB:10});
  let balance=await api(late.reseller,'/api/reseller/bootstrap');
  check('20 to 10 GB in the final week releases exactly 10 unused GB and preserves usage and identity',()=>{
   assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.refundedGB,10);
   assert.equal(balance.data.permissions.remainingGB,10);assert.equal(late.client.totalGB,10*GB);assert.equal(late.client.used,4*GB);
   assert.equal(late.client.expiryTime,originalExpiry);assert.equal(late.client.subId,originalSubId);
  });
  result=await api(late.reseller,late.path,'PUT',{trafficGB:10});
  balance=await api(late.reseller,'/api/reseller/bootstrap');
  check('repeating the same reduction returns no extra quota',()=>{assert.equal(result.status,200);assert.equal(result.data.refundedGB,0);assert.equal(balance.data.permissions.remainingGB,10)});
  result=await api(late.reseller,late.path,'DELETE');
  balance=await api(late.reseller,'/api/reseller/bootstrap');
  check('deleting a reduced final-week account adds no further refund and records consumed traffic',()=>{
   assert.equal(result.status,200);assert.equal(result.data.refundedGB,0);assert.equal(result.data.debitedGB,4);assert.equal(result.data.forfeitedGB,6);
   assert.equal(balance.data.permissions.remainingGB,10);
  });
  const over=await seedTwenty('consumed-reduction',12,Date.now()+30*86400000);
  result=await api(over.reseller,over.path,'PUT',{trafficGB:10});
  balance=await api(over.reseller,'/api/reseller/bootstrap');
  check('cut beyond the usable balance explains the limit and neither updates nor refunds',()=>{
   assert.equal(result.status,403);assert.match(result.data.error,/بیشتر از حجم قابل‌کسر/);assert.match(result.data.error,/۸ گیگ/);
   assert.equal(over.client.totalGB,20*GB);assert.equal(over.client.used,12*GB);assert.equal(balance.data.permissions.remainingGB,0);
  });
  const exact=await seedTwenty('exact-reduction',10,Date.now()+30*86400000);
  result=await api(exact.reseller,exact.path,'PUT',{trafficGB:10});
  check('exact consumed-volume boundary is allowed without resetting usage',()=>{assert.equal(result.status,200);assert.equal(result.data.refundedGB,10);assert.equal(exact.client.used,10*GB)});
  const oneByteOver=await seedTwenty('byte-over-reduction',10+1/GB,Date.now()+30*86400000);
  result=await api(oneByteOver.reseller,oneByteOver.path,'PUT',{trafficGB:10});
  check('one byte over the target is still consumed volume',()=>{assert.equal(result.status,403);assert.match(result.data.error,/۹ گیگ/);assert.equal(oneByteOver.client.totalGB,20*GB)});
  const race=await seedTwenty('reduction-usage-race',4,Date.now()+30*86400000);
  mode.set('reduction-usage-race',{useAfterUpdate:10*GB+1});
  result=await api(race.reseller,race.path,'PUT',{trafficGB:10});
  balance=await api(race.reseller,'/api/reseller/bootstrap');
  check('usage that crosses the new limit during the update prevents accounting release',()=>{
   assert.equal(result.status,502);assert.equal(result.data.partial,true);assert.match(result.data.error,/مصرف در زمان ویرایش تغییر کرده/);
   assert.equal(result.data.refundedGB,undefined);assert.equal(balance.data.permissions.remainingGB,0);
  });
  const expired=await seedTwenty('expired-reduction',0,Date.now()-86400000);
  result=await api(expired.reseller,expired.path,'PUT',{trafficGB:10});
  check('unused quota can be reduced on an expired account without renewing it',()=>{
   assert.equal(result.status,200);assert.equal(result.data.refundedGB,10);assert.ok(expired.client.expiryTime<Date.now());
  });
  const locked=await owner('late-deletion-forfeit',10),lockedClient=await seed(locked,'late-deletion-forfeit',1);lockedClient.expiryTime=Date.now()+86400000;
  await api(locked,'/api/reseller/users/late-deletion-forfeit','DELETE');
  result=await api(locked,'/api/reseller/users','POST',{name:'CannotReuse',trafficGB:1,expiryDays:30,inbounds:[{panelId:panel.id,inboundId:1}],requestId:'late-refund-reuse'});
  check('forfeited balance cannot fund another creation',()=>assert.equal(result.status,403));
  const delayed=await owner('delayed-refund',100),delayedClient=await seed(delayed,'delayed-refund',3);delayedClient.expiryTime=Date.now()+8*86400000;mode.set('all-remote',true);mode.set('node-pending',true);
  result=await api(delayed,'/api/reseller/users/delayed-refund','DELETE');
  check('pending deletion retains all allocation before complete native absence proof',()=>assert.equal(result.status,202));
  delayedClient.expiryTime=Date.now()+86400000;delayedClient.used=4*GB;mode.delete('node-pending');
  result=await api(delayed,'/api/reseller/users/delayed-refund','DELETE');mode.delete('all-remote');
  check('retry retains the accepted early-delete policy while charging newly observed usage',()=>{assert.equal(result.status,200);assert.equal(result.data.refundedGB,6);assert.equal(result.data.debitedGB,4)});
  const legacy=await owner('legacy-committed-delete',100),legacyClient=await seed(legacy,'legacy-committed-delete',3),example=await db.operationJournal.findFirstOrThrow({where:{resellerId:delayed.id,type:'DELETE'}}),installation=JSON.parse(example.metadata).operationInstallation;
  clients.delete(key('a',legacyClient.email));await db.reseller.update({where:{id:legacy.id},data:{consumedGB:3}});
  await db.operationJournal.create({data:{idempotencyKey:'legacy-committed-delete',resellerId:legacy.id,userId:(await db.resellerUser.findUniqueOrThrow({where:{resellerId_email:{resellerId:legacy.id,email:legacyClient.email}}})).id,email:legacyClient.email,type:'DELETE',status:'RUNNING',accountingCommitted:true,usageSnapshotGB:3,targetPanels:JSON.stringify([panel.id]),metadata:JSON.stringify({explicitDestructive:true,operationInstallation:installation,usageByPanel:{[panel.id]:3}})}});
  result=await api(legacy,'/api/reseller/users/'+legacyClient.email,'DELETE');const legacyAfter=await db.reseller.findUniqueOrThrow({where:{id:legacy.id}});
  check('legacy deletion committed before ownership removal finishes without a second usage debit or retroactive forfeiture',()=>{assert.equal(result.status,200,JSON.stringify(result));assert.equal(legacyAfter.consumedGB,3);assert.equal(result.data.refundedGB,7);assert.equal(result.data.forfeitedGB,0)});
 }
 if(!process.argv.includes('--availability-only')&&!process.argv.includes('--refund-only')&&!process.argv.includes('--renewal-only')&&!process.argv.includes('--features-only')) {
 const r=await owner('creator');mode.set('partial-add',true);let result=await api(r,'/api/reseller/users','POST',{name:'Partial',trafficGB:10,expiryDays:30,inbounds:[1,2,3].map(inboundId=>({panelId:panel.id,inboundId})),requestId:'partial-create-fixture'});mode.delete('partial-add');
 check('partial native add is completed before create reports ready',()=>{assert.equal(result.status,200);assert.equal(clients.get(key('a',result.data.email)).ids.size,3)});
 const stableEmail=result.data.email;result=await api(r,'/api/reseller/users','POST',{name:'Partial',trafficGB:10,expiryDays:30,inbounds:[1,2,3].map(inboundId=>({panelId:panel.id,inboundId})),requestId:'partial-create-fixture'});check('create retry with relative expiry returns same account',()=>{assert.equal(result.status,200);assert.equal(result.data.email,stableEmail)});
 const committedLegacy=await db.operationJournal.findFirst({where:{idempotencyKey:'create-req:'+r.id+':partial-create-fixture'}});const committedMeta=JSON.parse(committedLegacy.metadata);delete committedMeta.done;await db.operationJournal.update({where:{id:committedLegacy.id},data:{metadata:JSON.stringify(committedMeta)}});const committedAdds=nativeAdds;
 result=await api(r,'/api/reseller/users','POST',{name:'Partial',trafficGB:10,expiryDays:30,inbounds:[1,2,3].map(inboundId=>({panelId:panel.id,inboundId})),requestId:'partial-create-fixture'});check('old crash after committed creation returns the same customer without relying on a separate done flag',()=>{assert.equal(result.status,200);assert.equal(result.data.email,stableEmail);assert.equal(nativeAdds,committedAdds)});
 mode.set('node-pending',true);const pendingPayload={name:'Pending',trafficGB:10,expiryDays:30,inbounds:[1,2,3].map(inboundId=>({panelId:panel.id,inboundId})),requestId:'pending-create-fixture'};result=await api(r,'/api/reseller/users','POST',pendingPayload);const pendingJournal=await db.operationJournal.findFirst({where:{idempotencyKey:'create-req:'+r.id+':pending-create-fixture'}});const originalId=clients.get(key('a',pendingJournal.email)).id;
 const pendingUser=await db.resellerUser.findUnique({where:{resellerId_email:{resellerId:r.id,email:pendingJournal.email}}});
 check('verified queued creation is registered once and explicitly not ready',()=>{assert.equal(result.status,202);assert.equal(result.data.pending,true);assert.equal(result.data.ready,false);assert.equal(pendingJournal.reservedGB,0);assert.equal(pendingUser.trafficGB,10)});
 const uncertain=await owner('uncertain');await seed(uncertain,'uncertain',0);await db.operationJournal.create({data:{idempotencyKey:'unknown-create-reservation',resellerId:uncertain.id,email:'uncertain',type:'CREATE',status:'NEEDS_REPAIR',reservedGB:10}});result=await api(uncertain,'/api/reseller/users/uncertain','DELETE');check('ambiguous creation cannot be deleted to refund still-live allocation',()=>assert.equal(result.status,409));
 const attemptsBefore={adds:nativeAdds,attaches:nativeAttaches};result=await api(r,'/api/reseller/users','POST',pendingPayload);
 check('queued create retry confirms local targets despite an unrelated dirty remote node without writing again',()=>{assert.equal(result.status,200);assert.equal(result.data.email,pendingJournal.email);assert.deepEqual({adds:nativeAdds,attaches:nativeAttaches},attemptsBefore)});
 mode.delete('node-pending');result=await api(r,'/api/reseller/users','POST',pendingPayload);check('pending create confirms same identity and all selected locations',()=>{assert.equal(result.status,200);assert.equal(clients.get(key('a',result.data.email)).id,originalId);assert.equal(clients.get(key('a',result.data.email)).ids.size,3);assert.deepEqual({adds:nativeAdds,attaches:nativeAttaches},attemptsBefore)});
 mode.set('node-pending',true);const unrelatedPayload={...pendingPayload,name:'Unrelated',requestId:'unrelated-offline-create'};await api(r,'/api/reseller/users','POST',unrelatedPayload);mode.delete('node-pending');mode.set('unrelated-offline',true);result=await api(r,'/api/reseller/users','POST',unrelatedPayload);check('unrelated offline node never holds a fully saved customer creation open',()=>{assert.equal(result.status,200);assert.equal(result.data.pending,false)});mode.delete('unrelated-offline');
 mode.set('bad-create-record',true);result=await api(r,'/api/reseller/users','POST',{...pendingPayload,name:'WrongQuota',requestId:'wrong-quota-create'});mode.delete('bad-create-record');check('wrong native creation fields never produce a ready or queued account',()=>assert.equal(result.status,502));
 const batch=await owner('batch',20),batchPayload={prefix:'Batch',count:2,trafficGB:10,expiryDays:30,inbounds:[1,2,3].map(inboundId=>({panelId:panel.id,inboundId})),requestId:'batch-create-fixture'};mode.set('node-pending',true);result=await api(batch,'/api/reseller/users/bulk','POST',batchPayload);check('bulk distinguishes saved pending accounts from ready accounts and failures',()=>{assert.equal(result.status,200);assert.equal(result.data.createdCount,0);assert.equal(result.data.pendingCount,2);assert.equal(result.data.failedCount,0)});mode.delete('node-pending');result=await api(batch,'/api/reseller/users/bulk','POST',batchPayload);const batchUsers=await db.resellerUser.findMany({where:{resellerId:batch.id}});check('bulk retry completes same funded accounts with an exhausted free pool',()=>{assert.equal(result.status,200);assert.equal(result.data.createdCount,2);assert.equal(batchUsers.length,2)});
 const waiting=await owner('waiting-delete',20);mode.set('node-pending',true);const waitingPayload={...pendingPayload,name:'WaitingDelete',requestId:'waiting-delete'};await api(waiting,'/api/reseller/users','POST',waitingPayload);const savedWaiting=await db.resellerUser.findFirst({where:{resellerId:waiting.id}});mode.set('all-remote',true);result=await api(waiting,'/api/reseller/users/'+savedWaiting.email,'DELETE');let waitingPool=await api(waiting,'/api/reseller/bootstrap');check('a saved creation accepts delete intent while an offline target keeps every allocated byte guarded',()=>{assert.equal(result.status,202);assert.equal(result.data.pending,true);assert.equal(waitingPool.data.permissions.remainingGB,10);assert.equal(clients.has(key('a',savedWaiting.email)),true)});clients.get(key('a',savedWaiting.email)).used=2*GB;mode.delete('node-pending');result=await api(waiting,'/api/reseller/users/'+savedWaiting.email,'DELETE');waitingPool=await api(waiting,'/api/reseller/bootstrap');check('pending delete refunds only unused volume after target recovery and counts intervening consumption',()=>{assert.equal(result.status,200);assert.equal(result.data.refundedGB,8);assert.equal(waitingPool.data.permissions.remainingGB,18)});mode.delete('all-remote');
 const lower=await owner('lower',10);await seed(lower,'decrease',9);result=await api(lower,'/api/reseller/users/decrease','PUT',{trafficGB:1});check('quota decrease cannot release already-consumed allocation',()=>assert.equal(result.status,403));
 const activatedOwner=await owner('activated-queue',30),activatedPayload={...pendingPayload,name:'Activated',expiryMode:'first-use',requestId:'activated-queue'};mode.set('node-pending',true);const activatedResult=await api(activatedOwner,'/api/reseller/users','POST',activatedPayload);const activatedJournal=await db.operationJournal.findFirst({where:{resellerId:activatedOwner.id,type:'CREATE'}});const activatedClient=clients.get(key('a',activatedJournal.email));activatedClient.expiryTime=Date.now()+30*86400000;const activatedExpiry=activatedClient.expiryTime;mode.delete('node-pending');result=await api(activatedOwner,'/api/reseller/users','POST',activatedPayload);
 check('first-use activation during a queued creation confirms without restoring birth expiry',()=>{assert.equal(activatedResult.status,202);assert.equal(result.status,200);assert.equal(activatedClient.expiryTime,activatedExpiry)});
 const disabledOwner=await owner('disabled-queue',30),disabledPayload={...pendingPayload,name:'Disabled',requestId:'disabled-queue'};mode.set('node-pending',true);await api(disabledOwner,'/api/reseller/users','POST',disabledPayload);const disabledJournal=await db.operationJournal.findFirst({where:{resellerId:disabledOwner.id,type:'CREATE'}});const disabledClient=clients.get(key('a',disabledJournal.email));disabledClient.enable=false;disabledClient.used=11*GB;mode.delete('node-pending');result=await api(disabledOwner,'/api/reseller/users','POST',disabledPayload);
 check('natural disable while queued does not prevent confirmation or reset live counters',()=>{assert.equal(result.status,200);assert.equal(disabledClient.enable,false);assert.equal(disabledClient.used,11*GB)});
 const exhausted=await owner('exhausted',10);await seed(exhausted,'exhausted',9);result=await api(exhausted,'/api/reseller/users/exhausted/reset-traffic','POST',{});check('reset cannot reuse quota when pool has no headroom',()=>{assert.equal(result.status,403);assert.equal(clients.get(key('a','exhausted')).used,9*GB)});
 const enough=await owner('enough',30);await seed(enough,'enough',9);result=await api(enough,'/api/reseller/users/enough/reset-traffic','POST',{});const resetOwner=await db.reseller.findUnique({where:{id:enough.id}});check('funded reset remains supported and consumption debited once',()=>{assert.equal(result.status,200);assert.equal(resetOwner.consumedGB,9);assert.equal(clients.get(key('a','enough')).enable,true)});
 const unused=await owner('unused',10);await seed(unused,'unused',0);result=await api(unused,'/api/reseller/users/unused','DELETE');let unusedPool=await api(unused,'/api/reseller/bootstrap');check('deleting a verified unused customer returns its full allocation immediately',()=>{assert.equal(result.status,200);assert.equal(unusedPool.data.permissions.remainingGB,10);assert.equal(result.data.refundedGB,10)});
 const overshootOwner=await owner('overshoot-reset',100),overReset=await seed(overshootOwner,'over-reset',10.2);overReset.enable=false;result=await api(overshootOwner,'/api/reseller/users/over-reset/reset-traffic','POST',{});check('reset after quota overshoot preserves quota and makes the funded valid customer usable',()=>{assert.equal(result.status,200);assert.equal(overReset.totalGB,10*GB);assert.equal(overReset.used,0);assert.equal(overReset.enable,true)});
 const manualOwner=await owner('manual-reset',100),manualReset=await seed(manualOwner,'manual-reset',2);manualReset.enable=false;result=await api(manualOwner,'/api/reseller/users/manual-reset/reset-traffic','POST',{});check('reset preserves an ordinary manual disable when quota was not exhausted',()=>{assert.equal(result.status,200);assert.equal(manualReset.enable,false);assert.equal(manualReset.used,0)});
 const expiredOwner=await owner('expired-reset',100),expiredReset=await seed(expiredOwner,'expired-reset',10.2);expiredReset.enable=false;expiredReset.expiryTime=Date.now()-1000;result=await api(expiredOwner,'/api/reseller/users/expired-reset/reset-traffic','POST',{});check('reset of exhausted traffic never reactivates an expired customer',()=>{assert.equal(result.status,200);assert.equal(expiredReset.enable,false)});
 const ackResetOwner=await owner('ack-reset',100),ackReset=await seed(ackResetOwner,'ack-reset',2);mode.set('ack-reset',{resetAckOnly:true});result=await api(ackResetOwner,'/api/reseller/users/ack-reset/reset-traffic','POST',{});check('a successful native acknowledgement without a lower counter is never reported as a successful reset',()=>assert.equal(result.status,502));ackReset.used=3*GB;mode.delete('ack-reset');result=await api(ackResetOwner,'/api/reseller/users/ack-reset/reset-traffic','POST',{});check('an unconfirmed reset is not replayed against subsequently reported traffic',()=>{assert.equal(result.status,502);assert.equal(ackReset.used,3*GB)});
 const shrink=await owner('shrink',30);await seed(shrink,'shrink',2);result=await api(shrink,'/api/reseller/users/shrink','PUT',{trafficGB:5});check('legitimate quota decrease above usage remains supported',()=>assert.equal(result.status,200));
 const renewal=await owner('renewal',50);const renewing=await seed(renewal,'renewing',21.26);renewing.enable=false;renewing.totalGB=20*GB;await db.resellerUser.update({where:{resellerId_email:{resellerId:renewal.id,email:'renewing'}},data:{trafficGB:20}});
 mode.set('renewing',{pendingUpdate:true});result=await api(renewal,'/api/reseller/users/renewing','PUT',{trafficGB:50});
 check('verified queued increase is accepted without claiming node completion',()=>{assert.equal(result.status,202);assert.equal(result.data.pending,true);assert.equal(renewing.totalGB,50*GB)});
 let queued=await db.resellerUser.findUnique({where:{resellerId_email:{resellerId:renewal.id,email:'renewing'}}});
 check('queued increase moves reservation into allocation exactly once',()=>assert.equal(queued.trafficGB,50));
 result=await api(renewal,'/api/reseller/users/renewing','PUT',{enable:true});
 check('queued increase can activate healthy locations without resetting usage',()=>{assert.equal(result.status,202);assert.equal(result.data.pending,true);assert.equal(renewing.enable,true)});
 const reserved=await db.operationJournal.findFirst({where:{resellerId:renewal.id,email:'renewing',type:'UPDATE'}});
 check('queued retry retains pending journal without double reservation',()=>{assert.equal(reserved.reservedGB,0);assert.equal(reserved.status,'PARTIAL');assert.equal(renewing.used,21.26*GB)});
 // Reproduce a legacy partially applied increase: native50, tracked20, reserved30.
 await db.resellerUser.update({where:{id:queued.id},data:{trafficGB:20}});await db.operationJournal.update({where:{id:reserved.id},data:{reservedGB:30,metadata:JSON.stringify({newTrafficGB:50})}});
 result=await api(renewal,'/api/reseller/users/renewing','PUT',{enable:true});
 check('enable-only resumes a legacy funded increase using its original quota',()=>{assert.equal(result.status,202);assert.equal(result.data.pending,true)});
 result=await api(renewal,'/api/reseller/users/renewing','PUT',{trafficGB:40});
 check('a pending update cannot change its funded target',()=>assert.equal(result.status,409));
 mode.delete('renewing');result=await api(renewal,'/api/reseller/users/renewing','PUT',{trafficGB:50});
 check('same quota retry completes with zero free pool and no duplicate charge',()=>{assert.equal(result.status,200)});
 const retarget=await owner('queued-retarget',30);const retargeted=await seed(retarget,'queued-retarget',2);mode.set('queued-retarget',{pendingUpdate:true});
 await api(retarget,'/api/reseller/users/queued-retarget','PUT',{trafficGB:20});
 result=await api(retarget,'/api/reseller/users/queued-retarget','PUT',{trafficGB:30});
 const retargetUser=await db.resellerUser.findUnique({where:{resellerId_email:{resellerId:retarget.id,email:'queued-retarget'}}});
 const retargetJournal=await db.operationJournal.findFirst({where:{resellerId:retarget.id,type:'UPDATE'}});
 check('a saved queued edit allows a subsequent funded increase',()=>{assert.equal(result.status,202);assert.equal(retargetUser.trafficGB,30);assert.equal(retargeted.totalGB,30*GB);assert.equal(retargetJournal.reservedGB,0);assert.equal(retargeted.used,2*GB)});
 result=await api(retarget,'/api/reseller/users/queued-retarget','PUT',{trafficGB:40});
 check('retargeting a saved queue cannot spend beyond the reseller pool',()=>{assert.equal(result.status,403);assert.equal(retargeted.totalGB,30*GB)});
 result=await api(retarget,'/api/reseller/users/queued-retarget','PUT',{trafficGB:25});
 check('saved queued quota cannot be reduced before synchronization',()=>{assert.equal(result.status,409);assert.equal(retargeted.totalGB,30*GB)});
 const interrupted=await owner('queued-interrupted',40);const interruptedClient=await seed(interrupted,'queued-interrupted',2);mode.set('queued-interrupted',{pendingUpdate:true});await api(interrupted,'/api/reseller/users/queued-interrupted','PUT',{trafficGB:20});
 mode.set('queued-interrupted',{pendingUpdate:true,dropUpdate:true});result=await api(interrupted,'/api/reseller/users/queued-interrupted','PUT',{trafficGB:30});
 let interruptedJournal=await db.operationJournal.findFirst({where:{resellerId:interrupted.id,type:'UPDATE'}});const interruptedUser=await db.resellerUser.findUnique({where:{resellerId_email:{resellerId:interrupted.id,email:'queued-interrupted'}}});
 check('a failed subsequent edit retains new funding and does not inherit saved status',()=>{assert.equal(result.status,502);assert.equal(interruptedJournal.reservedGB,10);assert.equal(interruptedUser.trafficGB,20);assert.equal(JSON.parse(interruptedJournal.metadata).localCommitted,false);assert.equal(JSON.parse(interruptedJournal.metadata).newTrafficGB,30)});
 mode.set('queued-interrupted',{pendingUpdate:true});result=await api(interrupted,'/api/reseller/users/queued-interrupted','PUT',{enable:true});interruptedJournal=await db.operationJournal.findUnique({where:{id:interruptedJournal.id}});
 check('retry of interrupted subsequent increase transfers its reservation once',()=>{assert.equal(result.status,202);assert.equal(interruptedClient.totalGB,30*GB);assert.equal(interruptedJournal.reservedGB,0);assert.equal(interruptedClient.used,2*GB)});
 result=await api(renewal,'/api/reseller/users/renewing','PUT',{enable:true});
 check('customer can activate after the funded increase finishes',()=>{assert.equal(result.status,200);assert.equal(renewing.enable,true);assert.equal(renewing.used,21.26*GB)});
 const over=await owner('overshoot',10);const exceeded=await seed(over,'overshoot',10.1);result=await api(over,'/api/reseller/users/overshoot','PUT',{enable:false});
 check('an exhausted customer can be disabled without lowering quota or resetting use',()=>{assert.equal(result.status,200);assert.equal(exceeded.enable,false);assert.equal(exceeded.used,10.1*GB)});
 result=await api(over,'/api/reseller/users/overshoot','PUT',{enable:true});check('activation never bypasses exhausted quota',()=>assert.equal(result.status,403));
 const invalidEnable=[];for(const enable of ['true','false',1,{},null])invalidEnable.push((await api(over,'/api/reseller/users/overshoot','PUT',{enable})).status);
 check('non-boolean status cannot bypass quota validation or change native state',()=>{assert.deepEqual(invalidEnable,[400,400,400,400,400]);assert.equal(exceeded.enable,false)});
 const delayed=await owner('queued-decrease',30);await seed(delayed,'queued-decrease',2);mode.set('queued-decrease',{pendingUpdate:true});result=await api(delayed,'/api/reseller/users/queued-decrease','PUT',{trafficGB:5});
 const decreased=await db.resellerUser.findUnique({where:{resellerId_email:{resellerId:delayed.id,email:'queued-decrease'}}});
 check('queued quota decrease never refunds the still-usable old allocation',()=>{assert.equal(result.status,502);assert.equal(decreased.trafficGB,10)});
 const unverified=await owner('unverified-queue',50);await seed(unverified,'unverified-queue',2);mode.set('unverified-queue',{pendingUpdate:true,dropUpdate:true});result=await api(unverified,'/api/reseller/users/unverified-queue','PUT',{trafficGB:20});
 const unverifiedUser=await db.resellerUser.findUnique({where:{resellerId_email:{resellerId:unverified.id,email:'unverified-queue'}}});
 check('unverified queued acknowledgement never commits local allocation',()=>{assert.equal(result.status,502);assert.equal(unverifiedUser.trafficGB,10)});
 const orphan=await seed(shrink,'orphan',3);orphan.ids=new Set();result=await api(shrink,'/api/reseller/users/orphan','DELETE');const orphanOwner=await db.reseller.findUnique({where:{id:shrink.id}});check('orphan without inbound stats deletes using verified central usage',()=>{assert.equal(result.status,200);assert.equal(orphanOwner.consumedGB,3);assert.equal(clients.has(key('a','orphan')),false)});
 const deletion=await owner('deletion');await seed(deletion,'ack-only',1);mode.set('ack-only',{deleteAckOnly:true});result=await api(deletion,'/api/reseller/users/ack-only','DELETE');const ackTracked=await db.resellerUser.findUnique({where:{resellerId_email:{resellerId:deletion.id,email:'ack-only'}}});check('fake delete success is rejected and local allocation retained',()=>{assert.ok(result.status>=400);assert.equal(ackTracked.trafficGB,10)});
 await seed(deletion,'bad-missing',1);mode.set('bad-missing',{badMissing:true});result=await api(deletion,'/api/reseller/users/bad-missing','DELETE');check('unrelated not-found response cannot release quota',()=>assert.ok(result.status>=400));
 await seed(deletion,'ambiguous-reset',1);mode.set('ambiguous-reset',{loseResetResponse:true});await api(deletion,'/api/reseller/users/ambiguous-reset/reset-traffic','POST',{});clients.get(key('a','ambiguous-reset')).used=4*GB;result=await api(deletion,'/api/reseller/users/ambiguous-reset/reset-traffic','POST',{});check('lost reset reply never clears newly accrued usage on retry',()=>{assert.ok(result.status>=400);assert.equal(clients.get(key('a','ambiguous-reset')).used,4*GB)});
 const finalize=await owner('acknowledged-delete');await seed(finalize,'acknowledged-delete',2);mode.set('all-remote',true);mode.set('acknowledged-delete',{dirtyAfterDelete:true});const deletesBefore=nativeDeletes;
 result=await api(finalize,'/api/reseller/users/acknowledged-delete','DELETE');
 check('a completed remote delete retains funding until native synchronization finishes',()=>{assert.equal(result.status,202);assert.equal(clients.has(key('a','acknowledged-delete')),false);assert.equal(nativeDeletes,deletesBefore+1)});
 mode.delete('node-pending');await api(finalize,'/api/reseller/customer-tools');const finalizedUser=await db.resellerUser.findUnique({where:{resellerId_email:{resellerId:finalize.id,email:'acknowledged-delete'}}}),finalizedOwner=await db.reseller.findUnique({where:{id:finalize.id}}),finalizedJournal=await db.operationJournal.findFirst({where:{resellerId:finalize.id,type:'DELETE'}});
 check('normal metadata refresh finishes an acknowledged delete and returns unused funding',()=>{assert.equal(finalizedUser,null);assert.equal(finalizedOwner.consumedGB,2);assert.equal(finalizedJournal.status,'SUCCESS');assert.equal(finalizedJournal.accountingCommitted,true)});
 check('read-triggered completion never repeats a native delete',()=>assert.equal(nativeDeletes,deletesBefore+1));
 await api(finalize,'/api/reseller/customer-tools');const settled=await api(finalize,'/api/reseller/bootstrap');
 check('repeated metadata refresh cannot debit or refund the completed deletion twice',()=>{assert.equal(settled.data.permissions.remainingGB,98);assert.equal(nativeDeletes,deletesBefore+1)});
 const beforeUnsafe=nativeDeletes;await api(deletion,'/api/reseller/customer-tools');const retainedAck=await db.resellerUser.findUnique({where:{resellerId_email:{resellerId:deletion.id,email:'ack-only'}}});
 check('metadata refresh leaves an ambiguous native deletion protected',()=>{assert.ok(retainedAck);assert.equal(nativeDeletes,beforeUnsafe)});mode.delete('all-remote');mode.delete('acknowledged-delete');
 const b=await db.panelConfig.create({data:{name:'mock-b',baseUrl:native+'/b',username:'mock',password:encryptSecret('mock'),apiToken:encryptSecret('mock')}});await seed(deletion,'partial-delete',1,b);mode.set('partial-delete',{failB:true});await api(deletion,'/api/reseller/users/partial-delete','DELETE');clients.get(key('b','partial-delete')).used=5*GB;mode.set('partial-delete',{});result=await api(deletion,'/api/reseller/users/partial-delete','DELETE');const d=await db.operationJournal.findFirst({where:{email:'partial-delete',type:'DELETE'}});check('partial delete retry accounts growing pending-panel usage once',()=>{assert.equal(result.status,200);assert.equal(d.usageSnapshotGB,6);assert.equal(d.accountingCommitted,true)});
 const cold=await owner('cold');const v=await seed(cold,'cold-ready',0);v.ids=new Set([1,2,3]);await db.resellerUser.update({where:{resellerId_email:{resellerId:cold.id,email:'cold-ready'}},data:{inboundIds:JSON.stringify([1,2,3].map(inboundId=>({panelId:panel.id,inboundId})))}});await db.panelConfig.update({where:{id:panel.id},data:{name:'cold-mock'}});mode.set('delay',true);const response=await fetch(base+'/api/s/'+v.subId+'?format=json');const sub=await response.json();check('cold subscription never returns missing/empty success for a ready user',()=>{assert.equal(response.status,200);assert.equal(sub.links.length,3)});
 mode.delete('delay');const revoked=await owner('revoked-create');const revokePayload={name:'Revoked',trafficGB:10,expiryDays:30,inbounds:[{panelId:panel.id,inboundId:1}],requestId:'revoked-create-fixture'};mode.set('node-pending',true);await api(revoked,'/api/reseller/users','POST',revokePayload);mode.delete('node-pending');await db.resellerInbound.deleteMany({where:{resellerId:revoked.id}});result=await api(revoked,'/api/reseller/users','POST',revokePayload);check('pending creation cannot resume into a location after permission was revoked',()=>assert.equal(result.status,403));
 const cancelOwner=await owner('cancel-unstarted-reset',100);const cancelClient=await seed(cancelOwner,'cancel-unstarted',3);
 mode.set('all-remote',true);mode.set('node-pending',true);
 result=await api(cancelOwner,'/api/reseller/users/cancel-unstarted/reset-traffic','POST',{});
 const cancelJournal=await db.operationJournal.findFirst({where:{resellerId:cancelOwner.id,email:'cancel-unstarted',type:'RESET'},orderBy:{createdAt:'desc'}});
 check('unstarted reset retains its prospective debit while a required target is unavailable',()=>{assert.equal(result.status,202);assert.equal(cancelJournal.reservedGB,3);assert.equal(cancelClient.used,3*GB)});
 let cancelMeta=await api(cancelOwner,'/api/reseller/customer-tools');
 check('pending reset exposes its exact cancellable operation to its owner',()=>{const m=cancelMeta.data.users.find(u=>u.email==='cancel-unstarted');assert.equal(m.pendingOperationId,cancelJournal.id);assert.equal(m.canCancelReset,true)});
 result=await api(r,'/api/reseller/users/cancel-unstarted/reset-traffic','DELETE',{operationId:cancelJournal.id});
 check('another owner cannot cancel the pending reset',()=>assert.equal(result.status,404));
 result=await api(cancelOwner,'/api/reseller/users/cancel-unstarted/reset-traffic','DELETE',{});
 check('cancellation requires the exact operation rather than a stale row button',()=>assert.equal(result.status,400));
 const cancellations=await Promise.all([1,2].map(()=>api(cancelOwner,'/api/reseller/users/cancel-unstarted/reset-traffic','DELETE',{operationId:cancelJournal.id})));
 const cancelled=await db.operationJournal.findUnique({where:{id:cancelJournal.id}}),cancelOwnerAfter=await db.reseller.findUnique({where:{id:cancelOwner.id}});
 check('double cancellation closes one unexecuted reset without clearing usage or granting quota',()=>{assert.ok(cancellations.every(x=>x.status===200));assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.reservedGB,0);assert.equal(cancelOwnerAfter.consumedGB,0);assert.equal(cancelOwnerAfter.trafficPoolGB,100);assert.equal(cancelClient.used,3*GB);assert.equal(cancelClient.enable,true)});
 mode.delete('node-pending');mode.delete('all-remote');
 result=await api(cancelOwner,'/api/reseller/users/cancel-unstarted','PUT',{name:'Editable again'});
 check('editing is available again after safe cancellation with usage retained',()=>{assert.equal(result.status,200);assert.equal(cancelClient.used,3*GB)});
 mode.set('all-remote',true);mode.set('node-pending',true);await api(cancelOwner,'/api/reseller/users/cancel-unstarted/reset-traffic','POST',{});
 const nextReset=await db.operationJournal.findFirst({where:{resellerId:cancelOwner.id,email:'cancel-unstarted',type:'RESET',status:'RUNNING'},orderBy:{createdAt:'desc'}});
 await api(cancelOwner,'/api/reseller/users/cancel-unstarted/reset-traffic','DELETE',{operationId:cancelJournal.id});
 const nextAfterOld=nextReset&&await db.operationJournal.findUnique({where:{id:nextReset.id}});
 check('a delayed cancellation of the old request never cancels a new reset cycle',()=>{assert.notEqual(nextReset?.id,cancelJournal.id);assert.equal(nextAfterOld?.status,'RUNNING')});
 mode.delete('node-pending');mode.delete('all-remote');result=await api(cancelOwner,'/api/reseller/users/cancel-unstarted/reset-traffic','POST',{});
 check('a fresh reset after cancellation runs once and retains the real consumed debit',()=>{assert.equal(result.status,200);assert.equal(cancelClient.used,0)});
 const finalCancelOwner=await db.reseller.findUnique({where:{id:cancelOwner.id}});check('only the actual completed reset charges the consumed volume',()=>assert.equal(finalCancelOwner.consumedGB,3));
 const beforeUnknown=clients.get(key('a','ambiguous-reset')).used;
 const uncertainResetForCancel=await db.operationJournal.findFirst({where:{resellerId:deletion.id,email:'ambiguous-reset',type:'RESET'},orderBy:{createdAt:'desc'}});
 result=await api(deletion,'/api/reseller/users/ambiguous-reset/reset-traffic','DELETE',{operationId:uncertainResetForCancel.id});
 check('a reset with an unknown write result cannot be cancelled or release newly accrued usage',()=>{assert.equal(result.status,409);assert.equal(clients.get(key('a','ambiguous-reset')).used,beforeUnknown)});
 const cancelDeleteOwner=await owner('cancel-delete-renew',100);const deleteRenewClient=await seed(cancelDeleteOwner,'cancel-delete-renew',3);
 mode.set('all-remote',true);mode.set('node-pending',true);
 result=await api(cancelDeleteOwner,'/api/reseller/users/cancel-delete-renew','DELETE');
 const deleteIntent=await db.operationJournal.findFirst({where:{resellerId:cancelDeleteOwner.id,type:'DELETE'}});
 check('offline delete intent has not changed live identity or traffic',()=>{assert.equal(result.status,202);assert.equal(deleteRenewClient.used,3*GB);assert.equal(deleteIntent.completedPanels,'[]')});
 const deleteMetadata=await api(cancelDeleteOwner,'/api/reseller/customer-tools');
 check('unexecuted deletion exposes an owner action instead of permanently blocking renewal',()=>{const m=deleteMetadata.data.users.find(u=>u.email==='cancel-delete-renew');assert.equal(m.canCancelOperation,true);assert.equal(m.pendingOperationId,deleteIntent.id)});
 result=await api(cancelDeleteOwner,'/api/reseller/users/cancel-delete-renew','PUT',{trafficGB:20});check('renewal conflict explains the exact safe recovery action without changing the account',()=>{assert.equal(result.status,409);assert.ok(result.data.error.includes('لغو درخواست و ویرایش'));assert.equal(deleteRenewClient.totalGB,10*GB)});
 result=await api(r,'/api/reseller/users/cancel-delete-renew/pending-operation','DELETE',{operationId:deleteIntent.id});check('generic cancellation cannot escape customer ownership',()=>assert.equal(result.status,404));
 result=await api(cancelDeleteOwner,'/api/reseller/users/cancel-delete-renew/pending-operation','DELETE',{});check('generic cancellation requires the exact operation identity',()=>assert.equal(result.status,400));
 result=await api(cancelDeleteOwner,'/api/reseller/users/cancel-delete-renew/pending-operation','DELETE',{operationId:deleteIntent.id});
 check('owner can cancel an unstarted deletion without refunding allocated or used traffic',()=>{assert.equal(result.status,200);assert.equal(deleteRenewClient.used,3*GB);assert.equal(deleteRenewClient.totalGB,10*GB)});
 mode.delete('all-remote');mode.delete('node-pending');
 result=await api(cancelDeleteOwner,'/api/reseller/users/cancel-delete-renew','PUT',{trafficGB:20,expiryDays:40});
 const renewedOwner=await db.reseller.findUnique({where:{id:cancelDeleteOwner.id}}),oldDelete=await db.operationJournal.findUnique({where:{id:deleteIntent.id}});
 check('renewal after cancellation preserves usage and closes the exact delete request',()=>{assert.equal(result.status,200);assert.equal(deleteRenewClient.used,3*GB);assert.equal(deleteRenewClient.totalGB,20*GB);assert.equal(oldDelete.status,'CANCELLED');assert.equal(renewedOwner.trafficPoolGB,100);assert.equal(renewedOwner.consumedGB,0)});
 result=await api(cancelDeleteOwner,'/api/reseller/users/cancel-delete-renew');check('edit preparation returns verified fresh values and references instead of a stale bootstrap row',()=>{assert.equal(result.status,200);assert.equal(result.data.user.liveFresh,true);assert.equal(result.data.user.totalGB,20);assert.equal(result.data.user.usedGB,3);assert.deepEqual(result.data.user.inboundRefs,[{panelId:panel.id,inboundId:1}]);assert.ok(!JSON.stringify(result.data).includes('uuid-cancel-delete-renew'))});
 result=await api(r,'/api/reseller/users/cancel-delete-renew');check('fresh edit preparation cannot expose another owners customer',()=>assert.equal(result.status,404));
 result=await api(cancelDeleteOwner,'/api/reseller/users/cancel-delete-renew/pending-operation','DELETE',{operationId:deleteIntent.id});check('repeated cancelled delete neither refunds nor changes the renewed account',()=>{assert.equal(result.status,200);assert.equal(deleteRenewClient.totalGB,20*GB);assert.equal(deleteRenewClient.used,3*GB)});
 mode.set('all-remote',true);mode.set('node-pending',true);await api(cancelDeleteOwner,'/api/reseller/users/cancel-delete-renew','DELETE');const freshDelete=await db.operationJournal.findFirst({where:{resellerId:cancelDeleteOwner.id,type:'DELETE',status:'RUNNING'}});await api(cancelDeleteOwner,'/api/reseller/users/cancel-delete-renew/pending-operation','DELETE',{operationId:deleteIntent.id});const freshDeleteAfterOld=await db.operationJournal.findUnique({where:{id:freshDelete.id}});check('old delete cancellation does not cancel a newly requested deletion',()=>assert.equal(freshDeleteAfterOld.status,'RUNNING'));mode.delete('all-remote');mode.delete('node-pending');
 await seed(cancelDeleteOwner,'executed-delete',1);mode.set('executed-delete',{deleteAckOnly:true});await api(cancelDeleteOwner,'/api/reseller/users/executed-delete','DELETE');
 const startedDelete=await db.operationJournal.findFirst({where:{resellerId:cancelDeleteOwner.id,email:'executed-delete',type:'DELETE'}});
 result=await api(cancelDeleteOwner,'/api/reseller/users/executed-delete/pending-operation','DELETE',{operationId:startedDelete.id});
 check('a deletion with attempted native work cannot be cancelled for a refund',()=>{assert.equal(result.status,409);assert.ok(clients.has(key('a','executed-delete')))});
 // Paid traffic survives deletion, account recreation and funded reset cycles.
 // Native statistics repeat the same email counter on all three inbounds.
 const paid=await owner('paid-delete-ledger',100),paidPayload={name:'Paid',trafficGB:20,expiryDays:30,inbounds:[1,2,3].map(inboundId=>({panelId:panel.id,inboundId})),requestId:'paid-first-create'};
 result=await api(paid,'/api/reseller/users','POST',paidPayload);assert.equal(result.status,200);const paidEmail=result.data.email;clients.get(key('a',paidEmail)).used=7*GB;
 const paidDeletes=await Promise.all([1,2].map(()=>api(paid,'/api/reseller/users/'+paidEmail,'DELETE'))),paidAfter=await db.reseller.findUnique({where:{id:paid.id}});
 result=await api(paid,'/api/reseller/bootstrap');
 check('concurrent deletion of 20 GB with 7 GB used refunds only 13 GB, with one permanent debit',()=>{assert.ok(paidDeletes.some(x=>x.status===200));assert.ok(paidDeletes.every(x=>[200,404].includes(x.status)));assert.equal(paidAfter.consumedGB,7);assert.equal(result.data.permissions.allocatedGB,0);assert.equal(result.data.permissions.remainingGB,93)});
 const paidNativeAdds=nativeAdds;result=await api(paid,'/api/reseller/users','POST',paidPayload);
 check('replaying a deleted successful create request cannot create a free replacement',()=>{assert.equal(result.status,409);assert.equal(nativeAdds,paidNativeAdds)});
 result=await api(paid,'/api/reseller/users','POST',{...paidPayload,name:'TooMuch',trafficGB:94,requestId:'paid-too-much'});
 check('recreation cannot spend the 7 GB already consumed by a deleted account',()=>{assert.equal(result.status,403);assert.equal(nativeAdds,paidNativeAdds)});
 result=await api(paid,'/api/reseller/users','POST',{...paidPayload,requestId:'paid-second-create'});assert.equal(result.status,200);const recreatedEmail=result.data.email;clients.get(key('a',recreatedEmail)).used=2*GB;
 result=await api(paid,'/api/reseller/users/'+recreatedEmail+'/reset-traffic','POST',{});assert.equal(result.status,200);const paidReset=await db.reseller.findUnique({where:{id:paid.id}});result=await api(paid,'/api/reseller/bootstrap');
 check('reset after recreation retains earlier spending and funds the cleared counter',()=>{assert.equal(paidReset.consumedGB,9);assert.equal(clients.get(key('a',recreatedEmail)).used,0);assert.equal(result.data.permissions.remainingGB,71)});
 clients.get(key('a',recreatedEmail)).used=3*GB;result=await api(paid,'/api/reseller/users/'+recreatedEmail,'DELETE');assert.equal(result.status,200);const paidFinal=await db.reseller.findUnique({where:{id:paid.id}});result=await api(paid,'/api/reseller/bootstrap');
 check('delete after reset preserves all three usage periods without replica double billing',()=>{assert.equal(paidFinal.consumedGB,12);assert.equal(result.data.permissions.remainingGB,88);assert.equal(result.data.permissions.allocatedGB,0)});
 await api(paid,'/api/reseller/users/'+recreatedEmail,'DELETE');await api(paid,'/api/reseller/customer-tools');const paidRepeat=await db.reseller.findUnique({where:{id:paid.id}});result=await api(paid,'/api/reseller/bootstrap');
 check('repeated delete and metadata completion cannot refund or debit settled traffic again',()=>{assert.equal(paidRepeat.consumedGB,12);assert.equal(result.data.permissions.remainingGB,88)});
 const paidOver=await owner('paid-delete-overshoot',100);await seed(paidOver,'paid-overshoot',11.25);result=await api(paidOver,'/api/reseller/users/paid-overshoot','DELETE');assert.equal(result.status,200);const paidOverAfter=await db.reseller.findUnique({where:{id:paidOver.id}});result=await api(paidOver,'/api/reseller/bootstrap');
 check('deletion charges the full 11.25 GB overshoot instead of capping debit at the 10 GB allocation',()=>{assert.equal(paidOverAfter.consumedGB,11.25);assert.equal(result.data.permissions.remainingGB,88.75)});
 const paidPartial=await owner('paid-partial-delete',100);await seed(paidPartial,'paid-partial',3,b);mode.set('paid-partial',{failB:true});result=await api(paidPartial,'/api/reseller/users/paid-partial','DELETE');assert.equal(result.status,502);const paidPartialPending=await db.reseller.findUnique({where:{id:paidPartial.id}});result=await api(paidPartial,'/api/reseller/bootstrap');
 check('partial deletion refunds no allocation while a native copy remains usable',()=>{assert.equal(result.data.permissions.allocatedGB,10);assert.equal(result.data.permissions.remainingGB,90);assert.equal(paidPartialPending.consumedGB,0)});
 clients.get(key('b','paid-partial')).used=5*GB;mode.delete('paid-partial');result=await api(paidPartial,'/api/reseller/users/paid-partial','DELETE');assert.equal(result.status,200);const paidPartialAfter=await db.reseller.findUnique({where:{id:paidPartial.id}});result=await api(paidPartial,'/api/reseller/bootstrap');
 check('partial deletion reconciliation charges final independent-panel traffic once',()=>{assert.equal(paidPartialAfter.consumedGB,8);assert.equal(result.data.permissions.remainingGB,92);assert.equal(result.data.permissions.allocatedGB,0)});
 // Reproduce a process crash at the real transaction boundary: native deletion
 // and the atomic consumedGB/accountingCommitted transaction already succeeded,
 // while the tracked allocation and RUNNING journal have not been closed yet.
 const paidCrash=await owner('paid-delete-commit-crash',100),crashClient=await seed(paidCrash,'paid-commit-crash',3),crashTracked=await db.resellerUser.findUniqueOrThrow({where:{resellerId_email:{resellerId:paidCrash.id,email:'paid-commit-crash'}}});
 const settledPaid=await db.operationJournal.findFirstOrThrow({where:{resellerId:paid.id,email:paidEmail,type:'DELETE',status:'SUCCESS'}}),crashMetadata=JSON.parse(settledPaid.metadata),crashNode=crashMetadata.nodeSync[panel.id];
 crashNode.email='paid-commit-crash';crashNode.steps=[{key:'master',identity:crashClient.id,status:'DONE',wasEnabled:true,usageBytes:3*GB}];crashNode.deleteTargets=['master'];crashNode.deleteVerified=true;crashMetadata.usageByPanel={[panel.id]:3};clients.delete(key('a','paid-commit-crash'));
 await db.$transaction(async tx=>{await tx.reseller.update({where:{id:paidCrash.id},data:{consumedGB:3}});await tx.operationJournal.create({data:{idempotencyKey:'paid-commit-crash',resellerId:paidCrash.id,userId:crashTracked.id,email:crashTracked.email,type:'DELETE',status:'RUNNING',usageSnapshotGB:3,accountingCommitted:true,targetPanels:JSON.stringify([panel.id]),completedPanels:JSON.stringify([panel.id]),metadata:JSON.stringify(crashMetadata)}})});
 const crashDeletes=nativeDeletes;result=await api(paidCrash,'/api/reseller/users/paid-commit-crash','DELETE');assert.equal(result.status,200);const crashAfter=await db.reseller.findUnique({where:{id:paidCrash.id}});result=await api(paidCrash,'/api/reseller/bootstrap');
 check('crash after permanent debit resumes local completion without another debit, refund, or native deletion',()=>{assert.equal(crashAfter.consumedGB,3);assert.equal(result.data.permissions.allocatedGB,0);assert.equal(result.data.permissions.remainingGB,97);assert.equal(nativeDeletes,crashDeletes)});
 const recoveredPartial=await owner('recovered-partial-delete',100);await seed(recoveredPartial,'recovered-partial',1,b);mode.set('recovered-partial',{failB:true});result=await api(recoveredPartial,'/api/reseller/users/recovered-partial','DELETE');assert.equal(result.status,502);
 mode.set('all-remote',true);mode.set('recovered-partial',{dirtyAfterDelete:true});result=await api(recoveredPartial,'/api/reseller/users/recovered-partial','DELETE');assert.equal(result.status,202);mode.delete('node-pending');mode.delete('all-remote');mode.delete('recovered-partial');await api(recoveredPartial,'/api/reseller/customer-tools');
 const recoveredUser=await db.resellerUser.findUnique({where:{resellerId_email:{resellerId:recoveredPartial.id,email:'recovered-partial'}}}),recoveredOwner=await db.reseller.findUnique({where:{id:recoveredPartial.id}}),recoveredJournal=await db.operationJournal.findFirst({where:{resellerId:recoveredPartial.id,type:'DELETE'}});
 check('old partial failure markers do not prevent read-only completion after every target later acknowledges deletion',()=>{assert.equal(recoveredUser,null);assert.equal(recoveredJournal.status,'SUCCESS');assert.equal(recoveredJournal.failedPanels,'[]');assert.equal(recoveredOwner.consumedGB,3)});
 const lateCopyOwner=await owner('late-delete-copy',100),lateCopy=await seed(lateCopyOwner,'late-delete-copy',1,b);mode.set('reappear-on-health',{email:lateCopy.email,client:{...lateCopy,enable:false}});const lateDeletes=nativeDeletes;
 result=await api(lateCopyOwner,'/api/reseller/users/late-delete-copy','DELETE');const lateCopyAfter=await db.reseller.findUnique({where:{id:lateCopyOwner.id}});const lateCopyRemaining=await api(lateCopyOwner,'/api/reseller/bootstrap');
 check('same-identity copy reappearing after native synchronization is reconciled in the original delete before refund',()=>{assert.equal(result.status,200);assert.equal(clients.has(key('a',lateCopy.email)),false);assert.equal(lateCopyAfter.consumedGB,3);assert.equal(lateCopyRemaining.data.permissions.remainingGB,97);assert.equal(nativeDeletes,lateDeletes+3)});
 const lateForeignOwner=await owner('late-foreign-copy',100),lateForeign=await seed(lateForeignOwner,'late-foreign-copy',1,b);mode.set('reappear-on-health',{email:lateForeign.email,client:{...lateForeign,id:'foreign-late-identity',enable:false}});const foreignDeletes=nativeDeletes;
 result=await api(lateForeignOwner,'/api/reseller/users/late-foreign-copy','DELETE');const lateForeignAfter=await db.reseller.findUnique({where:{id:lateForeignOwner.id}});const lateForeignPool=await api(lateForeignOwner,'/api/reseller/bootstrap');
 check('late replacement identity is never deleted or refunded by reconciliation',()=>{assert.equal(result.status,502);assert.equal(clients.get(key('a',lateForeign.email)).id,'foreign-late-identity');assert.equal(lateForeignAfter.consumedGB,0);assert.equal(lateForeignPool.data.permissions.remainingGB,90);assert.equal(nativeDeletes,foreignDeletes+2)});
 const brieflyDirty=await owner('briefly-dirty-delete',100);await seed(brieflyDirty,'briefly-dirty-delete',3);mode.set('all-remote',true);mode.set('node-pending',true);const dirtyTimer=setTimeout(()=>mode.delete('node-pending'),750);
 result=await api(brieflyDirty,'/api/reseller/users/briefly-dirty-delete','DELETE');clearTimeout(dirtyTimer);mode.delete('node-pending');mode.delete('all-remote');const brieflyDirtyAfter=await db.reseller.findUnique({where:{id:brieflyDirty.id}});
 check('a briefly dirty healthy node settles within the original delete instead of leaving an unstarted queue',()=>{assert.equal(result.status,200);assert.equal(clients.has(key('a','briefly-dirty-delete')),false);assert.equal(brieflyDirtyAfter.consumedGB,3)});
 }
 if(!process.argv.includes('--refund-only')&&!process.argv.includes('--renewal-only')&&!process.argv.includes('--features-only')) {
  const slowOwner=await owner('slow-healthy-controller',100);await seed(slowOwner,'slow-healthy-reset',3);mode.set('slow-healthy-reset',{});mode.set('catalog-delay',4500);mode.set('options-supported',true);
 let result=await api(slowOwner,'/api/reseller/inbounds');
 check('a healthy large controller snapshot taking over four seconds retains granted choices',()=>{assert.equal(result.status,200);assert.deepEqual(result.data.inbounds.map(i=>i.inboundId),[1,2,3])});
 await db.reseller.update({where:{id:slowOwner.id},data:{mirzaEnabled:true}});const slowKey=(await api(slowOwner,'/api/reseller/mirza/api-token','POST',{})).data.token;assert.ok(slowKey);
 const slowCatalogResponse=await fetch(base+'/api/bridge/'+slowOwner.username+'/panel/api/inbounds/list',{headers:{Authorization:'Bearer '+slowKey}});const slowCatalog=await slowCatalogResponse.json();
 check('Mirza receives live granted choices from the same slow healthy controller',()=>{assert.equal(slowCatalogResponse.status,200);assert.equal(slowCatalog.success,true);assert.deepEqual(slowCatalog.obj.map(i=>i.id),[1,2,3])});
 result=await api(slowOwner,'/api/reseller/users/slow-healthy-reset/reset-traffic','POST',{});const slowJournal=await db.operationJournal.findFirstOrThrow({where:{resellerId:slowOwner.id,type:'RESET'}});const slowAfter=await db.reseller.findUniqueOrThrow({where:{id:slowOwner.id}});
 check('slow healthy readiness completes the original reset without waiting for a thirty-minute observer tick',()=>{assert.equal(result.status,200);assert.equal(clients.get(key('a','slow-healthy-reset')).used,0);assert.equal(slowJournal.status,'SUCCESS');assert.equal(slowJournal.reservedGB,0);assert.equal(slowAfter.consumedGB,3);assert.equal(mode.get('slow-healthy-reset').resets,1)});
 mode.delete('options-supported');const legacySlowOwner=await owner('legacy-slow-controller',100);await seed(legacySlowOwner,'legacy-slow-reset',2);mode.set('legacy-slow-reset',{});
 result=await api(legacySlowOwner,'/api/reseller/users/legacy-slow-reset/reset-traffic','POST',{});const legacySlowAfter=await db.reseller.findUniqueOrThrow({where:{id:legacySlowOwner.id}});
 check('an older controller without the lightweight endpoint retains fresh bounded reset verification',()=>{assert.equal(result.status,200);assert.equal(legacySlowAfter.consumedGB,2);assert.equal(clients.get(key('a','legacy-slow-reset')).used,0);assert.equal(mode.get('legacy-slow-reset').resets,1)});
 mode.delete('catalog-delay');mode.set('options-supported',true);mode.set('options-invalid-node',true);const invalidNodeOwner=await owner('invalid-option-node',100);await seed(invalidNodeOwner,'invalid-option-node',3);mode.set('invalid-option-node',{});
 result=await api(invalidNodeOwner,'/api/reseller/users/invalid-option-node/reset-traffic','POST',{});const invalidNodeAfter=await db.reseller.findUniqueOrThrow({where:{id:invalidNodeOwner.id}});
 check('a present invalid node ID in lightweight metadata cannot authorize a reset or release its debit',()=>{assert.equal(result.status,202);assert.equal(clients.get(key('a','invalid-option-node')).used,3*GB);assert.equal(invalidNodeAfter.consumedGB,0);assert.equal(mode.get('invalid-option-node').resets,undefined)});
 mode.delete('options-invalid-node');mode.delete('options-supported');
 const dirtyResetOwner=await owner('briefly-dirty-reset',100);await seed(dirtyResetOwner,'briefly-dirty-reset',3);mode.set('all-remote',true);mode.set('briefly-dirty-reset',{dirtyAfterReset:true});
 result=await api(dirtyResetOwner,'/api/reseller/users/briefly-dirty-reset/reset-traffic','POST',{});mode.delete('all-remote');const dirtyResetAfter=await db.reseller.findUniqueOrThrow({where:{id:dirtyResetOwner.id}});
 check('a brief configuration push after reset settles without replaying the reset or leaving its charge reserved',()=>{assert.equal(result.status,200);assert.equal(clients.get(key('a','briefly-dirty-reset')).used,0);assert.equal(dirtyResetAfter.consumedGB,3);assert.equal(mode.get('briefly-dirty-reset').resets,1)});
 }
  console.log(JSON.stringify({checks,failures,fixture:dir}));if(failures.length)process.exitCode=1;
}catch(e){console.error(e);console.error('Fixture:',dir);process.exitCode=1}
finally{if(app){if(process.platform==='win32')await new Promise(resolve=>{const p=spawn('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{windowsHide:true});p.on('exit',resolve)});else app.kill('SIGTERM')}if(server){server.closeAllConnections();server.close()}if(db)await db.$disconnect()}
