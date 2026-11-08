import type { PanelAuth, PanelApiResult, PanelClient } from "./panel";
import type { NodeTls } from './private-node-http';

/** Explicit repair peers, never additional billing/statistics panels. */
export type NodePeer = {
  key: string;
  baseUrl: string;
  token: string;
  masterInboundIds: number[];
  tls?: NodeTls;
  nativeNodeId?: number;
};
type RecordData = Record<string, unknown>;
type ClientDetail = { client: RecordData; inboundIds: number[]; usedTraffic?: unknown };
export type NativeRequest = <T>(auth: PanelAuth, path: string, init?: { method?: string; json?: unknown }) => Promise<PanelApiResult<T>>;
type Step = { key: string; identity: string; status: "PENDING" | "STARTED" | "DONE"; wasEnabled?: boolean; reactivateExhausted?: boolean; usageBytes?: number };
export type NodeMutationState = { version: 1; email: string; op: "delete" | "reset"; steps: Step[]; deleteTargets?: string[]; deleteVerified?: boolean };
export type NodeMutationProgress = {
  load(): Promise<NodeMutationState | undefined>;
  save(state: NodeMutationState): Promise<void>;
  expectedSubId?: string;
  checkpointUsage?(bytes: number): Promise<void>;
};
const failure = (reason: string): PanelApiResult => ({ ok: false, msg: `NODE_SYNC_FAILED: ${reason} — عملیات کامل نشده؛ پس از رفع مشکل دوباره ادامه دهید` });
function identity(c: RecordData): string {
  return typeof c.uuid === "string" && c.uuid ? c.uuid : typeof c.id === "string" ? c.id : "";
}
function missing(r: PanelApiResult): boolean {
  return !r.ok && /^(?:client )?(?:not found|does not exist)$|^obtain \(record not found\)$|^کلاینت یافت نشد[.!]?$/.test((r.msg || "").trim().toLowerCase());
}
async function detail(request: NativeRequest, auth: PanelAuth, email: string): Promise<ClientDetail | null> {
  const r = await request<ClientDetail>(auth, `/panel/api/clients/get/${encodeURIComponent(email)}`);
  if (missing(r)) return null;
  if (!r.ok || !r.data?.client || r.data.client.email !== email || !identity(r.data.client) || !Array.isArray(r.data.inboundIds)) throw new Error("خواندن مشخصات معتبر حساب ممکن نشد");
  return r.data;
}

/** A successful write is not evidence that every requested location was saved. */
export async function ensureClientMembership(auth: PanelAuth, email: string, inboundIds: number[], request: NativeRequest, expected?: Partial<PanelClient>): Promise<PanelApiResult> {
  try {
    let current = await detail(request, auth, email);
    let pending = false;
    if (!current) return failure("حساب ساخته‌شده در پنل تأیید نشد");
    if (expected?.subId && current.client.subId !== expected.subId) return failure("شناسهٔ اشتراک با درخواست ساخت مطابقت ندارد");
    if (expected?.id && identity(current.client) !== expected.id) return failure("هویت حساب با درخواست ساخت مطابقت ندارد");
    const missingIds = [...new Set(inboundIds)].filter(id => !current!.inboundIds.includes(id));
    if (missingIds.length) {
      const attached = await request(auth, `/panel/api/clients/${encodeURIComponent(email)}/attach`, { method: "POST", json: { inboundIds: missingIds } });
      if (!attached.ok) return failure("تکمیل اینباندهای انتخابی موفق نبود");
      pending = (attached.data as { nodePending?: boolean } | undefined)?.nodePending === true;
      const before = current;
      current = await detail(request, auth, email);
      if (!current) return failure("تأیید اینباندها ممکن نشد");
      assertSame(before.client, current.client);
    }
    if (!inboundIds.every(id => current!.inboundIds.includes(id))) return failure("همهٔ اینباندهای انتخابی هنوز ثبت نشده‌اند");
    if (expected && !creationFieldsMatch(current.client, expected)) return failure("مشخصات ثبت‌شدهٔ حساب با درخواست ساخت یکسان نیست");
    return pending ? { ok: false, pending: true, msg: "ثبت حساب تأیید شد؛ همگام‌سازی لوکیشن‌ها در جریان است" } : { ok: true };
  } catch { return failure("تأیید هویت و اینباندهای حساب ممکن نشد"); }
}

function creationFieldsMatch(actual: RecordData, expected: Partial<PanelClient>): boolean {
  return (!expected.id || identity(actual) === expected.id) && (["email", "totalGB", "expiryTime", "enable", "subId", "limitIp"] as const).every(k => expected[k] === undefined || actual[k] === expected[k]);
}
/** This verification never attaches, adds, enables or resets a customer. */
export async function verifyClientCreationRecord(auth: PanelAuth, email: string, inboundIds: number[], expected: Partial<PanelClient>, request: NativeRequest): Promise<PanelApiResult> {
  try { const current = await detail(request, auth, email); return current && creationFieldsMatch(current.client, expected) && inboundIds.every(id => current.inboundIds.includes(id)) ? { ok: true } : failure("ثبت کامل حساب با مشخصات اصلی تأیید نشد"); }
  catch { return failure("خواندن حساب ساخته‌شده ممکن نشد"); }
}
function peersFor(auth: PanelAuth, master: ClientDetail): NodePeer[] {
  // A linked node is already handled by 3x-ui. Only repair unlinked copies.
  return (auth.nodePeers || []).filter(p => !p.masterInboundIds.some(id => master.inboundIds.includes(id)));
}
function assertSame(a: RecordData, b: RecordData): void {
  if (!identity(a) || identity(a) !== identity(b)) throw new Error("شناسهٔ حساب روی نود متفاوت است؛ نیاز به بررسی مدیر دارد");
}
function nodePayload(current: RecordData, patch: RecordData): RecordData {
  // Use the NODE's complete record, not the master's per-inbound defaults.
  const payload = { ...current, ...patch, id: identity(current), uuid: identity(current) };
  for (const k of ["traffic", "inboundIds", "externalConfigIds", "externalLinks", "usedTraffic", "createdAt", "updatedAt"]) delete payload[k];
  // Native models serialize empty WireGuard fields as strings although the update
  // DTO expects arrays/numbers. Omit only empty values; retain meaningful values.
  for (const k of ["allowedIPs", "privateKey", "publicKey", "preSharedKey", "keepAlive", "forwardedPorts"]) if (!payload[k]) delete payload[k];
  return payload;
}

async function readUsage(request: NativeRequest, auth: PanelAuth, email: string): Promise<number> {
  const current = await detail(request, auth, email);
  if (typeof current?.usedTraffic === "number" && Number.isFinite(current.usedTraffic) && current.usedTraffic >= 0) return current.usedTraffic;
  const r = await request<{ clientStats?: { email: string; up: number; down: number }[] }[]>(auth, "/panel/api/inbounds/list");
  if (!r.ok || !Array.isArray(r.data)) throw new Error("Usage unavailable");
  const stats = r.data.flatMap(i => i.clientStats || []).filter(s => s.email === email);
  if (!stats.length) throw new Error("Usage missing");
  const values = stats.map(s => Number(s.up) + Number(s.down));
  if (values.some(v => !Number.isFinite(v) || v < 0)) throw new Error("Usage invalid");
  return Math.max(...values);
}

export async function verifiedClientUsage(auth: PanelAuth, email: string, request: NativeRequest, expectedTotalBytes?: number): Promise<PanelApiResult<number>> {
  try {
    const master = await detail(request, auth, email);
    if (!master) return { ok: false, msg: "حساب مرجع برای تأیید مصرف در دسترس نیست" };
    if (expectedTotalBytes !== undefined && master.client.totalGB !== expectedTotalBytes) return { ok: false, msg: "سهمیهٔ نهایی حساب مرجع تأیید نشد" };
    let used = await readUsage(request, auth, email);
    for (const peer of peersFor(auth, master)) {
      const current = await detail(request, peer, email);
      if (!current) continue;
      assertSame(master.client, current.client);
      if (expectedTotalBytes !== undefined && current.client.totalGB !== expectedTotalBytes) return { ok: false, msg: "سهمیهٔ نهایی نود تأیید نشد" };
      used = Math.max(used, await readUsage(request, peer, email));
    }
    return { ok: true, data: used };
  } catch { return { ok: false, msg: "مصرف معتبر حساب قابل دریافت نیست" }; }
}

export async function updateMasterClient(auth: PanelAuth, email: string, patch: Partial<PanelClient>, request: NativeRequest): Promise<PanelApiResult> {
  try {
    const current = await detail(request, auth, email);
    if (!current || patch.id && patch.id !== identity(current.client)) return failure("هویت حساب برای ویرایش مطابقت ندارد");
    const supplied = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const r = await request(auth, `/panel/api/clients/update/${encodeURIComponent(email)}`, { method: "POST", json: nodePayload(current.client, supplied) });
    if (!r.ok) return r;
    const verified = await verifyMasterClientUpdate(auth, email, { ...patch, id: identity(current.client) }, request);
    if (!verified.ok) return verified;
    if ((r.data as { nodePending?: boolean } | undefined)?.nodePending) return { ok: false, pending: true, msg: "تغییر در مرجع تأیید شد؛ همگام‌سازی برخی لوکیشن‌ها هنوز کامل نشده است" };
    return verified;
  } catch { return failure("خواندن و ذخیرهٔ کامل مشخصات حساب ممکن نشد"); }
}

async function setEnabled(request: NativeRequest, target: PanelAuth, email: string, current: ClientDetail, enable: boolean): Promise<void> {
  const r = await request(target, `/panel/api/clients/update/${encodeURIComponent(email)}`, { method: "POST", json: nodePayload(current.client, { enable }) });
  if (!r.ok) throw new Error("Enable update failed");
  const after = await detail(request, target, email);
  if (!after || after.client.enable !== enable) throw new Error("Enable verification failed");
  assertSame(current.client, after.client);
}
export async function syncNodeClientUpdate(auth: PanelAuth, email: string, client: Partial<PanelClient>, request: NativeRequest): Promise<PanelApiResult> {
  try {
    const master = await detail(request, auth, email);
    if (!master) return failure("حساب مرجع در دسترس نیست");
    if (client.id && client.id !== identity(master.client)) return failure("تغییر شناسهٔ اتصال نیاز به بررسی مدیر دارد");
    const patch: RecordData = {};
    for (const k of ["totalGB", "expiryTime", "enable"] as const) if (client[k] !== undefined) patch[k] = client[k];
    // Propagate intentional settings/subscription changes, but preserve existing
    // node-specific settings when the master value has not actually changed.
    for (const k of ["subId", "password", "flow", "limitIp", "tgId", "reset"] as const) if (client[k] !== undefined && client[k] !== master.client[k]) patch[k] = client[k];
    const targets: { peer: NodePeer; current: ClientDetail }[] = [];
    for (const peer of peersFor(auth, master)) {
      const current = await detail(request, peer, email);
      if (!current) continue; // Never invent a location or import an old account.
      assertSame(master.client, current.client);
      targets.push({ peer, current });
    }
    // All reads/identity checks precede the first write. Fix the stale local
    // quota before enabling the master, so the node quota job cannot undo it.
    for (const { peer, current } of targets) {
      if (Object.entries(patch).every(([k, v]) => current.client[k] === v)) continue;
      const r = await request(peer, `/panel/api/clients/update/${encodeURIComponent(email)}`, { method: "POST", json: nodePayload(current.client, patch) });
      if (!r.ok) return failure("ذخیرهٔ تغییرات روی نود موفق نبود");
      const after = await detail(request, peer, email);
      if (!after) return failure("تأیید تغییرات روی نود ممکن نشد");
      assertSame(current.client, after.client);
      if (!Object.entries(patch).every(([k, v]) => after.client[k] === v)) return failure("نود تغییرات را تأیید نکرد");
    }
    return { ok: true };
  } catch { return failure("خواندن نود یا تطبیق هویت حساب موفق نبود"); }
}

export async function verifyMasterClientUpdate(auth: PanelAuth, email: string, client: Partial<PanelClient>, request: NativeRequest): Promise<PanelApiResult> {
  try {
    const after = await detail(request, auth, email);
    if (!after || client.id !== undefined && identity(after.client) !== client.id || !(["totalGB", "expiryTime", "enable", "subId", "limitIp", "flow", "password", "tgId", "reset"] as const).every(k => client[k] === undefined || after.client[k] === client[k])) return failure("ذخیرهٔ نهایی حساب مرجع تأیید نشد");
    return { ok: true };
  } catch { return failure("خواندن نتیجهٔ نهایی حساب مرجع موفق نبود"); }
}

/** Durable reset/delete progress. STARTED resets are ambiguous after a crash or
 * lost response and must never be replayed automatically against live counters. */
export async function mutateWithNodePeers(auth: PanelAuth, email: string, op: "delete" | "reset", request: NativeRequest, progress?: NodeMutationProgress, reconcilePass = 0): Promise<PanelApiResult> {
  try {
    if (op === "reset" && !progress) return failure("ریست روی نود به ژورنال ماندگار نیاز دارد");
    let state = await progress?.load();
    if (!state) {
      const master = await detail(request, auth, email);
      if (master && progress?.expectedSubId && master.client.subId !== progress.expectedSubId) return failure("هویت حساب مرجع با اشتراک ثبت‌شده مطابقت ندارد");
      if (!master && (op !== "delete" || !progress?.expectedSubId)) return failure("هویت حساب مرجع برای عملیات قابل تأیید نیست");
      const steps: Step[] = [];
      for (const peer of op === 'delete' ? auth.nodePeers || [] : master ? peersFor(auth, master) : auth.nodePeers || []) {
        const current = await detail(request, peer, email);
        if (!current) continue;
        if (master) { assertSame(master.client, current.client);if (op === 'delete' && current.client.subId !== master.client.subId) return failure('شناسهٔ اشتراک نود متفاوت است'); }
        else if (current.client.subId !== progress?.expectedSubId) return failure("هویت نسخهٔ باقی‌ماندهٔ حساب قابل تأیید نیست");
        steps.push({ key: peer.key, identity: identity(current.client), status: "PENDING" });
      }
      if (master) steps.push({ key: "master", identity: identity(master.client), status: "PENDING" });
      state = { version: 1, email, op, steps };
      await progress?.save(state);
    }
    if (state.version !== 1 || state.email !== email || state.op !== op) return failure("ژورنال نود با عملیات مطابقت ندارد");
    if (op === 'delete') {
      const targets = [{ key: 'master', auth }, ...(auth.nodePeers || []).map(peer => ({ key: peer.key, auth: peer }))];
      const keys = new Set(targets.map(t => t.key));
      if (state.deleteTargets?.some(key => !keys.has(key)) || state.steps.some(step => !keys.has(step.key))) return failure('یک هدف ثبت‌شدهٔ حذف از پیکربندی نودها حذف شده است');
      const copies = await Promise.all(targets.map(async target => ({ ...target, current: await detail(request, target.auth, email) })));
      const expected = state.steps.find(s => s.key === 'master')?.identity || state.steps[0]?.identity;
      if (state.steps.some(step => !expected || step.identity !== expected)) return failure('هویت‌های ثبت‌شدهٔ حذف با هم مطابقت ندارند');
      for (const copy of copies) if (copy.current && (!expected || identity(copy.current.client) !== expected || progress?.expectedSubId && copy.current.client.subId !== progress.expectedSubId)) return failure('هویت نسخهٔ نود با درخواست حذف مطابقت ندارد');
      const master = copies.find(c => c.key === 'master')?.current;
      if (master && auth.nodePeers?.some(p => p.nativeNodeId !== undefined)) {
        const catalog = await request<{ id: number; nodeId?: number | null }[]>(auth, '/panel/api/inbounds/list');
        if (!catalog.ok || !Array.isArray(catalog.data) || !master.inboundIds.every(id => {
          const found = catalog.data!.filter(i => i.id === id);
          // Native omitempty serialization leaves nodeId absent for local
          // inbounds. A present invalid/unknown remote ID must still fail closed.
          return found.length === 1 && (found[0].nodeId === undefined || found[0].nodeId === null || Number.isSafeInteger(found[0].nodeId) && found[0].nodeId! > 0 && auth.nodePeers!.some(p => p.nativeNodeId === found[0].nodeId));
        })) return failure('اتصال مستقیم همهٔ نودهای حساب برای تأیید حذف پیکربندی نشده است');
      }
      // Extend only the same explicitly requested deletion after proving every
      // identity. A DONE copy may have been recreated by delayed native fan-out.
      for (const copy of copies) if (copy.current) {
        let step = state.steps.find(s => s.key === copy.key);
        if (!step) { step = { key: copy.key, identity: identity(copy.current.client), status: 'PENDING' };state.steps.splice(copy.key === 'master' ? state.steps.length : Math.max(0, state.steps.findIndex(s => s.key === 'master')), 0, step); }
        if (step.status === 'DONE') step.status = 'PENDING';
      }
      state.deleteTargets = targets.map(t => t.key);state.deleteVerified = false;await progress?.save(state);
      // Freeze the master before deleting peers. Freezing it later can fan an
      // update back out to a peer which was already removed.
      const masterStep = state.steps.find(s => s.key === 'master');
      if (master?.client.enable === true && masterStep && progress?.checkpointUsage) {
        masterStep.wasEnabled ??= true;await progress.save(state);
        await setEnabled(request, auth, email, master, false);
        masterStep.usageBytes = Math.max(masterStep.usageBytes || 0, await readUsage(request, auth, email));
        await progress.save(state);await progress.checkpointUsage(Math.max(...state.steps.map(s => s.usageBytes || 0)));
      }
    }
    for (const step of state.steps) {
      if (step.status === "STARTED" && op === "reset") return failure("پاسخ ریست قبلی قطعی نیست؛ برای جلوگیری از صفر شدن دوبارهٔ مصرف، بررسی مدیر لازم است");
      const target = step.key === "master" ? auth : auth.nodePeers?.find(p => p.key === step.key);
      if (!target) return failure("نود ثبت‌شده در ژورنال پیکربندی نشده است");
      if (step.status === "DONE") {
        if (op === "reset" && (step.wasEnabled || step.reactivateExhausted)) {
          const done = await detail(request, target, email);
          if (!done || identity(done.client) !== step.identity) return failure("تأیید بازگشت حساب پس از ریست ممکن نشد");
          if (!done.client.enable) await setEnabled(request, target, email, done, true);
        }
        continue;
      }
      const current = await detail(request, target, email);
      if (!current && op !== "delete") return failure("حساب نود هنگام ریست در دسترس نیست");
      if (current && (identity(current.client) !== step.identity || op === 'delete' && progress?.expectedSubId && current.client.subId !== progress.expectedSubId)) return failure("هویت حساب پس از ثبت عملیات عوض شده است");
      if (current) {
        if (progress?.checkpointUsage) {
          // Persist the original enable state before freezing, so retries preserve it.
          step.wasEnabled ??= current.client.enable === true;
          await progress.save(state);
          if (current.client.enable) await setEnabled(request, target, email, current, false);
          try {
            step.usageBytes = Math.max(step.usageBytes || 0, await readUsage(request, target, email));
            // Reset explicitly renews the usage allowance. An account stopped by
            // quota exhaustion can run again; an ordinary manual disable or an
            // expired account keeps its disabled state.
            const total = Number(current.client.totalGB), expiry = Number(current.client.expiryTime);
            step.reactivateExhausted ??= op === 'reset' && !step.wasEnabled && total > 0 && step.usageBytes >= total && (expiry <= 0 || expiry > Date.now());
            await progress.save(state);
            await progress.checkpointUsage(Math.max(...state.steps.map(s => s.usageBytes || 0)));
          } catch (e) {
            if (step.wasEnabled) {
              const fresh = await detail(request, target, email);
              if (fresh && identity(fresh.client) === step.identity) await setEnabled(request, target, email, fresh, true);
            }
            throw e;
          }
        }
        step.status = "STARTED"; await progress?.save(state);
        const path = op === "delete" ? "del" : "resetTraffic";
        const r = await request(target, `/panel/api/clients/${path}/${encodeURIComponent(email)}`, { method: "POST" });
        if (!r.ok && (op !== 'delete' || await detail(request, target, email))) return failure("پاسخ عملیات نود قطعی نیست؛ بررسی و ادامه لازم است");
        if (op === "delete" && await detail(request, target, email)) return failure("حذف حساب روی نود تأیید نشد");
        if (op === 'reset' && (step.usageBytes || 0) > 0 && await readUsage(request, target, email) >= step.usageBytes!) return failure('صفرشدن مصرف روی نود تأیید نشد؛ درخواست مبهم دوباره اجرا نمی‌شود');
      }
      step.status = "DONE"; await progress?.save(state);
      if (op === "reset" && (step.wasEnabled || step.reactivateExhausted)) {
        const after = await detail(request, target, email);
        if (!after || identity(after.client) !== step.identity) return failure("تأیید حساب پس از ریست ممکن نشد");
        await setEnabled(request, target, email, after, true);
      }
    }
    if (op === 'delete') {
      const verified = await verifyClientDeletion(auth, email, request);
      if (!verified.ok) return progress && reconcilePass === 0 ? mutateWithNodePeers(auth, email, op, request, progress, 1) : verified;
      state.deleteVerified = true;await progress?.save(state);
    }
    return { ok: true };
  } catch { return failure("ارتباط یا ثبت پیشرفت عملیات نود موفق نبود"); }
}

/** No native writes. Used again at the accounting boundary after synchronization. */
export async function verifyClientDeletion(auth: PanelAuth, email: string, request: NativeRequest): Promise<PanelApiResult> {
  try { const copies = await Promise.all([auth, ...(auth.nodePeers || [])].map(target => detail(request, target, email)));return copies.every(c => c === null) ? { ok: true } : failure('نسخهٔ حساب هنوز روی یک نود وجود دارد'); }
  catch { return failure('نبودن نسخهٔ حساب روی همهٔ نودها تأیید نشد'); }
}
