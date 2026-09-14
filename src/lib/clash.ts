import type { BuiltLink } from "./links";
import type { PortalLink } from "./user-portal";

/**
 * خروجی Clash/Clash.Meta (YAML) از لینک‌های vless/vmess/trojan/ss
 * پشتیبانی: tls, reality, ws, grpc, tcp — به اندازه کافی برای اپ‌های رایج
 */

type Json = Record<string, unknown>;

function qs(uri: string): URLSearchParams {
  const i = uri.indexOf("?");
  return new URLSearchParams(i === -1 ? "" : uri.slice(i + 1));
}

function fragment(uri: string): string {
  const i = uri.indexOf("#");
  return i === -1 ? "" : decodeURIComponent(uri.slice(i + 1));
}

type ClashProxy = Record<string, unknown>;

function fromVless(uri: string): ClashProxy | null {
  try {
    const u = new URL(uri.replace(/^vless:\/\//, "http://").replace(/#.*$/, ""));
    const p = qs(uri);
    const proxy: ClashProxy = {
      name: fragment(uri) || `vless-${u.hostname}`,
      type: "vless",
      server: u.hostname,
      port: Number(u.port) || 443,
      uuid: decodeURIComponent(u.username || ""),
      udp: true,
    };
    const flow = p.get("flow");
    if (flow) proxy.flow = flow;
    const security = p.get("security") || "none";
    const sni = p.get("sni") || p.get("host") || u.hostname;
    if (security === "tls" || security === "reality") {
      proxy.tls = true;
      proxy.servername = sni;
      const fp = p.get("fp");
      if (fp) proxy["client-fingerprint"] = fp;
    }
    if (security === "reality") {
      proxy["reality-opts"] = {
        "public-key": p.get("pbk") || "",
        "short-id": p.get("sid") || "",
      };
    }
    const network = p.get("type") || "tcp";
    proxy.network = network;
    if (network === "ws") {
      const opts: Json = { path: p.get("path") || "/" };
      const host = p.get("host");
      if (host) opts.headers = { Host: host };
      proxy["ws-opts"] = opts;
    } else if (network === "grpc") {
      proxy["grpc-opts"] = { "grpc-service-name": p.get("serviceName") || "" };
    } else if (network === "tcp" && p.get("headerType") === "http") {
      proxy.network = "http";
      const opts: Json = { path: p.get("path") || "/" };
      const host = p.get("host");
      if (host) opts.headers = { Host: [host] };
      proxy["http-opts"] = opts;
    }
    return proxy;
  } catch {
    return null;
  }
}

function fromVmess(uri: string): ClashProxy | null {
  try {
    const raw = uri.replace(/^vmess:\/\//, "");
    const json = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Record<string, string>;
    const proxy: ClashProxy = {
      name: json.ps || `vmess-${json.add}`,
      type: "vmess",
      server: json.add,
      port: Number(json.port) || 443,
      uuid: json.id,
      alterId: Number(json.aid || 0),
      cipher: json.scy || "auto",
      udp: true,
    };
    const net = json.net || "tcp";
    proxy.network = net === "tcp" && json.type === "http" ? "http" : net;
    if (json.tls === "tls" || json.tls === "reality") {
      proxy.tls = true;
      if (json.sni || json.host) proxy.servername = json.sni || json.host;
      if (json.fp) proxy["client-fingerprint"] = json.fp;
    }
    if (net === "ws") {
      const opts: Json = { path: json.path || "/" };
      if (json.host) opts.headers = { Host: json.host };
      proxy["ws-opts"] = opts;
    } else if (net === "grpc") {
      proxy["grpc-opts"] = { "grpc-service-name": json.path || "" };
    } else if (proxy.network === "http") {
      const opts: Json = { path: json.path || "/" };
      if (json.host) opts.headers = { Host: [json.host] };
      proxy["http-opts"] = opts;
    }
    return proxy;
  } catch {
    return null;
  }
}

function fromTrojan(uri: string): ClashProxy | null {
  try {
    const u = new URL(uri.replace(/^trojan:\/\//, "http://").replace(/#.*$/, ""));
    const p = qs(uri);
    const proxy: ClashProxy = {
      name: fragment(uri) || `trojan-${u.hostname}`,
      type: "trojan",
      server: u.hostname,
      port: Number(u.port) || 443,
      password: decodeURIComponent(u.username || ""),
      udp: true,
      sni: p.get("sni") || p.get("peer") || u.hostname,
    };
    const net = p.get("type") || "tcp";
    if (net === "ws") {
      proxy.network = "ws";
      const opts: Json = { path: p.get("path") || "/" };
      const host = p.get("host");
      if (host) opts.headers = { Host: host };
      proxy["ws-opts"] = opts;
    } else if (net === "grpc") {
      proxy.network = "grpc";
      proxy["grpc-opts"] = { "grpc-service-name": p.get("serviceName") || "" };
    }
    return proxy;
  } catch {
    return null;
  }
}

function fromSs(uri: string): ClashProxy | null {
  try {
    const u = new URL(uri.replace(/^ss:\/\//, "http://").replace(/#.*$/, ""));
    const userinfo = decodeURIComponent(u.username || "");
    const [method, password = ""] = userinfo.split(":");
    return {
      name: fragment(uri) || `ss-${u.hostname}`,
      type: "ss",
      server: u.hostname,
      port: Number(u.port) || 443,
      cipher: method || "chacha20-ietf-poly1305",
      password,
      udp: true,
    };
  } catch {
    return null;
  }
}

function yamlValue(v: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(v)) return `[${v.map((x) => JSON.stringify(String(x))).join(", ")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Json)
      .map(([k, val]) => `${"  ".repeat(indent + 1)}${k}: ${yamlValue(val, indent + 1)}`)
      .join("\n");
    return `\n${entries}`;
  }
  return typeof v === "number" ? String(v) : JSON.stringify(String(v ?? ""));
}

function proxyToYaml(proxy: ClashProxy): string {
  const lines: string[] = [];
  const ordered: [string, unknown][] = Object.entries(proxy);
  for (const [k, v] of ordered) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      lines.push(`  ${k}:`);
      for (const [k2, v2] of Object.entries(v as Json)) {
        lines.push(`    ${k2}: ${yamlValue(v2, 0)}`);
      }
    } else {
      lines.push(`  ${k}: ${yamlValue(v, 0)}`);
    }
  }
  return lines.join("\n");
}

/** ساخت YAML کامل Clash از لینک‌ها */
export function buildClashYaml(links: PortalLink[], userName: string): string {
  const proxies: ClashProxy[] = [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    let proxy: ClashProxy | null = null;
    if (l.protocol === "vless") proxy = fromVless(l.uri);
    else if (l.protocol === "vmess") proxy = fromVmess(l.uri);
    else if (l.protocol === "trojan") proxy = fromTrojan(l.uri);
    else if (l.protocol === "shadowsocks") proxy = fromSs(l.uri);
    if (!proxy) continue;
    let name = proxy.name as string;
    let n = 2;
    while (seen.has(name)) name = `${proxy.name as string} (${n++})`;
    proxy.name = name;
    seen.add(name);
    names.push(name);
    proxies.push(proxy);
  }
  if (proxies.length === 0) {
    return `# No available proxies\nproxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n`;
  }
  const proxyBlocks = proxies.map((p) => `  -\n${proxyToYaml(p)}`).join("\n");
  return [
    `# Clash subscription — ${userName}`,
    `# generated: ${new Date().toISOString()}`,
    `port: 7890`,
    `socks-port: 7891`,
    `allow-lan: false`,
    `mode: rule`,
    `log-level: info`,
    ``,
    `proxies:`,
    proxyBlocks,
    ``,
    `proxy-groups:`,
    `  - name: "PROXY"`,
    `    type: select`,
    `    proxies:`,
    ...names.map((n) => `      - ${JSON.stringify(n)}`),
    ``,
    `rules:`,
    `  - GEOIP,IR,DIRECT`,
    `  - MATCH,PROXY`,
  ].join("\n");
}
