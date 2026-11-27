"use client";

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, expiryLabel, PvLogo, StatusBadge } from './shared';
import type { Session } from './types';

type Customers = { users: { email: string; name: string | null; enabled: boolean | null; expiry: number | null }[]; more: boolean; pending?: boolean };

export function SupportView({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<Customers | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const refreshUntil = Date.now() + 65000;
    const load = async () => {
      const response = await api<Customers>('/api/support/customers?page=' + page, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      if (cancelled) return;
      if (response.ok && response.data) {
        setResult(response.data);
        setNotice('');
        if (response.data.pending && Date.now() < refreshUntil) timer = setTimeout(() => void load(), 2500);
      } else setNotice(response.error || 'دریافت کاربران ناموفق بود');
    };
    void load();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [page, refresh]);
  return <main className="mx-auto max-w-4xl p-4 space-y-4" dir="rtl">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div className="flex items-center gap-3"><PvLogo size={36} /><div><h1 className="font-bold">پشتیبانی نماینده</h1><bdi className="text-xs text-muted-foreground">{session.username}</bdi></div></div>
      <Button variant="outline" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); onLogout(); }}>خروج</Button>
    </header>
    <div className="flex items-center justify-between gap-2"><h2 className="font-bold">کاربران نماینده</h2><Button variant="outline" onClick={() => setRefresh(n => n + 1)}>به‌روزرسانی</Button></div>
    {notice ? <p role="alert" className="tone-danger">{notice}</p> : !result && <p role="status">در حال دریافت…</p>}
    {result?.users.length === 0 && <p className="text-muted-foreground">کاربری ثبت نشده است.</p>}
    {result?.users.map(user => <article key={user.email} className="flex flex-wrap justify-between items-center rounded-lg border bg-card p-3 gap-2">
      <div><strong>{user.name || user.email}</strong><div><bdi className="text-xs text-muted-foreground">{user.email}</bdi></div></div>
      <div className="flex items-center gap-3"><StatusBadge active={user.enabled} /><span className="text-sm">{expiryLabel(user.expiry).text}</span></div>
    </article>)}
    <div className="flex gap-2">
      <Button variant="outline" disabled={!page} onClick={() => { setResult(null); setPage(page - 1); }}>قبلی</Button>
      <Button variant="outline" disabled={!result?.more} onClick={() => { setResult(null); setPage(page + 1); }}>بعدی</Button>
    </div>
  </main>;
}
