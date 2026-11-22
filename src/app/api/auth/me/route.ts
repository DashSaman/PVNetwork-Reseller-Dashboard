import { NextResponse } from "next/server";
import { inspectDashboardSession } from "@/lib/session";
import { RESELLER_DISABLED_NOTICE } from "@/lib/auth-state";
import { getSupportContact } from "@/lib/support-contact";

export async function GET() {
  const accountToken = await inspectDashboardSession();
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (!accountToken) return NextResponse.json({ user: null }, { headers });
  if (accountToken.resellerDisabled) {
    const { url: supportUrl } = await getSupportContact();
    return NextResponse.json({ user: null, notice: RESELLER_DISABLED_NOTICE, supportUrl }, { headers });
  }
  const s = accountToken.payload;
  return NextResponse.json({
    user: { role: s.role, username: s.username, uid: s.uid },
  }, { headers });
}
