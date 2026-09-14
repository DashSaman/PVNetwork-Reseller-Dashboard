import { Card, CardContent } from "@/components/ui/card";
import { PvLogo } from "@/components/panel/shared";
import { getSystemBrand } from "@/lib/whitelabel";
import { Smartphone, MonitorSmartphone, Apple, AppWindow, Download } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "دانلود اپلیکیشن‌ها",
  icons: { icon: "/logo.webp" },
};

const APPS = [
  { name: "v2rayNG", platform: "اندروید ۵+", icon: <Smartphone className="h-5 w-5" />, url: "https://play.google.com/store/apps/details?id=com.v2ray.ang", note: "پیشنهادی اندروید — گوگل‌پلی" },
  { name: "v2rayNG (APK)", platform: "اندروید", icon: <Smartphone className="h-5 w-5" />, url: "https://github.com/2dust/v2rayNG/releases", note: "دانلود مستقیم APK" },
  { name: "Hiddify", platform: "همه پلتفرم‌ها", icon: <MonitorSmartphone className="h-5 w-5" />, url: "https://hiddify.com/download", note: "اندروید، iOS، ویندوز، مک، لینوکس" },
  { name: "Streisand", platform: "iOS / مک", icon: <Apple className="h-5 w-5" />, url: "https://apps.apple.com/us/app/streisand/id6377664703", note: "پیشنهادی آیفون و آیپد" },
  { name: "V2Box", platform: "iOS", icon: <Apple className="h-5 w-5" />, url: "https://apps.apple.com/us/app/v2box/id6446814670", note: "جایگزین iOS" },
  { name: "v2rayN", platform: "ویندوز", icon: <AppWindow className="h-5 w-5" />, url: "https://github.com/2dust/v2rayN/releases", note: "پیشنهادی ویندوز" },
  { name: "NekoBox", platform: "ویندوز", icon: <AppWindow className="h-5 w-5" />, url: "https://github.com/MatsuriDayo/nekoray/releases", note: "جایگزین ویندوز" },
  { name: "V2rayXS", platform: "مک / iOS", icon: <Apple className="h-5 w-5" />, url: "https://github.com/tzmax/V2rayXS/releases", note: "پشتیبانی Xray" },
];

export default async function AppsPage() {
  const brand = await getSystemBrand();
  return (
    <main className="min-h-screen py-10 px-4 relative overflow-hidden">
      <div className="bg-blob w-96 h-96 bg-[var(--brand)] top-[-10rem] end-[-8rem] opacity-40" />
      <div className="bg-blob w-80 h-80 bg-[var(--brand-orange)] bottom-[-8rem] start-[-6rem] opacity-40" />

      <div className="relative mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-center gap-3">
          <PvLogo size={44} />
          <div>
            <div className="text-xl font-extrabold brand-gradient-text">{brand}</div>
            <div className="text-xs text-muted-foreground">مرکز دانلود اپلیکیشن‌های اتصال</div>
          </div>
        </div>

        <Card className="bg-card card-soft">
          <CardContent className="p-5 space-y-2">
            <h1 className="font-extrabold flex items-center gap-2">
              <Download className="h-5 w-5 text-[var(--brand)]" />
              اپ مناسب دستگاه خود را دانلود کنید
            </h1>
            <p className="text-sm text-muted-foreground leading-6">
              بعد از نصب اپ، لینک اشتراکی که از پشتیبانی دریافت کرده‌اید را در بخش «Subscription / افزودن از کلیپ‌بورد» وارد کنید تا همه لوکیشن‌ها به‌صورت خودکار اضافه شوند و همیشه به‌روز بمانند.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {APPS.map((a) => (
            <a
              key={a.name}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-2xl border border-border bg-card card-soft p-4 hover:border-[var(--brand)]/50 hover:bg-[var(--brand-soft)]/40 transition-colors"
            >
              <span className="h-12 w-12 rounded-xl bg-[var(--brand-soft)] flex items-center justify-center text-[var(--brand-deep)]">{a.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-extrabold" dir="ltr">{a.name}</span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">{a.platform}</span>
                <span className="block text-[11px] text-[var(--brand-deep)] mt-0.5">{a.note}</span>
              </span>
            </a>
          ))}
        </div>

        <p className="text-center text-[11px] text-muted-foreground pb-4">
          {brand} © {new Date().getFullYear()}
        </p>
      </div>
    </main>
  );
}
