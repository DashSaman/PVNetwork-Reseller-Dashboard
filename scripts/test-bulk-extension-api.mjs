// Self-contained integration fixture: real Prisma/SQLite and Next routes, mock remote panels.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.local-dev', `bulk-test-${Date.now()}`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'test.db'), '');
process.env.DATABASE_URL = `file:../.local-dev/${path.basename(dir)}/test.db`;
process.env.APP_SECRET = 'bulk-extension-isolated-test-secret';
const { PrismaClient } = await import('@prisma/client');
const { hashPassword, signAccountSession, encryptSecret } = await import('../src/lib/crypto.ts');
const GB = 1073741824, EXPIRY = 2000000000000;
const mocks = [];
let app, db, r, checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
const original = email => ({ email, id: `uuid-${email}`, limitIp: 3, totalGB: 10 * GB, expiryTime: EXPIRY, enable: false, subId: `sub-${email}`, flow: 'xtls-rprx-vision', tgId: '42', reset: 7 });
async function mockPanel(name) {
  const clients = new Map(['u1', 'u2', 'outsider'].map(e => [e, original(e)]));
  const mock = { clients, failUpdate: false, writes: 0, server: null, base: '', beforeUpdate: null, exportReads: 0 };
  const nativePath = path.join(dir, `${name}.db`);
  const nativeDb = new DatabaseSync(nativePath);
  nativeDb.exec("CREATE TABLE clients(email TEXT, uuid TEXT); INSERT INTO clients VALUES('u1','uuid-u1');");
  nativeDb.close();
  const server = http.createServer(async (req, res) => {
    if (req.url === '/panel/api/server/getDb') {
      mock.exportReads++;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(readFileSync(nativePath)); return;
    }
    let raw = ''; for await (const chunk of req) raw += chunk;
    let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
    let obj = null, success = true, msg = '';
    if (req.url === '/panel/api/inbounds/list') obj = [{ id: 1, port: 443, protocol: 'vless', tag: name, settings: JSON.stringify({ clients: [...clients.values()] }), clientStats: [...clients.values()].map(c => ({ email: c.email, up: GB, down: 2 * GB, total: c.totalGB, expiryTime: c.expiryTime, enable: c.enable })) }];
    else if (req.url.startsWith('/panel/api/clients/get/')) {
      const c = clients.get(decodeURIComponent(req.url.split('/').at(-1)));
      if (c) obj = { client: { ...c, uuid: c.id }, inboundIds: [1], usedTraffic: 3 * GB };
      else { success = false; msg = 'Obtain (record not found)'; }
    } else if (req.url.startsWith('/panel/api/clients/update/')) {
      const email = decodeURIComponent(req.url.split('/').at(-1));
      if (mock.beforeUpdate) await mock.beforeUpdate(email);
      if (mock.failUpdate) { success = false; msg = 'mock panel offline'; }
      else { const { uuid, ...patch } = body; clients.set(email, { ...clients.get(email), ...patch }); mock.writes++; }
    } else if (req.url === '/panel/api/clients/onlines') obj = [];
    else if (req.url === '/panel/api/clients/list') obj = [...clients.values()];
    else { success = false; msg = `unimplemented ${req.url}`; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success, msg, obj }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  mock.server = server; mock.base = `http://127.0.0.1:${server.address().port}`;
  mocks.push(mock); return mock;
}
async function child(cmd, args, env = process.env) {
  await new Promise((resolve, reject) => { const c = spawn(cmd, args, { cwd: root, env, windowsHide: true, stdio: 'inherit' }); c.on('error', reject); c.on('exit', code => code === 0 ? resolve() : reject(new Error(`process exit ${code}`))); });
}
try {
  await child(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate']);
  db = new PrismaClient();
  const a = await mockPanel('DE'), b = await mockPanel('FI');
  const pa = await db.panelConfig.create({ data: { name: 'Mock A', baseUrl: a.base, username: 'mock', password: encryptSecret('mock'), apiToken: encryptSecret('mock-token') } });
  const pb = await db.panelConfig.create({ data: { name: 'Mock B', baseUrl: b.base, username: 'mock', password: encryptSecret('mock'), apiToken: encryptSecret('mock-token') } });
  const refs = [{ panelId: pa.id, inboundId: 1 }, { panelId: pb.id, inboundId: 1 }];
  const admin = await db.adminUser.create({ data: { username: 'admin', password: hashPassword('LocalDemo123!') } });
  const reseller = await db.reseller.create({ data: { username: 'bulk_test', password: hashPassword('LocalDemo123!'), trafficPoolGB: 25, multiLocation: true } });
  const outsider = await db.reseller.create({ data: { username: 'other_owner', password: hashPassword('LocalDemo123!'), trafficPoolGB: 100 } });
  for (const ref of refs) await db.resellerInbound.create({ data: { resellerId: reseller.id, ...ref, inboundTag: 'mock', protocol: 'vless', port: 443 } });
  for (const email of ['u1', 'u2']) await db.resellerUser.create({ data: { resellerId: reseller.id, email, trafficGB: 10, subId: `sub-${email}`, panelId: pa.id, inboundIds: JSON.stringify(refs) } });
  await db.resellerUser.create({ data: { resellerId: outsider.id, email: 'outsider', trafficGB: 10, subId: 'sub-outsider', panelId: pa.id, inboundIds: JSON.stringify(refs) } });
  const token = (role, uid) => 'rp_session=' + signAccountSession(role, [admin, reseller, outsider].find(a => a.id === uid), 'dashboard', Date.now() + 3600000);
  const ac = token('ADMIN', admin.id, 'admin'), rc = token('RESELLER', reseller.id, reseller.username);
  const temp = net.createServer(); await new Promise(r => temp.listen(0, '127.0.0.1', r)); const port = temp.address().port; await new Promise(r => temp.close(r));
  const base = `http://127.0.0.1:${port}`;
  const log = createWriteStream(path.join(dir, 'next.log'));
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, windowsHide: true });
  app.stdout.pipe(log, { end: false }); app.stderr.pipe(log, { end: false });
  for (let n = 0; n < 120; n++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); if (n === 119) throw new Error(`app failed to start; see ${dir}/next.log`); }
  const url = `/api/admin/resellers/${reseller.id}/bulk-extension`;
  async function api(route, body, cookie = ac, method = body ? 'POST' : 'GET') { const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; }
  r = await api(url, null, ''); check('anonymous denied', () => assert.equal(r.status, 401));
  r = await api(url, { mode: 'preview', trafficGB: 5, days: 2 }, rc); check('reseller denied', () => assert.equal(r.status, 401));
  const ownUrl = '/api/reseller/users/bulk-extension';
  r = await api(ownUrl, { mode: 'preview', trafficGB: 0, days: 1, resellerId: outsider.id }, rc);
  check('reseller can preview own group and cannot choose a different owner', () => { assert.equal(r.status, 200); assert.equal(r.data.preview.affected, 2); });
  r = await api(url, { mode: 'preview', trafficGB: 5, days: 2 });
  check('whole group rejected for insufficient pool with no panel writes', () => { assert.equal(r.status, 400); assert.equal(a.writes + b.writes, 0); });
  await db.reseller.update({ where: { id: reseller.id }, data: { trafficPoolGB: 40 } });
  r = await api(url, { mode: 'preview', trafficGB: 5, days: 2 });
  const preview = r.data.preview;
  check('preview counts only selected owner and correct total delta', () => { assert.equal(r.status, 200); assert.equal(preview.affected, 2); assert.equal(preview.requiredGB, 10); });
  r = await api(url, { mode: 'start', trafficGB: 5, days: 2, hash: 'forged', requestId: 'test-forged-12345678' });
  check('stale or forged preview cannot reserve or mutate', () => { assert.equal(r.status, 409); assert.equal(a.writes + b.writes, 0); });
  const startBody = { mode: 'start', trafficGB: 5, days: 2, hash: preview.hash, requestId: 'test-request-12345678' };
  r = await api(url, startBody); const jobId = r.data.job.jobId;
  check('all quota reserved before the first panel write', () => { assert.equal(r.status, 200); assert.equal(a.writes + b.writes, 0); });
  const reserved = await db.operationJournal.aggregate({ where: { resellerId: reseller.id, type: 'UPDATE' }, _sum: { reservedGB: true } });
  assert.equal(reserved._sum.reservedGB, 10);
  assert.equal((await api(url, startBody)).data.job.jobId, jobId);
  const otherUrl = `/api/admin/resellers/${outsider.id}/bulk-extension`;
  r = await api(otherUrl, { mode: 'run', jobId }); check('job cannot run under another owner', () => assert.equal(r.status, 404));
  r = await api(ownUrl + '?jobId=' + jobId, null, token('RESELLER', outsider.id, outsider.username));
  check('reseller cannot inspect another owner group job', () => assert.equal(r.status, 404));
  r = await api('/api/reseller/users', { name: 'overquota', trafficGB: 15, inbounds: refs }, rc);
  check('new users cannot spend volume reserved by bulk', () => { assert.equal(r.status, 403); assert.equal(a.writes + b.writes, 0); });
  r = await api('/api/reseller/users/u1', null, rc, 'DELETE');
  check('delete cannot interleave with bulk', () => { assert.equal(r.status, 409); assert.equal(a.writes + b.writes, 0); });
  r = await api(`/api/admin/resellers/${reseller.id}`, { trafficPoolGB: 25 }, ac, 'PUT');
  check('admin pool cannot shrink below allocated plus reserved volume', () => assert.equal(r.status, 409));
  r = await api(`/api/reseller/users/u1`, { trafficGB: 15 }, rc, 'PUT');
  check('single-user edit cannot bypass bulk reservation or mutate remote first', () => { assert.equal(r.status, 409); assert.equal(a.writes + b.writes, 0); });
  r = await api(`/api/reseller/users/u1/reset-traffic`, {}, rc);
  check('reset cannot interleave with bulk', () => { assert.equal(r.status, 409); assert.equal(a.writes + b.writes, 0); });
  b.failUpdate = true;
  r = await api(url, { mode: 'run', jobId });
  check('partial remote failure retains quota reservation and local allocation', () => { assert.equal(r.data.job.status, 'PARTIAL'); assert.equal(r.data.job.done, 0); assert.equal(a.clients.get('u1').totalGB, 15 * GB); });
  assert.equal((await db.resellerUser.findFirst({ where: { resellerId: reseller.id, email: 'u1' } })).trafficGB, 10);
  // Restart the actual Next process; reservations and per-panel progress must survive.
  if (process.platform === 'win32') await child('taskkill.exe', ['/PID', String(app.pid), '/T', '/F']); else app.kill('SIGTERM');
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, windowsHide: true });
  app.stdout.pipe(log, { end: false }); app.stderr.pipe(log, { end: false });
  for (let n = 0; n < 120; n++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 500)); if (n === 119) throw new Error('restart failed'); }
  assert.equal((await api(url)).data.job.jobId, jobId);
  check('actual process restart keeps durable per-panel progress and reservations', () => assert.equal(a.clients.get('u1').totalGB, 15 * GB));
  b.failUpdate = false;
  for (let i = 0; i < 3; i++) { r = await api(url, { mode: 'run', jobId }); if (!r.data.job.pending) break; }
  check('resume completes all users and releases reservations', () => { assert.equal(r.data.job.status, 'SUCCESS'); assert.equal(r.data.job.done, 2); });
  const beforeRepeat = a.writes + b.writes;
  await api(url, { mode: 'run', jobId }); await api(url, startBody);
  check('successful request replay does not add again', () => assert.equal(a.writes + b.writes, beforeRepeat));
  for (const m of [a, b]) for (const email of ['u1', 'u2']) check(`${email} quota/expiry/connection fields preserved`, () => assert.deepEqual(m.clients.get(email), { ...original(email), totalGB: 15 * GB, expiryTime: 2000172800000 }));
  check('other owner unchanged', () => { assert.deepEqual(a.clients.get('outsider'), original('outsider')); assert.deepEqual(b.clients.get('outsider'), original('outsider')); });
  const fresh = await db.reseller.findUnique({ where: { id: reseller.id } }); assert.equal(fresh.trafficPoolGB, 40); assert.equal(fresh.consumedGB, 0);
  assert.equal((await db.operationJournal.aggregate({ where: { resellerId: reseller.id }, _sum: { reservedGB: true } }))._sum.reservedGB, 0);
  // A name-only edit queued behind the final bulk step must not restore a stale quota/expiry.
  await api('/api/reseller/users/u2', { name: 'warm route without authorization' }, '', 'PUT');
  r = await api(url, { mode: 'preview', trafficGB: 0, days: 1 });
  const p2 = r.data.preview;
  r = await api(url, { mode: 'start', trafficGB: 0, days: 1, hash: p2.hash, requestId: 'test-concurrent-12345678' });
  const job2 = r.data.job.jobId;
  await api(url, { mode: 'run', jobId: job2 });
  let release, reached;
  const hold = new Promise(resolve => { release = resolve; });
  const reachedPromise = new Promise(resolve => { reached = resolve; });
  b.beforeUpdate = async email => { if (email === 'u2') { reached(); await hold; } };
  const finalStep = api(url, { mode: 'run', jobId: job2 });
  await Promise.race([reachedPromise, new Promise((_, reject) => { setTimeout(() => reject(new Error('bulk step never reached controlled panel write')), 10000).unref(); })]);
  const queued = api('/api/reseller/users/u2', { name: 'queued name edit' }, rc, 'PUT');
  await new Promise(resolve => setTimeout(resolve, 300));
  release(); await finalStep;
  r = await queued; b.beforeUpdate = null;
  check('queued stale single-user defaults cannot undo completed time extension', () => { assert.equal(r.status, 409); assert.equal(b.clients.get('u2').expiryTime, 2000259200000); });
  // First-use activation before a user's turn should still get an exact time extension.
  for (const m of [a, b]) m.clients.get('u1').expiryTime = -86400000;
  r = await api(url, { mode: 'preview', trafficGB: 0, days: 2 });
  const p3 = r.data.preview;
  r = await api(url, { mode: 'start', trafficGB: 0, days: 2, hash: p3.hash, requestId: 'test-first-use-12345678' });
  const job3 = r.data.job.jobId;
  for (const m of [a, b]) m.clients.get('u1').expiryTime = 2100000000000;
  r = await api(url, { mode: 'run', jobId: job3 });
  check('first-use activation before step extends the activated expiration', () => { assert.equal(r.data.job.done, 1); assert.equal(a.clients.get('u1').expiryTime, 2100172800000); });
  await api(url, { mode: 'run', jobId: job3 });
  r = await api(ownUrl, { mode: 'preview', trafficGB: 0, days: 1 }, rc);
  const ownPreview = r.data.preview;
  r = await api(ownUrl, { mode: 'start', trafficGB: 0, days: 1, hash: ownPreview.hash, requestId: 'test-reseller-own-12345678', resellerId: outsider.id }, rc);
  const ownJobId = r.data.job.jobId;
  do { r = await api(ownUrl, { mode: 'run', jobId: ownJobId }, rc); } while (r.data.job.pending && r.data.job.status !== 'PARTIAL');
  check('reseller executes own group with reseller audit attribution', () => { assert.equal(r.data.job.done, 2); assert.equal(r.data.job.status, 'SUCCESS'); });
  const ownLog = await db.activityLog.findFirst({ where: { resellerId: reseller.id, action: 'تکمیل افزایش گروهی حجم و زمان' }, orderBy: { createdAt: 'desc' } });
  assert.equal(ownLog.actorType, 'RESELLER'); assert.equal(ownLog.actorName, reseller.username);
  assert.deepEqual(a.clients.get('outsider'), original('outsider'));
  r = await api('/api/admin/backups', null, ''); check('backup list denies anonymous', () => assert.equal(r.status, 401));
  r = await api('/api/admin/backups', {}, rc); check('backup creation denies representatives', () => assert.equal(r.status, 401));
  r = await api('/api/admin/backups', {});
  const created = r.data?.backup;
  check('admin creates complete dashboard backup without contacting connected panels', () => { assert.equal(r.status, 200); assert.equal(created.complete, true); assert.equal(created.panelCount, 0); assert.equal(a.exportReads+b.exportReads, 0); });
  r = await api('/api/admin/backups');
  check('backup list excludes recovery secrets', () => { assert.equal(r.data.files.length, 1); assert.ok(!JSON.stringify(r.data).includes(process.env.APP_SECRET)); });
  const downloaded = await fetch(base + '/api/admin/backups?download=' + created.name, { headers: { Cookie: ac } });
  assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get('content-type'), 'application/zip');
  assert.equal(downloaded.headers.get('cache-control'), 'private, no-store');
  const zipPath = path.join(dir, 'download.zip'); writeFileSync(zipPath, Buffer.from(await downloaded.arrayBuffer()));
  const restorePath = path.join(dir, 'restore');
  await child(process.platform === 'win32' ? 'python' : 'python3', ['scripts/panel-backup.py', 'restore', zipPath, restorePath]);
  const restored = new DatabaseSync(path.join(restorePath, 'data/custom.db'));
  const journalCount = await db.operationJournal.count();
  check('downloaded archive restores real dashboard users and encrypted credentials', () => {
    assert.equal(restored.prepare('SELECT count(*) AS n FROM ResellerUser').get().n, 3);
    assert.equal(restored.prepare('SELECT password FROM Reseller WHERE id=?').get(reseller.id).password, fresh.password);
    assert.equal(restored.prepare('SELECT count(*) AS n FROM OperationJournal').get().n, journalCount);
  });
  restored.close();
  check('download includes recovery key and all stored panel connection settings', () => {
    assert.equal(readFileSync(path.join(restorePath, 'recovery.env'), 'utf8').trim(), 'APP_SECRET=' + process.env.APP_SECRET);
    const restored = new DatabaseSync(path.join(restorePath, 'data/custom.db'));
    assert.equal(restored.prepare('SELECT apiToken FROM PanelConfig WHERE id=?').get(pa.id).apiToken, pa.apiToken); restored.close();
  });
  r = await api('/api/admin/backups?download=../../custom.db'); check('download rejects traversal', () => assert.equal(r.status, 404));
  r = await api('/api/admin/backups?download=' + created.name, null, rc); check('representative cannot download admin backup', () => assert.equal(r.status, 401));
  writeFileSync(path.join(root, '.local-dev', 'bulk-ui.json'), JSON.stringify({ base, cookie: ac, representativeCookie: rc, fixtureDir: dir }));
  console.log(`INTEGRATION PASS: ${checks} checks; fixture ${base}; log ${dir}/next.log`);
  if (process.argv.includes('--keep')) { console.log('UI_READY: press Enter to stop fixture'); await new Promise(r => process.stdin.once('data', r)); }
} catch (e) { console.error(e); console.error(`Fixture logs: ${dir}`); process.exitCode = 1; }
finally {
  if (app) { if (process.platform === 'win32') await child('taskkill.exe', ['/PID', String(app.pid), '/T', '/F']).catch(() => {}); else app.kill('SIGTERM'); }
  for (const m of mocks) m.server.close();
  if (db) await db.$disconnect();
}
