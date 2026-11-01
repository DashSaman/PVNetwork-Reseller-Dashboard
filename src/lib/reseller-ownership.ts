import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { runtimeSecret } from "../../scripts/runtime-secret.cjs";

const PREFIX = "resellerHandover:";
export const handoverKey = (id: string) => PREFIX + id;
export type HandoverRecord = {
  version: 1; sourceUsername: string; sourceName: string | null;
  adminId: string; transferredAt: string; token: string; managedUsers: number;
};

/** Marker presence is authoritative even if its display metadata is damaged. */
export async function isAdminManagedReseller(id: string): Promise<boolean> {
  return !!await db.setting.findUnique({ where: { key: handoverKey(id) }, select: { key: true } });
}

export async function adminManagedResellers(): Promise<Map<string, HandoverRecord | null>> {
  const rows = await db.setting.findMany({ where: { key: { startsWith: PREFIX } } });
  return new Map(rows.map(row => {
    let record: HandoverRecord | null = null;
    try {
      const parsed = JSON.parse(row.value) as HandoverRecord;
      if (parsed.version === 1 && typeof parsed.sourceUsername === "string") record = parsed;
    } catch { /* Ownership remains closed; only the display metadata is unavailable. */ }
    return [row.key.slice(PREFIX.length), record];
  }));
}

type PreviewUser = { id: string; email: string; subId: string | null; trafficGB: number; panelId: string; inboundIds: string };
export function handoverToken(id: string, username: string, users: PreviewUser[]): string {
  const snapshot = [...users].sort((a, b) => a.id.localeCompare(b.id)).map(u =>
    [u.id, u.email, u.subId, u.trafficGB, u.panelId, u.inboundIds]);
  return createHmac("sha256", runtimeSecret()).update(JSON.stringify(["reseller-handover-v1", id, username, snapshot])).digest("hex");
}

export function validHandoverToken(provided: unknown, expected: unknown): boolean {
  return typeof provided === "string" && typeof expected === "string" && /^[a-f0-9]{64}$/.test(expected) && /^[a-f0-9]{64}$/.test(provided)
    && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
