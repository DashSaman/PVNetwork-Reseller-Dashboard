import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ user: null }, { status: 200 });
  return NextResponse.json({
    user: { role: s.role, username: s.username, uid: s.uid },
  });
}
