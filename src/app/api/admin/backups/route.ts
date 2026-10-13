import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { backupFile, backupSchedule, createBackup, listBackups } from "@/lib/backups";

export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401, headers });
  try {
    const name = req.nextUrl.searchParams.get("download");
    if (name) return new Response(new Uint8Array(await backupFile(name)), { headers: { ...headers, "Content-Type": "application/zip", ...(req.nextUrl.searchParams.has("raw") ? {} : { "Content-Disposition": `attachment; filename="${name}"` }) } });
    return NextResponse.json({ files: await listBackups(), scheduled: await backupSchedule(), retentionDays: 5, dailyTime: "03:00", timezone: "Asia/Tehran" }, { headers });
  } catch { return NextResponse.json({ error: "بکاپ در دسترس نیست؛ فهرست را دوباره دریافت کنید" }, { status: 404, headers }); }
}
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401, headers });
  try {
    const body = await req.json();
    const kind = body.kind === "daily" ? "daily" : "manual";
    return NextResponse.json({ backup: await createBackup(admin.username, kind) }, { headers });
  } catch (e) {
    console.error("backup creation failed", e instanceof Error ? e.name : "unknown");
    return NextResponse.json({ error: "تهیه بکاپ انجام نشد؛ فضای دیسک و وضعیت سرویس بکاپ را بررسی کنید" }, { status: 503, headers });
  }
}
