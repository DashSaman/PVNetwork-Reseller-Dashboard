"use client";

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from './shared';

const membersEndpoint = '/api/reseller/support-members';
const contactEndpoint = '/api/reseller/support-contact';

export function ResellerSupport() {
  const [members, setMembers] = useState<string[]>([]);
  const [contact, setContact] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const loadMembers = useCallback(async () => {
    const r = await api<{ members: string[] }>(membersEndpoint);
    if (r.ok && r.data) setMembers(r.data.members);
    else setNotice(r.error || 'فهرست حساب‌های پشتیبانی دریافت نشد');
  }, []);
  useEffect(() => {
    void loadMembers();
    void api<{ username: string }>(contactEndpoint).then(r => {
      if (r.ok && r.data) { setContact(r.data.username); setReady(true); }
      else setNotice(r.error || 'پشتیبانی دریافت نشد');
    });
  }, [loadMembers]);

  async function saveContact() {
    setBusy(true);
    const r = await api<{ username: string }>(contactEndpoint, { method: 'PUT', body: JSON.stringify({ username: contact }) });
    if (r.ok && r.data) setContact(r.data.username);
    setNotice(r.ok ? 'آیدی پشتیبانی ذخیره شد' : r.error || 'ذخیره انجام نشد');
    setBusy(false);
  }

  async function createMember() {
    setBusy(true);
    const r = await api(membersEndpoint, { method: 'POST', body: JSON.stringify({ username: name, password }) });
    if (r.ok) { setName(''); setPassword(''); await loadMembers(); }
    setNotice(r.ok ? 'حساب همکار ساخته شد' : r.error || 'ساخت حساب انجام نشد');
    setBusy(false);
  }

  async function removeMember(username: string) {
    if (!window.confirm('دسترسی این همکار لغو شود؟')) return;
    setBusy(true);
    const r = await api(membersEndpoint + '?username=' + encodeURIComponent(username), { method: 'DELETE' });
    if (r.ok) await loadMembers();
    setNotice(r.ok ? 'دسترسی همکار لغو شد' : r.error || 'لغو دسترسی انجام نشد');
    setBusy(false);
  }

  return <div className="space-y-4">
    <form className="space-y-3 rounded-lg border bg-card p-4" onSubmit={e => { e.preventDefault(); void saveContact(); }}>
      <h2 className="font-bold">پشتیبانی مشتریان</h2>
      <label className="block text-sm">آیدی تلگرام در صفحهٔ مشتری<Input className="max-w-sm mt-1" dir="ltr" maxLength={33} value={contact} onChange={e => setContact(e.target.value)} disabled={!ready || busy} /></label>
      <Button disabled={!ready || busy}>ذخیرهٔ آیدی</Button>
    </form>
    <form className="space-y-3 rounded-lg border bg-card p-4" onSubmit={e => { e.preventDefault(); void createMember(); }}>
      <h2 className="font-bold">همکاران پشتیبانی</h2>
      <p className="text-sm text-muted-foreground">همکاران با نام کاربری کامل نمایش‌داده‌شده وارد می‌شوند و فقط فهرست و وضعیت کاربران این نمایندگی را می‌بینند.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">نام ورود<Input dir="ltr" required maxLength={32} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="text-sm">رمز عبور همکار<Input dir="ltr" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      </div>
      <Button disabled={busy}>افزودن همکار</Button>
      <ul className="space-y-2">
        {members.map(username => <li key={username} className="flex items-center justify-between rounded-md border p-2"><bdi>{username}</bdi><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void removeMember(username)}>لغو دسترسی</Button></li>)}
      </ul>
    </form>
    {notice && <p className="text-sm" role="status">{notice}</p>}
  </div>;
}
