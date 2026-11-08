import https from 'node:https';
import tls from 'node:tls';
import { isIP } from 'node:net';
import { createHash, X509Certificate } from 'node:crypto';

export type NodeTls = { connectHost: string; ca: string; mode?: 'ca' } | { connectHost: string; mode: 'pin'; spkiSha256: string };
type Init = { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal };

export async function privateNodeRequest(url: string, trust: NodeTls, init: Init): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('Private node requires HTTPS');
  let agent: https.Agent | undefined;
  if (trust.mode === 'pin') {
    if (!isIP(trust.connectHost) || !isIP(target.hostname.replace(/^\[|\]$/g, '')) || !/^[a-fA-F0-9]{64}$/.test(trust.spkiSha256)) throw new Error('Pinned node requires a literal address and provisioned SHA256 key');
    // This private trust anchor is the independently provisioned public key.
    // No HTTP request, credential or body is sent until that key is verified.
    const socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      init.signal.throwIfAborted();
      const socket = tls.connect({ host: trust.connectHost, port: Number(target.port || 443), rejectUnauthorized: false, minVersion: 'TLSv1.2' });
      const abort = () => socket.destroy(init.signal.reason instanceof Error ? init.signal.reason : new Error('Node request aborted'));
      const failed = (error: Error) => { init.signal.removeEventListener('abort', abort);socket.destroy();reject(error); };
      init.signal.addEventListener('abort', abort, { once: true });socket.once('error', failed);
      socket.once('secureConnect', () => {
        try {
          init.signal.throwIfAborted();
          const cert = socket.getPeerCertificate(true);
          if (!cert.raw) throw new Error('Node certificate missing');
          const key = new X509Certificate(cert.raw).publicKey.export({ type: 'spki', format: 'der' });
          if (createHash('sha256').update(key).digest('hex') !== trust.spkiSha256.toLowerCase()) throw new Error('Node key does not match provisioned identity');
          init.signal.removeEventListener('abort', abort);socket.removeListener('error', failed);resolve(socket);
        } catch (error) { failed(error as Error); }
      });
    });
    let used = false;
    agent = new https.Agent({ keepAlive: false });
    agent.createConnection = () => { if (used) throw new Error('Node connection cannot be retried');used = true;return socket; };
    if (init.signal.aborted) { socket.destroy();init.signal.throwIfAborted(); }
  }
  return new Promise((resolve, reject) => {
    const req = https.request(target, {
      method: init.method, headers: init.headers, signal: init.signal,
      ...(trust.mode === 'pin' ? { agent } : { hostname: trust.connectHost, servername: target.hostname, ca: trust.ca, rejectUnauthorized: true }),
    }, res => {
      const chunks: Buffer[] = [];let bytes = 0;
      res.on('data', (chunk: Buffer) => { bytes += chunk.length;if (bytes > 2 * 1024 * 1024) req.destroy(new Error('Node response too large'));else chunks.push(chunk); });
      res.on('error', error => { agent?.destroy();reject(error); });
      res.on('end', () => { agent?.destroy();resolve(new Response(Buffer.concat(chunks), { status: res.statusCode || 502 })); });
    });
    req.on('error', error => { agent?.destroy();reject(error); });req.end(init.body);
  });
}
