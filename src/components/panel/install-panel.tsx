'use client';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export function InstallPanel() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  useEffect(() => {
    if (window.location.pathname !== '/') return;
    if ('serviceWorker' in navigator && window.isSecureContext) void navigator.serviceWorker.register('/panel-sw.js', { scope: '/' }).catch(() => undefined);
    const ready = (e: Event) => { e.preventDefault(); setPrompt(e as InstallEvent); };
    const installed = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', ready);window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('beforeinstallprompt', ready);window.removeEventListener('appinstalled', installed); };
  }, []);
  if (!prompt) return null;
  return <button className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-xl border bg-card p-3 text-sm shadow-lg" onClick={async () => { await prompt.prompt(); await prompt.userChoice; setPrompt(null); }}><Download className="h-4 w-4" />نصب پنل</button>;
}
