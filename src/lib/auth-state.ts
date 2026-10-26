import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { accountSessionVersion, verifySession, type SessionPayload, type SessionAccount } from "./crypto";

export const SESSION_REVOCATION_PREFIX = "sessionRevoked:";
export const isSessionRevocationKey = (key: string) => /^sessionRevoked:[a-f0-9]{64}$/.test(key);
const revokedKey = (token: string) => SESSION_REVOCATION_PREFIX + createHash("sha256").update(token).digest("hex");

export function matchesAccountSession(payload: SessionPayload, account: SessionAccount, audience: "dashboard" | "bridge"): boolean {
  if (payload.aud !== audience || payload.uid !== account.id || payload.username !== account.username || !/^[a-f0-9]{64}$/.test(payload.ver || "")) return false;
  const expected = accountSessionVersion(payload.role, account);
  return timingSafeEqual(Buffer.from(payload.ver!), Buffer.from(expected));
}

export async function validateAccountToken(token: string | undefined, audience: "dashboard" | "bridge"): Promise<SessionPayload | null> {
  const payload = verifySession(token);
  if (!payload || payload.aud !== audience) return null;
  const account = payload.role === "ADMIN"
    ? await db.adminUser.findUnique({ where: { id: payload.uid } })
    : await db.reseller.findUnique({ where: { id: payload.uid } });
  if (!account || "active" in account && !account.active || !matchesAccountSession(payload, account, audience)) return null;
  if (audience === "bridge" && (payload.role !== "RESELLER" || !("mirzaEnabled" in account) || !account.mirzaEnabled)) return null;
  if (await db.setting.findUnique({ where: { key: revokedKey(token!) }, select: { key: true } })) return null;
  return payload;
}

/** Revokes this cookie server-side; storing only its hash never discloses a token. */
export async function revokeDashboardToken(token: string | undefined): Promise<void> {
  const payload = await validateAccountToken(token, "dashboard");
  if (!payload) return;
  await db.setting.upsert({ where: { key: revokedKey(token!) }, create: { key: revokedKey(token!), value: String(payload.exp) }, update: { value: String(payload.exp) } });
  await db.setting.deleteMany({ where: { key: { startsWith: SESSION_REVOCATION_PREFIX }, value: { lt: String(Date.now()) } } });
}
