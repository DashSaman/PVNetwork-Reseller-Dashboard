import type { PanelClient } from "./panel";

export type ExtensionInput = { trafficGB: number; days: number };
export type ExtensionTarget = { panelId: string; protocol: string; client: PanelClient };
export type ExtensionSource = { id: string; email: string; trafficGB: number; targets: ExtensionTarget[] };
export type ExtensionUser = { id: string; email: string; oldTrafficGB: number; newTrafficGB: number; targets: ExtensionTarget[] };
export type ExtensionPlan = { users: ExtensionUser[]; total: number; unchanged: number; requiredGB: number; input: ExtensionInput };
const GB = 1073741824;
const DAY = 86400000;

export function validateExtensionInput(input: ExtensionInput) {
  if (!Number.isSafeInteger(input.trafficGB) || input.trafficGB < 0 || input.trafficGB > 1000000 ||
      !Number.isSafeInteger(input.days) || input.days < 0 || input.days > 36500 ||
      (input.trafficGB === 0 && input.days === 0)) {
    throw new Error("حجم و روز اضافه باید عدد صحیح و غیرمنفی باشند؛ حداقل یکی بیشتر از صفر باشد");
  }
}

/** Pure preflight: calculate fixed absolute targets before any remote mutation. */
export function planExtension(sources: ExtensionSource[], input: ExtensionInput, quota: { unlimited: boolean; remaining: number }): ExtensionPlan {
  validateExtensionInput(input);
  if (sources.length === 0) throw new Error("این نماینده کاربری ندارد");
  const users: ExtensionUser[] = [];
  let requiredGB = 0;
  for (const s of sources) {
    if (!s.targets.length) throw new Error(`پنل کاربر ${s.email} در دسترس نیست`);
    const newTrafficGB = s.trafficGB > 0 ? s.trafficGB + input.trafficGB : 0;
    if (!Number.isSafeInteger(newTrafficGB) || newTrafficGB > 2147483647) throw new Error("سهمیه از محدودهٔ مجاز خارج است");
    let changed = newTrafficGB !== s.trafficGB;
    const targets = s.targets.map((t) => {
      const c = t.client;
      if (!Number.isSafeInteger(c.expiryTime) || !Number.isSafeInteger(c.totalGB) || c.totalGB < 0) throw new Error(`اطلاعات کاربر ${s.email} نامعتبر است`);
      if (input.trafficGB > 0 && c.totalGB !== s.trafficGB * GB) throw new Error(`سهمیهٔ زندهٔ ${s.email} با سهمیهٔ ثبت‌شده هماهنگ نیست؛ ابتدا اصلاح کنید`);
      const expiryTime = c.expiryTime === 0 ? 0 : c.expiryTime + (c.expiryTime < 0 ? -1 : 1) * input.days * DAY;
      if (!Number.isSafeInteger(expiryTime) || Math.abs(expiryTime) > 8640000000000000) throw new Error("تاریخ از محدودهٔ مجاز خارج است");
      changed ||= expiryTime !== c.expiryTime;
      return { ...t, client: { ...c, totalGB: input.trafficGB > 0 ? newTrafficGB * GB : c.totalGB, expiryTime } };
    });
    if (changed) {
      requiredGB += newTrafficGB - s.trafficGB;
      users.push({ id: s.id, email: s.email, oldTrafficGB: s.trafficGB, newTrafficGB, targets });
    }
  }
  if (!quota.unlimited && requiredGB > quota.remaining) throw new Error(`پول ترافیک کافی نیست — ${requiredGB} گیگ لازم است؛ موجودی ${Math.round(quota.remaining * 100) / 100} گیگ`);
  return { users, total: sources.length, unchanged: sources.length - users.length, requiredGB, input };
}

/** Persist each panel result; retries always replay absolute values, never add again. */
export async function executeExtensionUser(user: ExtensionUser, completed: string[], deps: {
  apply: (target: ExtensionTarget) => Promise<void>;
  markPanel: (panelId: string) => Promise<void>;
  commit: () => Promise<void>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    for (const t of user.targets) {
      if (completed.includes(t.panelId)) continue;
      await deps.apply(t);
      await deps.markPanel(t.panelId);
    }
    await deps.commit();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "خطا در افزایش گروهی" };
  }
}
