import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { withResellerLock } from "@/lib/reseller-helpers";
import { handoverKey, handoverToken, validHandoverToken, type HandoverRecord } from "@/lib/reseller-ownership";

type Ctx = { params: Promise<{ id: string }> };
export async function POST(req: NextRequest, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const { id } = await ctx.params;
  let body: { confirmUsername?: unknown; token?: unknown };
  try { body = await req.json(); if (!body || typeof body !== "object") throw Error(); }
  catch { return NextResponse.json({ error: "درخواست تأیید معتبر نیست" }, { status: 400 }); }

  return withResellerLock(id, async () => {
    const current = await db.reseller.findUnique({ where: { id }, include: { users: true } });
    if (!current) return NextResponse.json({ error: "نماینده پیدا نشد" }, { status: 404 });
    if (body.confirmUsername !== current.username) return NextResponse.json({ error: "نام کاربری نماینده را دقیق وارد کنید" }, { status: 400 });
    const previous = await db.setting.findUnique({ where: { key: handoverKey(id) } });
    if (previous) {
      let record: HandoverRecord;
      try { record = JSON.parse(previous.value); } catch { return NextResponse.json({ error: "سابقهٔ انتقال نیاز به بررسی دارد" }, { status: 409 }); }
      if (!record || record.version !== 1) return NextResponse.json({ error: "سابقهٔ انتقال نیاز به بررسی دارد" }, { status: 409 });
      if (!validHandoverToken(body.token, record.token)) return NextResponse.json({ error: "تأیید انتقال معتبر نیست" }, { status: 409 });
      return NextResponse.json({ ok: true, alreadyTransferred: true, managedUsers: record.managedUsers });
    }
    if (!validHandoverToken(body.token, handoverToken(id, current.username, current.users))) {
      return NextResponse.json({ error: "فهرست یا تنظیمات کاربران تغییر کرده است؛ پیش‌نمایش را دوباره دریافت کنید" }, { status: 409 });
    }
    const activeOperations = await db.operationJournal.count({ where: { resellerId: id, status: { in: ["PENDING", "RUNNING", "PARTIAL", "NEEDS_REPAIR"] } } });
    if (activeOperations) return NextResponse.json({ error: "این نماینده عملیات ناتمام دارد؛ ابتدا آن را تعیین تکلیف کنید", activeOperations }, { status: 409 });
    const record: HandoverRecord = {
      version: 1, sourceUsername: current.username, sourceName: current.name, adminId: admin.uid,
      transferredAt: new Date().toISOString(), token: body.token as string, managedUsers: current.users.length,
    };
    await db.$transaction(async tx => {
      await tx.reseller.update({ where: { id }, data: { active: false } });
      await tx.setting.create({ data: { key: handoverKey(id), value: JSON.stringify(record) } });
      await tx.activityLog.create({ data: { actorType: "ADMIN", actorName: admin.username, action: "انتقال کاربران نماینده به ادمین", detail: `${current.username} | ${current.users.length} کاربر | حفظ حجم، زمان، لینک و مصرف`, resellerId: id } });
    });
    return NextResponse.json({ ok: true, managedUsers: current.users.length });
  });
}
