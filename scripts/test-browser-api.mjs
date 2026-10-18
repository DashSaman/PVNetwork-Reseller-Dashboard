import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, SESSION_RECHECK_EVENT } from '../src/lib/browser-api.ts';
import { publicLocationLabel, publicPanelErrors } from '../src/lib/reseller-presentation.ts';

test('only rejected dashboard sessions trigger a session recheck', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  const events = [];
  globalThis.window = { dispatchEvent: e => events.push(e.type) };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({error:'denied'}), {status:401});
    for (const url of ['/api/admin/overview','/api/reseller/live-users']) {
      const result = await api(url); assert.equal(result.status,401); assert.equal(result.ok,false);
    }
    assert.deepEqual(events,[SESSION_RECHECK_EVENT,SESSION_RECHECK_EVENT]);
    await api('/api/auth/login'); await api('/api/auth/me'); await api('https://external.invalid/api/admin/test');
    assert.equal(events.length,2);
    for (const status of [403,502,504]) {
      globalThis.fetch = async () => new Response('{}',{status});
      assert.equal((await api('/api/admin/panel-summary')).status,status);
    }
    globalThis.fetch = async () => { throw Error('offline'); };
    assert.equal((await api('/api/admin/panel-summary')).ok,false);
    assert.equal(events.length,2,'network/upstream/permission failures must not log users out');
  } finally { globalThis.fetch=originalFetch; globalThis.window=originalWindow; }
});

test('display metadata removes backend identity without touching useful location names', () => {
  assert.equal(publicLocationLabel('Private backend · Germany','Private backend'),'Germany');
  assert.equal(publicLocationLabel('ثنایی 3x-ui · Germany'),'Germany');
  assert.equal(publicLocationLabel('in-2096-tcp','Private backend'),'in-2096-tcp');
  assert.equal(publicLocationLabel('Private backend','Private backend'),'لوکیشن');
  const errors=publicPanelErrors([{panelId:'keep-id',panelName:'Private backend',msg:'https://secret.invalid 3x-ui token'}]);
  assert.equal(errors[0].panelId,'keep-id');
  assert.ok(!JSON.stringify(errors).includes('Private backend'));
  assert.ok(!JSON.stringify(errors).includes('secret.invalid'));
});
