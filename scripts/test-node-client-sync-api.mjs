// Real routes, journals and SQLite; isolated master + HTTPS unlinked node fixtures.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.local-dev', `node-sync-${Date.now()}`);
mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, 'test.db'), '');
process.env.DATABASE_URL = `file:../.local-dev/${path.basename(dir)}/test.db`;
process.env.APP_SECRET = 'isolated-node-sync-test-key';
const { PrismaClient } = await import('@prisma/client');
const { encryptSecret, hashPassword, signAccountSession } = await import('../src/lib/crypto.ts');
let db, app, checks = 0; const servers = [];
const GB = 1073741824;
const check = (name, fn) => { fn(); checks++; console.log('PASS', name); };
const client = e => ({ email: e, id: `uuid-${e}`, uuid: `uuid-${e}`, subId: `sub-${e}`, totalGB: 10 * GB, expiryTime: 2000000000000, enable: false, limitIp: 0, reset: 7 });
const certPy = `from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime,timedelta,timezone
import pathlib,sys
p=pathlib.Path(sys.argv[1]);k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'node.test')]);now=datetime.now(timezone.utc)
c=x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=2)).add_extension(x509.SubjectAlternativeName([x509.DNSName('node.test')]),critical=False).add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).sign(k,hashes.SHA256())
(p/'cert.pem').write_bytes(c.public_bytes(serialization.Encoding.PEM));(p/'key.pem').write_bytes(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))`;
execFileSync('python', ['-c', certPy, dir], { windowsHide: true });
async function mock(isNode) {
  const clients = new Map(['u1', 'u2'].map(e => [e, client(e)]));
  if (isNode) for (const c of clients.values()) { c.totalGB = 5 * GB; c.limitIp = 3; }
  const m = { clients, fail: false, writes: 0, resets: 0, used: 3 * GB };
  const handler = async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
    let success = true, obj, msg = '';
    if (m.fail) { success = false; msg = 'offline'; }
    else if (req.url === '/panel/api/inbounds/list') obj = [{ id: 1, tag: 'mock', port: 443, protocol: 'vless', settings: JSON.stringify({ clients: [...clients.values()] }), clientStats: [...clients.values()].map(c => ({ email: c.email, up: m.used, down: 0, total: c.totalGB, expiryTime: c.expiryTime, enable: c.enable })) }];
    else if (req.url.startsWith('/panel/api/clients/get/')) {
      const c = clients.get(decodeURIComponent(req.url.split('/').at(-1)));
      if (c) obj = { client: c, inboundIds: [1], usedTraffic: m.used }; else { success = false; msg = 'Obtain (record not found)'; }
    } else if (req.url.startsWith('/panel/api/clients/update/')) { const e = decodeURIComponent(req.url.split('/').at(-1)); clients.set(e, { ...clients.get(e), ...body }); m.writes++; }
    else if (req.url.startsWith('/panel/api/clients/resetTraffic/')) { m.resets++; m.used = 0; }
    else if (req.url.startsWith('/panel/api/clients/del/')) { clients.delete(decodeURIComponent(req.url.split('/').at(-1))); }
    else if (req.url === '/panel/api/clients/list') obj = [...clients.values()];
    else if (req.url === '/panel/api/clients/onlines') obj = [];
    else { success = false; msg = 'unimplemented'; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success, obj, msg }));
  };
  const s = isNode ? https.createServer({ key: readFileSync(path.join(dir, 'key.pem')), cert: readFileSync(path.join(dir, 'cert.pem')) }, handler) : http.createServer(handler);
  servers.push(s); await new Promise(r => s.listen(0, '127.0.0.1', r));
  return { ...m, server: s, base: `${isNode ? 'https://node.test' : 'http://127.0.0.1'}:${s.address().port}`, state: m };
}
async function child(cmd, args) { await new Promise((resolve, reject) => { const c = spawn(cmd, args, { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true }); c.on('error', reject); c.on('exit', n => n === 0 ? resolve() : reject(Error('child ' + n))); }); }
try {
  await child(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate']); db = new PrismaClient();
  const master = await mock(false), node = await mock(true);
  const p = await db.panelConfig.create({ data: { name: 'master', baseUrl: master.base, username: 'mock', password: encryptSecret('mock'), apiToken: encryptSecret('mock') } });
  const peers = [{ key: 'de', baseUrl: node.base, token: 'secret-node-token', masterInboundIds: [142], tls: { connectHost: '127.0.0.1', ca: readFileSync(path.join(dir, 'cert.pem'), 'utf8') } }];
  await db.setting.create({ data: { key: `nodeSyncPeers:${p.id}`, value: encryptSecret(JSON.stringify(peers)) } });
  const owner = await db.reseller.create({ data: { username: 'owner', password: hashPassword('test'), trafficPoolGB: 100, multiLocation: true } });
  const refs = [{ panelId: p.id, inboundId: 1 }];
  await db.resellerInbound.create({ data: { resellerId: owner.id, panelId: p.id, inboundId: 1, inboundTag: 'mock', protocol: 'vless', port: 443 } });
  for (const e of ['u1', 'u2']) await db.resellerUser.create({ data: { resellerId: owner.id, email: e, subId: 'sub-' + e, trafficGB: 10, panelId: p.id, inboundIds: JSON.stringify(refs) } });
  const admin = await db.adminUser.create({ data: { username: 'admin', password: hashPassword('test-admin') } });
  const ac = 'rp_session=' + signAccountSession('ADMIN', admin, 'dashboard', Date.now() + 3600000);
  const rc = 'rp_session=' + signAccountSession('RESELLER', owner, 'dashboard', Date.now() + 3600000);
  const tmp = net.createServer(); await new Promise(r => tmp.listen(0, '127.0.0.1', r)); const port = tmp.address().port; await new Promise(r => tmp.close(r));
  const base = `http://127.0.0.1:${port}`, log = createWriteStream(path.join(dir, 'next.log'));
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, windowsHide: true }); app.stdout.pipe(log); app.stderr.pipe(log);
  for (let n = 0; n < 120; n++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); if (n === 119) throw Error('startup failed'); }
  async function api(route, body, method = 'POST', cookie = rc) { const r = await fetch(base + route, { method, headers: { Cookie: cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; }
  let r = await api('/api/reseller/users/u1', { trafficGB: 15, enable: true }, 'PUT');
  check('real edit reaches unlinked HTTPS node and preserves local device limit', () => { assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(node.clients.get('u1').totalGB, 15 * GB); assert.equal(node.clients.get('u1').limitIp, 3); assert.equal(node.clients.get('u1').enable, true); });
  check('allocation commits once without debiting existing consumption', () => { assert.equal(master.clients.get('u1').totalGB, 15 * GB); });
  node.state.fail = true;
  r = await api('/api/reseller/users/u1', { trafficGB: 20 }, 'PUT');
  check('unavailable node fails preflight and master stays at old quota', () => { assert.equal(r.status, 502); assert.equal(master.clients.get('u1').totalGB, 15 * GB); });
  const partial = await db.operationJournal.findFirst({ where: { email: 'u1', status: 'PARTIAL' } });
  const retained = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId: owner.id, email: 'u1' } } });
  check('failed preflight creates no partial write or unnecessary reservation', () => { assert.equal(partial, null); assert.equal(retained.trafficGB, 15); });
  node.state.fail = false; r = await api('/api/reseller/users/u1', { trafficGB: 20 }, 'PUT');
  check('retry converges to absolute quota and releases reservation', () => { assert.equal(r.status, 200); assert.equal(node.clients.get('u1').totalGB, 20 * GB); });
  const bulk = `/api/admin/resellers/${owner.id}/bulk-extension`;
  r = await api(bulk, { mode: 'preview', trafficGB: 1, days: 2 }, 'POST', ac); const preview = r.data.preview;
  r = await api(bulk, { mode: 'start', trafficGB: 1, days: 2, hash: preview.hash, requestId: 'node-sync-bulk-12345678' }, 'POST', ac); const jobId = r.data.job.jobId;
  r = await api(bulk, { mode: 'run', jobId }, 'POST', ac);
  if (r.data.job.status === 'RUNNING') r = await api(bulk, { mode: 'run', jobId }, 'POST', ac);
  check('bulk extension reaches each node copy, retaining deliberate disable', () => { assert.equal(r.data.job.status, 'SUCCESS', JSON.stringify(r.data)); assert.equal(node.clients.get('u2').totalGB, 11 * GB); assert.equal(node.clients.get('u2').expiryTime, 2000000000000 + 2 * 86400000); assert.equal(node.clients.get('u2').enable, false); });
  r = await api('/api/reseller/users/u1/reset-traffic', {});
  check('journal reset reaches both copies exactly once', () => { assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(node.state.resets, 1); assert.equal(master.state.resets, 1); });
  const reset = await db.operationJournal.findFirst({ where: { email: 'u1', type: 'RESET' } });
  check('reset progress durable and billing counts only canonical usage', () => { assert.equal(reset.status, 'SUCCESS'); assert.equal(reset.usageSnapshotGB, 3); assert.equal(JSON.parse(reset.metadata).nodeSync[p.id].steps.every(s => s.status === 'DONE'), true); });
  r = await api('/api/reseller/users/u2', null, 'DELETE');
  check('journal delete removes both copies without old node leftovers', () => { assert.equal(r.status, 200); assert.equal(node.clients.has('u2'), false); assert.equal(master.clients.has('u2'), false); });
  // A different name must fail certificate hostname validation even with the CA.
  peers[0].baseUrl = peers[0].baseUrl.replace('node.test', 'wrong.test');
  await db.setting.update({ where: { key: `nodeSyncPeers:${p.id}` }, data: { value: encryptSecret(JSON.stringify(peers)) } });
  r = await api('/api/reseller/users/u1', { trafficGB: 23 }, 'PUT');
  check('private routing still verifies TLS hostname', () => assert.equal(r.status, 502));
  console.log(`NODE SYNC API PASS ${checks}`);
} catch (e) { console.error(e); console.error('Fixture logs:', dir); process.exitCode = 1; }
finally {
  if (app) { if (process.platform === 'win32') await child('taskkill.exe', ['/PID', String(app.pid), '/T', '/F']).catch(() => {}); else app.kill('SIGTERM'); }
  for (const s of servers) { s.closeAllConnections(); s.close(); }
  if (db) await db.$disconnect();
}
