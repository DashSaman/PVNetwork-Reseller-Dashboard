import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { decryptSecret, verifyPassword } from "@/lib/crypto";
import { verifyTotp } from "@/lib/totp";
import { isBlocked, recordFailure } from "@/lib/rate-limit";
import { previewRestore, queueRestore, restoreAvailability } from "@/lib/dashboard-restore";

export const runtime = "nodejs";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (data: object, status = 200) => NextResponse.json(data, { status, headers });
async function operator() {
  const session = await requireAdmin();
  return session ? db.adminUser.findUnique({ where: { id: session.uid } }) : null;
}
function sameOrigin(req: NextRequest) {
  // Browser sends Origin on both raw upload and JSON confirmation; no allowlist wildcard.
  const origin = req.headers.get("origin");
  if (!origin || req.headers.get("sec-fetch-site") === "cross-site") return false;
  try { return new URL(origin).host === req.headers.get("host") && ["https:", "http:"].includes(new URL(origin).protocol); }
  catch { return false; }
}
async function confirmationBody(req: NextRequest) {
  if (!req.body) throw Error("Empty confirmation");
  const reader = req.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 16384) { await reader.cancel(); throw Error("Confirmation too large"); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
export async function GET() {
  if (!await operator()) return json({ error: "دسترسی غیرمجاز" }, 401);
  return json(await restoreAvailability());
}
export async function PUT(req: NextRequest) {
  const admin = await operator();
  if (!admin) return json({ error: "دسترسی غیرمجاز" }, 401);
  if (!sameOrigin(req)) return json({ error: "مبدأ درخواست معتبر نیست." }, 403);
  try { return json(await previewRestore(req, admin.id)); }
  catch { return json({ error: "بکاپ پذیرفته نشد؛ نصب باید تازه و فایل کامل، سالم، سازگار و حداکثر ۶۴ مگابایت باشد. فضای آزاد و نبود آپلود هم‌زمان را بررسی کنید." }, 409); }
}
export async function POST(req: NextRequest) {
  const admin = await operator();
  if (!admin) return json({ error: "دسترسی غیرمجاز" }, 401);
  if (!sameOrigin(req)) return json({ error: "مبدأ درخواست معتبر نیست." }, 403);
  const key = `restore:${admin.id}`;
  if (isBlocked(key).blocked) return json({ error: "تلاش‌های ناموفق زیاد است؛ بعداً تلاش کنید." }, 429);
  try {
    if (Number(req.headers.get("content-length") || 0) > 16384) return json({ error: "درخواست بیش از حد بزرگ است." }, 413);
    const body = await confirmationBody(req);
    if (typeof body.password !== "string" || body.password.length > 1024 || !verifyPassword(body.password, admin.password) || (admin.totpEnabled && !verifyTotp(decryptSecret(admin.totpSecret || ""), String(body.totpCode || "")))) {
      recordFailure(key, 5); return json({ error: "رمز ادمین یا کد دومرحله‌ای معتبر نیست." }, 403);
    }
    if (body.confirm !== "RESTORE" || typeof body.token !== "string") return json({ error: "تأیید بازیابی کامل نیست." }, 400);
    await queueRestore(body.token, admin.id);
    // Existing Docker restart policy restarts only this process/container. No Docker API access.
    setTimeout(() => process.exit(0), 1500);
    const response = json({ queued: true, message: "بازیابی در شروع مجدد داشبورد اعمال می‌شود؛ سپس با حساب داخل بکاپ وارد شوید." }, 202);
    response.cookies.delete("rp_session"); return response;
  } catch { return json({ error: "بازیابی شروع نشد؛ نصب تازه و پیش‌نمایش معتبر لازم است. فایل را دوباره بررسی کنید." }, 409); }
}
