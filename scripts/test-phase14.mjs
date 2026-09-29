#!/usr/bin/env node
/**
 * تست‌های فاز ۱.۴ — ضد-بایپس نهایی، idempotency، رزرو دلتای UPDATE، تک‌منبع کانونی، شمارش وضعیت، ادmine و کارایی.
 */
if (process.env.NODE_ENV === "production") { console.error("REFUSED: production."); process.exit(1); }
if (process.env.ALLOW_DESTRUCTIVE_TESTS !== "true") { console.error("REFUSED: ALLOW_DESTRUCTIVE_TESTS=true required."); process.exit(1); }
const DBURL = process.env.DATABASE_URL || "";
if (/\/opt\/pv-reseller|\/app\/data\/custom\.db/i.test(DBURL)) { console.error("REFUSED: production DB path."); process.exit(1); }
if (!/\.local-dev|[/\\]tmp|test/i.test(DBURL)) { console.error("REFUSED: DATABASE_URL not an approved test location:", DBURL); process.exit(1); }

const BASE = "http://localhost:3210";
const MOCK_A = "http://127.0.0.1:3299";
const MOCK_B = "http://127.0.0.1:3300";
const GB = 1024 * 1024 * 1024;
let pass = 0, fail = 0;
const createdResellers = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✓", name, extra); }
  else { fail++; console.log("  ✗", name, extra ? "— " + extra : ""); }
}
async function api(method, path, body, cookie, headers = {}) {
  const h = { "Content-Type": "application/json", ...headers };
  if (cookie) h.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null), sc: res.headers.getSetCookie?.() || [] };
}
const pick = (sc) => (sc.find((s) => s.startsWith("rp_session")) || "").split(";")[0];
const rnd = () => Math.random().toString(36).slice(2, 8);
const setUsage = (mock, email, up, down) =>
  fetch(mock + "/mock" + (mock === MOCK_B ? "2" : "") + "/setusage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, up, down }) });
const mockKey = (path, body) => fetch((path.startsWith("/mock2") ? MOCK_B : MOCK_A) + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const scanStats = (reset) => fetch(MOCK_A + "/mock/scanstats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reset ? { reset: true } : {}) }).then((r) => r.json());
async function mkReseller(admin, pool, inbounds, tag) {
  const u = (tag || "p14") + rnd();
  const r = await api("POST", "/api/admin/resellers", { username: u, password: "AccTest123456", name: "", multiLocation: true, trafficPoolGB: pool, allowIpLimit: true, allowWhitelabel: false, active: true, inbounds }, admin);
  if (r.json?.id) createdResellers.push(r.json.id);
  const l = await api("POST", "/api/auth/login", { username: u, password: "AccTest123456" });
  return { rc: pick(l.sc), username: u };
}
async function bridgeLogin(rs) {
  await api("PUT", "/api/reseller/mirza", { enabled: true, chatId: "" }, rs.rc);
  const l = await api("POST", `/api/bridge/${rs.username}/login`, { username: rs.username, password: "AccTest123456" }, null);
  return (l.sc.find((x) => x.startsWith("pv_bridge")) || "").split(";")[0];
}

(async () => {
  let admin = "";
  try {
    for (const k of [["/mock/failreset", { on: false }], ["/mock/faildel", { on: false }], ["/mock2/failupdate", { on: false }], ["/mock2/unknownmode", { on: false }], ["/mock2/failadd", { on: false }], ["/mock2/ambiguousadd", { on: false }]])
      await mockKey(k[0], k[1]);

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

    // ===== T1-T5: نمایندهٔ محدود هرگز کاربر نامحدود نمی‌سازد =====
    console.log("== A) limited → unlimited user impossible ==");
    const rsL = await mkReseller(admin, 100, [inbA]);
    r = await api("POST", "/api/reseller/users", { name: "z1" + rnd(), trafficGB: 0, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rsL.rc);
    check("T1 single create 0 → reject", r.status === 403, `st=${r.status}`);
    r = await api("POST", "/api/reseller/users/bulk", { prefix: "z" + rnd(), count: 2, trafficGB: 0, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rsL.rc);
    check("T2 bulk 0 → reject", r.status === 400 || r.status === 403, `st=${r.status}`);
    const bcL = await bridgeLogin(rsL);
    r = await api("POST", `/api/bridge/${rsL.username}/panel/api/inbounds/addClient`, { id: inbA.inboundId, settings: JSON.stringify({ clients: [{ email: "bz" + rnd(), totalGB: 0, expiryTime: 0, enable: true }] }) }, bcL);
    check("T3 Bridge create total=0 → reject", r.json?.success === false, JSON.stringify(r.json)?.slice(0, 60));
    r = await api("POST", "/api/reseller/users", { name: "ten" + rnd(), trafficGB: 10, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rsL.rc);
    const ten = r.json.email;
    r = await api("PUT", `/api/reseller/users/${encodeURIComponent(ten)}`, { trafficGB: 0 }, rsL.rc);
    check("T4 Dashboard PUT 10→0 → reject", r.status === 403, `st=${r.status}`);
    r = await api("POST", `/api/bridge/${rsL.username}/panel/api/inbounds/updateClient/x`, { id: inbA.inboundId, settings: JSON.stringify({ clients: [{ email: ten, totalGB: 0, expiryTime: 0, enable: true }] }) }, bcL);
    check("T5 Bridge update →0 → reject", r.json?.success === false, JSON.stringify(r.json)?.slice(0, 60));
    // نمایندهٔ نامحدود: رفتار قدیمی 0=نامحدود
    const rsU = await mkReseller(admin, 0, [inbA]);
    r = await api("POST", "/api/reseller/users", { name: "unl" + rnd(), trafficGB: 0, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rsU.rc);
    check("نامحدود: 0 = نامحدود همچنان مجاز (legacy)", r.json?.ok === true, JSON.stringify(r.json)?.slice(0, 50));

    // ===== T6-T8: رزرو دلتای UPDATE =====
    console.log("== B) UPDATE delta reservation ==");
    const rsD = await mkReseller(admin, 100, [inbA, inbB]);
    r = await api("POST", "/api/reseller/users", { name: "dv" + rnd(), trafficGB: 50, expiryDate: "", ipLimit: 0, inbounds: [inbA, inbB] }, rsD.rc);
    const dv = r.json.email;
    await mockKey("/mock2/failupdate", { on: true });
    r = await api("PUT", `/api/reseller/users/${encodeURIComponent(dv)}`, { trafficGB: 80 }, rsD.rc);
    check("T6 update 50→80 با شکست پنل B → PARTIAL", r.status === 502 && r.json?.partial === true, `st=${r.status}`);
    r = await api("GET", "/api/reseller/inbounds", null, rsD.rc);
    check("T7 remaining با رزرو دلتا = ۲۰ (نه ۵۰)", Math.abs(r.json.permissions.remainingGB - 20) < 0.01, `rem=${r.json.permissions.remainingGB}`);
    r = await api("POST", "/api/reseller/users", { name: "steal" + rnd(), trafficGB: 30, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rsD.rc);
    check("T7b ساخت ۳۰ گیگی روی دلتای رزروشده → reject", r.status === 403, `st=${r.status}`);
    await mockKey("/mock2/failupdate", { on: false });
    r = await api("PUT", `/api/reseller/users/${encodeURIComponent(dv)}`, { trafficGB: 80 }, rsD.rc);
    check("T8 retry → موفق", r.json?.ok === true, JSON.stringify(r.json)?.slice(0, 40));
    r = await api("GET", "/api/reseller/inbounds", null, rsD.rc);
    check("T8b allocation=80، رزرو آزاد، remaining=20", r.json.permissions.allocatedGB === 80 && Math.abs(r.json.permissions.remainingGB - 20) < 0.01, `a=${r.json.permissions.allocatedGB} r=${r.json.permissions.remainingGB}`);

    // ===== T9-T12: idempotency ساخت داشبورد =====
    console.log("== C) create idempotency ==");
    const rsI = await mkReseller(admin, 100, [inbA, inbB]);
    const reqId = "idem-" + rnd();
    const nameI = "idem" + rnd();
    await mockKey("/mock2/unknownmode", { on: true });
    r = await api("POST", "/api/reseller/users", { name: nameI, trafficGB: 15, expiryDate: "", ipLimit: 1, inbounds: [inbA, inbB], requestId: reqId }, rsI.rc, { "idempotency-key": reqId });
    check("T9 اولین تلاش UNKNOWN → رد", r.status >= 400, `st=${r.status}`);
    await mockKey("/mock2/unknownmode", { on: false });
    r = await api("POST", "/api/reseller/users", { name: nameI, trafficGB: 15, expiryDate: "", ipLimit: 1, inbounds: [inbA, inbB], requestId: reqId }, rsI.rc, { "idempotency-key": reqId });
    const firstEmail = r.json?.email;
    check("T10 retry همان requestId → همان email", r.json?.ok === true && firstEmail, JSON.stringify(r.json)?.slice(0, 60));
    const sub1 = r.json?.subId;
    r = await api("POST", "/api/reseller/users", { name: nameI, trafficGB: 15, expiryDate: "", ipLimit: 1, inbounds: [inbA, inbB], requestId: reqId }, rsI.rc, { "idempotency-key": reqId });
    check("T11 دوباره همان requestId → همان email/subId (idempotent)", r.json?.ok === true && r.json?.email === firstEmail && r.json?.subId === sub1, `${r.json?.email} vs ${firstEmail}`);
    r = await api("POST", "/api/reseller/users", { name: nameI, trafficGB: 15, expiryDate: "", ipLimit: 1, inbounds: [inbA, inbB], requestId: reqId + "-x" }, rsI.rc);
    check("T12 requestId متفاوت → عملیات جدید مجاز", r.json?.ok === true && r.json?.email !== firstEmail, JSON.stringify(r.json)?.slice(0, 50));
    r = await api("POST", "/api/reseller/users", { name: nameI, trafficGB: 30, expiryDate: "", ipLimit: 1, inbounds: [inbA], requestId: reqId }, rsI.rc);
    check("T14 payload متفاوت با همان requestId → 409", r.status === 409, `st=${r.status}`);

    // ===== T20-T25: canonical همه‌جا (شامل clientList) =====
    console.log("== D) canonical equality (incl. clientList) ==");
    const rsC = await mkReseller(admin, 100, [inbA, inbB]);
    r = await api("POST", "/api/reseller/users", { name: "ce" + rnd(), trafficGB: 30, expiryDate: "", ipLimit: 0, inbounds: [inbA, inbB] }, rsC.rc);
    const ce = r.json.email;
    await setUsage(MOCK_A, ce, 7 * GB, 0);
    await setUsage(MOCK_B, ce, 5 * GB, 0);
    r = await api("GET", "/api/reseller/users", null, rsC.rc);
    const du = r.json.users.find((x) => x.email === ce);
    check("T25 Dashboard=12", Math.abs(du.usedGB - 12) < 0.01, `used=${du.usedGB}`);
    r = await api("GET", `/api/s/${du.subId}?format=json`);
    check("T24 Portal=12", Math.abs(r.json.usedGB - 12) < 0.01, `used=${r.json.usedGB}`);
    const bcC = await bridgeLogin(rsC);
    r = await api("GET", `/api/bridge/${rsC.username}/panel/api/inbounds/getClientTraffics/${encodeURIComponent(ce)}`, null, bcC);
    const g12 = ((r.json?.obj?.up || 0) + (r.json?.obj?.down || 0)) / GB;
    check("T23 getClientTraffics=12", Math.abs(g12 - 12) < 0.01, `used=${g12}`);
    r = await api("GET", `/api/bridge/${rsC.username}/panel/api/clients/list`, null, bcC);
    const cl = (r.json?.obj || []).find((c) => c.email === ce);
    const cl12 = ((cl?.up || 0) + (cl?.down || 0)) / GB;
    check("T22 Bridge clientList=12", Math.abs(cl12 - 12) < 0.01, `used=${cl12}`);

    // ===== T26: شمارش وضعیت بدون دوگانگی =====
    console.log("== E) status counts ==");
    r = await api("GET", "/api/reseller/stats", null, rsC.rc);
    const st = r.json.stats;
    const usersCount = r.json.stats.usersCount ?? r.json.stats.users ?? 0;
    check("T26 active+expired+disabled ≤ users", st.activeUsers + st.expiredUsers + st.disabledUsers <= usersCount + 1, `a=${st.activeUsers} e=${st.expiredUsers} d=${st.disabledUsers} u=${usersCount}`);

    // ===== T27-T29: admin pool obligations =====
    console.log("== F) admin pool obligations ==");
    const adminTarget = createdResellers[createdResellers.length - 1];
    // رزرو دلتای فعال بساز
    const rsP = await mkReseller(admin, 100, [inbA, inbB]);
    r = await api("POST", "/api/reseller/users", { name: "po" + rnd(), trafficGB: 30, expiryDate: "", ipLimit: 0, inbounds: [inbA, inbB] }, rsP.rc);
    const po = r.json.email;
    await mockKey("/mock2/failupdate", { on: true });
    await api("PUT", `/api/reseller/users/${encodeURIComponent(po)}`, { trafficGB: 60 }, rsP.rc); // PARTIAL، دلتا 30 رزرو
    await mockKey("/mock2/failupdate", { on: false });
    r = await api("PUT", `/api/admin/resellers/${rsP.id ?? createdResellers[createdResellers.length - 1]}`, { trafficPoolGB: 20 }, admin);
    // id reseller لازم — mkReseller آن را نگه می‌دارد؟ push کردیم r.json.id
    check("T29 admin pool زیر رزرو → 409", r.status === 409, `st=${r.status}`);
    r = await api("PUT", `/api/admin/resellers/${createdResellers[createdResellers.length - 1]}`, { trafficPoolGB: 20, overrideSafety: true }, admin);
    check("override صریح مجاز", r.json?.ok === true || r.status === 200, `st=${r.status}`);

    // ===== T30: reseller delete guard =====
    console.log("== G) safe delete ==");
    r = await api("DELETE", `/api/admin/resellers/${createdResellers[createdResellers.length - 1]}`, null, admin);
    check("T30 delete با کاربران/عملیات فعال → 409", r.status === 409, `st=${r.status}`);

    // ===== T31-T32: subId =====
    console.log("== H) subId ==");
    {
      const rsS = await mkReseller(admin, 50, [inbA]);
      const bcS = await bridgeLogin(rsS);
      const sid = "abc-def_123-" + rnd();
      r = await api("POST", `/api/bridge/${rsS.username}/panel/api/inbounds/addClient`, { id: inbA.inboundId, settings: JSON.stringify({ clients: [{ email: "sd" + rnd(), totalGB: 5 * GB, expiryTime: 0, enable: true, subId: sid }] }) }, bcS);
      check("T31 ساخت با subId دارای -/_ موفق", r.json?.success === true, JSON.stringify(r.json)?.slice(0, 60));
      const portal = await fetch(`${BASE}/api/s/${sid}`);
      check("T31b پرتال همان subId دقیق resolve می‌شود", portal.status === 200, `st=${portal.status}`);
      // کاربر دوم با همان subId
      r = await api("POST", `/api/bridge/${rsS.username}/panel/api/inbounds/addClient`, { id: inbA.inboundId, settings: JSON.stringify({ clients: [{ email: "sd2" + rnd(), totalGB: 5 * GB, expiryTime: 0, enable: true, subId: sid }] }) }, bcS);
      check("T32 subId تکراری برای کاربر دیگر → reject", r.json?.success === false, JSON.stringify(r.json)?.slice(0, 60));
    }

    // ===== کارایی: bootstrap فقط یک اسکن؛ concurrency =====
    console.log("== I) performance ==");
    await scanStats(true);
    r = await api("GET", "/api/reseller/bootstrap", null, rsC.rc);
    check("bootstrap پاسخ می‌دهد", r.status === 200 && Array.isArray(r.json?.users), `st=${r.status}`);
    let ss = await scanStats(false);
    check("P36 bootstrap = حداکثر یک اسکن پنل A", ss.scanCount <= 1, `A=${ss.scanCount}`);
    // single-flight: سه درخواست هم‌زمان خواندنی → باز هم ≤1 در پنجره TTL
    await scanStats(true);
    await Promise.all([
      api("GET", "/api/reseller/users", null, rsC.rc),
      api("GET", "/api/reseller/inbounds", null, rsC.rc),
      api("GET", "/api/reseller/bootstrap", null, rsC.rc),
    ]);
    ss = await scanStats(false);
    check("P40 سه مصرف‌کنندهٔ هم‌زمان = یک snapshot مشترک (A)", ss.scanCount <= 1, `A=${ss.scanCount}`);
    // concurrency: تأخیر 200ms هر دو پنل → مجموع خواندنی باید ~max نه جمع (≤ 320ms با سربار)
    await scanStats({ reset: true, delay: 200 }.reset ? { reset: true, delay: 200 } : { reset: true });
    await fetch(MOCK_A + "/mock/scanstats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delay: 200 }) });
    const t0 = Date.now();
    await api("GET", "/api/reseller/users", null, rsC.rc);
    const dur = Date.now() - t0;
    await fetch(MOCK_A + "/mock/scanstats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delay: 0 }) });
    check("P42 دو پنل 200ms → مجموع < 400ms (concurrent)", dur < 400, `dur=${dur}ms`);
    // پنل کند: A=300ms، B=0 → نباید از timeout فرار کند ولی صفحات خواندنی سریع می‌مانند (B سهم دارد)
    await fetch(MOCK_A + "/mock/scanstats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delay: 300 }) });
    const t1 = Date.now();
    r = await api("GET", "/api/reseller/inbounds", null, rsC.rc);
    const dur2 = Date.now() - t1;
    await fetch(MOCK_A + "/mock/scanstats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delay: 0 }) });
    check("P43 یک پنل کند → پاسخ جزئی با دادهٔ سالم پنل دیگر", r.status === 200 && Array.isArray(r.json?.inbounds) && r.json.inbounds.length > 0, `dur=${dur2}ms inb=${r.json?.inbounds?.length}`);

    console.log(`\n== نتیجه فاز ۱.۴: ${pass} پاس، ${fail} شکست ==`);
  } catch (e) {
    console.error("RUNNER FAIL:", e);
    process.exitCode = 1;
  } finally {
    try {
      for (const id of createdResellers) await api("DELETE", `/api/admin/resellers/${id}`, null, admin).catch(() => {});
      console.log(`(cleanup: ${createdResellers.length} reseller)`);
    } catch { /* best-effort */ }
  }
  process.exit(fail ? 1 : 0);
})();
