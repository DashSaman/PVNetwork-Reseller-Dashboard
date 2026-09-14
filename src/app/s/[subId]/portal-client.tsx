"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import QRCode from "react-qr-code";
import { PvLogo, faNum } from "@/components/panel/shared";
import type { PortalData } from "@/lib/user-portal";
import {
  Link2,
  Copy,
  QrCode,
  Smartphone,
  MonitorSmartphone,
  CheckCircle2,
  XCircle,
  Clock,
  Wifi,
  WifiOff,
  Download,
  Apple,
  AppWindow,
} from "lucide-react";

const APPS = [
  { name: "v2rayNG", platform: "اندروید", icon: <Smartphone className="h-5 w-5" />, url: "https://play.google.com/store/apps/details?id=com.v2ray.ang", note: "پیشنهادی اندروید" },
  { name: "Hiddify", platform: "اندروید / iOS / ویندوز", icon: <MonitorSmartphone className="h-5 w-5" />, url: "https://hiddify.com/download", note: "همه‌کاره" },
  { name: "Streisand", platform: "iOS / مک", icon: <Apple className="h-5 w-5" />, url: "https://apps.apple.com/us/app/streisand/id6377664703", note: "پیشنهادی آیفون" },
  { name: "V2Box", platform: "iOS", icon: <Apple className="h-5 w-5" />, url: "https://apps.apple.com/us/app/v2box/id6446814670", note: "جایگزین iOS" },
  { name: "v2rayN", platform: "ویندوز", icon: <AppWindow className="h-5 w-5" />, url: "https://github.com/2dust/v2rayN/releases", note: "پیشنهادی ویندوز" },
  { name: "NekoBox", platform: "ویندوز", icon: <AppWindow className="h-5 w-5" />, url: "https://github.com/MatsuriDayo/nekoray/releases", note: "جایگزین ویندوز" },
];

export function PortalClient({ data }: { data: PortalData }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  if (!data.found) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Card className="bg-card card-soft max-w-sm w-full">
          <CardContent className="p-8 text-center space-y-3">
            <XCircle className="h-12 w-12 text-red-400 mx-auto" />
            <h1 className="font-extrabold text-lg">اشتراک یافت نشد</h1>
            <p className="text-sm text-muted-foreground">این لینک نامعتبر است یا اشتراک حذف شده. با پشتیبانی خودتان تماس بگیرید.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const subUrl = typeof window !== "undefined" ? window.location.href : "";

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(""), 1500);
    });
  }

  const usagePct = data.usagePct ?? 0;
  const unlimited = data.totalGB <= 0;

  return (
    <main className="min-h-screen py-8 px-4 relative overflow-hidden">
      <div className="bg-blob w-96 h-96 bg-[var(--brand)] top-[-10rem] end-[-8rem] opacity-40" />
      <div className="bg-blob w-80 h-80 bg-[var(--brand-orange)] bottom-[-8rem] start-[-6rem] opacity-40" />

      <div className="relative mx-auto max-w-2xl space-y-4">
        {/* هدر برند */}
        <div className="flex items-center justify-center gap-3">
          <PvLogo size={40} />
          <div>
            <div className="text-lg font-extrabold brand-gradient-text">{data.brandName}</div>
            <div className="text-[11px] text-muted-foreground">صفحه اشتراک شما — همیشه به‌روز</div>
          </div>
        </div>

        {/* وضعیت کاربر */}
        <Card className="bg-card card-soft">
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs text-muted-foreground">کاربر</div>
                <div className="font-extrabold text-lg" dir="ltr">{data.email}</div>
              </div>
              <Badge variant="outline" className={data.enable ? "tone-ok" : "tone-danger"}>
                {data.enable ? <Wifi className="h-3.5 w-3.5 me-1" /> : <WifiOff className="h-3.5 w-3.5 me-1" />}
                {data.enable ? "فعال" : "غیرفعال"}
              </Badge>
            </div>

            {/* مصرف */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">مصرف ترافیک</span>
                <span dir="ltr" className="font-semibold">
                  {faNum(data.usedGB)} / {unlimited ? "∞" : faNum(data.totalGB)} GB
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-muted overflow-hidden" dir="ltr">
                <div
                  className={`h-full rounded-full transition-all ${
                    usagePct >= 90
                      ? "bg-[linear-gradient(90deg,#ef4444,#f87171)]"
                      : usagePct >= 75
                        ? "bg-[linear-gradient(90deg,#f59e0b,#fbbf24)]"
                        : "bg-[linear-gradient(90deg,#0f9e99,#f37021)]"
                  }`}
                  style={{ width: `${unlimited ? Math.min(100, data.usedGB * 2) || 4 : Math.max(3, usagePct)}%` }}
                />
              </div>
              {!unlimited && <div className="text-xs text-muted-foreground">{faNum(usagePct)}٪ مصرف شده</div>}
            </div>

            {/* انقضا و لوکیشن */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-border p-3 flex items-center gap-2.5">
                <Clock className="h-4 w-4 text-[var(--brand)]" />
                <div>
                  <div className="text-[11px] text-muted-foreground">انقضا</div>
                  <div className="text-sm font-bold">
                    {data.expiryTime <= 0
                      ? "نامحدود"
                      : data.daysLeft !== undefined && data.daysLeft < 0
                        ? "منقضی شده"
                        : `${faNum(data.daysLeft ?? 0)} روز مانده`}
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border p-3 flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-[var(--brand-orange)]" />
                <div>
                  <div className="text-[11px] text-muted-foreground">لوکیشن‌ها</div>
                  <div className="text-sm font-bold truncate" dir="ltr">{data.locations.join(" · ") || "-"}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* لینک اشتراک */}
        <Card className="bg-card card-soft">
          <CardContent className="p-5 space-y-3">
            <h2 className="font-bold text-sm flex items-center gap-1.5">
              <Link2 className="h-4 w-4 text-[var(--brand)]" /> لینک اشتراک
            </h2>
            <p className="text-xs text-muted-foreground leading-5">
              در اپ (V2RayNG / Streisand / Hiddify) گزینه «افزودن از اشتراک» را بزنید و این لینک را وارد کنید — همه لوکیشن‌ها خودکار اضافه و به‌روز می‌شوند.
            </p>
            <code dir="ltr" className="block bg-muted rounded-lg px-3 py-2.5 font-mono text-[10px] break-all border border-border">
              {subUrl}
            </code>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => copy(subUrl, "sub")}>
                {copied === subUrl ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} کپی
              </Button>
              <Button size="sm" variant="outline" onClick={() => setQr(qr === "sub" ? null : "sub")}>
                <QrCode className="h-3.5 w-3.5" /> نمایش QR
              </Button>
            </div>
            {qr === "sub" && (
              <div className="flex justify-center p-3 bg-card rounded-xl border border-border">
                <QRCode value={subUrl} size={200} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* لینک‌های مستقیم */}
        {data.links.length > 0 && (
          <Card className="bg-card card-soft">
            <CardContent className="p-5 space-y-3">
              <h2 className="font-bold text-sm flex items-center gap-1.5">
                <Download className="h-4 w-4 text-[var(--brand-orange)]" /> کانفیگ‌های مستقیم
              </h2>
              <div className="space-y-2">
                {data.links.map((l, i) => (
                  <div key={i} className="rounded-xl border border-border p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Badge variant="secondary" className="text-[10px]" dir="ltr">{l.protocol}</Badge>
                        <span className="text-xs font-semibold truncate" dir="ltr">{l.remark}</span>
                      </div>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copy(l.uri, `l${i}`)}>
                          {copied === l.uri ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setQr(qr === `l${i}` ? null : `l${i}`)}>
                          <QrCode className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {qr === `l${i}` && (
                      <div className="flex justify-center p-2 bg-card rounded-lg border border-border">
                        <QRCode value={l.uri} size={180} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                روش ساده‌تر: فقط لینک اشتراک بالا را در اپ وارد کنید — نیازی به کانفیگ‌های تکی نیست.
              </p>
            </CardContent>
          </Card>
        )}

        {/* اپ‌ها */}
        <Card className="bg-card card-soft">
          <CardContent className="p-5 space-y-3">
            <h2 className="font-bold text-sm flex items-center gap-1.5">
              <Smartphone className="h-4 w-4 text-[var(--brand)]" /> دانلود اپلیکیشن‌ها
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {APPS.map((a) => (
                <a
                  key={a.name}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-border p-3 hover:border-[var(--brand)]/50 hover:bg-[var(--brand-soft)]/40 transition-colors"
                >
                  <span className="h-10 w-10 rounded-lg bg-[var(--brand-soft)] flex items-center justify-center text-[var(--brand-deep)]">{a.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold" dir="ltr">{a.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{a.platform} — {a.note}</span>
                  </span>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground pb-4">
          {data.brandName} © {new Date().getFullYear()} — این صفحه اختصاصی شماست؛ با دیگران به اشتراک نگذارید.
        </p>
      </div>
    </main>
  );
}
