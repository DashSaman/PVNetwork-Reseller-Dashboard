import dns from "dns/promises";
import { db } from "@/lib/db";
import { randomHex } from "./crypto";

/**
 * وایت‌لیبل: برند و دامنه اختصاصی نماینده
 * تأیید دامنه از طریق رکورد TXT (_pvnet.example.com) یا CNAME به دامنه سابسکریپشن
 */

export const VERIFY_PREFIX = "_pvnet";

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-z0-9.\-]/g, "");
}

export function isValidDomain(d: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d);
}

/** ساخت یا دریافت توکن تأیید */
export async function ensureVerifyToken(resellerId: string): Promise<string> {
  const r = await db.reseller.findUnique({ where: { id: resellerId }, select: { verifyToken: true } });
  if (r?.verifyToken) return r.verifyToken;
  const token = `pvnet-${randomHex(12)}`;
  await db.reseller.update({ where: { id: resellerId }, data: { verifyToken: token } });
  return token;
}

export type VerifyResult = { ok: boolean; msg: string; method?: "TXT" | "CNAME" };

/** بررسی مالکیت دامنه: TXT یا CNAME */
export async function verifyDomain(resellerId: string): Promise<VerifyResult> {
  const reseller = await db.reseller.findUnique({
    where: { id: resellerId },
    select: { customDomain: true, verifyToken: true },
  });
  if (!reseller?.customDomain) {
    return { ok: false, msg: "ابتدا دامنه خود را وارد و ذخیره کنید" };
  }
  const domain = normalizeDomain(reseller.customDomain);
  const token = reseller.verifyToken ? `pvnet-verify=${reseller.verifyToken}` : null;

  // ۱) بررسی رکورد TXT روی _pvnet.domain
  try {
    const txts = await dns.resolveTxt(`${VERIFY_PREFIX}.${domain}`);
    const flat = txts.map((chunks) => chunks.join(""));
    if (token && flat.some((t) => t.trim() === token)) {
      await db.reseller.update({ where: { id: resellerId }, data: { domainVerified: true } });
      return { ok: true, method: "TXT", msg: "دامنه با موفقیت تأیید شد (رکورد TXT)" };
    }
  } catch {
    // TXT نیست؛ ادامه با CNAME
  }

  // ۲) بررسی CNAME به دامنه سابسکریپشن سامانه
  const config = await db.panelConfig.findFirst({ orderBy: { updatedAt: "desc" } });
  if (config?.subBase) {
    let subHost = "";
    try {
      subHost = new URL(config.subBase.trim()).hostname;
    } catch {
      subHost = normalizeDomain(config.subBase);
    }
    try {
      const cnames = await dns.resolveCname(domain);
      if (subHost && cnames.some((c) => c.toLowerCase() === subHost.toLowerCase())) {
        await db.reseller.update({ where: { id: resellerId }, data: { domainVerified: true } });
        return { ok: true, method: "CNAME", msg: "دامنه با موفقیت تأیید شد (CNAME به سرور سابسکریپشن)" };
      }
    } catch {
      // بدون CNAME
    }
  }

  return {
    ok: false,
    msg: "تأیید انجام نشد — رکورد TXT را دقیقاً مطابق راهنما ثبت کنید (اعمال DNS تا چند ساعت طول می‌کشد)",
  };
}

/** تنظیمات برند کلی سامانه */
export async function getSystemBrand(): Promise<string> {
  const s = await db.setting.findUnique({ where: { key: "systemBrand" } });
  return s?.value || "PvNetWork";
}

export async function setSystemBrand(name: string): Promise<void> {
  const v = name.trim().slice(0, 60) || "PvNetWork";
  await db.setting.upsert({ where: { key: "systemBrand" }, create: { key: "systemBrand", value: v }, update: { value: v } });
}
