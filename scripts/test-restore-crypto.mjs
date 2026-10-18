import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let validate;
try { ({ validateEncrypted:validate } = require('./restore-crypto.cjs')); } catch {}
test('archived key decrypts panel and peer settings; wrong key fails closed', () => {
  assert.equal(typeof validate, 'function', 'restore crypto validator missing');
  const enc = plain => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update('source').digest(), iv); const value=Buffer.concat([c.update(plain),c.final()]); return [iv,c.getAuthTag(),value].map(b=>b.toString('base64')).join('.'); };
  const fields=[{type:'credential',value:enc('token')},{type:'peer',panelId:'p',value:enc(JSON.stringify([{key:'n',baseUrl:'https://node.invalid/p',token:'token',masterInboundIds:[142],tls:{connectHost:'172.18.0.1',ca:'-----BEGIN CERTIFICATE-----\ntest'}}]))}];
  assert.deepEqual(validate('source', fields, ['p']), {encryptedFields:2,peerCount:1,privateRoute:true});
  assert.throws(()=>validate('target',fields,['p']));
  assert.throws(()=>validate('source',fields,[]));
});
