"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, expiryLabel, faNum, gbLabel, Spinner, StatusBadge } from "./shared";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type UserRow = {
  id: string; email: string; name: string | null; ownerId: string; ownerName: string;
  sourceUsername: string; adminManaged: boolean; trafficGB: number; subLink: string;
  usedGB: number | null; expiryTime: number | null; enable: boolean | null;
};
type Result = { users: UserRow[]; pending: boolean; stale: boolean };

export function AdminUsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [page, setPage] = useState(0);
  const reload = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false, running = false;
    async function load(live: boolean) {
      if (running) return;
      running = true;
      try {
        const r = await api<Result>(`/api/admin/users${live ? "?live=1" : ""}`, { signal: AbortSignal.timeout(15000) });
        if (disposed) return;
        if (!r.ok || !r.data) { setError(r.error || "اطلاعات دریافت نشد"); return; }
        const next = r.data.users;
        setUsers(previous => {
          const cache = new Map(previous.map(u => [u.id, u]));
          return next.map(u => ({ ...u, usedGB: u.usedGB ?? cache.get(u.id)?.usedGB ?? null,
            expiryTime: u.expiryTime ?? cache.get(u.id)?.expiryTime ?? null,
            enable: u.enable ?? cache.get(u.id)?.enable ?? null }));
        });
        setError(r.data.pending || r.data.stale ? "آمار زنده در حال به‌روزرسانی است؛ آخرین مقدار دریافت‌شده نمایش داده می‌شود." : "");
      } finally { running = false; if (!disposed) setLoading(false); }
    }
    reload.current = () => { void load(true); };
    void load(false).then(() => { if (!disposed) void load(true); });
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 15000);
    return () => { disposed = true; clearInterval(timer); reload.current = () => {}; };
  }, []);

  const owners = useMemo(() => [...new Map(users.filter(u => !u.adminManaged).map(u => [u.ownerId, u.ownerName])).entries()], [users]);
  const filtered = users.filter(u => (!owner || (owner === "admin" ? u.adminManaged : !u.adminManaged && u.ownerId === owner))
    && `${u.name || ""} ${u.email} ${u.ownerName} ${u.sourceUsername}`.toLowerCase().includes(query.trim().toLowerCase()));
  const lastPage = Math.max(0, Math.ceil(filtered.length / 15) - 1), currentPage = Math.min(page, lastPage);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-bold">همهٔ کاربران</h2><p className="text-xs text-muted-foreground">{faNum(users.length)} کاربر · {faNum(users.filter(u => u.adminManaged).length)} کاربر تحت مدیریت ادمین</p></div>
      <div className="flex flex-wrap gap-2">
        <Input aria-label="جستجوی کاربران" placeholder="جستجوی نام یا کاربر..." className="w-48" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
        <select aria-label="فیلتر مالک کاربران" className="h-9 rounded-md border bg-background px-2 text-sm" value={owner} onChange={e => { setOwner(e.target.value); setPage(0); }}>
          <option value="">همهٔ مالک‌ها</option><option value="admin">تحت مدیریت ادمین</option>
          {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <Button variant="outline" size="icon" aria-label="به‌روزرسانی کاربران" onClick={() => reload.current()}><RefreshCw className="h-4 w-4" /></Button>
      </div>
    </div>
    {error && <p className="text-sm text-muted-foreground" role="status">{error}</p>}
    {loading ? <div className="flex justify-center p-10"><Spinner /></div> : <div className="rounded-xl border overflow-hidden">
      <Table><TableHeader><TableRow><TableHead>کاربر</TableHead><TableHead>مدیریت</TableHead><TableHead>مصرف / سهمیه</TableHead><TableHead>انقضا</TableHead><TableHead>وضعیت</TableHead><TableHead>اشتراک</TableHead></TableRow></TableHeader>
        <TableBody>{filtered.slice(currentPage * 15, currentPage * 15 + 15).map(u => <TableRow key={u.id}>
          <TableCell><div className="font-bold">{u.name || u.email}</div><div className="text-xs text-muted-foreground" dir="ltr">{u.email}</div></TableCell>
          <TableCell>{u.adminManaged ? <div className="space-y-1"><Badge variant="outline">تحت مدیریت ادمین</Badge><div className="text-xs text-muted-foreground">از {u.sourceUsername}</div></div> : u.ownerName}</TableCell>
          <TableCell className="whitespace-nowrap">{u.usedGB === null ? "در حال دریافت" : gbLabel(u.usedGB)} / {u.trafficGB > 0 ? gbLabel(u.trafficGB) : "نامحدود"}</TableCell>
          <TableCell className="whitespace-nowrap">{u.expiryTime !== null && u.expiryTime < 0 ? "پس از اولین اتصال" : expiryLabel(u.expiryTime).text}</TableCell>
          <TableCell><StatusBadge active={u.enable} /></TableCell>
          <TableCell><Button variant="ghost" size="icon" disabled={!u.subLink} aria-label={`کپی اشتراک ${u.email}`} onClick={async () => {
            try { await navigator.clipboard.writeText(u.subLink); toast({ title: "لینک اشتراک کپی شد" }); }
            catch { toast({ title: "کپی انجام نشد", variant: "destructive" }); }
          }}><Copy className="h-4 w-4" /></Button></TableCell>
        </TableRow>)}{!filtered.length && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">کاربری پیدا نشد.</TableCell></TableRow>}</TableBody>
      </Table>
      <div className="flex justify-between items-center gap-2 border-t p-3 text-xs text-muted-foreground"><span>{faNum(filtered.length)} کاربر · صفحهٔ {faNum(currentPage + 1)} از {faNum(lastPage + 1)}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>قبلی</Button><Button size="sm" variant="outline" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>بعدی</Button></div></div>
    </div>}
  </div>;
}
