import { db } from "./db";
import { decryptSecret } from "./crypto";
import type { NodePeer } from "./node-client-sync";
import { isIP } from 'node:net';

/** Root-provisioned, encrypted as one document; never returned by UI settings. */
export async function getNodePeers(panelId: string): Promise<NodePeer[]> {
  const row = await db.setting.findUnique({ where: { key: `nodeSyncPeers:${panelId}` } });
  if (!row) return [];
  const raw = decryptSecret(row.value);
  if (!raw) throw new Error("تنظیمات اتصال نود قابل خواندن نیست؛ بررسی مدیر لازم است");
  const peers: NodePeer[] = JSON.parse(raw);
  if (!Array.isArray(peers) || peers.length > 10) throw new Error("Invalid node peers");
  const keys = new Set<string>(), nodeIds = new Set<number>();
  for (const p of peers) {
    const url = new URL(p.baseUrl);
    if (!p.key || p.key === "master" || keys.has(p.key) || !p.token || url.protocol !== "https:" || url.username || url.password || !Array.isArray(p.masterInboundIds) || !p.masterInboundIds.length || !p.masterInboundIds.every(Number.isSafeInteger)) throw new Error("Invalid node peer");
    if (p.tls) {
      if (p.tls.mode === 'pin') {
        if (!isIP(p.tls.connectHost) || !isIP(url.hostname.replace(/^\[|\]$/g, '')) || !/^[a-fA-F0-9]{64}$/.test(p.tls.spkiSha256)) throw new Error('Invalid pinned node identity');
      } else if (p.tls.mode && p.tls.mode !== 'ca' || !p.tls.connectHost || !p.tls.ca?.includes("-----BEGIN CERTIFICATE-----")) throw new Error("Invalid node TLS config");
    }
    if (p.nativeNodeId !== undefined) { if (!Number.isSafeInteger(p.nativeNodeId) || p.nativeNodeId <= 0 || nodeIds.has(p.nativeNodeId)) throw new Error('Invalid native node coverage');nodeIds.add(p.nativeNodeId); }
    keys.add(p.key);
  }
  return peers;
}
