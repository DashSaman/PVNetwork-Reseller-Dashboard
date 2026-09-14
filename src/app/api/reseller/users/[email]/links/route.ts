import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReseller } from "@/lib/session";
import { getPanelById, getAllPanelInbounds, buildSubLink } from "@/lib/panel-manager";
import { getResellerWithAccess } from "@/lib/reseller-helpers";
import { buildV2rayLink, type BuiltLink } from "@/lib/links";

type Ctx = { params: Promise<{ email: string }> };

/**
 * لینک‌های یک کاربر برای نماینده:
 * - subLink: لینک سابسکریپشن (با پشتیبانی وایت‌لیبل)
 * - links: لینک‌های مستقیم اتصال (vless/vmess/trojan) به تفکیک اینباند/لوکیشن
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const { email: rawEmail } = await ctx.params;
  const email = decodeURIComponent(rawEmail);

  try {
    const reseller = await getResellerWithAccess(session.uid);
    if (!reseller) return NextResponse.json({ error: "حساب شما فعال نیست" }, { status: 403 });

    const tracked = await db.resellerUser.findUnique({
      where: { resellerId_email: { resellerId: reseller.id, email } },
    });
    if (!tracked) return NextResponse.json({ error: "کاربر پیدا نشد" }, { status: 404 });

    const subLink = await buildSubLink(tracked.subId || "", reseller, tracked.panelId || undefined);

    // آدرس اتصال پیش‌فرض: هاست درخواست کاربر (مثل panel.example.com)
    const fwdHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    const requestHost = fwdHost.split(",")[0].trim().split(":")[0] || "";

    // هاست هر پنل: دامنه subBase آن پنل، وگرنه هاست درخواست فعلی
    const panelResult = await getAllPanelInbounds();
    const links: (BuiltLink & { tag: string; panelName: string; remark: string })[] = [];
    const seen = new Set<string>();

    if (panelResult.ok) {
      for (const bundle of panelResult.panels) {
        const panel = await getPanelById(bundle.panelId);
        let host = "";
        if (panel?.subBase) {
          try {
            host = new URL(panel.subBase.trim()).hostname;
          } catch {
            host = "";
          }
        }
        if (!host) host = requestHost;

        for (const inb of bundle.inbounds) {
          const key = `${bundle.panelId}::${inb.id}`;
          const hasClient = inb.clients.some((c) => c.email === email) || inb.clientStats.some((c) => c.email === email);
          if (!hasClient || seen.has(key)) continue;
          seen.add(key);

          const client = inb.clients.find((c) => c.email === email);
          if (!host || (!client?.id && !client?.password)) continue;

          const built = buildV2rayLink({
            protocol: inb.protocol,
            host,
            port: inb.port,
            remark: `${inb.remark || inb.tag}`,
            uuid: client.id,
            password: client.password,
            email,
            flow: client.flow || "",
            stream: (inb.stream || null) as Record<string, unknown> | null,
          });
          links.push({ ...built, tag: inb.tag, panelName: bundle.panelName, remark: inb.remark || inb.tag });
        }
      }
    }

    return NextResponse.json({
      email,
      subId: tracked.subId || null,
      subLink,
      links,
      panelError: panelResult.ok ? null : panelResult.msg || null,
    });
  } catch (e) {
    console.error("user links error:", e);
    return NextResponse.json({ error: "خطای داخلی در دریافت لینک‌ها" }, { status: 500 });
  }
}
