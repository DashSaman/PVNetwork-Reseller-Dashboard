import { NextResponse } from "next/server";
import { getSystemBrand } from "@/lib/whitelabel";

/** نام برند سامانه — عمومی (برای صفحه ورود) */
export async function GET() {
  return NextResponse.json({ brand: await getSystemBrand() });
}
