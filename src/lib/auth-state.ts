import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { accountSessionVersion, verifySession, type SessionPayload, type SessionAccount } from "./crypto";
import { isAdminManagedReseller } from "./reseller-ownership";
import { getSupportMember } from "./support-members";

export const SESSION_REVOCATION_PREFIX = "sessionRevoked:";
export const RESELLER_DISABLED_NOTICE = "حساب نمایندگی شما غیرفعال است. برای فعال‌سازی دوباره به پشتیبانی پیام بدهید.";
export const isSessionRevocationKey = (key: string) => /^sessionRevoked:[a-f0-9]{64}$/.test(key);
const revokedKey = (token: string) => SESSION_REVOCATION_PREFIX + createHash("sha256").update(token).digest("hex");

export function matchesAccountSession(payload: SessionPayload, account: SessionAccount, audience: "dashboard" | "bridge"): boolean {
  if (payload.aud !== audience || payload.uid !== account.id || payload.username !== account.username || !/^[a-f0-9]{64}$/.test(payload.ver || "")) return false;
  const expected = accountSessionVersion(payload.role, account);
  return timingSafeEqual(Buffer.from(payload.ver!), Buffer.from(expected));
}

export async function inspectAccountToken(token: string | undefined, audience: "dashboard" | "bridge") {
  const payload = verifySession(token);
  if (!payload || payload.aud !== audience) return null;
  if (payload.role === "SUPPORT") {
    if (audience !== "dashboard") return null;
    const account = await getSupportMember(payload.uid);
    if (!account || !matchesAccountSession(payload, account, audience)) return null;
    const owner = await db.reseller.findUnique({ where: { id: account.resellerId }, select: { active: true } });
    const resellerDisabled = !owner?.active || await isAdminManagedReseller(account.resellerId);
    if (await db.setting.findUnique({ where: { key: revokedKey(token!) }, select: { key: true } })) return null;
    return { payload, resellerDisabled, supportOwnerId: account.resellerId };
  }
  const account = payload.role === "ADMIN"
    ? await db.adminUser.findUnique({ where: { id: payload.uid } })
    : await db.reseller.findUnique({ where: { id: payload.uid } });
  if (!account || !matchesAccountSession(payload, account, audience)) return null;
  const resellerDisabled = payload.role === "RESELLER"
    && (("active" in account && !account.active) || await isAdminManagedReseller(account.id));
  if (resellerDisabled && audience === "bridge") return null;
  if (audience === "bridge" && (payload.role !== "RESELLER" || !("mirzaEnabled" in account) || !account.mirzaEnabled)) return null;
  if (await db.setting.findUnique({ where: { key: revokedKey(token!) }, select: { key: true } })) return null;
  return { payload, resellerDisabled };
}

export async function validateAccountToken(token: string | undefined, audience: "dashboard" | "bridge"): Promise<SessionPayload | null> {
  const accountToken = await inspectAccountToken(token, audience);
  return accountToken && !accountToken.resellerDisabled ? accountToken.payload : null;
}

/** Revokes this cookie server-side; storing only its hash never discloses a token. */
export async function revokeDashboardToken(token: string | undefined): Promise<void> {
  const accountToken = await inspectAccountToken(token, "dashboard");
  if (!accountToken) return;
  const { payload } = accountToken;
  await db.setting.upsert({ where: { key: revokedKey(token!) }, create: { key: revokedKey(token!), value: String(payload.exp) }, update: { value: String(payload.exp) } });
  await db.setting.deleteMany({ where: { key: { startsWith: SESSION_REVOCATION_PREFIX }, value: { lt: String(Date.now()) } } });
}
