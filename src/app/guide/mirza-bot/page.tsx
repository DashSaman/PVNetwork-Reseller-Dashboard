import type { Metadata } from 'next';
import { PvLogo } from '@/components/panel/shared';
import { MirzaSetupGuide } from '@/components/panel/mirza-setup-guide';

export const metadata: Metadata = {
  title: 'آموزش نصب و اتصال ربات میرزا | سامانه نمایندگی',
  description: 'آموزش قدم‌به‌قدم ساخت ربات تلگرام، نصب میرزا روی سرور جدا، اتصال به پنل نمایندگی و ساخت اولین اشتراک آزمایشی.',
};

export default function MirzaGuidePage() {
  return <main className="min-h-screen bg-background text-foreground" dir="rtl">
    <div className="mx-auto max-w-3xl space-y-7 px-4 py-8 sm:py-12">
      <header className="flex items-start gap-3">
        <PvLogo size={44} />
        <div className="min-w-0"><h1 className="text-xl font-extrabold">آموزش نصب و اتصال ربات میرزا</h1><p className="mt-2 text-xs leading-6 text-muted-foreground">از ساخت ربات در تلگرام تا اولین اشتراک آزمایشی. مراحل اتصال با میرزا ۰٫۸٫۱ بررسی شده‌اند.</p></div>
      </header>
      <MirzaSetupGuide />
      <footer className="border-t border-border pt-5 text-center text-xs leading-7 text-muted-foreground">همین آموزش در تنظیمات حساب ← اتصال فروش به میرزا هم در دسترس است.<div><a href="/" className="font-bold text-[var(--brand-deep)] underline underline-offset-4">بازگشت به پنل نمایندگی</a></div></footer>
    </div>
  </main>;
}
