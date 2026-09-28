#!/usr/bin/env node
/**
 * تست‌های فاز ۱.۱ — صحت عملیات تخریبی چندپنلی
 * نیازمندی: mock (3299 + 3300) و dev server (3210)
 * اجرا: node scripts/test-phase11.mjs
 * محافظ: در production اجرا نمی‌شود.
 */
if (process.env.NODE_ENV === "production") {
  console.error("REFUSED: destructive accounting tests are not allowed in production.");
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

async function mkReseller(admin, pool, inbounds) {
  const u = "p11" + rnd();
  const r = await api("POST", "/api/admin/resellers", { username: u, password: "AccTest123456", name: "", multiLocation: true, trafficPoolGB: pool, allowIpLimit: true, allowWhitelabel: false, active: true, inbounds }, admin);
  if (!r.json?.ok) { console.log("  (reseller exists — reusing)"); }
  const l = await api("POST", "/api/auth/login", { username: u, password: "AccTest123456" });
  return { rc: pick(l.sc), username: u };
}

(async () => {
  await outage(MOCK_A, false); await outage(MOCK_B, false);
  let r = await api("POST", "/api/auth/login", { username: "admin", password: "LocalDemo123!" });
  const admin = pick(r.sc);

  r = await api("POST", "/api/admin/panel-config", { name: "Mock Panel", baseUrl: "http://127.0.0.1:3299", username: "admin", password: "admin123" }, admin);
  console.log("  (panel A:", r.json?.ok === true ? "created)" : "already)");
  // اتصال پنل B (اگر نبود)
  r = await api("POST", "/api/admin/panel-config", { name: "Mock Panel B", baseUrl: "http://127.0.0.1:3300", username: "admin", password: "admin123" }, admin);
  console.log("  (panel B:", r.json?.ok === true ? "created)" : "already)");
  // شناسه‌های واقعی پنل A و B از لیست ادمین
  r = await api("GET", "/api/admin/inbounds", null, admin);
  const allInb = r.json.inbounds || [];
  const inbARef = { panelId: allInb.find((i) => (i.tag || "").includes("DE")).panelId, inboundId: allInb.find((i) => (i.tag || "").includes("DE")).inboundId };
  const inbBRef = { panelId: allInb.find((i) => (i.tag || "").includes("FI")).panelId, inboundId: allInb.find((i) => (i.tag || "").includes("FI")).inboundId };

  // نماینده دوپنلی
  const both = await mkReseller(admin, 100, [inbARef, inbBRef]);
  // اینباند واقعی پنل B از تنظیمات ادمین لازم است — رفرش اینباندها
  r = await api("GET", "/api/reseller/inbounds", null, both.rc);
  const inbA = r.json.inbounds.find((i) => i.tag?.includes("DE")) || r.json.inbounds[0];
  const inbB = r.json.inbounds.find((i) => i.tag?.includes("FI"));

  // ---------- A) قفل و race ----------
  console.log("== A) concurrency ==");
  {
    const rs = await mkReseller(admin, 100, [inbARef]);
    r = await api("GET", "/api/reseller/inbounds", null, rs.rc);
    const ia = r.json.inbounds[0];
    const bulkReq = () => api("POST", "/api/reseller/users/bulk", { prefix: "b" + rnd(), count: 10, trafficGB: 10, expiryDate: "", ipLimit: 0, inbounds: [{ panelId: ia.panelId, inboundId: ia.inboundId }] }, rs.rc);
    const [b1, b2] = await Promise.all([bulkReq(), bulkReq()]);
    const oks = [b1, b2].filter((x) => x.json?.createdCount === 10).length;
    check("bulk vs bulk: فقط یک دسته ۱۰۰ گیگی رزرو شد", oks === 1, `oks=${oks}`);
    const sReq = () => api("POST", "/api/reseller/users", { name: "s" + rnd(), trafficGB: 20, expiryDate: "", ipLimit: 0, inbounds: [{ panelId: ia.panelId, inboundId: ia.inboundId }] }, rs.rc);
    const s1 = await sReq();
    check("bulk vs single: ساخت ۲۰ گیگی پس از پُر شدن رد شد", s1.status === 403 || s1.json?.error, `status=${s1.status}`);
  }

  // ---------- B) partial reset دو پنلی ----------
  console.log("== B) partial reset ==");
  {
    const email = "pr" + rnd();
    r = await api("POST", "/api/reseller/users", { name: email, trafficGB: 50, expiryDate: "", ipLimit: 0, inbounds: [{ panelId: inbA.panelId, inboundId: inbA.inboundId }, ...(inbB ? [{ panelId: inbB.panelId, inboundId: inbB.inboundId }] : [])] }, both.rc);
    check("ساخت کاربر دوپنلی", r.json?.ok === true, JSON.stringify(r.json)?.slice(0, 90));
    const realEmail = r.json.email;
    await setUsage(MOCK_A, realEmail, 7 * GB, 0);
    await setUsage(MOCK_B, realEmail, 5 * GB, 0);
    // پنل B قطع → ریست باید fail-closed رد شود
    await outage(MOCK_B, true);
    r = await api("POST", `/api/reseller/users/${encodeURIComponent(realEmail)}/reset-traffic`, null, both.rc);
    check("ریست با پنل مرتبطِ down رد شد (502)", r.status === 502, `status=${r.status}`);
    r = await api("GET", "/api/reseller/inbounds", null, both.rc);
    check("مصرف قطعی ثبت نشد (0)", r.json.permissions.consumedGB === 0, `consumed=${r.json.permissions.consumedGB}`);
    // پنل B برگشت → retry موفق و بدهکاری دقیقاً یک‌بار = ۱۲ گیگ
    await outage(MOCK_B, false);
    r = await api("POST", `/api/reseller/users/${encodeURIComponent(realEmail)}/reset-traffic`, null, both.rc);
    check("ریست پس از رفع قطعی موفق", r.json?.ok === true, JSON.stringify(r.json)?.slice(0, 80));
    check("بدهکاری دقیقاً یک‌بار = ۱۲ گیگ (۷+۵)", r.json?.debitedGB === 12, `debited=${r.json?.debitedGB}`);
    // ریست دوباره (شمارنده‌ها صفر شده‌اند) → بدهکاری جدید صفر — دوبار بدهکاری نداریم
    r = await api("POST", `/api/reseller/users/${encodeURIComponent(realEmail)}/reset-traffic`, null, both.rc);
    check("ریست تکراری بدهکاری اضافه ندارد", r.json?.ok === true && r.json?.debitedGB === 0, `debited=${r.json?.debitedGB}`);
  }

  // ---------- C) partial delete دو پنلی ----------
  console.log("== C) partial delete ==");
  {
    const email = "pd" + rnd();
    r = await api("POST", "/api/reseller/users", { name: email, trafficGB: 30, expiryDate: "", ipLimit: 0, inbounds: [{ panelId: inbA.panelId, inboundId: inbA.inboundId }, ...(inbB ? [{ panelId: inbB.panelId, inboundId: inbB.inboundId }] : [])] }, both.rc);
    const realEmail = r.json.email;
    await setUsage(MOCK_A, realEmail, 4 * GB, 0);
    await setUsage(MOCK_B, realEmail, 6 * GB, 0);
    await outage(MOCK_B, true);
    r = await api("DELETE", `/api/reseller/users/${encodeURIComponent(realEmail)}`, null, both.rc);
    check("حذف با پنل مرتبطِ down رد شد", r.status === 502, `status=${r.status}`);
    r = await api("GET", "/api/reseller/users", null, both.rc);
    check("رکورد tracked حفظ شد", r.json.users.some((u) => u.email === realEmail));
    await outage(MOCK_B, false);
    r = await api("DELETE", `/api/reseller/users/${encodeURIComponent(realEmail)}`, null, both.rc);
    check("حذف پس از رفع قطعی موفق", r.json?.ok === true, JSON.stringify(r.json)?.slice(0, 80));
    check("بدهکاری یک‌باره = ۱۰ گیگ (۴+۶)", r.json?.debitedGB === 10, `debited=${r.json?.debitedGB}`);
  }

  // ---------- D) پرتال و پل: سازگاری تجمیع کانونی ----------
  console.log("== D) canonical usage: داشبورد = پل = پرتال ==");
  {
    const email = "cc" + rnd();
    r = await api("POST", "/api/reseller/users", { name: email, trafficGB: 25, expiryDate: "", ipLimit: 0, inbounds: [{ panelId: inbA.panelId, inboundId: inbA.inboundId }] }, both.rc);
    check("ساخت کاربر کانونی D", r.json?.ok === true, JSON.stringify(r.json)?.slice(0, 90));
    const realEmail = r.json.email;
    await setUsage(MOCK_A, realEmail, 5 * GB, 2 * GB); // ۷ گیگ
    await fetch(MOCK_A + "/mock/dup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: realEmail }) });
    // داشبورد
    r = await api("GET", "/api/reseller/users", null, both.rc);
    console.log("    (users GET:", r.status, "users:", r.json.users?.length, "err:", r.json.error || "-", ")");
    const dash = r.json.users?.find((u) => u.email === realEmail);
    check("داشبورد usedGB = ۷ (نه ۱۴)", dash && Math.abs(dash.usedGB - 7) < 0.01, `used=${dash?.usedGB}`);
    // پرتال (format=json)
    const sub = dash?.subId;
    r = await api("GET", `/api/s/${sub}?format=json`);
    check("پرتال usedGB = ۷", Math.abs((r.json?.usedGB ?? -1) - 7) < 0.01, `used=${r.json?.usedGB}`);
    // پل getClientTraffics
    r = await api("PUT", "/api/reseller/mirza", { enabled: true, chatId: "" }, both.rc);
    console.log("    (mirza PUT:", r.status, JSON.stringify(r.json)?.slice(0, 60) + ")");
    r = await api("POST", `/api/bridge/${both.username}/login`, { username: both.username, password: "AccTest123456" }, null);
    console.log("    (bridge login:", r.status, JSON.stringify(r.json)?.slice(0, 60) + ")");
    const bc = (r.sc.find((s) => s.startsWith("pv_bridge")) || "").split(";")[0];
    r = await api("GET", `/api/bridge/${both.username}/panel/api/inbounds/getClientTraffics/${encodeURIComponent(realEmail)}`, null, bc);
    console.log("    (bridge obj:", JSON.stringify(r.json?.obj)?.slice(0, 120) + ")");
    const bUsed = ((r.json?.obj?.up || 0) + (r.json?.obj?.down || 0)) / GB;
    check("پل used = ۷ گیگ", Math.abs(bUsed - 7) < 0.01, `used=${bUsed}`);
  }

  // ---------- E) create ناقص: rollback جبرانی ----------
  console.log("== E) partial create rollback (شبیه‌سازی قطعی پنل B) ==");
  {
    const eRes = await mkReseller(admin, 50, [inbARef, inbBRef]);
    const erc = eRes.rc;
    await fetch(MOCK_B + "/mock2/failadd", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: true }) });
    const email = "or" + rnd();
    r = await api("POST", "/api/reseller/users", { name: email, trafficGB: 10, expiryDate: "", ipLimit: 0, inbounds: [{ panelId: inbA.panelId, inboundId: inbA.inboundId }, ...(inbB ? [{ panelId: inbB.panelId, inboundId: inbB.inboundId }] : [])] }, erc);
    check("ساخت ناقص با جبران → خطا برگرداند", r.status === 502 || r.json?.error, `status=${r.status} body=${JSON.stringify(r.json)?.slice(0,80)}`);
    await fetch(MOCK_B + "/mock2/failadd", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: false }) });
    await outage(MOCK_B, false);
    // بررسی اینکه روی پنل A یتیم نمانده (rollback انجام شده) — ساخت مجدد همان نام باید موفق باشد
    r = await api("POST", "/api/reseller/users", { name: email, trafficGB: 10, expiryDate: "", ipLimit: 0, inbounds: [{ panelId: inbA.panelId, inboundId: inbA.inboundId }] }, erc);
    check("ساخت مجدد همان نام موفق (rollback قبلی کامل بود)", r.json?.ok === true, JSON.stringify(r.json)?.slice(0, 90));
    await api("DELETE", `/api/reseller/users/${encodeURIComponent(r.json?.email || "")}`, null, erc);
  }

  // ---------- F) کوکی‌ها ----------
  console.log("== F) cookies ==");
  {
    r = await api("POST", "/api/auth/login", { username: "admin", password: "LocalDemo123!" });
    const sc = r.sc.find((s) => s.startsWith("rp_session")) || "";
    check("کوکی لاگین: HttpOnly + SameSite + Path=/", /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc) && /Path=\//.test(sc), sc.slice(0, 80));
  }

  console.log(`\n== نتیجه فاز ۱.۱: ${pass} پاس، ${fail} شکست ==`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error("RUNNER FAIL:", e);
  process.exit(1);
});
