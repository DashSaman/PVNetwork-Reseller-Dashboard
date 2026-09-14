import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { panelLogin, getInbounds, type PanelAuth } from "@/lib/panel";

/** تست اتصال به پنل ثنایی قبل از ذخیره — با API Token یا نام کاربری/رمز */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });

  try {
    const { baseUrl, username, password, apiToken } = (await req.json()) as {
      baseUrl?: string;
      username?: string;
      password?: string;
      apiToken?: string;
    };
    if (!baseUrl) {
      return NextResponse.json({ ok: false, msg: "آدرس پنل الزامی است" }, { status: 400 });
    }

    let auth: PanelAuth;
    if (apiToken) {
      auth = { baseUrl: baseUrl.trim().replace(/\/+$/, ""), token: apiToken.trim() };
    } else {
      if (!username || !password) {
        return NextResponse.json({ ok: false, msg: "یا API Token یا نام کاربری و رمز وارد کنید" }, { status: 400 });
      }
      const login = await panelLogin(baseUrl, username, password);
      if (!login.ok || !login.data) {
        return NextResponse.json({ ok: false, msg: login.msg || "اتصال ناموفق بود" });
      }
      auth = { baseUrl: baseUrl.trim().replace(/\/+$/, ""), cookie: login.data.cookie, csrf: login.data.csrf };
    }

    const inb = await getInbounds(auth);
    if (!inb.ok || !inb.data) {
      return NextResponse.json({ ok: false, msg: inb.msg || "اتصال برقرار شد اما دریافت اینباندها ناموفق بود" });
    }
    return NextResponse.json({
      ok: true,
      msg: `اتصال موفق! ${inb.data.length} اینباند پیدا شد.`,
      inbounds: inb.data.map((i) => ({
        id: i.id,
        tag: i.tag,
        remark: i.remark,
        protocol: i.protocol,
        port: i.port,
        clients: i.clientStats.length,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, msg: `خطا: ${(e as Error).message}` }, { status: 500 });
  }
}
