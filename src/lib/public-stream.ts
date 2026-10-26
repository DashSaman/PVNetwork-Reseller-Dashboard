type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
function pick(value: unknown, keys: string[]): Obj {
  const source = obj(value), result: Obj = {};
  for (const key of keys) {
    const value = source[key];
    if (["string", "number", "boolean"].includes(typeof value)) result[key] = value;
    else if (Array.isArray(value) && value.every(v => ["string", "number", "boolean"].includes(typeof v))) result[key] = [...value];
  }
  return result;
}

/** Client connection parameters only. Never serialize a native server config. */
export function publicStreamSettings(value: unknown): Obj {
  const source = obj(value), result = pick(source, ["network", "security"]);
  if (source.tlsSettings) result.tlsSettings = pick(source.tlsSettings, ["serverName", "fingerprint", "alpn", "allowInsecure"]);
  if (source.realitySettings) {
    const reality = obj(source.realitySettings);
    result.realitySettings = { ...pick(reality, ["serverName", "serverNames", "publicKey", "shortId", "shortIds", "fingerprint", "spiderX"]), settings: pick(reality.settings, ["publicKey", "fingerprint", "spiderX"]) };
  }
  for (const key of ["wsSettings", "httpupgradeSettings", "splithttpSettings", "xhttpSettings"]) {
    if (source[key]) { const s = obj(source[key]); result[key] = { ...pick(s, ["path", "host", "mode", "earlyDataHeaderName", "maxEarlyData"]), headers: pick(s.headers, ["Host", "host"]) }; }
  }
  if (source.grpcSettings) result.grpcSettings = pick(source.grpcSettings, ["serviceName", "authority", "multiMode"]);
  if (source.kcpSettings) { const k = obj(source.kcpSettings); result.kcpSettings = { ...pick(k, ["seed", "mtu", "tti", "uplinkCapacity", "downlinkCapacity", "congestion", "readBufferSize", "writeBufferSize"]), header: pick(k.header, ["type"]) }; }
  if (source.quicSettings) { const q = obj(source.quicSettings); result.quicSettings = { ...pick(q, ["security", "key"]), header: pick(q.header, ["type"]) }; }
  if (source.tcpSettings) {
    const tcp = obj(source.tcpSettings), header = obj(tcp.header), request = obj(header.request);
    result.tcpSettings = { header: { ...pick(header, ["type"]), request: { ...pick(request, ["path", "method", "version"]), headers: pick(request.headers, ["Host", "host"]) } } };
  }
  return result;
}
