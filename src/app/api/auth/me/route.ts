import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const s = await getSession();
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (!s) return NextResponse.json({ user: null }, { status: 200, headers });
  return NextResponse.json({
    user: { role: s.role, username: s.username, uid: s.uid },
  }, { headers });
}
