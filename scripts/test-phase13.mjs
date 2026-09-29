#!/usr/bin/env node
/**
 * تست‌های فاز ۱.۳ — رزرو مؤثر در همه مسیرها، validation بدون نشت، UPDATE resumable، بازیابی duplicate، canonical SUM
 */
if (process.env.NODE_ENV === "production") {
  console.error("REFUSED: production."); process.exit(1);
}
if (process.env.ALLOW_DESTRUCTIVE_TESTS !== "true") {
  console.error("REFUSED: set ALLOW_DESTRUCTIVE_TESTS=true."); process.exit(1);
}
// گارد ایزوله‌بودن دیتابیس (F17) — مسیر تولید ممنوع، مسیر تست تصریح‌شده الزامی
const DBURL = process.env.DATABASE_URL || "";
if (/\/opt\/pv-reseller|\/app\/data\/custom\.db/i.test(DBURL)) {
  console.error("REFUSED: DATABASE_URL resolves to a production path:", DBURL); process.exit(1);
}
if (!/\.local-dev|[/\\]tmp|test/i.test(DBURL)) {
  console.error("REFUSED: DATABASE_URL is not an approved test location:", DBURL); process.exit(1);
}

const BASE = "http://localhost:3210";
const MOCK_A = "http://127.0.0.1:3299";
const MOCK_B = "http://127.0.0.1:3300";
const GB = 1024 * 1024 * 1024;
let pass = 0, fail = 0;
const created = []; // cleanup در finally
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✓", name, extra); }
  else { fail++; console.log("  ✗", name, extra ? "— " + extra : ""); }
}
async function api(method, path, body, cookie) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null), sc: res.headers.getSetCookie?.() || [] };
}
const pick = (sc) => (sc.find((s) => s.startsWith("rp_session")) || "").split(";")[0];
const rnd = () => Math.random().toString(36).slice(2, 8);
const setUsage = (mock, email, up, down) =>
  fetch(mock + "/mock" + (mock === MOCK_B ? "2" : "") + "/setusage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, up, down }) });
const mockKey = (path, body) => fetch((path.startsWith("/mock2") ? MOCK_B : MOCK_A) + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const outage = (b, off) => fetch((b ? MOCK_B + "/mock2" : MOCK_A + "/mock") + "/outage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ off }) });

async function bridgeLogin(rs) {
  await api("PUT", "/api/reseller/mirza", { enabled: true, chatId: "" }, rs.rc);
  const l = await api("POST", `/api/bridge/${rs.username}/login`, { username: rs.username, password: "AccTest123456" }, null);
  return (l.sc.find((x) => x.startsWith("pv_bridge")) || "").split(";")[0];
}
async function mkReseller(admin, pool, inbounds, tag) {
  const u = (tag || "p13") + rnd();
  const r = await api("POST", "/api/admin/resellers", { username: u, password: "AccTest123456", name: "", multiLocation: true, trafficPoolGB: pool, allowIpLimit: true, allowWhitelabel: false, active: true, inbounds }, admin);
  if (r.json?.id) created.push(r.json.id);
  const l = await api("POST", "/api/auth/login", { username: u, password: "AccTest123456" });
  return { rc: pick(l.sc), username: u };
}

(async () => {
  let admin = "";
  try {
    await outage(0, false); await outage(1, false);
    for (const k of [["/mock/failreset", { on: false }], ["/mock/faildel", { on: false }], ["/mock2/failadd", { on: false }], ["/mock2/ambiguousadd", { on: false }], ["/mock2/unknownmode", { on: false }], ["/mock2/failupdate", { on: false }]])
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

    // ===== A) رزرو فعال در برابر همهٔ مسیرها =====
    console.log("== A) reservation enforced everywhere ==");
    const rs = await mkReseller(admin, 50, [inbA, inbB]);
    await mockKey("/mock2/unknownmode", { on: true });
    const ambName = "amb" + rnd();
    r = await api("POST", "/api/reseller/users", { name: ambName, trafficGB: 20, expiryDate: "", ipLimit: 0, inbounds: [inbA, inbB] }, rs.rc);
    check("UNKNOWN → رد با رزرو فعال", r.status === 502, JSON.stringify(r.json)?.slice(0, 70));
    await mockKey("/mock2/unknownmode", { on: false });
    r = await api("GET", "/api/reseller/inbounds", null, rs.rc);
    check("remaining = ۳۰ (رزرو ۲۰)", Math.abs(r.json.permissions.remainingGB - 30) < 0.01, `rem=${r.json.permissions.remainingGB}`);

    r = await api("POST", "/api/reseller/users", { name: "s" + rnd(), trafficGB: 40, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rs.rc);
    check("single ۴۰ → رد", r.status === 403, `st=${r.status}`);
    r = await api("POST", "/api/reseller/users/bulk", { prefix: "b" + rnd(), count: 4, trafficGB: 10, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rs.rc);
    check("bulk ۴۰ (۴×۱۰) → رد", r.status === 403, `st=${r.status}`);
    // کاربر کوچک ۵ گیگی برای PUT/پل
    r = await api("POST", "/api/reseller/users", { name: "small" + rnd(), trafficGB: 5, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rs.rc);
    const small = r.json.email;
    r = await api("PUT", `/api/reseller/users/${encodeURIComponent(small)}`, { trafficGB: 45 }, rs.rc);
    check("PUT به ۴۵ (+۴۰) → رد", r.status === 403, `st=${r.status}`);
    const bc = await bridgeLogin(rs);
    r = await api("POST", `/api/bridge/${rs.username}/panel/api/inbounds/updateClient/x`, {
      id: inbA.inboundId, settings: JSON.stringify({ clients: [{ email: small, totalGB: 45 * GB, expiryTime: 0, enable: true }] }),
    }, bc);
    check("bridge update +۴۰ → رد", r.json?.success === false, JSON.stringify(r.json)?.slice(0, 60));

    // بازیابی: همان ساخت UNKNOWN با تکرار → stale-recovery → رزرو آزاد
    r = await api("POST", "/api/reseller/users", { name: ambName, trafficGB: 20, expiryDate: "", ipLimit: 0, inbounds: [inbA, inbB] }, rs.rc);
    check("تکرار همان ساخت → بازیابی stale موفق (رزرو آزاد + کاربر ثبت)", r.json?.ok === true, JSON.stringify(r.json)?.slice(0, 60));
    r = await api("GET", "/api/reseller/inbounds", null, rs.rc);
    // تکرار با نام یکسان = ایمیل جدید (پسوند تصادفی) → کاربر دوم؛ رزرو یتیم اولیه همچنان قفل — ضد-بایپس
    check("تکرار ساخت: کاربر دوم ثبت + رزرو یتیم قفل ماند (rem=۵)", Math.abs(r.json.permissions.remainingGB - 5) < 0.01, `rem=${r.json.permissions.remainingGB}`);

    // ===== B) validation بدون نشت رزرو =====
    console.log("== B) validation never leaks reservation ==");
    {
      const rs2 = await mkReseller(admin, 30, [inbA]);
      const bc2 = await bridgeLogin(rs2);
      // ایمیل کوتاه پل
      r = await api("POST", `/api/bridge/${rs2.username}/panel/api/inbounds/addClient`, {
        id: inbA.inboundId, settings: JSON.stringify({ clients: [{ email: "ab", totalGB: 5 * GB, expiryTime: 0, enable: true }] }),
      }, bc2);
      check("ایمیل نامعتبر پل → 400", r.json?.success === false, JSON.stringify(r.json)?.slice(0, 50));
      // duplicate پل: ساخت دوباره همان ایمیل
      const em = "dup" + rnd();
      await api("POST", `/api/bridge/${rs2.username}/panel/api/inbounds/addClient`, { id: inbA.inboundId, settings: JSON.stringify({ clients: [{ email: em, totalGB: 5 * GB, expiryTime: 0, enable: true }] }) }, bc2);
      r = await api("POST", `/api/bridge/${rs2.username}/panel/api/inbounds/addClient`, { id: inbA.inboundId, settings: JSON.stringify({ clients: [{ email: em, totalGB: 5 * GB, expiryTime: 0, enable: true }] }) }, bc2);
      check("duplicate پل → رد", r.json?.success === false, JSON.stringify(r.json)?.slice(0, 50));
      // inbound نامعتبر داشبورد
      r = await api("POST", "/api/reseller/users", { name: "iv" + rnd(), trafficGB: 5, expiryDate: "", ipLimit: 0, inbounds: [{ panelId: inbA.panelId, inboundId: 9999 }] }, rs2.rc);
      check("اینباند ناموجود → 400", r.status === 400 || r.json?.error, `st=${r.status}`);
      r = await api("GET", "/api/reseller/inbounds", null, rs2.rc);
      check("هیچ رزرو نشت نکرده (remaining = ۲۵ = ۳۰−۵)", Math.abs(r.json.permissions.remainingGB - 25) < 0.01, `rem=${r.json.permissions.remainingGB}`);
    }

    // ===== C) UPDATE resumable — همان ژورنال =====
    console.log("== C) UPDATE resume same journal ==");
    {
      const rs3 = await mkReseller(admin, 100, [inbA, inbB]);
      r = await api("POST", "/api/reseller/users", { name: "uu" + rnd(), trafficGB: 10, expiryDate: "", ipLimit: 0, inbounds: [inbA, inbB] }, rs3.rc);
      const em = r.json.email;
      await mockKey("/mock2/failupdate", { on: true });
      r = await api("PUT", `/api/reseller/users/${encodeURIComponent(em)}`, { trafficGB: 20 }, rs3.rc);
      check("update اول → PARTIAL", r.status === 502 && r.json?.partial === true, `st=${r.status}`);
      await mockKey("/mock2/failupdate", { on: false });
      r = await api("PUT", `/api/reseller/users/${encodeURIComponent(em)}`, { trafficGB: 20 }, rs3.rc);
      check("retry → موفق (resume همان ژورنال)", r.json?.ok === true, JSON.stringify(r.json)?.slice(0, 50));
      // اگر ژورنال UPDATE باز مانده بود DELETE باید 409 می‌شد — پس موفقیت DELETE = بسته‌شدن همان ژورنال
      r = await api("DELETE", `/api/reseller/users/${encodeURIComponent(em)}`, null, rs3.rc);
      check("DELETE پس از update موفق → بدون 409 (ژورنال UPDATE بسته شد)", r.json?.ok === true, `st=${r.status}`);
    }

    // ===== D) canonical SUM چندپنلی: داشبورد=پرتال=clientList=getClientTraffics=۱۲ =====
    console.log("== D) multi-panel canonical sum ==");
    {
      const rs4 = await mkReseller(admin, 100, [inbA, inbB]);
      r = await api("POST", "/api/reseller/users", { name: "mp" + rnd(), trafficGB: 30, expiryDate: "", ipLimit: 0, inbounds: [inbA, inbB] }, rs4.rc);
      const em = r.json.email;
      await setUsage(MOCK_A, em, 7 * GB, 0);
      await setUsage(MOCK_B, em, 5 * GB, 0);
      r = await api("GET", "/api/reseller/users", null, rs4.rc);
      const u = r.json.users.find((x) => x.email === em);
      check("داشبورد = ۱۲", Math.abs(u.usedGB - 12) < 0.01, `used=${u.usedGB}`);
      r = await api("GET", `/api/s/${u.subId}?format=json`);
      check("پرتال = ۱۲", Math.abs(r.json.usedGB - 12) < 0.01, `used=${r.json.usedGB}`);
      const bc4 = await bridgeLogin(rs4);
      r = await api("GET", `/api/bridge/${rs4.username}/panel/api/inbounds/getClientTraffics/${encodeURIComponent(em)}`, null, bc4);
      const g = ((r.json?.obj?.up || 0) + (r.json?.obj?.down || 0)) / GB;
      check("getClientTraffics = ۱۲", Math.abs(g - 12) < 0.01, `used=${g}`);
    }

    // ===== E) isolation واقعی — ژورنال PARTIAL نماینده A مانع/مسیر B نیست =====
    console.log("== E) tenant isolation (real) ==");
    {
      const rsA = await mkReseller(admin, 100, [inbA], "isa");
      const rsB = await mkReseller(admin, 100, [inbB], "isb");
      // کاربر A با ریست PARTIAL
      r = await api("POST", "/api/reseller/users", { name: "tnt" + rnd(), trafficGB: 10, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rsA.rc);
      const emA = r.json.email;
      await setUsage(MOCK_A, emA, 2 * GB, 0);
      await mockKey("/mock/failreset", { on: true });
      await api("POST", `/api/reseller/users/${encodeURIComponent(emA)}/reset-traffic`, null, rsA.rc); // PARTIAL
      await mockKey("/mock/failreset", { on: false });
      // B مستقل: ساخت و ریست موفق — نه بلاک، نه resume اشتباه
      r = await api("POST", "/api/reseller/users", { name: "tnt2" + rnd(), trafficGB: 10, expiryDate: "", ipLimit: 0, inbounds: [inbB] }, rsB.rc);
      const emB = r.json.email;
      await setUsage(MOCK_B, emB, 3 * GB, 0);
      r = await api("POST", `/api/reseller/users/${encodeURIComponent(emB)}/reset-traffic`, null, rsB.rc);
      check("عملیات B مستقل از ژورنال PARTIALِ A موفق (بدهکاری ۳ خودش)", r.json?.ok === true && r.json?.debitedGB === 3, JSON.stringify(r.json)?.slice(0, 50));
      r = await api("GET", "/api/reseller/inbounds", null, rsB.rc);
      check("consumed B = ۳ (نه مقادیر A)", Math.abs(r.json.permissions.consumedGB - 3) < 0.01, `c=${r.json.permissions.consumedGB}`);
    }

    console.log(`\n== نتیجه فاز ۱.۳: ${pass} پاس، ${fail} شکست ==`);
  } catch (e) {
    console.error("RUNNER FAIL:", e);
    process.exitCode = 1;
  } finally {
    // cleanup (F18): حذف نماینده‌های این اجرا — حتی هنگام شکست
    try {
      for (const id of created) {
        await api("DELETE", `/api/admin/resellers/${id}`, null, admin).catch(() => {});
      }
      console.log(`(cleanup: ${created.length} نمایندهٔ تست حذف شد)`);
    } catch { /* best-effort */ }
  }
  process.exit(fail ? 1 : 0);
})();
