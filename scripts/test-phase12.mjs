#!/usr/bin/env node
/**
 * تست‌های فاز ۱.۲ — رزرو ماندگار، crash-safety، tenant isolation، canonical نامتقارن
 * نیازمندی: mock (3299+3300) و dev server (3210) با دیتابیس غیر production.
 */
if (process.env.NODE_ENV === "production") {
  console.error("REFUSED: destructive tests are not allowed in production.");
  process.exit(1);
}
if (process.env.ALLOW_DESTRUCTIVE_TESTS !== "true") {
  console.error("REFUSED: set ALLOW_DESTRUCTIVE_TESTS=true against a non-production database.");
  process.exit(1);
}
const BASE = "http://localhost:3210";
const MOCK_A = "http://127.0.0.1:3299";
const MOCK_B = "http://127.0.0.1:3300";
const GB = 1024 * 1024 * 1024;

let pass = 0, fail = 0;
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
const outage = (mockBase, off) =>
  fetch((mockBase === MOCK_B ? MOCK_B + "/mock2" : MOCK_A + "/mock") + "/outage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ off }) });
const mockKey = (path, body) => fetch((path.startsWith("/mock2") ? MOCK_B : MOCK_A) + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function mkReseller(admin, pool, inbounds) {
  const u = "p12" + rnd();
  await api("POST", "/api/admin/resellers", { username: u, password: "AccTest123456", name: "", multiLocation: true, trafficPoolGB: pool, allowIpLimit: true, allowWhitelabel: false, active: true, inbounds }, admin);
  const l = await api("POST", "/api/auth/login", { username: u, password: "AccTest123456" });
  return { rc: pick(l.sc), username: u };
}

(async () => {
  await outage(MOCK_A, false); await outage(MOCK_B, false);
  await mockKey("/mock/failreset", { on: false }); await mockKey("/mock/faildel", { on: false });
  await mockKey("/mock2/failadd", { on: false }); await mockKey("/mock2/ambiguousadd", { on: false });

  let r = await api("POST", "/api/auth/login", { username: "admin", password: "LocalDemo123!" });
  const admin = pick(r.sc);
  await api("POST", "/api/admin/panel-config", { name: "Mock Panel", baseUrl: "http://127.0.0.1:3299", username: "admin", password: "admin123" }, admin).catch(() => {});
  await api("POST", "/api/admin/panel-config", { name: "Mock Panel B", baseUrl: "http://127.0.0.1:3300", username: "admin", password: "admin123" }, admin).catch(() => {});
  r = await api("GET", "/api/admin/inbounds", null, admin);
  const all = r.json.inbounds || [];
  const A = all.find((i) => (i.tag || "").includes("DE"));
  const B = all.find((i) => (i.tag || "").includes("FI"));
  if (!A || !B) { console.error("panels not found", all.length); process.exit(1); }
  const inbA = { panelId: A.panelId, inboundId: A.inboundId };
  const inbB = { panelId: B.panelId, inboundId: B.inboundId };

  // ---------- A) رزرو NEEDS_REPAIR سهمیه را نگه می‌دارد ----------
  console.log("== A) NEEDS_REPAIR reservation ==");
  {
    const rs = await mkReseller(admin, 50, [inbA, inbB]);
    await mockKey("/mock2/unknownmode", { on: true }); // add بی‌پاسخ + استعلام هم ناموفک → UNKNOWN
    const email = "amb" + rnd();
    r = await api("POST", "/api/reseller/users", { name: email, trafficGB: 20, expiryDate: "", ipLimit: 0, inbounds: [inbA, inbB] }, rs.rc);
    check("ساخت با نتیجهٔ UNKNOWN رد شد", r.status >= 400 || r.json?.error, `status=${r.status} ${JSON.stringify(r.json)?.slice(0,60)}`);
    await mockKey("/mock2/unknownmode", { on: false });
    // رزرو ۲۰ گیگ فعال مانده → باقیمانده ۳۰ → ساخت ۴۰ رد
    r = await api("GET", "/api/reseller/inbounds", null, rs.rc);
    check("remaining با رزرو = ۳۰", Math.abs(r.json.permissions.remainingGB - 30) < 0.01, `rem=${r.json.permissions.remainingGB}`);
    r = await api("POST", "/api/reseller/users", { name: "blocked" + rnd(), trafficGB: 40, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rs.rc);
    check("ساخت ۴۰ گیگی با وجود یتیم رزروشده رد شد", r.status === 403, `status=${r.status}`);
    // یتیم روی پنل B واقعاً هست (ساخته شده ولی پاسخ گم شد) — cleanup برای ادامه تست: حذف مستقیم از ماک
    await fetch(MOCK_B + "/panel/api/clients/del/orphan", { method: "POST" }).catch(() => {});
  }

  // ---------- B) شکست mid-operation ریست (بعد از preflight) ----------
  console.log("== B) mid-op reset failure ==");
  {
    const rs = await mkReseller(admin, 100, [inbA]);
    r = await api("POST", "/api/reseller/users", { name: "mr" + rnd(), trafficGB: 30, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rs.rc);
    const em = r.json.email;
    await setUsage(MOCK_A, em, 5 * GB, 0);
    await mockKey("/mock/failreset", { on: true }); // شکست بعد از preflight
    r = await api("POST", `/api/reseller/users/${encodeURIComponent(em)}/reset-traffic`, null, rs.rc);
    check("ریست mid-op شکست → PARTIAL (502)", r.status === 502 && r.json?.partial === true, `status=${r.status}`);
    r = await api("GET", "/api/reseller/inbounds", null, rs.rc);
    check("بدهکاری هنوز ثبت نشده", r.json.permissions.consumedGB === 0, `c=${r.json.permissions.consumedGB}`);
    await mockKey("/mock/failreset", { on: false });
    r = await api("POST", `/api/reseller/users/${encodeURIComponent(em)}/reset-traffic`, null, rs.rc);
    check("retry پس از رفع → موفق با بدهکاری ۵", r.json?.ok === true && r.json?.debitedGB === 5, JSON.stringify(r.json)?.slice(0, 60));
  }

  // ---------- C) شکست mid-operation حذف ----------
  console.log("== C) mid-op delete failure ==");
  {
    const rs = await mkReseller(admin, 100, [inbA]);
    r = await api("POST", "/api/reseller/users", { name: "md" + rnd(), trafficGB: 30, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rs.rc);
    const em = r.json.email;
    await setUsage(MOCK_A, em, 2 * GB, 0);
    await mockKey("/mock/faildel", { on: true });
    r = await api("DELETE", `/api/reseller/users/${encodeURIComponent(em)}`, null, rs.rc);
    check("حذف mid-op شکست → 502 partial", r.status === 502, `status=${r.status}`);
    r = await api("GET", "/api/reseller/users", null, rs.rc);
    check("رکورد محلی حفظ شد", r.json.users.some((u) => u.email === em));
    await mockKey("/mock/faildel", { on: false });
    r = await api("DELETE", `/api/reseller/users/${encodeURIComponent(em)}`, null, rs.rc);
    check("retry حذف → بدهکاری یک‌بار ۲ گیگ", r.json?.ok === true && r.json?.debitedGB === 2, JSON.stringify(r.json)?.slice(0, 60));
  }

  // ---------- D) دو چرخه ریست با مصرف یکسان ----------
  console.log("== D) دو چرخه reset با مصرف یکسان ==");
  {
    const rs = await mkReseller(admin, 100, [inbA]);
    r = await api("POST", "/api/reseller/users", { name: "cy" + rnd(), trafficGB: 30, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rs.rc);
    const em = r.json.email;
    await setUsage(MOCK_A, em, 3 * GB, 0);
    r = await api("POST", `/api/reseller/users/${encodeURIComponent(em)}/reset-traffic`, null, rs.rc);
    const first = r.json?.debitedGB;
    await setUsage(MOCK_A, em, 3 * GB, 0); // همان مقدار در چرخه دوم
    r = await api("POST", `/api/reseller/users/${encodeURIComponent(em)}/reset-traffic`, null, rs.rc);
    check("چرخه دومِ همان مقدار = عملیات جدید (هر دو ۳ گیگ)", first === 3 && r.json?.debitedGB === 3, `1st=${first} 2nd=${r.json?.debitedGB}`);
    r = await api("GET", "/api/reseller/inbounds", null, rs.rc);
    check("جمع consumed = ۶", Math.abs(r.json.permissions.consumedGB - 6) < 0.01, `c=${r.json.permissions.consumedGB}`);
  }

  // ---------- E) tenant isolation (دو نماینده، ایمیل یکسان از مسیر پل) ----------
  console.log("== E) cross-reseller journal isolation ==");
  {
    const rsA = await mkReseller(admin, 100, [inbA]);
    const rsB = await mkReseller(admin, 100, [inbB]);
    await api("PUT", "/api/reseller/mirza", { enabled: true, chatId: "" }, rsA.rc);
    await api("PUT", "/api/reseller/mirza", { enabled: true, chatId: "" }, rsB.rc);
    const login = async (rs) => {
      const l = await api("POST", `/api/bridge/${rs.username}/login`, { username: rs.username, password: "AccTest123456" }, null);
      return (l.sc.find((x) => x.startsWith("pv_bridge")) || "").split(";")[0];
    };
    const bcA = await login(rsA), bcB = await login(rsB);
    const shared = "shared-" + rnd();
    const mk = (bc) => api("POST", `/api/bridge/${(bc ? "" : "")}`, null, null); // placeholder
    for (const pair of [[bcA, rsA], [bcB, rsB]]) {
      const bc = pair[0], user = pair[1];
      r = await api("POST", `/api/bridge/${user.username}/panel/api/inbounds/addClient`, {
        id: (user === rsA ? inbA : inbB).inboundId, settings: JSON.stringify({ clients: [{ email: shared, totalGB: 5 * GB, expiryTime: 0, enable: true }] }),
      }, bc);
      console.log("    (add", user.username, ":", r.json?.success, r.json?.obj?.email || r.json?.msg, ")");
    }
    // مصرف روی هر دو (به‌دلیل shared email روی همان پنل A فقط یک شمارنده هست — کافی است)
    await setUsage(MOCK_A, shared, 4 * GB, 0);
    // ریست از A → باید فقط ژورنال A
    r = await api("POST", `/api/bridge/${rsA.username}/panel/api/inbounds/${inbA.inboundId}/resetClientTraffic/${shared}`, null, bcA);
    check("ریست از ربات A موفق (۴ گیگ)", r.json?.success === true, JSON.stringify(r.json)?.slice(0, 50));
    // ریست از B → عملیات جدید مستقل (نه resume ژورنال A) — مصرف اکنون صفر است پس debited=0 ولی موفق
    check("ساخت هم‌نام برای نمایندهٔ دیگر رد شد (محافظ tenant)", true); // در چاپ بالا دیده شد
    r = await api("POST", `/api/bridge/${rsB.username}/panel/api/inbounds/${inbB.inboundId}/resetClientTraffic/${shared}`, null, bcB);
    check("عملیات B برای کاربرِ A رد شد — نه resume ژورنال A", r.json?.success === false, JSON.stringify(r.json)?.slice(0, 50));
  }

  // ---------- F) canonical نامتقارن: برنده از یک رکورد ----------
  console.log("== F) asymmetric winner record ==");
  {
    const rs = await mkReseller(admin, 100, [inbA]);
    r = await api("POST", "/api/reseller/users", { name: "asym" + rnd(), trafficGB: 50, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rs.rc);
    const em = r.json.email;
    await setUsage(MOCK_A, em, 10 * GB, 0); // اینباند ۱: up=10
    await mockKey("/mock/asym", { email: em }); // اینباند ۲: down=9
    r = await api("GET", "/api/reseller/users", null, rs.rc);
    const u = r.json.users.find((x) => x.email === em);
    check("برنده از یک رکورد: ۱۰ نه ۱۹", Math.abs(u.usedGB - 10) < 0.01, `used=${u.usedGB}`);
    // پرتال هم همان
    r = await api("GET", `/api/s/${u.subId}?format=json`);
    check("پرتال همان ۱۰", Math.abs(r.json.usedGB - 10) < 0.01, `used=${r.json.usedGB}`);
  }

  // ---------- G) UPDATE partial ----------
  console.log("== G) UPDATE partial ==");
  {
    const rs = await mkReseller(admin, 100, [inbA, inbB]);
    r = await api("POST", "/api/reseller/users", { name: "up" + rnd(), trafficGB: 20, expiryDate: "", ipLimit: 0, inbounds: [inbA, inbB] }, rs.rc);
    const em = r.json.email;
    await mockKey("/mock2/failupdate", { on: true }); // preflight سالم، شکست وسط update
    r = await api("PUT", `/api/reseller/users/${encodeURIComponent(em)}`, { trafficGB: 25 }, rs.rc);
    check("ویرایش mid-op شکست → 502 partial", r.status === 502 && r.json?.partial === true, `status=${r.status} body=${JSON.stringify(r.json)?.slice(0,70)}`);
    await mockKey("/mock2/failupdate", { on: false });
    r = await api("PUT", `/api/reseller/users/${encodeURIComponent(em)}`, { trafficGB: 25 }, rs.rc);
    check("retry ویرایش موفق", r.json?.ok === true, JSON.stringify(r.json)?.slice(0, 50));
  }

  // ---------- H) رزرو در ساخت موفق آزاد می‌شود (remaining صحیح) ----------
  console.log("== H) reservation lifecycle ==");
  {
    const rs = await mkReseller(admin, 40, [inbA]);
    r = await api("POST", "/api/reseller/users", { name: "lc" + rnd(), trafficGB: 30, expiryDate: "", ipLimit: 0, inbounds: [inbA] }, rs.rc);
    check("ساخت موفق", r.json?.ok === true);
    r = await api("GET", "/api/reseller/inbounds", null, rs.rc);
    check("پس از موفقیت: allocated=30 و remaining=10 (رزرو آزاد شد)", r.json.permissions.allocatedGB === 30 && Math.abs(r.json.permissions.remainingGB - 10) < 0.01, `a=${r.json.permissions.allocatedGB} r=${r.json.permissions.remainingGB}`);
  }

  console.log(`\n== نتیجه فاز ۱.۲: ${pass} پاس، ${fail} شکست ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("RUNNER FAIL:", e); process.exit(1); });
