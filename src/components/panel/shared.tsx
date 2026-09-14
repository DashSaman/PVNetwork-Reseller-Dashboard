"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState, type ReactNode } from "react";

/** فرمت تاریخ شمسی */
export function faDate(ts: number | string | Date): string {
  try {
    const d = new Date(ts);
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return String(ts);
  }
}

/** عدد فارسی */
export function faNum(n: number | string): string {
  return Number(n || 0).toLocaleString("fa-IR");
}

/** تاریخ انقضا با برچسب وضعیت */
export function expiryLabel(expiryTime: number): { text: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (!expiryTime || expiryTime <= 0) return { text: "نامحدود", tone: "muted" };
  const days = Math.ceil((expiryTime - Date.now()) / 86400000);
  if (days < 0) return { text: `منقضی (${Math.abs(days)} روز پیش)`, tone: "danger" };
  if (days <= 3) return { text: `${days} روز مانده`, tone: "warn" };
  return { text: `${days} روز مانده`, tone: "ok" };
}

export function gbLabel(gb: number): string {
  return gb > 0 ? `${faNum(Math.round(gb * 100) / 100)} گیگ` : "نامحدود";
}

export function TrafficBar({ used, total }: { used: number; total: number }) {
  const unlimited = total <= 0;
  const pct = unlimited ? Math.min(100, used * 2) : Math.min(100, (used / total) * 100);
  const tone =
    pct >= 95
      ? "bg-[linear-gradient(90deg,#ef4444,#f87171)]"
      : pct >= 75
        ? "bg-[linear-gradient(90deg,#f59e0b,#fbbf24)]"
        : "bg-[linear-gradient(90deg,#0f9e99,#2dd4bf)]";
  return (
    <div className="min-w-32 space-y-1.5">
      <div className="text-xs text-muted-foreground" dir="ltr">
        <span className="font-semibold text-foreground">{faNum(Math.round(used * 100) / 100)}</span>
        {" / "}
        {unlimited ? "∞" : faNum(Math.round(total * 100) / 100)} GB
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${unlimited && used === 0 ? "bg-muted-foreground/40" : tone}`}
          style={{ width: `${unlimited && used === 0 ? 4 : pct}%` }}
        />
      </div>
    </div>
  );
}

export function StatCard({
  title,
  value,
  sub,
  icon,
  tone = "default",
}: {
  title: string;
  value: ReactNode;
  sub?: string;
  icon?: ReactNode;
  tone?: "default" | "brand" | "orange" | "success" | "warning" | "danger";
}) {
  const styles: Record<string, { chip: string; text: string }> = {
    default: { chip: "tone-muted", text: "text-foreground" },
    brand: { chip: "tone-brand", text: "text-[var(--brand-deep)]" },
    orange: { chip: "tone-orange", text: "text-[var(--brand-orange)]" },
    success: { chip: "tone-ok", text: "text-emerald-600 dark:text-emerald-400" },
    warning: { chip: "tone-warn", text: "text-amber-600 dark:text-amber-400" },
    danger: { chip: "tone-danger", text: "text-red-500 dark:text-red-400" },
  };
  const s = styles[tone] || styles.default;
  return (
    <Card className="bg-card card-soft border-border/70 hover:border-[var(--brand)]/40 transition-colors">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-muted-foreground font-medium">{title}</span>
          {icon && (
            <span className={`h-8 w-8 rounded-lg flex items-center justify-center ${s.chip}`}>{icon}</span>
          )}
        </div>
        <div className={`mt-2.5 text-2xl font-extrabold tracking-tight ${s.text}`}>{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge className="tone-ok hover:tone-ok" variant="outline">
      فعال
    </Badge>
  ) : (
    <Badge className="tone-danger hover:tone-danger" variant="outline">
      غیرفعال
    </Badge>
  );
}

export function ExpiryBadge({ expiryTime }: { expiryTime: number }) {
  const { text, tone } = expiryLabel(expiryTime);
  const cls =
    tone === "danger"
      ? "tone-danger"
      : tone === "warn"
        ? "tone-warn"
        : tone === "ok"
          ? "tone-ok"
          : "tone-muted";
  return (
    <Badge variant="outline" className={`${cls} hover:bg-transparent`}>
      {text}
    </Badge>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (json as { error?: string }).error || "خطای نامشخص" };
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, error: `خطای شبکه: ${(e as Error).message}` };
  }
}

/** ورودی رمز عبور با دکمه نمایش/مخفی‌سازی (علامت چشم) */
export const PasswordInput = forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function PasswordInput({ className, ...props }, ref) {
    const [show, setShow] = useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={show ? "text" : "password"}
          className={`pe-10 ${className || ""}`}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((v) => !v)}
          className="absolute inset-y-0 end-0 flex items-center justify-center w-10 text-muted-foreground hover:text-[var(--brand)] transition-colors"
          aria-label={show ? "مخفی کردن رمز" : "نمایش رمز"}
          title={show ? "مخفی کردن رمز" : "نمایش رمز"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  }
);

/** لوگوی PvNetWork — تصویر واقعی برند */
export function PvLogo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden rounded-xl bg-[#14100c] shadow-sm ring-1 ring-black/10 dark:ring-white/10 ${className}`}
      style={{ width: size, height: size }}
    >
      <img src="/logo.webp" alt="PvNetWork" width={size} height={size} className="h-full w-full object-cover" />
    </span>
  );
}
