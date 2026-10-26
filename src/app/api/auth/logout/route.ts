import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { cookies } from "next/headers";
import { revokeDashboardToken } from "@/lib/auth-state";

export async function POST() {
  await revokeDashboardToken((await cookies()).get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
