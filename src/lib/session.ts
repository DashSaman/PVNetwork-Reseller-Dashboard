import { cookies } from "next/headers";
import type { SessionPayload } from "./crypto";
import { validateAccountToken } from "./auth-state";

export const SESSION_COOKIE = "rp_session";
const SESSION_TTL = 1000 * 60 * 60 * 12; // ۱۲ ساعت

export function sessionExpiry(): number {
  return Date.now() + SESSION_TTL;
}

/** تنها راه صدور کوکی نشست داشبورد — سیاست امنیتی یکسان در همه مسیرها */
export function setDashboardSessionCookie(res: import("next/server").NextResponse, token: string): void {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return validateAccountToken(store.get(SESSION_COOKIE)?.value, "dashboard");
}

export async function requireAdmin(): Promise<SessionPayload | null> {
  const s = await getSession();
  return s && s.role === "ADMIN" ? s : null;
}

export async function requireReseller(): Promise<SessionPayload | null> {
  const s = await getSession();
  return s && s.role === "RESELLER" ? s : null;
}
