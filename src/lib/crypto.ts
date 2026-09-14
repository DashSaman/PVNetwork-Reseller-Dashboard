import crypto from "crypto";

// ---------- رمزنگاری رمزهای عبور (scrypt) ----------
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// ---------- رمزنگاری AES برای پسورد پنل ----------
const SECRET = process.env.APP_SECRET || "reseller-panel-local-secret-key-2024";

function aesKey(): Buffer {
  return crypto.createHash("sha256").update(SECRET).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  try {
    const [ivB64, tagB64, encB64] = payload.split(".");
    if (!ivB64 || !tagB64 || !encB64) return "";
    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

// ---------- توکن نشست (HMAC امضاشده) ----------
export type SessionPayload = {
  role: "ADMIN" | "RESELLER";
  uid: string; // شناسه در دیتابیس
  username: string;
  exp: number; // timestamp میلی‌ثانیه
};

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Buffer {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

export function signSession(payload: SessionPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(crypto.createHmac("sha256", SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac("sha256", SECRET).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8")) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomHex(len: number): string {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}

export function randomUuid(): string {
  return crypto.randomUUID();
}
