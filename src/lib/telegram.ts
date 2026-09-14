import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "./crypto";
import { logActivity } from "./logger";

/**
 * اعلان‌های تلگرام — هر نماینده بات خودش را دارد (وایت‌لیبل دوستانه)
 * - ذخیره امن توکن با AES
 * - نرخ محدود هشدار مصرف/انقضا (هر کاربر هر ۱۲ ساعت یک‌بار)
 */

export type ResellerTg = {
  id: string;
  username: string;
  tgBotToken: string | null;
  tgChatId: string | null;
  tgEnabled: boolean;
};

const ALERT_INTERVAL_MS = 1000 * 60 * 60 * 12; // ۱۲ ساعت بین هشدارهای تکراری

export async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string
): Promise<{ ok: boolean; msg: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (res.ok && j?.ok) return { ok: true, msg: "پیام ارسال شد" };
    return { ok: false, msg: j?.description || `خطای تلگرام (${res.status})` };
  } catch (e) {
    return { ok: false, msg: `اتصال به تلگرام ناموفق: ${(e as Error).message}` };
  }
}

/** ارسال پیام با بات ذخیره‌شده نماینده (اگر فعال باشد) */
export async function notifyReseller(reseller: ResellerTg, text: string): Promise<{ ok: boolean; msg: string }> {
  if (!reseller.tgEnabled) return { ok: false, msg: "اعلان تلگرام غیرفعال است" };
  const token = reseller.tgBotToken ? decryptSecret(reseller.tgBotToken) : "";
  if (!token || !reseller.tgChatId) return { ok: false, msg: "توکن بات یا شناسه چت تنظیم نشده است" };
  return sendTelegram(token, reseller.tgChatId, text);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** اعلان ساخت کاربر (تکی یا گروهی) */
export async function notifyUserCreated(
  reseller: ResellerTg & { brandName: string | null },
  users: { email: string; subLink: string | null; trafficGB: number }[],
  kind: "single" | "bulk"
): Promise<void> {
  if (users.length === 0) return;
  const brand = reseller.brandName || "پنل نمایندگی";
  const lines = users.map(
    (u) =>
      `👤 <b>${escapeHtml(u.email)}</b>\n📦 سهمیه: ${u.trafficGB > 0 ? u.trafficGB + " GB" : "نامحدود"}${u.subLink ? `\n🔗 ${escapeHtml(u.subLink)}` : ""}`
  );
  const text =
    kind === "bulk"
      ? `✅ <b>${brand}</b> — ${users.length} کاربر ساخته شد\n\n${lines.join("\n\n")}`
      : `✅ <b>${brand}</b> — کاربر جدید ساخته شد\n\n${lines[0]}`;
  await notifyReseller(reseller, text);
}

/** نقشه هشدارهای اخیر — در جدول Setting نگه‌داری می‌شود */
type AlertMap = Record<string, number>;

async function loadAlertMap(resellerId: string): Promise<AlertMap> {
  const key = `tgAlerts:${resellerId}`;
  const s = await db.setting.findUnique({ where: { key } });
  if (!s?.value) return {};
  try {
    return JSON.parse(s.value) as AlertMap;
  } catch {
    return {};
  }
}

async function saveAlertMap(resellerId: string, map: AlertMap): Promise<void> {
  const key = `tgAlerts:${resellerId}`;
  // نگه‌داری حداکثر ۵۰۰ رکورد اخیر
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 500);
  const value = JSON.stringify(Object.fromEntries(entries));
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export type ThresholdAlert = { email: string; name: string | null; type: "usage" | "expiry"; pct?: number; days?: number };

/**
 * هشدار آستانه مصرف (۸۰٪+) و انقضا نزدیک (۳ روز) — با نرخ محدود ۱۲ ساعته
 * از route کاربران صدا زده می‌شود (بدون بلاک کردن پاسخ)
 */
export async function sendThresholdAlerts(
  reseller: ResellerTg & { brandName: string | null },
  alerts: ThresholdAlert[]
): Promise<void> {
  if (!reseller.tgEnabled || alerts.length === 0) return;
  const token = reseller.tgBotToken ? decryptSecret(reseller.tgBotToken) : "";
  if (!token || !reseller.tgChatId) return;

  const map = await loadAlertMap(reseller.id);
  const now = Date.now();
  const pending: ThresholdAlert[] = [];
  for (const a of alerts) {
    const k = `${a.type}:${a.email}`;
    if (!map[k] || now - map[k] > ALERT_INTERVAL_MS) {
      pending.push(a);
      map[k] = now;
    }
  }
  if (pending.length === 0) return;

  const brand = reseller.brandName || "پنل نمایندگی";
  const usage = pending.filter((a) => a.type === "usage");
  const expiry = pending.filter((a) => a.type === "expiry");
  const lines: string[] = [`⚠️ <b>${brand}</b> — هشدار مصرف`];
  if (usage.length) {
    lines.push("<b>مصرف ۸۰٪ به بالا:</b>");
    for (const u of usage) lines.push(`• ${escapeHtml(u.email)} — ${u.pct ?? 100}٪ مصرف شده`);
  }
  if (expiry.length) {
    lines.push("<b>انقضای نزدیک:</b>");
    for (const u of expiry) lines.push(`• ${escapeHtml(u.email)} — ${u.days ?? 0} روز مانده`);
  }
  const r = await sendTelegram(token, reseller.tgChatId, lines.join("\n"));
  if (r.ok) {
    await saveAlertMap(reseller.id, map);
    await logActivity({
      actorType: "RESELLER",
      actorName: reseller.username,
      action: "اعلان تلگرام هشدار مصرف",
      detail: `${pending.length} هشدار ارسال شد`,
      resellerId: reseller.id,
    });
  }
}

/** تست اتصال بات */
export async function testTelegram(reseller: ResellerTg & { brandName: string | null }): Promise<{ ok: boolean; msg: string }> {
  const r = await notifyReseller(reseller, `✅ تست اتصال موفق — اعلان‌های <b>${reseller.brandName || "پنل نمایندگی"}</b> فعال شد.`);
  return r;
}

export { encryptSecret };
