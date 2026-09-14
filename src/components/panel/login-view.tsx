"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2, Eye, EyeOff, Gauge, Users, Globe } from "lucide-react";
import { api, PvLogo } from "./shared";
import { ThemeToggle } from "./theme";
import type { Session } from "./types";

export function LoginView({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [need2fa, setNeed2fa] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [brand, setBrand] = useState("PvNetWork");

  useEffect(() => {
    api<{ brand: string }>("/api/public/brand").then((r) => {
      if (r.ok && r.data?.brand) setBrand(r.data.brand);
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const r = await api<{ role: "ADMIN" | "RESELLER"; username: string; need2fa?: boolean; error?: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, totpCode: totpCode || undefined }),
    });
    setLoading(false);
    if (!r.ok || !r.data) {
      setError(r.error || "ورود ناموفق بود");
      if (r.data?.need2fa || (r.error || "").includes("دومرحله")) setNeed2fa(true);
      return;
    }
    if (r.data.need2fa) {
      setNeed2fa(true);
      setError("");
      return;
    }
    const me = await api<{ user: Session | null }>("/api/auth/me");
    if (me.ok && me.data?.user) onLogin(me.data.user);
  }

  return (
    <main className="min-h-screen flex items-stretch justify-center p-4 sm:p-6 relative overflow-hidden">
      {/* لکه‌های رنگی پس‌زمینه */}
      <div className="bg-blob w-96 h-96 bg-[var(--brand)] top-[-8rem] end-[-6rem]" />
      <div className="bg-blob w-80 h-80 bg-[var(--brand-orange)] bottom-[-7rem] start-[-5rem]" />

      {/* دکمه تم */}
      <div className="absolute top-4 end-4 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-4xl my-auto grid lg:grid-cols-2 rounded-3xl overflow-hidden bg-card card-soft border border-border/60 animate-rise">
        {/* ستون برند */}
        <div className="hidden lg:flex flex-col justify-between p-10 text-white relative bg-[#0d0a08]">
          {/* پس‌زمینه لوگو به‌صورت محو */}
          <div
            className="absolute inset-0 opacity-25 pointer-events-none"
            style={{
              backgroundImage: "url(/logo.webp)",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/40 pointer-events-none" />

          <div className="relative flex items-center gap-3">
            <PvLogo size={44} />
            <div>
              <div className="text-lg font-extrabold tracking-tight">سامانه نمایندگی {brand}</div>
              <div className="text-xs text-white/80">Reseller Dashboard</div>
            </div>
          </div>

          <div className="relative space-y-6">
            <h2 className="text-2xl font-bold leading-relaxed">
              مدیریت فروش و نمایندگی
              <br />
              با زیرساخت اختصاصی و امن
            </h2>
            <ul className="space-y-3 text-sm text-white/90">
              <li className="flex items-center gap-2.5">
                <span className="h-8 w-8 rounded-lg bg-white/15 flex items-center justify-center"><Users className="h-4 w-4" /></span>
                ساخت کاربر، تعیین تاریخ و ترافیک برای هر نماینده
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-8 w-8 rounded-lg bg-white/15 flex items-center justify-center"><Gauge className="h-4 w-4" /></span>
                نمودارهای مصرف و آمار لحظه‌ای
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-8 w-8 rounded-lg bg-white/15 flex items-center justify-center"><Globe className="h-4 w-4" /></span>
                وایت‌لیبل: دامنه و برند اختصاصی هر نماینده
              </li>
            </ul>
          </div>

          <p className="relative text-[11px] text-white/60">{brand} © {new Date().getFullYear()} — تمام حقوق محفوظ است</p>
        </div>

        {/* ستون فرم */}
        <div className="p-8 sm:p-10 flex flex-col justify-center">
          <div className="lg:hidden flex items-center gap-3 mb-6">
            <PvLogo size={40} />
            <div className="text-lg font-extrabold">سامانه نمایندگی <span className="brand-gradient-text">{brand}</span></div>
          </div>

          <div className="mb-6">
            <h1 className="text-xl font-extrabold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[var(--brand)]" />
              ورود به سامانه
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">با حساب ادمین یا حساب نماینده وارد شوید</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">نام کاربری</Label>
              <Input
                id="username"
                dir="ltr"
                className="latin-input h-11"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">رمز عبور</Label>
              <div className="relative">
                <Input
                  id="password"
                  dir="ltr"
                  className="latin-input h-11 pe-11"
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute inset-y-0 end-0 flex items-center justify-center w-11 text-muted-foreground hover:text-[var(--brand)] transition-colors"
                  aria-label={showPass ? "مخفی کردن رمز" : "نمایش رمز"}
                  title={showPass ? "مخفی کردن رمز" : "نمایش رمز"}
                >
                  {showPass ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </div>
            {error && (
              <p className="text-sm tone-danger border rounded-md px-3 py-2">{error}</p>
            )}
            {need2fa && (
              <div className="space-y-2 rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-soft)] p-3">
                <Label htmlFor="totp" className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-[var(--brand)]" />
                  کد ورود دومرحله‌ای
                </Label>
                <Input
                  id="totp"
                  dir="ltr"
                  className="latin-input h-11 text-center tracking-[0.4em] font-bold"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="------"
                />
                <p className="text-[11px] text-muted-foreground">کد ۶ رقمی اپ Authenticator را وارد کنید</p>
              </div>
            )}
            <Button
              type="submit"
              className="w-full h-11 brand-gradient text-white hover:opacity-90 font-bold"
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {need2fa ? "تأیید کد و ورود" : "ورود به پنل"}
            </Button>
          </form>

          <p className="lg:hidden text-center text-[11px] text-muted-foreground mt-3">
            {brand} — زیرساخت امن ابری
          </p>
        </div>
      </div>
    </main>
  );
}
