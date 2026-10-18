// Invoked only by this panel's timer, inside its existing container.
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.adminUser.findFirst();
    if (!admin) throw new Error('No administrator account exists');
    const body = Buffer.from(JSON.stringify({ role: 'ADMIN', uid: admin.id, username: admin.username, exp: Date.now() + 600000 })).toString('base64url');
    const secret = require('./runtime-secret.cjs').runtimeSecret();
    const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/admin/backups`;
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `rp_session=${body}.${signature}` }, body: JSON.stringify({ kind: 'daily' }), signal: AbortSignal.timeout(360000) });
    const result = await r.json();
    if (!r.ok || !result.backup) throw new Error(result.error || `Backup HTTP ${r.status}`);
    console.log(JSON.stringify({ name: result.backup.name, complete: result.backup.complete, panelCount: result.backup.panelCount }));
    if (!result.backup.complete) { console.error('Backup incomplete; inspect the admin backup page'); process.exitCode = 2; }
  } finally { await db.$disconnect(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
