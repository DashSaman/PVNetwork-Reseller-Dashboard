import crypto from "crypto";

/**
 * TOTP (RFC 6238) — ورود دومرحله‌ای بدون وابستگی خارجی
 * - الگوریتم HMAC-SHA1، بازه ۳۰ ثانیه، ۶ رقم
 * - Base32 (RFC 4648) رمزگذاری/رمزگشایی
 */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** تولید رمز مخفی تصادفی (۲۰ بایت = ۱۶۰ بیت) */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** آدرس otpauth برای QR */
export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** تولید کد TOTP برای یک بازه زمانی */
function totpAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/**
 * تأیید کد — پذیرش بازه فعلی و ±۱ (پوشش تأخیر ساعت)
 */
export function verifyTotp(secret: string, code: string): boolean {
  const clean = (code || "").replace(/\D/g, "");
  if (clean.length !== 6) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (const drift of [-1, 0, 1]) {
    if (totpAt(secret, counter + drift) === clean) return true;
  }
  return false;
}
