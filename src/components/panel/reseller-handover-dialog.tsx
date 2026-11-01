"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, faNum, gbLabel, Spinner } from "./shared";
import { toast } from "@/hooks/use-toast";
import type { ResellerInfo } from "./types";

type Preview = {
  reseller: { users: { id: string; email: string; name: string | null; trafficGB: number }[] };
  handover: { token: string; activeOperations: number; userCount: number };
};

export function ResellerHandoverDialog({ reseller, onClose, onChanged }: {
  reseller: ResellerInfo; onClose: () => void; onChanged: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError(""); setConfirmation(""); setPreview(null);
    const r = await api<Preview>(`/api/admin/resellers/${reseller.id}`);
    setLoading(false);
    if (r.ok && r.data) setPreview(r.data);
    else setError(r.error || "فهرست کاربران دریافت نشد");
  }, [reseller.id]);
  useEffect(() => { void load(); }, [load]);

  async function confirm() {
    if (!preview || confirmation !== reseller.username || busy) return;
    setBusy(true); setError("");
    const r = await api(`/api/admin/resellers/${reseller.id}/handover`, {
      method: "POST", body: JSON.stringify({ token: preview.handover.token, confirmUsername: confirmation }),
    });
    setBusy(false);
    if (r.ok) {
      toast({ title: "انتقال انجام شد", description: "نماینده از فهرست حذف شد؛ کاربرانش در بخش کاربران ادمین باقی می‌مانند." });
      onChanged(); onClose();
    } else setError(r.error || "انتقال انجام نشد؛ فهرست را بازخوانی کنید");
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto" dir="rtl">
      <DialogHeader>
        <DialogTitle>حذف نماینده {reseller.username}</DialogTitle>
        <DialogDescription>
          کاربران زیر به مدیریت ادمین منتقل می‌شوند و با همان لینک، حجم و زمان فعلی ادامه می‌دهند.
          دسترسی نماینده قطع و نام او از فهرست نماینده‌ها حذف می‌شود؛ سابقهٔ مصرف حفظ می‌شود.
        </DialogDescription>
      </DialogHeader>
      {loading ? <div className="flex justify-center p-6"><Spinner /></div> : preview && <>
        <div className="text-sm font-bold">{faNum(preview.handover.userCount)} کاربر برای انتقال</div>
        <ScrollArea className="max-h-56 rounded-lg border">
          <div className="divide-y">{preview.reseller.users.map(user => <div key={user.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <div className="min-w-0"><div className="font-bold break-words">{user.name || user.email}</div><div className="text-xs text-muted-foreground break-all" dir="ltr">{user.email}</div></div>
            <span className="shrink-0 text-muted-foreground">{user.trafficGB > 0 ? gbLabel(user.trafficGB) : "نامحدود"}</span>
          </div>)}{!preview.reseller.users.length && <p className="p-3 text-sm text-muted-foreground">این نماینده کاربری ندارد؛ سابقهٔ او نگه داشته می‌شود.</p>}</div>
        </ScrollArea>
        {!!preview.handover.activeOperations && <p className="text-sm text-amber-600" role="status">{faNum(preview.handover.activeOperations)} عملیات ناتمام وجود دارد؛ انتقال تا تعیین تکلیف آن‌ها مجاز نیست.</p>}
        <div className="space-y-2">
          <Label htmlFor="handover-confirm">نام کاربری نماینده برای تأیید</Label>
          <Input id="handover-confirm" value={confirmation} onChange={e => setConfirmation(e.target.value)} dir="ltr" autoComplete="off" disabled={busy} placeholder={reseller.username} />
        </div>
      </>}
      {error && <div className="text-sm text-destructive space-y-2" role="alert"><p>{error}</p><Button variant="outline" disabled={busy || loading} onClick={() => void load()}>بازخوانی فهرست</Button></div>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>انصراف</Button>
        <Button variant="destructive" disabled={busy || loading || !preview || !!preview.handover.activeOperations || confirmation !== reseller.username || !!error} onClick={() => void confirm()}>
          {busy && <Spinner className="h-4 w-4" />} انتقال کاربران و حذف نماینده
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
