import type { Metadata } from 'next';
import { PvLogo } from '@/components/panel/shared';
import { MirzaSetupGuide } from '@/components/panel/mirza-setup-guide';

export const metadata: Metadata = {
  title: 'آموزش تصویری اتصال میرزا | سامانه نمایندگی',
  description: 'آموزش تصویری و مرحله‌به‌مرحله اتصال میرزا: توکن فروش، کاربر نمونه، انتخاب لوکیشن‌ها و لینک کامل ساب.',
};

export default function MirzaGuidePage() {
  return <main className="min-h-screen bg-background text-foreground" dir="rtl">
    <div className="mx-auto max-w-3xl space-y-7 px-4 py-8 sm:py-12">
      <header className="flex items-start gap-3">
        <PvLogo size={44} />
        <div className="min-w-0"><h1 className="text-xl font-extrabold">آموزش تصویری اتصال میرزا</h1><p className="mt-2 text-xs leading-6 text-muted-foreground">۱۰ مرحلهٔ ساده؛ از روشن‌کردن اتصال تا انتخاب لوکیشن‌ها و راه‌اندازی ساب. مطابق نسخهٔ ۰٫۸٫۱ میرزا.</p></div>
      </header>
      <MirzaSetupGuide />
      <footer className="border-t border-border pt-5 text-center text-xs leading-7 text-muted-foreground">همین آموزش در تنظیمات حساب ← اتصال فروش به میرزا هم در دسترس است.<div><a href="/" className="font-bold text-[var(--brand-deep)] underline underline-offset-4">بازگشت به پنل نمایندگی</a></div></footer>
    </div>
  </main>;
}
