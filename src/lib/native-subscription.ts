import type { BuiltLink } from './links';

export type NativeLink = BuiltLink & { remark: string };
const MAX_BYTES = 2 * 1024 * 1024;

/** Keep the native URI verbatim: TLS/ECH, address overrides and passwords belong
 * to the subscription generator, not to the dashboard's reconstruction. */
export function parseNativeSubscription(body: string): NativeLink[] {
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Subscription too large');
  let text = body.trim();
  if (!/^(?:vless|vmess|trojan|ss|hy2|hysteria2):\/\//m.test(text)) {
    if (!/^[A-Za-z0-9+/=_\s-]+$/.test(text)) throw new Error('Invalid subscription');
    text = Buffer.from(text.replace(/\s/g, ''), 'base64').toString('utf8').trim();
  }
  const result: NativeLink[] = [];
  for (const uri of text.split(/\r?\n/).map(v => v.trim()).filter(Boolean)) {
    if (!/^(?:vless|vmess|trojan|ss|hy2|hysteria2):\/\//.test(uri)) throw new Error('Invalid configuration');
    if (uri.startsWith('vmess://')) {
      const config = JSON.parse(Buffer.from(uri.slice(8), 'base64').toString('utf8'));
      const port = Number(config.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535 || !config.id || !config.add) throw new Error('Invalid VMess configuration');
      result.push({ protocol: 'vmess', port, uri, remark: String(config.ps || '') });
    } else {
      const value = new URL(uri), port = Number(value.port || (value.protocol === 'trojan:' ? 443 : 0));
      if (!value.hostname || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid configuration endpoint');
      let remark = '';try { remark = decodeURIComponent(value.hash.slice(1)); } catch { throw new Error('Invalid configuration name'); }
      result.push({ protocol: value.protocol === 'ss:' ? 'shadowsocks' : value.protocol.slice(0, -1), port, uri, remark });
    }
  }
  if (!result.length) throw new Error('Empty subscription');
  return result;
}

/** Only an administrator-saved native origin is fetched. Never fetch a URL from
 * the request, a reseller custom domain, or a native redirect. */
export async function readNativeSubscription(panel: { subBase: string | null; subPath: string | null }, subId: string): Promise<NativeLink[]> {
  if (!panel.subBase || !/^[A-Za-z0-9_-]{8,128}$/.test(subId)) throw new Error('Native subscription unavailable');
  const base = new URL(panel.subBase.trim());
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid native subscription origin');
  const part = (panel.subPath ?? 'sub').replace(/^\/+|\/+$/g, '');
  const url = base.toString().replace(/\/+$/, '') + (part ? '/' + part : '') + '/' + encodeURIComponent(subId);
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000), headers: { Accept: 'text/plain', 'User-Agent': 'PVNetwork-Subscription/1.0' } });
  if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_BYTES || !response.body) throw new Error('Native subscription unavailable');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];let size = 0;
  try { for (;;) { const { done, value } = await reader.read();if (done) break;size += value.byteLength;if (size > MAX_BYTES) throw new Error('Subscription too large');chunks.push(value); } }
  finally { await reader.cancel(); }
  return parseNativeSubscription(Buffer.concat(chunks).toString('utf8'));
}

/** Match a canonical URI to an authorized, available inbound without changing
 * the URI. A unique native name also covers external address/port overrides. */
type LinkInbound = { protocol: string; port: number; remark?: string; tag: string };
export function nativeLinksForInbounds(links: NativeLink[], inbounds: LinkInbound[], allInbounds: LinkInbound[] = inbounds): NativeLink[] {
  return links.filter(link => {
    const named = allInbounds.filter(i => link.remark && [i.remark, i.tag].includes(link.remark));
    const matches = named.length ? named : allInbounds.filter(i => i.protocol === link.protocol && i.port === link.port);
    return matches.length > 0 && matches.every(i => inbounds.includes(i));
  });
}
