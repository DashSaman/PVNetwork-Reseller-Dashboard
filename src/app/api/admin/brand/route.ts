import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { getSystemBrand, setSystemBrand } from "@/lib/whitelabel";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  return NextResponse.json({ brand: await getSystemBrand() });
}

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const body = (await req.json()) as { brand?: string };
  await setSystemBrand(body.brand || "PvNetwork");
  return NextResponse.json({ ok: true, brand: await getSystemBrand() });
}
