"use client";

import { useEffect, useState } from "react";
import { Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { api, Spinner } from "./shared";

const endpoint = "/api/admin/support-contact";

export function SupportContactSettings() {
  const [username, setUsername] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api<{ username: string }>(endpoint).then((response) => {
      if (response.ok && response.data) setUsername(response.data.username);
      else toast({ title: "دریافت تنظیمات پشتیبانی ناموفق بود", description: response.error, variant: "destructive" });
    });
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (username === null || saving) return;
    setSaving(true);
    const response = await api<{ username: string }>(endpoint, {
      method: "PUT",
      body: JSON.stringify({ username }),
    });
    if (response.ok && response.data) {
      setUsername(response.data.username);
      toast({ title: "تنظیمات پشتیبانی ذخیره شد" });
    } else {
      toast({ title: "ذخیره انجام نشد", description: response.error, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Card className="bg-card card-soft">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-4 w-4 text-[var(--brand)]" />
          پشتیبانی نماینده‌ها
        </CardTitle>
        <CardDescription>این آیدی مقصد دکمهٔ «پیام به پشتیبانی» برای نماینده‌های غیرفعال است.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5 flex-1">
            <Label htmlFor="support-telegram-username">آیدی تلگرام پشتیبانی</Label>
            <Input
              id="support-telegram-username"
              dir="ltr"
              className="latin-input"
              value={username ?? ""}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="@your_support"
              disabled={username === null || saving}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" disabled={username === null || saving} className="brand-gradient text-white hover:opacity-90 font-bold">
            {saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            ذخیره آیدی پشتیبانی
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">برای برداشتن دکمه، این فیلد را خالی و ذخیره کنید.</p>
      </CardContent>
    </Card>
  );
}
