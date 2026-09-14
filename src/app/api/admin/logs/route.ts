import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const take = Math.min(Number(searchParams.get("take") || 100), 300);
  const logs = await db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take });
  return NextResponse.json({ logs });
}
