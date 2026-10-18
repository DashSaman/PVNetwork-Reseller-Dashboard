"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SESSION_RECHECK_EVENT } from "@/lib/browser-api";
import dynamic from "next/dynamic";
import { LoginView } from "@/components/panel/login-view";
import { api, PvLogo, Spinner } from "@/components/panel/shared";
import type { Session } from "@/components/panel/types";

// داشبوردها (نمودارها و کتابخانه‌های سنگین) جدا از صفحه ورود لود می‌شوند — کاهش چشمگیر لود اول
const AdminView = dynamic(
  () => import("@/components/panel/admin-view").then((m) => ({ default: m.AdminView })),
  { loading: () => <ViewSpinner /> }
);
const ResellerView = dynamic(
  () => import("@/components/panel/reseller-view").then((m) => ({ default: m.ResellerView })),
  { loading: () => <ViewSpinner /> }
);

function ViewSpinner() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <PvLogo size={48} className="animate-pulse" />
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--brand)] border-t-transparent" />
    </main>
  );
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const inFlight = useRef(false);
  const sessionVersion = useRef(0);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const version = sessionVersion.current;
    const r = await api<{ user: Session | null }>("/api/auth/me", { cache: "no-store" });
    if (version === sessionVersion.current && r.ok && r.data) setSession(r.data.user);
    inFlight.current = false;
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener(SESSION_RECHECK_EVENT, check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener(SESSION_RECHECK_EVENT, check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [check]);

  const changeSession = (next: Session | null) => {
    sessionVersion.current++;
    setSession(next);
  };

  if (checking) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <PvLogo size={56} className="animate-pulse" />
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--brand)] border-t-transparent" />
        <p className="text-sm">در حال بررسی نشست...</p>
      </main>
    );
  }

  if (!session) {
    return <LoginView onLogin={changeSession} />;
  }

  if (session.role === "ADMIN") {
    return <AdminView key={session.uid} session={session} onLogout={() => changeSession(null)} />;
  }
  return <ResellerView key={session.uid} session={session} onLogout={() => changeSession(null)} />;
}
