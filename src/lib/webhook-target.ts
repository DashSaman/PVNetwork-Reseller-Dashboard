import { createHmac } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export function parseWebhookUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 1024) return null;
  try {
    const url = new URL(raw.trim());
    const host = url.hostname;
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
      || isIP(host) || host.length > 253 || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host)
      || /\.(localhost|local|internal|lan|home|onion|test|invalid)$/i.test(host)) return null;
    return url;
  } catch { return null; }
}

export function publicWebhookIpv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99))
    && !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100))
    && !(a === 203 && b === 0 && c === 113);
}

export function signWebhook(secret: string, timestamp: string, payload: string) {
  return 'sha256=' + createHmac('sha256', secret).update(timestamp + '.' + payload).digest('hex');
}

export async function deliverWebhook(url: URL, eventId: string, secret: string, body: string) {
  const dns = new Resolver({ timeout: 1200, tries: 1 });
  const addresses = await dns.resolve4(url.hostname);
  if (!addresses.length || addresses.some(address => !publicWebhookIpv4(address))) throw Error('Non-public webhook destination');
  const address = addresses[0];
  // Pin the already vetted address for this request. Keep the configured name
  // for SNI, the certificate, and Host, and never follow redirects.
  const timestamp = String(Math.floor(Date.now() / 1000));
  await new Promise<void>((resolve, reject) => {
    const outgoing = request(url, {
      method: 'POST', agent: false, family: 4, signal: AbortSignal.timeout(3500),
      lookup: (_name, _options, callback) => callback(null, address, 4),
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'X-PVNet-Event-Id': eventId, 'X-PVNet-Timestamp': timestamp, 'X-PVNet-Signature': signWebhook(secret, timestamp, body),
      },
    }, response => {
      response.destroy();
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) resolve();
      else reject(Error('Webhook delivery rejected'));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}
