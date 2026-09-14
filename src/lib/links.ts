/**
 * ساخت لینک‌های اتصال (V2Ray/V2rayNG/Strength/Streisand) از مشخصات کلاینت و اینباند
 * - vless / vmess / trojan / shadowsocks
 * - پشتیبانی استریم: tcp, ws, grpc, kcp, httpupgrade, splithttp/xhttp + tls / reality
 */

type Json = Record<string, unknown>;

function asObj(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}
function asStr(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** enc برای query params — طبق استاندارد لینک‌های V2Ray */
function q(v: string): string {
  return encodeURIComponent(v);
}

export type LinkInput = {
  protocol: string; // vless | vmess | trojan | shadowsocks
  host: string; // آدرس اتصال (دامنه یا IP)
  port: number;
  remark: string; // نام نمایشی لینک
  uuid?: string; // vless/vmess
  password?: string; // trojan/ss
  email: string;
  flow?: string; // flow کلاینت (vless reality)
  stream: Json | null; // streamSettings اینباند
};

export type BuiltLink = {
  protocol: string;
  port: number;
  uri: string;
};

/** استخراج پارامترهای استریم برای لینک‌های URI (vless/trojan) */
function streamParams(stream: Json | null, address: string): Record<string, string> {
  const p: Record<string, string> = {};
  if (!stream) return p;

  const network = asStr(stream.network) || "tcp";
  const security = asStr(stream.security) || "none";
  p.type = network;
  p.security = security === "none" ? "none" : security;

  // ---- TLS ----
  if (security === "tls") {
    const tls = asObj(stream.tlsSettings);
    const sni = asStr(tls.serverName) || address;
    const fp = asStr(tls.fingerprint);
    const alpn = asArr(tls.alpn).filter((x) => typeof x === "string").join(",");
    if (sni) p.sni = sni;
    if (fp) p.fp = fp;
    if (alpn) p.alpn = alpn;
    if (asStr((tls.alpn as unknown) ?? "")) {
      // برخی نسخه‌ها alpn رشته‌ای می‌دهند
      const raw = asStr(tls.alpn);
      if (raw && !alpn) p.alpn = raw;
    }
  }

  // ---- Reality ----
  if (security === "reality") {
    const r = asObj(stream.realitySettings);
    const sni = (asArr(r.serverNames).find((x) => typeof x === "string") as string | undefined) || address;
    const inner = asObj(r.settings);
    const pbk = asStr(inner.publicKey) || asStr(r.publicKey);
    const sid = asArr(r.shortIds).find((x) => typeof x === "string" || typeof x === "number") || "";
    const fp = asStr(inner.fingerprint) || asStr(r.fingerprint) || "chrome";
    const spx = asStr(inner.spiderX) || asStr(r.spiderX);
    if (sni) p.sni = sni;
    if (pbk) p.pbk = pbk;
    if (sid) p.sid = String(sid);
    p.fp = fp;
    if (spx) p.spx = spx;
  }

  // ---- شبکه‌ها ----
  if (network === "ws") {
    const ws = asObj(stream.wsSettings);
    const path = asStr(ws.path);
    const host = asObj(ws.headers).Host || asObj(ws.headers).host;
    if (path) p.path = path;
    if (host) p.host = String(host);
  } else if (network === "grpc") {
    const g = asObj(stream.grpcSettings);
    const sn = asStr(g.serviceName);
    if (sn) p.serviceName = sn;
    if (g.multiMode === true) p.mode = "multi";
  } else if (network === "kcp") {
    const k = asObj(stream.kcpSettings);
    const headerType = asStr(asObj(k.header).type);
    if (headerType) p.headerType = headerType;
    const seed = asStr(k.seed);
    if (seed) p.seed = seed;
  } else if (network === "tcp") {
    const t = asObj(stream.tcpSettings);
    const headerType = asStr(asObj(t.header).type);
    if (headerType && headerType !== "none") {
      p.headerType = headerType;
      const req = asObj(asObj(t.header).request);
      const hHost = asArr(asObj(req.headers).Host)[0];
      const path = asStr(asObj(req).path).split("\n")[0];
      if (hHost) p.host = String(hHost);
      if (path) p.path = path;
    }
  } else if (network === "httpupgrade" || network === "splithttp" || network === "xhttp") {
    const key = network === "httpupgrade" ? "httpupgradeSettings" : network === "xhttp" ? "xhttpSettings" : "splithttpSettings";
    const s = asObj(stream[key] || stream.splithttpSettings || stream.xhttpSettings);
    const path = asStr(s.path);
    const host = asStr(asObj(s.headers).Host) || asStr(s.host);
    if (path) p.path = path;
    if (host) p.host = host;
  }

  return p;
}

function paramsToQuery(p: Record<string, string>): string {
  return Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${q(v)}`)
    .join("&");
}

export function buildV2rayLink(input: LinkInput): BuiltLink {
  const { protocol, host, port, remark, uuid, password, email, flow, stream } = input;
  const name = remark || email;

  if (protocol === "vless") {
    const p = streamParams(stream, host);
    if (flow) p.flow = flow;
    const query = paramsToQuery(p);
    return { protocol, port, uri: `vless://${uuid || ""}@${host}:${port}?${query}#${q(name)}` };
  }

  if (protocol === "trojan") {
    const p = streamParams(stream, host);
    p.type = p.type || "tcp";
    const query = paramsToQuery(p);
    return { protocol, port, uri: `trojan://${encodeURIComponent(password || "")}@${host}:${port}?${query}#${q(name)}` };
  }

  if (protocol === "shadowsocks") {
    const method = "chacha20-ietf-poly1305";
    const userinfo = Buffer.from(`${method}:${password || ""}`).toString("base64url");
    return { protocol, port, uri: `ss://${userinfo}@${host}:${port}#${q(name)}` };
  }

  // ---- vmess (JSON base64) ----
  const sp = streamParams(stream, host);
  const json = {
    v: "2",
    ps: name,
    add: host,
    port: String(port),
    id: uuid || "",
    aid: "0",
    scy: "auto",
    net: sp.type || "tcp",
    type: sp.headerType || "none",
    host: sp.host || sp.sni || "",
    path: sp.path || sp.serviceName || "",
    tls: sp.security === "tls" ? "tls" : sp.security === "reality" ? "reality" : "",
    sni: sp.sni || "",
    fp: sp.fp || "",
  };
  return { protocol, port, uri: `vmess://${Buffer.from(JSON.stringify(json)).toString("base64")}` };
}
