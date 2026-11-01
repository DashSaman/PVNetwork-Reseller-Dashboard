// Runs in this dashboard's existing container. No host listener or external token.
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.adminUser.findFirst();
    if (!admin) throw Error('No administrator account exists');
    const secret = require('./runtime-secret.cjs').runtimeSecret();
    const ver = crypto.createHmac('sha256', secret).update(JSON.stringify(['pvnet-account-session-v1', 'ADMIN', admin.id, admin.username, admin.password, !!admin.totpEnabled, admin.totpEnabled ? admin.totpSecret : null])).digest('hex');
    const body = Buffer.from(JSON.stringify({ role: 'ADMIN', uid: admin.id, username: admin.username, exp: Date.now() + 600000, aud: 'dashboard', ver })).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/admin/customer-observations`, { method: 'POST', headers: { Cookie: `rp_session=${body}.${signature}` }, signal: AbortSignal.timeout(900000) });
    const result = await response.json();
    if (response.status === 409 && result.busy) { console.log(JSON.stringify({ busy: true }));return; }
    if (!response.ok) throw Error(`Observation HTTP ${response.status}`);
    console.log(JSON.stringify({ observed: result.observed, skipped: result.skipped }));
    if (result.skipped) process.exitCode = 2;
  } finally { await db.$disconnect(); }
})().catch(e => { console.error(e.message);process.exitCode = 1; });
