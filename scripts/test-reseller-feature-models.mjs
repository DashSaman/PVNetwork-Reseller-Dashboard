import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { registerHooks } from 'node:module';
import { parseWebhookUrl, publicWebhookIpv4, signWebhook } from '../src/lib/webhook-target.ts';

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('./') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/src/lib/')) {
      return next(specifier + '.ts', context);
    }
    return next(specifier, context);
  },
});
const { renewalCap, readAutoRenewal, parseAutoRenewalLimits } = await import('../src/lib/renewal-plan.ts');
const { subscriptionFetchTimes } = await import('../src/lib/subscription-fetch-time.ts');
hooks.deregister();

test('renewal caps use only completed renewals and enforce the exact exclusive deadline', () => {
  assert.equal(renewalCap({ maxRenewals: 2 }, 1, 1000), null);
  assert.equal(renewalCap({ maxRenewals: 2 }, 2, 1000), 'count');
  assert.equal(renewalCap({ stopAt: 1000 }, 99, 999), null);
  assert.equal(renewalCap({ stopAt: 1000 }, 0, 1000), 'date');
  assert.equal(parseAutoRenewalLimits({ maxRenewals: 0 }), null);
  assert.equal(parseAutoRenewalLimits({ stopAt: '1000' }), null);
  assert.equal(readAutoRenewal('{"trafficGB":5,"days":30,"installation":"before"}', 'after'), null);
  const legacy = readAutoRenewal('{"trafficGB":5,"days":30,"installation":"before"}', 'before');
  assert.equal(legacy.trafficGB, 5);
  assert.equal(renewalCap(legacy, 500), null);
});

test('subscription fetch timestamps are bound to each tracked subscription identity', () => {
  const now = Date.now() - 2000;
  const tracked = [{ email: 'owned', subId: 'correct' }, { email: 'not-found', subId: 'unseen' }];
  const panels = [{ inbounds: [
    { clients: [{ email: 'owned', subId: 'correct' }], clientStats: [{ email: 'owned', lastSubFetch: now }] },
    { clients: [{ email: 'owned', subId: 'different' }], clientStats: [{ email: 'owned', lastSubFetch: now + 1000 }] },
    { clients: [{ email: 'not-found', subId: 'unseen' }], clientStats: [{ email: 'not-found', lastSubFetch: -1 }] },
  ] }];
  assert.deepEqual([...subscriptionFetchTimes(panels, tracked)], [['owned', now]]);
});

test('webhook only accepts a public HTTPS hostname on the default port', () => {
  for (const value of [
    'http://sample.example', 'https://user:password@host.example', 'https://host.example:9470',
    'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://vault.internal',
    'https://sample.example#fragment', 'https://a.localhost',
  ]) assert.equal(parseWebhookUrl(value), null, value);
  assert.equal(parseWebhookUrl('https://sample.example:443/callback?tenant=2').hostname, 'sample.example');
  for (const value of ['127.2.3.4', '0.0.0.0', '100.100.100.200', '192.168.1.2', '169.254.169.254', '172.17.1.2', '198.18.0.2', '203.0.113.4', '::ffff:8.8.8.8']) {
    assert.equal(publicWebhookIpv4(value), false, value);
  }
  assert.equal(publicWebhookIpv4('8.8.8.8'), true);
});

test('webhook signature covers the timestamp and exact UTF-8 payload', () => {
  const text = '{"data":"آزمایشی"}';
  const signed = signWebhook('sample-secret', '1700000000', text);
  assert.equal(signed, 'sha256=' + createHmac('sha256', 'sample-secret').update('1700000000.' + text).digest('hex'));
  assert.notEqual(signed, signWebhook('sample-secret', '1700000001', text));
  assert.notEqual(signed, signWebhook('sample-secret', '1700000000', text + ' '));
});
