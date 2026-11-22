import { db } from "./db";

const key = "supportTelegramUsername";

export function parseSupportTelegramUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return "";
  const username = trimmed.replace(/^@/, "");
  return /^[a-z0-9_]{5,32}$/i.test(username) ? username : null;
}

export async function getSupportContact() {
  const setting = await db.setting.findUnique({ where: { key }, select: { value: true } });
  const username = parseSupportTelegramUsername(setting?.value) ?? "";
  return { username, url: username ? `https://t.me/${username}` : undefined };
}

export async function setSupportTelegramUsername(username: string) {
  if (!username) {
    await db.setting.deleteMany({ where: { key } });
    return;
  }
  await db.setting.upsert({ where: { key }, create: { key, value: username }, update: { value: username } });
}
