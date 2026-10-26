import { db } from "./db";
import { randomHex } from "./crypto";
import { withResellerLock, getResellerWithAccess } from "./reseller-helpers";
import { getRequiredUserPanelIds } from "./accounting-ops";
import { getAllPanelInboundsFresh, getPanelConnection, buildSubLink } from "./panel-manager";
import { updateClient, type PanelClient } from "./panel";
import { logActivity } from "./logger";

const ACTIVE = ["PENDING", "RUNNING", "PARTIAL", "NEEDS_REPAIR"];
type RotationMeta = { kind: "SUBSCRIPTION_ROTATION"; oldSubId: string; newSubId: string; identities: Record<string, string> };
type Result = { ok: true; subId: string; subLink: string | null } | { ok: false; status: number; error: string; partial?: boolean };
const identity = (c: PanelClient) => c.id || c.password || "";

/** Absolute, durable subscription-only writes share the accounting lock. */
export async function rotateUserSubscription(resellerId: string, email: string): Promise<Result> {
  return withResellerLock(resellerId, async () => {
    const reseller = await getResellerWithAccess(resellerId);
    if (!reseller) return { ok: false, status: 403, error: "حساب فعال نیست" };
    const tracked = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId, email } } });
    if (!tracked) return { ok: false, status: 404, error: "کاربر پیدا نشد" };
    const required = await getRequiredUserPanelIds(tracked);
    if (!required.ok) return { ok: false, status: 409, error: required.msg };
    const active = await db.operationJournal.findMany({ where: { resellerId, email, status: { in: ACTIVE } } });
    let journal = active.find(j => j.type === "UPDATE" && JSON.parse(j.metadata || "{}").kind === "SUBSCRIPTION_ROTATION");
    if (active.some(j => j.id !== journal?.id)) return { ok: false, status: 409, error: "عملیات دیگری روی این کاربر در جریان است؛ ابتدا همان را تمام کنید" };
    const snapshot = await getAllPanelInboundsFresh();
    const current = new Map<string, { client: PanelClient; protocol: string }>();
    for (const id of required.panelIds) {
      const bundle = snapshot.panels.find(p => p.panelId === id);
      const inbound = bundle?.inbounds.find(i => i.clients.some(c => c.email === email));
      const client = inbound?.clients.find(c => c.email === email);
      if (!inbound || !client || !identity(client)) return { ok: false, status: 502, error: "اطلاعات همهٔ پنل‌های این کاربر قابل تأیید نیست؛ تغییری انجام نشد" };
      current.set(id, { client, protocol: inbound.protocol });
    }
    const meta: RotationMeta = journal ? JSON.parse(journal.metadata!) : {
      kind: "SUBSCRIPTION_ROTATION", oldSubId: tracked.subId || current.values().next().value!.client.subId || "",
      newSubId: randomHex(16), identities: Object.fromEntries([...current].map(([id, v]) => [id, identity(v.client)])),
    };
    const targets: string[] = journal ? JSON.parse(journal.targetPanels) : required.panelIds;
    for (const id of targets) {
      const c = current.get(id)?.client;
      if (!c || identity(c) !== meta.identities[id] || ![meta.oldSubId, meta.newSubId].includes(c.subId || "")) return { ok: false, status: 409, error: "هویت یا اشتراک خارج از این عملیات تغییر کرده؛ بررسی مدیر لازم است" };
    }
    if (!journal) journal = await db.operationJournal.create({ data: {
      idempotencyKey: `rotate-sub:${tracked.id}:${randomHex(16)}`, resellerId, userId: tracked.id, email,
      type: "UPDATE", status: "RUNNING", targetPanels: JSON.stringify(targets), metadata: JSON.stringify(meta),
    } });
    const completed = new Set<string>(JSON.parse(journal.completedPanels));
    const errors: string[] = [];
    for (const id of targets) {
      if (completed.has(id)) continue;
      try {
        const conn = await getPanelConnection(id);
        if (!conn.ok) throw Error(conn.msg);
        // Quota, expiry, enable and device fields are intentionally omitted.
        const result = await updateClient(conn.conn, email, current.get(id)!.protocol, { subId: meta.newSubId });
        if (!result.ok) throw Error(result.msg || "تأیید تغییر اشتراک ممکن نشد");
        completed.add(id);
        await db.operationJournal.update({ where: { id: journal.id }, data: { completedPanels: JSON.stringify([...completed]) } });
      } catch (error) { errors.push((error as Error).message); }
    }
    if (!errors.length) {
      const after = await getAllPanelInboundsFresh();
      for (const id of targets) {
        const client = after.panels.find(p => p.panelId === id)?.inbounds.flatMap(i => i.clients).find(c => c.email === email);
        if (!client || identity(client) !== meta.identities[id] || client.subId !== meta.newSubId) errors.push("اشتراک نهایی همهٔ پنل‌ها تأیید نشد");
      }
    }
    if (errors.length) {
      await db.operationJournal.update({ where: { id: journal.id }, data: { status: "PARTIAL", lastError: errors.join(" | ") } });
      return { ok: false, status: 502, partial: true, error: "تغییر لینک کامل نشده؛ همان دکمه را برای ادامه تکرار کنید" };
    }
    await db.$transaction([
      db.resellerUser.update({ where: { id: tracked.id }, data: { subId: meta.newSubId } }),
      db.operationJournal.update({ where: { id: journal.id }, data: { status: "SUCCESS", lastError: null, reservedGB: 0, accountingCommitted: true } }),
    ]);
    await logActivity({ actorType: "RESELLER", actorName: reseller.username, resellerId, action: "دوباره‌سازی لینک اشتراک", detail: email });
    return { ok: true, subId: meta.newSubId, subLink: await buildSubLink(meta.newSubId, reseller, tracked.panelId) };
  });
}
