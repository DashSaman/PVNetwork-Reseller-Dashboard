/**
 * آداپتور اتصال به پنل ثنایی (3x-ui) — نسخه 3.7+
 * - حالت توکن: Authorization: Bearer <apiToken> (بدون CSRF — پایدار برای اتوماسیون)
 * - حالت نام‌کاربری/رمز: ورود با جریان CSRF جدید (+ سازگاری با پنل‌های قدیمی v2)
 * مسیرهای کلاینت جدید: /panel/api/clients/* (رکورد یکپارچه کلاینت + چند اینباند)
 */

import { clearDisplayCache, sharedDisplayCache } from "./display-cache";
import { privateNodeRequest, type NodeTls } from './private-node-http';
import { nodesSynchronized } from './queued-update';
import { inboundAvailable } from './inbound-availability';
import type { InboundRuntimeHealth } from './inbound-availability';
import { syncNodeClientUpdate, updateMasterClient, mutateWithNodePeers, ensureClientMembership, verifyClientCreationRecord, verifiedClientUsage, verifyClientDeletion, revokeClientMemberships, type MembershipRevokeProgress, type NodePeer, type NodeMutationProgress } from "./node-client-sync";

export type PanelInbound = {
  id: number;
  enable?: boolean;
  nodeId?: number | null;
  port: number;
  protocol: string;
  tag: string;
  remark: string;
  up: number;
  down: number;
  total: number;
  clients: PanelClient[];
  clientStats: PanelClientStat[];
  /** تنظیمات استریم خام (tls/reality/ws/grpc/...) برای ساخت لینک اتصال */
  stream: Record<string, unknown> | null;
};

export type PanelClient = {
  id?: string; // UUID برای vless/vmess
  password?: string; // برای trojan / shadowsocks
  email: string;
  flow?: string;
  limitIp: number;
  totalGB: number;
  expiryTime: number;
  enable: boolean;
  subId?: string;
  tgId?: string;
  reset?: number;
};

export type PanelClientStat = {
  id?: number;
  inboundId?: number;
  email: string;
  enable?: boolean;
  up: number;
  down: number;
  total: number;
  expiryTime?: number;
};

export type PanelApiResult<T = unknown> = {
  ok: boolean;
  pending?: boolean;
  msg?: string;
  data?: T;
};

/** اتصال به پنل: توکن Bearer یا کوکی نشست */
export type PanelAuth = {
  baseUrl: string;
  token?: string; // API Token (3.7+)
  cookie?: string; // کوکی نشست (ورود با نام کاربری)
  csrf?: string; // توکن CSRF برای درخواست‌های POST در حالت کوکی (3.7+)
  nodePeers?: NodePeer[];
  tls?: NodeTls;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PvNetWork/1.0";

export function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function baseHeaders(auth: PanelAuth, withBody: boolean): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json",
    ...(withBody ? { "Content-Type": "application/json" } : {}),
  };
  if (auth.token) {
    h.Authorization = `Bearer ${auth.token}`;
  } else if (auth.cookie) {
    h.Cookie = auth.cookie;
    if (auth.csrf) h["X-CSRF-Token"] = auth.csrf;
  }
  return h;
}

/** لاگین به پنل و دریافت نشست — پشتیبانی از هر دو معماری (3.7 با CSRF، قدیمی بدون CSRF) */
export async function panelLogin(
  baseUrl: string,
  username: string,
  password: string
): Promise<PanelApiResult<{ cookie: string; csrf?: string }>> {
  const base = normalizeBase(baseUrl);
  // ---- تلاش برای جریان 3.7: گرفتن توکن CSRF ----
  let csrf: string | undefined;
  try {
    const csrfRes = await fetch(`${base}/csrf-token`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (csrfRes.ok) {
      const setCookie = csrfRes.headers.getSetCookie?.() ?? [];
      const cookie = setCookie.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
      const j = (await csrfRes.json().catch(() => null)) as { success?: boolean; obj?: string } | null;
      if (j?.success && j.obj) {
        csrf = j.obj;
        // ورود با CSRF
        const loginRes = await fetch(`${base}/login`, {
          method: "POST",
          headers: {
            "User-Agent": UA,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookie,
            "X-CSRF-Token": csrf,
          },
          body: new URLSearchParams({ username, password }).toString(),
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        });
        const setCookie2 = loginRes.headers.getSetCookie?.() ?? [];
        const merged = [...cookie.split("; ").filter(Boolean), ...setCookie2.map((c) => c.split(";")[0]).filter(Boolean)]
          .filter((v, i, a) => a.indexOf(v) === i)
          .join("; ");
        const lj = (await loginRes.json().catch(() => null)) as { success?: boolean; msg?: string } | null;
        if (loginRes.ok && lj?.success === true && merged) {
          return { ok: true, data: { cookie: merged, csrf } };
        }
        return { ok: false, msg: lj?.msg || "ورود به پنل ناموفق بود؛ نام کاربری/رمز را بررسی کنید." };
      }
    }
  } catch {
    // endpoint نبود → نسخه قدیمی؛ ادامه با جریان ساده
  }

  // ---- جریان قدیمی (v2.x) ----
  try {
    const res = await fetch(`${base}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
        Accept: "application/json",
      },
      body: new URLSearchParams({ username, password }).toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const cookie = setCookie.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
    let json: { success?: boolean; msg?: string } = {};
    try {
      json = await res.json();
    } catch {
      // برخی نسخه‌ها ریدایرکت HTML می‌دهند
    }
    if (res.ok && (json.success === true || cookie.length > 0)) {
      if (!cookie) return { ok: false, msg: "پنل کوکی نشست برنگرداند؛ آدرس پنل را بررسی کنید." };
      return { ok: true, data: { cookie } };
    }
    return { ok: false, msg: json.msg || "ورود به پنل ناموفق بود؛ نام کاربری/رمز یا آدرس را بررسی کنید." };
  } catch (e) {
    return { ok: false, msg: `عدم دسترسی به پنل: ${(e as Error).message}` };
  }
}

async function panelRequest<T>(
  auth: PanelAuth,
  path: string,
  init?: { method?: string; form?: Record<string, string>; json?: unknown; timeoutMs?: number; signal?: AbortSignal }
): Promise<PanelApiResult<T>> {
  const base = normalizeBase(auth.baseUrl);
  const method = init?.method || "GET";
  let body: string | undefined;
  if (init?.json !== undefined) {
    body = JSON.stringify(init.json);
  } else if (init?.form) {
    body = new URLSearchParams(init.form).toString();
  }
  try {
    const options = {
      method,
      headers: baseHeaders(auth, body !== undefined),
      body,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(init.timeoutMs ?? (method === "POST" && path.startsWith("/panel/api/clients/") ? 60000 : 20000))]) : AbortSignal.timeout(init?.timeoutMs ?? (method === "POST" && path.startsWith("/panel/api/clients/") ? 60000 : 20000)),
    };
    // A private node can have a private CA and a loopback/gateway route. Keep
    // normal hostname + CA validation; never disable verification globally.
    const res = auth.tls ? await privateNodeRequest(`${base}${path}`, auth.tls, options) : await fetch(`${base}${path}`, options);
    const json = (await res.json()) as { success?: boolean; msg?: string; obj?: T } | null;
    if (!json) return { ok: false, msg: `پاسخ نامعتبر از پنل (HTTP ${res.status})` };
    if (json.success === true) {
      const readOnlyClientPost = /^\/panel\/api\/clients\/(?:onlines|lastOnline|ips\/[^/]+)$/.test(path);
      if (method !== "GET" && !readOnlyClientPost && /^\/panel\/api\/(clients\/|inbounds\/(add|update|del))/.test(path)) clearDisplayCache(sharedDisplayCache());
      return { ok: true, data: json.obj as T };
    }
    return { ok: false, msg: json.msg || "عملیات در پنل ناموفق بود" };
  } catch (e) {
    return { ok: false, msg: `خطای ارتباط با پنل: ${(e as Error).message}` };
  }
}

export type RawInbound = {
  id: number;
  enable?: unknown;
  nodeId?: unknown;
  port: number;
  protocol: string;
  tag: string;
  remark?: string;
  up?: number;
  down?: number;
  total?: number;
  settings?: unknown; // رشته یا آبجکت (بسته به نسخه 3x-ui)
  streamSettings?: unknown;
  clientStats?: PanelClientStat[];
};

/** برخی نسخه‌های 3x-ui مقدار JSON را رشته و برخی آبجکت برمی‌گردانند */
function parseMaybeJson(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseInbound(raw: RawInbound): PanelInbound {
  const settings = parseMaybeJson(raw.settings);
  const clientsRaw = settings?.clients;
  const clients: PanelClient[] = Array.isArray(clientsRaw) ? (clientsRaw as PanelClient[]) : [];
  const stream = parseMaybeJson(raw.streamSettings);
  return {
    id: raw.id,
    enable: typeof raw.enable === 'boolean' ? raw.enable : undefined,
    nodeId: raw.nodeId === undefined || raw.nodeId === null ? null : Number.isSafeInteger(raw.nodeId) && (raw.nodeId as number) > 0 ? raw.nodeId as number : undefined,
    port: raw.port,
    protocol: raw.protocol,
    tag: raw.tag || `inbound-${raw.id}`,
    remark: raw.remark || raw.tag || `inbound-${raw.id}`,
    up: raw.up || 0,
    down: raw.down || 0,
    total: raw.total || 0,
    clients,
    clientStats: Array.isArray(raw.clientStats) ? raw.clientStats : [],
    stream,
  };
}

// A full controller list contains every client's settings/statistics and can
// take several seconds even while the small runtime endpoints are healthy.
// Keep this bounded and independent of mutation timeouts and display caches.
export const INBOUND_CATALOG_TIMEOUT_MS = 12000;

/** دریافت لیست کامل اینباندها به همراه آمار کلاینت‌ها */
export async function getInbounds(auth: PanelAuth, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<PanelApiResult<PanelInbound[]>> {
  // Large panel snapshots can finish after 20s; write requests keep their own
  // 20s deadline. Authoritative reads still bypass every display cache.
  const r = await panelRequest<RawInbound[]>(auth, "/panel/api/inbounds/list", { timeoutMs: 60000, ...options });
  if (!r.ok || !r.data) return { ok: false, msg: r.msg };
  const list = Array.isArray(r.data) ? r.data.map(parseInbound) : [];
  return { ok: true, data: list };
}

/** رکوردهای یکپارچه کلاینت‌ها (3.7+) — برای یافتن subId/uuid/رمز هر ایمیل */
export type PanelClientRecord = {
  email: string;
  subId?: string;
  uuid?: string;
  id?: string;
  password?: string;
  flow?: string;
  limitIp?: number;
  totalGB?: number;
  expiryTime?: number;
  enable?: boolean;
};

export async function getClientRecords(auth: PanelAuth): Promise<PanelApiResult<PanelClientRecord[]>> {
  const r = await panelRequest<PanelClientRecord[]>(auth, "/panel/api/clients/list");
  if (!r.ok) return r;
  return { ok: true, data: Array.isArray(r.data) ? r.data : [] };
}

/** ایمیل‌های کلاینت‌های آنلاین لحظه‌ای (همه اینباندهای پنل) — نسخه‌های جدید و قدیمی 3x-ui */
export async function getOnlineEmails(auth: PanelAuth): Promise<PanelApiResult<string[]>> {
  // 3x-ui جدید: /panel/api/clients/onlines
  let r = await panelRequest<string[]>(auth, "/panel/api/clients/onlines", { method: "POST", json: {} });
  if (!r.ok) {
    // نسخه‌های قدیمی‌تر: /panel/api/inbounds/onlines
    const legacy = await panelRequest<string[]>(auth, "/panel/api/inbounds/onlines", { method: "POST", json: {} });
    if (legacy.ok) return legacy;
  }
  if (!r.ok) return r;
  const list = Array.isArray(r.data) ? r.data.filter((x): x is string => typeof x === "string") : [];
  return { ok: true, data: list };
}

/** Read-only POST: native last-seen map; never forwards request-controlled fields. */
export async function getLastOnline(auth: PanelAuth, options: { timeoutMs?: number } = {}): Promise<PanelApiResult<Record<string, number>>> {
  const result = await panelRequest<Record<string, number>>(auth, '/panel/api/clients/lastOnline', { method: 'POST', json: {}, timeoutMs: options.timeoutMs ?? 8000 });
  if (!result.ok) return result;
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return { ok: false, msg: 'Last-online data unavailable' };
  return result;
}

/** IPهای ثبت‌شده یک کلاینت — مسیر جدید (online-stats) */
export async function getClientIps(auth: PanelAuth, email: string): Promise<PanelApiResult<string[]>> {
  const r = await panelRequest<string[]>(
    auth,
    `/panel/api/clients/ips/${encodeURIComponent(email)}`,
    { method: "POST", json: {} }
  );
  if (!r.ok) return r;
  const list = Array.isArray(r.data) ? r.data.filter((x): x is string => typeof x === "string" && !!x) : [];
  return { ok: true, data: list };
}

/** IPهای یک کلاینت — مسیر قدیمی per-inbound (نسخه‌های قدیمی 3x-ui) */
export async function getClientIpsLegacy(auth: PanelAuth, inboundId: number, email: string): Promise<PanelApiResult<string[]>> {
  const r = await panelRequest<string[]>(
    auth,
    `/panel/api/inbounds/${inboundId}/getClientIps/${encodeURIComponent(email)}`,
    { method: "POST", json: {} }
  );
  if (!r.ok) return r;
  const list = Array.isArray(r.data) ? r.data.filter((x): x is string => typeof x === "string" && !!x) : [];
  return { ok: true, data: list };
}

/** بدنه JSON کلاینت بر اساس پروتکل اینباند */
export function buildClientPayload(
  protocol: string,
  client: Partial<PanelClient>
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    email: client.email,
    limitIp: client.limitIp ?? 0,
    totalGB: client.totalGB ?? 0,
    expiryTime: client.expiryTime ?? 0,
    enable: client.enable ?? true,
    tgId: client.tgId ?? 0,
    subId: client.subId ?? "",
    reset: client.reset ?? 0,
  };
  if (protocol === "trojan" || protocol === "shadowsocks") {
    return { ...base, password: client.password || client.id || "" };
  }
  if (protocol === "vless") {
    return { ...base, id: client.id || "", flow: client.flow ?? "" };
  }
  return { ...base, id: client.id || "" };
}

/** افزودن کلاینت واحد به یک یا چند اینباند (مولتی‌لوکیشن) */
export async function addClient(
  auth: PanelAuth,
  inboundIds: number[],
  protocol: string,
  client: Partial<PanelClient>
): Promise<PanelApiResult> {
  const result = await panelRequest(auth, "/panel/api/clients/add", {
    method: "POST",
    json: {
      client: buildClientPayload(protocol, client),
      inboundIds,
    },
  });
  if (!result.ok) return result;
  const verified = await ensureClientMembership(auth, client.email || "", inboundIds, panelRequest, client);
  if (!verified.ok && !verified.pending) return verified;
  if ((result.data as { nodePending?: boolean } | undefined)?.nodePending) return { ok: false, pending: true, msg: "همگام‌سازی لوکیشن‌ها در جریان است؛ همان درخواست را دوباره ادامه دهید" };
  return verified;
}

/** ویرایش کلاینت (رکورد یکپارچه — روی همه اینباندهای متصل اعمال می‌شود) */
export async function resumeClientCreation(auth: PanelAuth, inboundIds: number[], protocol: string, client: Partial<PanelClient>): Promise<PanelApiResult> {
  const current = await panelRequest<{ client: { uuid?: string; id?: string; subId?: string } }>(auth, `/panel/api/clients/get/${encodeURIComponent(client.email || "")}`);
  if (current.ok && current.data?.client) {
    const c = current.data.client;
    if (c.subId !== client.subId || client.id && (c.uuid || c.id) !== client.id) return { ok: false, msg: "هویت حساب با عملیات ساخت قبلی یکسان نیست" };
    const verified = await ensureClientMembership(auth, client.email || '', inboundIds, panelRequest, client);
    if (!verified.ok && !verified.pending) return verified;
    // Re-attaching an already complete membership starts another native fan-out.
    return await arePanelNodesSynchronized(auth, true, inboundIds) ? { ok: true } : { ok: false, pending: true, msg: 'حساب ثبت شده؛ همگام‌سازی برخی لوکیشن‌ها در جریان است' };
  }
  if (client.id && /^(?:client )?(?:not found|does not exist)$|^obtain \(record not found\)$/.test((current.msg || "").trim().toLowerCase())) return addClient(auth, inboundIds, protocol, client);
  return { ok: false, msg: "وضعیت ساخت قبلی قابل تأیید نیست" };
}

export async function updateClient(
  auth: PanelAuth,
  email: string,
  protocol: string,
  client: Partial<PanelClient>
): Promise<PanelApiResult> {
  if (auth.nodePeers?.length) {
    const synced = await syncNodeClientUpdate(auth, email, client, panelRequest);
    if (!synced.ok) return synced;
  }
  return updateMasterClient(auth, email, client, panelRequest);
}

/** اتصال کلاینت موجود به اینباندهای جدید */
export async function attachClient(
  auth: PanelAuth,
  email: string,
  inboundIds: number[]
): Promise<PanelApiResult> {
  const result = await panelRequest(auth, `/panel/api/clients/${encodeURIComponent(email)}/attach`, {
    method: "POST",
    json: { inboundIds },
  });
  if (!result.ok) return result;
  const verified = await ensureClientMembership(auth, email, inboundIds, panelRequest);
  if (!verified.ok) return verified;
  if ((result.data as { nodePending?: boolean } | undefined)?.nodePending) return { ok: false, pending: true, msg: "همگام‌سازی لوکیشن‌ها هنوز کامل نشده است" };
  return verified;
}

/** جدا کردن کلاینت از اینباندها */
export async function detachClient(
  auth: PanelAuth,
  email: string,
  inboundIds: number[]
): Promise<PanelApiResult> {
  return panelRequest(auth, `/panel/api/clients/${encodeURIComponent(email)}/detach`, {
    method: "POST",
    json: { inboundIds },
  });
}

export async function revokeClientInbounds(auth: PanelAuth, email: string, subId: string, ids: number[], progress: { load(): Promise<MembershipRevokeProgress | undefined>; save(value: MembershipRevokeProgress): Promise<void> }, verifyOnly = false): Promise<PanelApiResult> {
  return revokeClientMemberships(auth, email, subId, ids, panelRequest, progress, verifyOnly);
}

export async function getClientProfile(auth: PanelAuth, email: string) {
  return panelRequest<{ client: PanelClient & { uuid?: string }; inboundIds: number[]; usedTraffic: number }>(auth, `/panel/api/clients/get/${encodeURIComponent(email)}`);
}

/** حذف کلاینت از همه اینباندها (رکورد یکتا) */
export async function getVerifiedClientUsage(auth: PanelAuth, email: string, expectedTotalBytes?: number): Promise<PanelApiResult<number>> {
  return verifiedClientUsage(auth, email, panelRequest, expectedTotalBytes);
}

/** Read-only confirmation; never retry the customer's mutation here. */
// Shared only within one confirmation batch; stale health still fails closed.
export type PanelNodeSyncSnapshot = { inbounds: Pick<PanelInbound, 'id' | 'nodeId'>[] | null; health: InboundRuntimeHealth };
export async function getPanelNodeSyncSnapshot(auth: PanelAuth, signal?: AbortSignal): Promise<PanelNodeSyncSnapshot> {
  // Readiness needs identities of inbounds and their hosting nodes, not a full
  // copy of every customer's traffic. Older panels retain a fresh full-list
  // fallback; neither path accepts cached or unknown runtime state.
  const options = await panelRequest<RawInbound[]>(auth, '/panel/api/inbounds/options', { timeoutMs: 4000, signal });
  let inbounds: PanelNodeSyncSnapshot['inbounds'];
  if (options.ok && Array.isArray(options.data) && options.data.every(i => i && Number.isSafeInteger(i.id) && i.id > 0)) {
    inbounds = options.data.map(i => ({ id: i.id, nodeId: parseInbound(i).nodeId }));
  } else {
    const full = await getInbounds(auth, { timeoutMs: INBOUND_CATALOG_TIMEOUT_MS, signal });
    inbounds = full.ok && full.data ? full.data.map(({ id, nodeId }) => ({ id, nodeId })) : null;
  }
  // Obtain health after a potentially slow fallback so its freshness window
  // has not expired while unrelated customer payloads were downloading.
  return { inbounds, health: await getInboundRuntimeHealth(auth, signal) };
}
export async function arePanelNodesSynchronized(auth: PanelAuth, allowEmpty = false, inboundIds?: number[], snapshot?: PanelNodeSyncSnapshot): Promise<boolean> {
  if (inboundIds) {
    if (!inboundIds.length) return false;
    const current = snapshot || await getPanelNodeSyncSnapshot(auth);
    return !!current.inbounds && [...new Set(inboundIds)].every(id => {
      const matches = current.inbounds!.filter(i => i.id === id);
      return matches.length === 1 && inboundAvailable({ ...matches[0], enable: true }, current.health);
    });
  }
  const result = await panelRequest<unknown>(auth, '/panel/api/nodes/list', { timeoutMs: 4000 });
  return result.ok && (allowEmpty && Array.isArray(result.data) && result.data.length === 0 || nodesSynchronized(result.data));
}

export async function getInboundRuntimeHealth(auth: PanelAuth, signal?: AbortSignal): Promise<InboundRuntimeHealth> {
  const [nodes, local] = await Promise.all([
    panelRequest<unknown>(auth, '/panel/api/nodes/list', { timeoutMs: 3500, signal }),
    panelRequest<{ xray?: { state?: unknown }; panelGuid?: unknown }>(auth, '/panel/api/server/status', { timeoutMs: 3500, signal }),
  ]);
  return { observedAt: Date.now(), localRunning: local.ok && local.data?.xray?.state === 'running', controllerGuid: local.ok && typeof local.data?.panelGuid === 'string' ? local.data.panelGuid : undefined, nodes: nodes.ok ? nodes.data : null };
}

export async function readClientCreation(auth: PanelAuth, inboundIds: number[], expected: Partial<PanelClient>, signal?: AbortSignal): Promise<PanelApiResult> {
  return verifyClientCreationRecord(auth, expected.email || '', inboundIds, expected, (a, p, init) => panelRequest(a, p, { ...init, timeoutMs: 4000, signal }));
}

export async function isQueuedClientSaved(auth: PanelAuth, email: string, quotaBytes: number, subId: string, inboundIds: number[], signal?: AbortSignal): Promise<boolean> {
  if (!subId || !inboundIds.length) return false;
  const result = await panelRequest<{ client: { email?: string; uuid?: string; id?: string; subId?: string; totalGB?: number }; inboundIds?: number[] }>(auth, `/panel/api/clients/get/${encodeURIComponent(email)}`, { timeoutMs: 4000, signal });
  const client = result.data?.client, ids = result.data?.inboundIds;
  if (!result.ok || !client || client.email !== email || !(client.uuid || client.id) || client.subId !== subId || client.totalGB !== quotaBytes || !Array.isArray(ids) || !inboundIds.every(id => ids.includes(id))) return false;
  const usage = await verifiedClientUsage(auth, email, (a, path, init) => panelRequest(a, path, { ...init, timeoutMs: 4000, signal }), quotaBytes);
  return usage.ok && usage.data !== undefined;
}

export async function deleteClient(auth: PanelAuth, email: string, progress?: NodeMutationProgress): Promise<PanelApiResult> {
  return mutateWithNodePeers(auth, email, "delete", panelRequest, progress);
}

export async function readClientDeletion(auth: PanelAuth, email: string): Promise<PanelApiResult> {
  return verifyClientDeletion(auth, email, (target, path, init) => panelRequest(target, path, { ...init, timeoutMs: 4000 }));
}

/** ریست ترافیک کلاینت بر اساس ایمیل */
export async function resetClientTraffic(auth: PanelAuth, email: string, progress?: NodeMutationProgress): Promise<PanelApiResult> {
  return mutateWithNodePeers(auth, email, "reset", panelRequest, progress);
}

/** کاربران آنلاین */
export async function getOnlineClients(auth: PanelAuth): Promise<PanelApiResult<unknown>> {
  return panelRequest(auth, "/panel/api/clients/onlines", { method: "POST" });
}

/** وضعیت سرور (سرعت لحظه‌ای شبکه + منابع) — برای ویجت زنده */
export type PanelServerStatus = {
  ok: boolean;
  msg?: string;
  data?: {
    up: number; // بایت/ثانیه
    down: number; // بایت/ثانیه
    cpu: number; // درصد
    memUsed: number;
    memTotal: number;
    tcpCount: number;
    uptime: number;
    xrayRunning: boolean;
  };
};

export async function getServerStatus(auth: PanelAuth): Promise<PanelServerStatus> {
  const r = await panelRequest<Record<string, unknown>>(auth, "/panel/api/server/status");
  if (!r.ok || !r.data || typeof r.data !== "object") return { ok: false, msg: r.msg };
  const d = r.data as Record<string, unknown>;
  const netIO = (d.netIO || {}) as Record<string, unknown>;
  const mem = (d.mem || {}) as Record<string, unknown>;
  const xray = (d.xray || {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      up: Number(netIO.up) || 0,
      down: Number(netIO.down) || 0,
      cpu: Number(d.cpu) || 0,
      memUsed: Number(mem.current) || 0,
      memTotal: Number(mem.total) || 0,
      tcpCount: Number(d.tcpCount) || 0,
      uptime: Number(d.uptime) || 0,
      xrayRunning: xray.state === "running",
    },
  };
}

/** شناسه یکتای کلاینت (سازگاری با کد قبلی) */
export function clientKeyId(c: PanelClient): string {
  return c.id || c.password || c.email;
}
