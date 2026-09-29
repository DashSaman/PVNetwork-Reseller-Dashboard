#!/usr/bin/env node
/**
 * تست hang واقعی: پنل B هرگز پاسخ نمی‌دهد (30s+).
 * رفتار جدید: bootstrap لوکال فوری (<500ms) + live-users ≤ UI deadline +3s.
 * رفتار قدیمی: 20s + 20s retry = ~40s بلاک.
 */
if (process.env.NODE_ENV === "production") { console.error("REFUSED"); process.exit(1); }
if (process.env.ALLOW_DESTRUCTIVE_TESTS !== "true") { console.error("REFUSED"); process.exit(1); }
const DBURL = process.env.DATABASE_URL || "";
if (/\/opt\/pv-reseller|\/app\/data\/custom\.db/i.test(DBURL)) { console.error("REFUSED: production DB"); process.exit(1); }
if (!/\.local-dev|[/\\]tmp|test/i.test(DBURL)) { console.error("REFUSED: not test location"); process.exit(1); }

const BASE = "http://localhost:3210";
const MOCK_A = "http://127.0.0.1:3299";
const MOCK_B = "http://127.0.0.1:3300";
const GB = 1024 ** 1024 * 1024;
let pass = 0, fail = 0;
const created = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✓", name, extra); }
  else { fail++; console.log("  ✗", name, extra ? "— " + extra : ""); }
}
async function api(method, path, body, cookie) {
  const h = { "Content-Type": "application/json" };
  if (cookie) h.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null), sc: res.headers.getSetCookie?.() || [] };
}
const pick = (sc) => (sc.find((s) => s.startsWith("rp_session")) || "").split(";")[0];
const rnd = () => Math.random().toString(36).slice(2, 8);
const mockKey = (path, body) => fetch((path.startsWith("/mock2") ? MOCK_B : MOCK_A) + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

(async () => {
  let admin = "";
  try {
    await mockKey("/mock2/hang", { on: false });
    let r = await api("POST", "/api/auth/login", { username: "admin", password: "LocalDemo123!" });
    admin = pick(r.sc);
    await api("POST", "/api/admin/panel-config", { name: "Mock Panel", baseUrl: "http://127.0.0.1:3299", username: "admin", password: "admin123" }, admin).catch(() => {});
    await api("POST", "/api/admin/panel-config", { name: "Mock Panel B", baseUrl: "http://127.0.0.1:3300", username: "admin", password: "admin123" }, admin).catch(() => {});
    r = await api("GET", "/api/admin/inbounds", null, admin);
    const all = r.json.inbounds || [];
    const A = all.find((i) => (i.tag || "").includes("DE"));
    const B = all.find((i) => (i.tag || "").includes("FI"));
    const inbA = { panelId: A.panelId, inboundId: A.inboundId };
    const inbB = { panelId: B.panelId, inboundId: B.inboundId };
    const u = "perf" + rnd();
    r = await api("POST", "/api/admin/resellers", { username: u, password: "AccTest123456", name: "", multiLocation: true, trafficPoolGB: 100, allowIpLimit: true, allowWhitelabel: false, active: true, inbounds: [inbA, inbB] }, admin);
    if (r.json?.id) created.push(r.json.id);
    await api("POST", "/api/reseller/users", { name: "hu" + rnd(), trafficGB: 10, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, (await (async () => {
      const l = await api("POST", "/api/auth/login", { username: u, password: "AccTest123456" }); return pick(l.sc);
    })()));
    const rl = await api("POST", "/api/auth/login", { username: u, password: "AccTest123456" });
    const rc = pick(rl.sc);

    console.log("== 1) bootstrap لوکال فوری — بدون تماس با 3x-ui ==");
    await mockKey("/mock2/hang", { on: true }); // پنل B hang
    let t = Date.now();
    r = await api("GET", "/api/reseller/bootstrap", null, rc);
    const bootstrapMs = Date.now() - t;
    check("bootstrap < 500ms (بدون 3x-ui)", r.status === 200 && bootstrapMs < 500, `${bootstrapMs}ms`);
    check("bootstrap users دارد", Array.isArray(r.json?.users) && r.json.users.length > 0, `users=${r.json?.users?.length}`);

    console.log("== 2) live-users با پنل hang — UI deadline ≤ ۳.۵s ==");
    t = Date.now();
    r = await api("GET", "/api/reseller/live-users", null, rc);
    const liveMs = Date.now() - t;
    check("live-users ≤ ۳۵۰۰ms (نه ۴۰s)", liveMs <= 3500, `${liveMs}ms`);
    check("live-users پاسخ می‌دهد (بخشی یا کامل)", r.status === 200 && Array.isArray(r.json?.users), `status=${r.status}`);
    check("خطای پنل hang گزارش شده", r.json?.panelErrors?.length > 0, `errors=${r.json?.panelErrors?.length}`);

    console.log("== 3) admin panel-summary با پنل hang ==");
    t = Date.now();
    r = await api("GET", "/api/admin/panel-summary", null, admin);
    const summaryMs = Date.now() - t;
    check("panel-summary ≤ ۳۵۰۰ms", summaryMs <= 3500, `${summaryMs}ms`);
    check("خطای پنل hang در summary", r.json?.panelErrors?.length > 0);

    console.log("== 4) mutation هنوز fail-closed با پنل hang ==");
    // DELETE باید fail-closed بماند (نه UI deadline)
    const delUser = r.json?.users?.[0]?.email || "unknown";
    r = await api("GET", "/api/reseller/users", null, rc);
    const firstUser = r.json.users[0]?.email;
    if (firstUser) {
      r = await api("DELETE", `/api/reseller/users/${encodeURIComponent(firstUser)}`, null, rc);
      check("DELETE با پنل hang → fail-closed (نه timeout کوتاه)", r.status === 502 || r.json?.error, `status=${r.status}`);
    }

    await mockKey("/mock2/hang", { on: false });
    console.log(`\n== نتیجه: ${pass} پاس، ${fail} شکست ==`);
  } catch (e) {
    console.error("FAIL:", e);
  } finally {
    for (const id of created) await api("DELETE", `/api/admin/resellers/${id}`, null, admin).catch(() => {});
  }
  process.exit(fail ? 1 : 0);
})();
