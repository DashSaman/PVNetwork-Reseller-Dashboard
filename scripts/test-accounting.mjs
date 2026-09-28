#!/usr/bin/env node
/**
 * تست‌های حسابداری و invariantهای فاز ۱ — نیازمند:
 *   ۱) mock 3x-ui:   node .local-dev/mock-3xui.mjs   (پورت 3299)
 *   ۲) سرور dev:     npx next dev -p 3210            (پورت 3210)
 * اجرا: node scripts/test-accounting.mjs
 *
 * پوشش:
 *  - race دو ساخت همزمان با سهمیهٔ محدود (فقط یکی باید پاس شود)
 *  - بدهکارسازی حذف/ریست + جلوگیری از شمارش دوبارهٔ کاربر در چند اینباند (تجمیع کانونی)
 *  - fail-closed: با قطع پنل، حذف/ریست انجام نمی‌شود و داده دست‌نخورده می‌ماند
 *  - جلوگیری از دور زدن پول از مسیر پل ربات
 */
const BASE = "http://localhost:3210";
const MOCK = "http://127.0.0.1:3299";
const GB = 1024 * 1024 * 1024;

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✓", name, extra); }
  else { fail++; console.log("  ✗", name, extra ? "— " + extra : ""); }
}

async function api(method, path, body, cookie, ct) {
  const headers = { "Content-Type": ct || "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
  const sc = res.headers.getSetCookie?.() || [];
  return { status: res.status, json: await res.json().catch(() => null), sc };
}
const pickSession = (sc) => (sc.find((s) => s.startsWith("rp_session")) || "").split(";")[0];
const rnd = () => Math.random().toString(36).slice(2, 8);
async function setUsage(email, up, down) {
  await fetch(MOCK + "/mock/setusage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, up, down }) });
}

(async () => {
  console.log("== راه‌اندازی ==");
  await fetch(MOCK + "/mock/outage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ off: false }) }); // اطمینان از شروع تمیز
  let r = await api("POST", "/api/auth/login", { username: "admin", password: "LocalDemo123!" });
  const admin = pickSession(r.sc);
  check("ورود ادمین", !!admin);
  r = await api("POST", "/api/admin/panel-config", { name: "Mock Panel", baseUrl: "http://127.0.0.1:3299", username: "admin", password: "admin123" }, admin);
  r = await api("POST", "/api/admin/resellers", { username: "acct" + rnd(), password: "AccTest123456", name: "", multiLocation: true, trafficPoolGB: 100, allowIpLimit: true, allowWhitelabel: false, active: true, inbounds: [{ panelId: "", inboundId: 1 }, { panelId: "", inboundId: 2 }] }, admin);
  const resellerUser = "acct" + rnd(); // در صورت تکرار اجرا، نماینده تازه می‌سازیم
  let rc = "";
  {
    r = await api("POST", "/api/auth/login", { username: resellerUser, password: "AccTest123456" });
    if (!pickSession(r.sc)) {
      r = await api("POST", "/api/admin/resellers", { username: resellerUser, password: "AccTest123456", name: "", multiLocation: true, trafficPoolGB: 100, allowIpLimit: true, allowWhitelabel: false, active: true, inbounds: [{ panelId: "", inboundId: 1 }, { panelId: "", inboundId: 2 }] }, admin);
      r = await api("POST", "/api/auth/login", { username: resellerUser, password: "AccTest123456" });
    }
    rc = pickSession(r.sc);
  }
  check("ورود نماینده تست", !!rc);
  r = await api("GET", "/api/reseller/inbounds", null, rc);
  const inb = r.json.inbounds[0];

  // ---------- ۱) race دو ساخت همزمان ----------
  console.log("== ۱) race دو ساخت همزمان با سهمیهٔ محدود ==");
  {
    const u = "race" + rnd();
    r = await api("POST", "/api/admin/resellers", { username: u, password: "AccTest123456", name: "", multiLocation: true, trafficPoolGB: 10, allowIpLimit: true, allowWhitelabel: false, active: true, inbounds: [{ panelId: "", inboundId: 1 }] }, admin);
    r = await api("POST", "/api/auth/login", { username: u, password: "AccTest123456" });
    const rc2 = pickSession(r.sc);
    r = await api("GET", "/api/reseller/inbounds", null, rc2);
    const raceInb = r.json.inbounds[0];
    const req = () => api("POST", "/api/reseller/users", { name: "racer" + rnd(), trafficGB: 10, expiryDate: "", ipLimit: 0, inbounds: [{ panelId: raceInb.panelId, inboundId: raceInb.inboundId }] }, rc2);
    const [a, b] = await Promise.all([req(), req()]);
    const oks = [a, b].filter((x) => x.json?.ok === true).length;
    console.log("    A:", a.status, JSON.stringify(a.json)?.slice(0,110));
    console.log("    B:", b.status, JSON.stringify(b.json)?.slice(0,110));
    check("فقط یکی از دو درخواست ۱۰ گیگی پاس شد", oks === 1, `oks=${oks}`);
    r = await api("GET", "/api/reseller/inbounds", null, rc2);
    check("allocated = 10 (بدون over-spend)", r.json.permissions.allocatedGB === 10, `allocated=${r.json.permissions.allocatedGB}`);
  }

  // ---------- ۲) تجمیع کانونی: کاربر در دو اینباند یک پنل دوبار شمرده نشود ----------
  console.log("== ۲) تجمیع کانونی چند اینباند ==");
  const email = "canon" + rnd();
  r = await api("POST", "/api/reseller/users", { name: email, trafficGB: 50, expiryDate: "", ipLimit: 0, inbounds: [{ panelId: inb.panelId, inboundId: inb.inboundId }] }, rc);
  check("ساخت کاربر کانونی", r.json?.ok === true, JSON.stringify(r.json)?.slice(0, 80));
  const realEmail = r.json.email; // داشبورد پسوند تصادفی اضافه می‌کند
  await setUsage(realEmail, 5 * GB, 2 * GB); // ۷ گیگ
  await fetch(MOCK + "/mock/dup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: realEmail }) });
  // حذف از داشبورد: بدهکاری باید دقیقاً ۷ باشد نه ۱۴
  r = await api("DELETE", `/api/reseller/users/${encodeURIComponent(realEmail)}`, null, rc);
  check("حذف با بدهکاری کانونی = ۷ گیگ (نه ۱۴)", r.json?.debitedGB === 7, `status=${r.status} body=${JSON.stringify(r.json)}`);

  // ---------- ۳) fail-closed: قطع پنل ----------
  console.log("== ۳) fail-closed با قطع پنل ==");
  const email2 = "fc" + rnd();
  const c3 = await api("POST", "/api/reseller/users", { name: email2, trafficGB: 20, expiryDate: "", ipLimit: 0, inbounds: [{ panelId: inb.panelId, inboundId: inb.inboundId }] }, rc);
  console.log("    (email2 create:", c3.status, JSON.stringify(c3.json)?.slice(0, 100) + ")");
  await setUsage(c3.json.email, 3 * GB, 0);
  await fetch(MOCK + "/mock/outage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ off: true }) });
  r = await api("DELETE", `/api/reseller/users/${encodeURIComponent(c3.json.email)}`, null, rc);
  check("حذف هنگام قطعی پنل رد شد", r.status === 502, `status=${r.status}`);
  r = await api("POST", `/api/reseller/users/${encodeURIComponent(c3.json.email)}/reset-traffic`, null, rc);
  check("ریست هنگام قطعی پنل رد شد", r.status === 502, `status=${r.status}`);
  await fetch(MOCK + "/mock/outage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ off: false }) });
  r = await api("GET", "/api/reseller/users", null, rc);
  check("کاربر همچنان tracked است (حذف نشده)", r.json.users.some((u) => u.email === c3.json.email));
  r = await api("DELETE", `/api/reseller/users/${encodeURIComponent(c3.json.email)}`, null, rc);
  check("پس از برگشت پنل، حذف با بدهکاری ۳ گیگ موفق", r.json?.debitedGB === 3, `debited=${r.json?.debitedGB}`);

  // ---------- ۴) پل: دور زدن پول ممکن نیست + بدهکارسازی همان هسته ----------
  console.log("== ۴) پل ربات ==");
  r = await api("PUT", "/api/reseller/mirza", { enabled: true, chatId: "" }, rc);
  check("فعال‌سازی سوییچ ربات", r.json?.ok === true);
  r = await api("POST", "/api/bridge/" + resellerUser + "/login", `username=${resellerUser}&password=AccTest123456`, null, "application/x-www-form-urlencoded");
  const bridgeCookie = (r.sc.find((s) => s.startsWith("pv_bridge")) || "").split(";")[0];
  check("لاگین ربات", r.json?.success === true && !!bridgeCookie);
  // درخواست بیش از باقیمانده → رد
  r = await api("POST", `/api/bridge/${resellerUser}/panel/api/inbounds/addClient`, {
    id: inb.inboundId, settings: JSON.stringify({ clients: [{ email: "bridge-huge", totalGB: 999 * GB, expiryTime: 0, enable: true }] }),
  }, bridgeCookie);
  check("ساخت ۹۹۹ گیگ از مسیر ربات رد شد", r.json?.success === false);
  // ساخت و حذف از ربات: بدهکاری باید همان هسته باشد
  const bEmail = "bridge-" + rnd();
  r = await api("POST", `/api/bridge/${resellerUser}/panel/api/inbounds/addClient`, {
    id: inb.inboundId, settings: JSON.stringify({ clients: [{ email: bEmail, totalGB: 30 * GB, expiryTime: 0, enable: true }] }),
  }, bridgeCookie);
  check("ساخت از مسیر ربات", r.json?.success === true);
  await setUsage(bEmail, 4 * GB, 0);
  r = await api("POST", `/api/bridge/${resellerUser}/panel/api/inbounds/1/delClientByEmail/${bEmail}`, null, bridgeCookie);
  check("حذف از مسیر ربات موفق", r.json?.success === true);
  r = await api("GET", "/api/reseller/inbounds", null, rc);
  check("بدهکاری حذف ربات ثبت شد (۴ گیگ)", r.json.permissions.consumedGB >= 4, `consumed=${r.json.permissions.consumedGB}`);

  console.log(`\n== نتیجه: ${pass} پاس، ${fail} شکست ==`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { try { await fetch(MOCK + "/mock/outage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ off: false }) }); } catch {} console.error("TEST RUNNER FAIL:", e); process.exit(1); });
