import { db } from "./db";
import { decryptSecret } from "./crypto";
import type { NodePeer } from "./node-client-sync";

/** Root-provisioned, encrypted as one document; never returned by UI settings. */
export async function getNodePeers(panelId: string): Promise<NodePeer[]> {
  const row = await db.setting.findUnique({ where: { key: `nodeSyncPeers:${panelId}` } });
  if (!row) return [];
  const raw = decryptSecret(row.value);
  if (!raw) throw new Error("تنظیمات اتصال نود قابل خواندن نیست؛ بررسی مدیر لازم است");
  const peers: NodePeer[] = JSON.parse(raw);
  if (!Array.isArray(peers) || peers.length > 10) throw new Error("Invalid node peers");
  const keys = new Set<string>();
  for (const p of peers) {
    const url = new URL(p.baseUrl);
    if (!p.key || p.key === "master" || keys.has(p.key) || !p.token || url.protocol !== "https:" || url.username || url.password || !Array.isArray(p.masterInboundIds) || !p.masterInboundIds.length || !p.masterInboundIds.every(Number.isSafeInteger)) throw new Error("Invalid node peer");
    if (p.tls && (!p.tls.connectHost || !p.tls.ca.includes("-----BEGIN CERTIFICATE-----"))) throw new Error("Invalid node TLS config");
    keys.add(p.key);
  }
  return peers;
}
