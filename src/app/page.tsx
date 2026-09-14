"use client";

import { useCallback, useEffect, useState } from "react";
import { LoginView } from "@/components/panel/login-view";
import { AdminView } from "@/components/panel/admin-view";
import { ResellerView } from "@/components/panel/reseller-view";
import { api, PvLogo } from "@/components/panel/shared";
import type { Session } from "@/components/panel/types";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    const r = await api<{ user: Session | null }>("/api/auth/me");
    setSession(r.ok && r.data ? r.data.user : null);
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

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
    return <LoginView onLogin={(s) => setSession(s)} />;
  }

  if (session.role === "ADMIN") {
    return <AdminView session={session} onLogout={() => setSession(null)} />;
  }
  return <ResellerView session={session} onLogout={() => setSession(null)} />;
}
