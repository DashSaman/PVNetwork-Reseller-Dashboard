import { NextRequest, NextResponse } from "next/server";
import { getPortalData } from "@/lib/user-portal";
import { buildClashYaml } from "@/lib/clash";

type Ctx = { params: Promise<{ subId: string }> };

/**
 * خروجی اشتراک عمومی بر اساس subId — سازگار با اپ‌های V2Ray و Clash
 * format پیش‌فرض: base64 (استاندارد V2Ray)
 * format=clash → YAML اپ‌های Clash / Clash.Meta
 * format=json  → JSON کامل برای یکپارچه‌سازی‌ها
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { subId } = await ctx.params;
  const requestHost = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    .trim()
    .split(":")[0];
  const format = (req.nextUrl.searchParams.get("format") || "base64").toLowerCase();
  const data = await getPortalData(subId, requestHost);

  if (!data.found) {
    return NextResponse.json({ error: "اشتراک یافت نشد" }, { status: 404 });
  }

  if (format === "json") {
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  }

  const uris = data.links.map((l) => l.uri);

  if (format === "clash") {
    const yaml = buildClashYaml(data.links, data.email || "user");
    return new NextResponse(yaml, {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Content-Disposition": `attachment; filename="clash-${data.subId.slice(0, 8)}.yaml"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // base64 استاندارد V2Ray
  const body = Buffer.from(uris.join("\n"), "utf8").toString("base64");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
