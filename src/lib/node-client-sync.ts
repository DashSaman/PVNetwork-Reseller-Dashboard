import type { PanelAuth, PanelApiResult, PanelClient } from "./panel";

/** Explicit repair peers, never additional billing/statistics panels. */
export type NodePeer = {
  key: string;
  baseUrl: string;
  token: string;
  masterInboundIds: number[];
  tls?: { connectHost: string; ca: string };
};
type RecordData = Record<string, unknown>;
type ClientDetail = { client: RecordData; inboundIds: number[] };
export type NativeRequest = <T>(auth: PanelAuth, path: string, init?: { method?: string; json?: unknown }) => Promise<PanelApiResult<T>>;
type Step = { key: string; identity: string; status: "PENDING" | "STARTED" | "DONE" };
export type NodeMutationState = { version: 1; email: string; op: "delete" | "reset"; steps: Step[] };
export type NodeMutationProgress = {
  load(): Promise<NodeMutationState | undefined>;
  save(state: NodeMutationState): Promise<void>;
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
    if (!after || !(["totalGB", "expiryTime", "enable", "subId"] as const).every(k => client[k] === undefined || after.client[k] === client[k])) return failure("ذخیرهٔ نهایی حساب مرجع تأیید نشد");
    return { ok: true };
  } catch { return failure("خواندن نتیجهٔ نهایی حساب مرجع موفق نبود"); }
}

/** Durable reset/delete progress. STARTED resets are ambiguous after a crash or
 * lost response and must never be replayed automatically against live counters. */
export async function mutateWithNodePeers(auth: PanelAuth, email: string, op: "delete" | "reset", request: NativeRequest, progress?: NodeMutationProgress): Promise<PanelApiResult> {
  try {
    if (op === "reset" && !progress) return failure("ریست روی نود به ژورنال ماندگار نیاز دارد");
    let state = await progress?.load();
    if (!state) {
      const master = await detail(request, auth, email);
      if (!master) return failure("هویت حساب مرجع برای عملیات قابل تأیید نیست");
      const steps: Step[] = [];
      for (const peer of peersFor(auth, master)) {
        const current = await detail(request, peer, email);
        if (!current) continue;
        assertSame(master.client, current.client);
        steps.push({ key: peer.key, identity: identity(current.client), status: "PENDING" });
      }
      steps.push({ key: "master", identity: identity(master.client), status: "PENDING" });
      state = { version: 1, email, op, steps };
      await progress?.save(state);
    }
    if (state.version !== 1 || state.email !== email || state.op !== op) return failure("ژورنال نود با عملیات مطابقت ندارد");
    for (const step of state.steps) {
      if (step.status === "DONE") continue;
      if (step.status === "STARTED" && op === "reset") return failure("پاسخ ریست قبلی قطعی نیست؛ برای جلوگیری از صفر شدن دوبارهٔ مصرف، بررسی مدیر لازم است");
      const target = step.key === "master" ? auth : auth.nodePeers?.find(p => p.key === step.key);
      if (!target) return failure("نود ثبت‌شده در ژورنال پیکربندی نشده است");
      const current = await detail(request, target, email);
      if (!current && op !== "delete") return failure("حساب نود هنگام ریست در دسترس نیست");
      if (current && identity(current.client) !== step.identity) return failure("هویت حساب پس از ثبت عملیات عوض شده است");
      if (current) {
        step.status = "STARTED"; await progress?.save(state);
        const path = op === "delete" ? "del" : "resetTraffic";
        const r = await request(target, `/panel/api/clients/${path}/${encodeURIComponent(email)}`, { method: "POST" });
        if (!r.ok) return failure("پاسخ عملیات نود قطعی نیست؛ بررسی و ادامه لازم است");
        if (op === "delete" && await detail(request, target, email)) return failure("حذف حساب روی نود تأیید نشد");
      }
      step.status = "DONE"; await progress?.save(state);
    }
    return { ok: true };
  } catch { return failure("ارتباط یا ثبت پیشرفت عملیات نود موفق نبود"); }
}
