const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
function validateEncrypted(secret, fields, panelIds) {
  if (!secret || secret.length > 4096 || /[\r\n\0]/.test(secret)) throw Error('Invalid key');
  const key = crypto.createHash('sha256').update(secret).digest();
  let peerCount = 0, privateRoute = false;
  for (const f of fields) {
    const parts = f.value.split('.');
    if (parts.length !== 3) throw Error('Invalid ciphertext');
    const [iv, tag, payload] = parts.map(x=>Buffer.from(x, 'base64'));
    if (iv.length !== 12 || tag.length !== 16) throw Error('Invalid ciphertext');
    const d = crypto.createDecipheriv('aes-256-gcm',key,iv); d.setAuthTag(tag);
    const plain = Buffer.concat([d.update(payload),d.final()]).toString('utf8');
    if (f.type === 'peer') {
      const peers=JSON.parse(plain), keys=new Set();
      if (!panelIds.includes(f.panelId) || !Array.isArray(peers) || peers.length > 10) throw Error('Invalid peers');
      for (const p of peers) {
        const url = new URL(p.baseUrl);
        if (!p.key || p.key === 'master' || keys.has(p.key) || !p.token || url.protocol !== 'https:' || url.username || url.password || !p.masterInboundIds?.length || !p.masterInboundIds.every(Number.isSafeInteger)) throw Error('Invalid peer');
        if (p.tls && (!p.tls.connectHost || !p.tls.ca?.includes('-----BEGIN CERTIFICATE-----'))) throw Error('Invalid TLS');
        keys.add(p.key); peerCount++; privateRoute ||= !!p.tls?.connectHost;
      }
    }
  }
  return { encryptedFields:fields.length, peerCount, privateRoute };
}
function validateDirectory(directory) {
  const env = fs.readFileSync(path.join(directory,'recovery.env'),'utf8');
  if (!env.startsWith('APP_SECRET=')) throw Error('Missing key');
  const secret = env.slice(11).replace(/\r?\n$/,'');
  const script = `import sqlite3,json,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
c.row_factory=sqlite3.Row
fields=[]
for table,cols in [('PanelConfig',['password','apiToken']),('AdminUser',['totpSecret']),('Reseller',['totpSecret','tgBotToken','mirzaBotToken'])]:
 for r in c.execute('SELECT * FROM '+table):
  for col in cols:
   if r[col]: fields.append({'type':'credential','value':r[col]})
for r in c.execute("SELECT key,value FROM Setting WHERE key LIKE 'nodeSyncPeers:%'"):
 fields.append({'type':'peer','panelId':r['key'].split(':',1)[1],'value':r['value']})
print(json.dumps({'fields':fields,'panelIds':[r[0] for r in c.execute('SELECT id FROM PanelConfig')]}))
c.close()`;
  const raw=execFileSync(process.env.BACKUP_PYTHON || (process.platform==='win32'?'python':'python3'),['-c',script,path.join(directory,'data/custom.db')],{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
  const data=JSON.parse(raw); return validateEncrypted(secret,data.fields,data.panelIds);
}
module.exports={validateEncrypted,validateDirectory};
if (require.main === module) {
  try { console.log(JSON.stringify(validateDirectory(process.argv[2]))); }
  catch { console.error('Backup recovery key or encrypted configuration is invalid'); process.exitCode=1; }
}
