// Administrative CLI, not an HTTP route. Supply the complete peer list on stdin.
// docker exec -i <container> node scripts/configure-node-sync.cjs <panel-id> < private-peers.json
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const secret = require('./runtime-secret.cjs').runtimeSecret();
(async () => {
  const panelId = process.argv[2];
  if (!panelId || !secret) throw Error('panel-id and APP_SECRET required');
  let raw = ''; for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 200000) throw Error('Configuration too large'); }
  const peers = JSON.parse(raw), keys = new Set(), nodeIds = new Set(), { isIP } = require('node:net');
  if (!Array.isArray(peers) || peers.length > 10) throw Error('Invalid peers');
  for (const p of peers) {
    const url = new URL(p.baseUrl);
    if (!p.key || p.key === 'master' || keys.has(p.key) || !p.token || url.protocol !== 'https:' || url.username || url.password || !p.masterInboundIds?.length || !p.masterInboundIds.every(Number.isSafeInteger)) throw Error('Invalid peer');
    if (p.tls) {
      if (p.tls.mode === 'pin') { if (!isIP(p.tls.connectHost) || !isIP(url.hostname.replace(/^\[|\]$/g, '')) || !/^[a-fA-F0-9]{64}$/.test(p.tls.spkiSha256)) throw Error('Invalid pinned node identity'); }
      else if (p.tls.mode && p.tls.mode !== 'ca' || !p.tls.connectHost || !p.tls.ca?.includes('-----BEGIN CERTIFICATE-----')) throw Error('Invalid TLS configuration');
    }
    if (p.nativeNodeId !== undefined) { if (!Number.isSafeInteger(p.nativeNodeId) || p.nativeNodeId <= 0 || nodeIds.has(p.nativeNodeId)) throw Error('Invalid native node coverage');nodeIds.add(p.nativeNodeId); }
    keys.add(p.key);
  }
  const db = new PrismaClient();
  try {
    if (!await db.panelConfig.findUnique({ where: { id: panelId } })) throw Error('Panel not found');
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(secret).digest(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(peers), 'utf8'), cipher.final()]);
    const value = [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.');
    const key = 'nodeSyncPeers:' + panelId;
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    console.log(JSON.stringify({ configured: true, peerCount: peers.length }));
  } finally { await db.$disconnect(); }
})().catch(() => { console.error('Node sync configuration failed; validate private input and panel id'); process.exitCode = 1; });
