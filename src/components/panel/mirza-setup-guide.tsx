'use client';

import { useId, useState, type ReactNode } from 'react';
import { ArrowDown, Check, ChevronLeft, ChevronRight, Copy, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';

const number = (n: number) => String(n).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
const samplePanel = 'https://npanel.softarg.ir/api/bridge/YOUR_USERNAME';
const sampleSub = 'https://npanel.softarg.ir/api/s/EXAMPLE_SUB_ID';
const sampleUser = 'demo_user';
type Tone = 'address' | 'token' | 'subscription';
const tones: Record<Tone, string> = {
  address: 'border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  token: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  subscription: 'border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300',
};
function Picture({ title, label, children }: { title: string; label: string; children: ReactNode }) {
  return <figure className="min-w-0 overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
    <div role="img" aria-label={label}>
      <div aria-hidden="true" className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-4 py-2.5 text-xs"><span className="font-bold">{title}</span><span className="text-[10px] text-muted-foreground">تصویر آموزشی</span></div>
      <div aria-hidden="true" className="space-y-3 p-4 sm:p-5">{children}</div>
    </div>
    <figcaption className="border-t border-border px-4 py-2 text-[10px] leading-5 text-muted-foreground">اطلاعات تصویر نمونه است؛ دکمه‌ها را در پنل یا ربات واقعی خودت بزن.</figcaption>
  </figure>;
}
function PaintedButton({ children, marked = false }: { children: ReactNode; marked?: boolean }) {
  return <span className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${marked ? 'border-orange-500 bg-orange-500/15 ring-2 ring-orange-400/40' : 'border-border bg-muted/50'}`}>{children}</span>;
}
function Point({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 text-xs font-bold text-orange-700 dark:text-orange-300"><ArrowDown className="h-5 w-5 shrink-0" />{children}</div>;
}
function Field({ title, value, tone = 'address' }: { title: string; value: string; tone?: Tone }) {
  return <div className={`min-w-0 rounded-xl border-2 p-3 ${tones[tone]}`}><div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-bold"><span>{title}</span><Copy className="h-4 w-4 shrink-0" /></div><div className="break-all text-xs leading-6 [overflow-wrap:anywhere]" dir="ltr">{value}</div></div>;
}
function Chat({ ask, answer, tone = 'address' }: { ask: string; answer: string; tone?: Tone }) {
  return <div className="space-y-2 text-xs leading-6"><div className="me-5 rounded-xl rounded-ss-sm border border-border bg-muted/50 p-2.5">میرزا: {ask}</div><div className={`ms-5 rounded-xl rounded-se-sm border p-2.5 break-all [overflow-wrap:anywhere] ${tones[tone]}`} dir="ltr">{answer}</div></div>;
}

const steps: { title: string; place: string; action: ReactNode; expected: string }[] = [
  { title: 'تنظیمات حساب را باز کن', place: 'پنل نمایندگی', action: <>وارد حساب نمایندگی خودت شو. بالای صفحه روی <b>«تنظیمات حساب»</b> بزن و کارت <b>«اتصال فروش به میرزا»</b> را پیدا کن.</>, expected: 'کارت اتصال فروش به میرزا را می‌بینی.' },
  { title: 'اتصال را روشن و ذخیره کن', place: 'پنل نمایندگی', action: <>سوییچ کارت را روشن کن. سپس پایین همان کارت روی <b>«ذخیره و اتصال ربات»</b> بزن. برای فروش لازم نیست بخش اعلان‌های تلگرام را پر کنی.</>, expected: 'برچسب «فعال» و دکمهٔ ساخت توکن API دیده می‌شوند.' },
  { title: 'توکن مخصوص فروش را بساز و کپی کن', place: 'پنل نمایندگی', action: <>روی <b>«ساخت توکن API»</b> و بعد علامت <b>کپی کنار توکن</b> بزن. توکن فقط همین بار قابل کپی است. آن را در جای امن نگه دار؛ این مقدار با توکن تلگرام و رمز ورود پنل فرق دارد.</>, expected: 'توکن فروش را برای فرستادن به میرزا آماده داری.' },
  { title: 'در مدیریت ربات میرزا، پنل اضافه کن', place: 'ربات میرزا در تلگرام', action: <>با حساب مدیر وارد ربات میرزا شو. <b>«🖥 اضافه کردن پنل»</b> و سپس <b dir="ltr">3x-ui</b> را بزن. یک نام دلخواه، مثلاً <b>«فروش من»</b> بفرست. اگر اتصال را قبلاً ساخته‌ای، از <b>«✏️ مدیریت پنل»</b> همان اتصال را ویرایش کن.</>, expected: 'میرزا آدرس پنل و سپس توکن را از تو می‌خواهد.' },
  { title: 'آدرس پنل و توکن را به میرزا بده', place: 'از پنل نمایندگی به میرزا', action: <>در کارت اتصال نمایندگی، <b>«آدرس پنل (Panel URL)»</b> را کپی و برای میرزا بفرست؛ آدرس باید مسیر مخصوص نام کاربری خودت را داشته باشد. وقتی گفت <b>«توکن را ارسال نمایید»</b>، همان <b>توکن API فروش مرحلهٔ ۳</b> را بفرست. نوع اتصال در میرزا <b dir="ltr">x-ui_single</b> است.</>, expected: 'پنل در فهرست مدیریت میرزا اضافه می‌شود. این نسخه نام کاربری و رمز ورود داشبورد را جداگانه نمی‌خواهد.' },
  { title: 'یک کاربر نمونه از پنل خودت بردار', place: 'پنل نمایندگی ← کاربران من', action: <>کاربر نمونه باید فقط لوکیشن‌های آنلاین و مجازی را داشته باشد که می‌خواهی بفروشی. از یک کاربر موجودِ خودت با همین شرایط استفاده کن؛ وگرنه یک کاربر آزمایشی با حداقل <b>۱ گیگ</b> بساز. حجم کاربر آزمایشی از موجودی تو تخصیص می‌یابد. سپس <b>نام کاربری ریزِ زیر نام</b> و <b>لینک کامل ساب</b> او را کپی کن؛ کاربر قدیمی با لوکیشن آفلاین را نمونه نگذار.</>, expected: 'دو مقدار جدا داری: نام کاربری داخلی و لینک کامل ساب همان کاربر.' },
  { title: 'لوکیشن‌های فروش را از کاربر نمونه بگیر', place: 'میرزا ← مدیریت پنل ← اتصال خودت', action: <>گزینهٔ <b>«⚙️ تنظیم پروتکل و اینباند»</b> را بزن. وقتی نام کاربری کانفیگ خواست، <b>نام کاربری داخلی کاربر نمونه</b> را بفرست؛ مثلاً <b dir="ltr">demo_user</b>. میرزا لوکیشن‌های همان کاربر را برای فروش می‌گیرد. این مرحله تنظیم پروتکل یا روتینگ سرور را تغییر نمی‌دهد.</>, expected: 'میرزا پیام ذخیره‌شدن اینباندها را نشان می‌دهد.' },
  { title: 'لینک کامل سابِ نمونه را بفرست', place: 'میرزا ← مدیریت پنل ← اتصال خودت', action: <>روی <b>«🔗 دامنه لینک ساب»</b> بزن و <b>لینک کامل ساب کاربر نمونه</b> را از پنل کپی و ارسال کن. لینک باید بعد از <b dir="ltr">/api/s/</b> شناسهٔ کاربر داشته باشد. میرزا لینک را بررسی می‌کند و خودش آدرس پایه را نگه می‌دارد؛ فقط آدرس پایه را به این پیام نفرست.</>, expected: 'میرزا لینک را قبول می‌کند و پایهٔ ساب را ذخیره می‌کند.' },
  { title: 'حجم بسته و اکانت تست را درست وارد کن', place: 'مدیریت محصولات و تست در میرزا', action: <>حجم بسته‌ها باید گیگ کامل باشد؛ مثل <b>۱، ۱۰ یا ۲۰ گیگ</b>. برای اکانت تست، اگر میرزا حجم را <b>مگابایت</b> می‌خواهد، <b>۱۰۲۴</b> بفرست تا ۱ گیگ شود. قیمت و مدت بسته را خودت تعیین کن. بستهٔ ۱۰۰ مگابایتی یا نیم‌گیگ با این اتصال قابل ساخت نیست.</>, expected: 'مثلاً بستهٔ ۱۰ گیگ با مدت ۳۰ روز و اکانت تست ۱۰۲۴ مگابایتی تعریف شده است.' },
  { title: 'نتیجهٔ اتصال را بررسی کن', place: 'پنل نمایندگی و میرزا', action: <>در کارت اتصال نمایندگی <b>«بررسی لوکیشن‌های قابل فروش»</b> را بزن؛ باید فهرست لوکیشن‌های آنلاین خودت را ببینی. در میرزا هم وضعیت همان پنل و لینک ساب را بررسی کن. پس از فروش، کاربر باید در <b>«کاربران من»</b> ظاهر شود و سابش کانفیگ داشته باشد. تست فروش واقعی از موجودی تو استفاده می‌کند.</>, expected: 'میرزا پنل را می‌خواند و لینک ساب کاربر، کانفیگ‌های لوکیشن‌های انتخاب‌شده را دارد.' },
];

function Illustration({ step }: { step: number }) {
  switch (step) {
    case 0: return <Picture title="پنل نمایندگی" label="تصویر مرحله ۱: محل دکمه تنظیمات حساب و کارت اتصال میرزا"><div className="grid grid-cols-2 gap-2"><PaintedButton>کاربران من</PaintedButton><PaintedButton marked>تنظیمات حساب</PaintedButton></div><Point>این کارت را پیدا کن</Point><div className="rounded-xl border-2 border-orange-400 bg-muted/30 p-4 text-sm font-bold">اتصال فروش به میرزا</div></Picture>;
    case 1: return <Picture title="اتصال فروش به میرزا" label="تصویر مرحله ۲: سوییچ روشن و دکمه ذخیره و اتصال ربات"><div className="flex items-center justify-between gap-3"><b className="text-xs">اتصال فروش به میرزا</b><span className="flex h-6 w-11 items-center justify-end rounded-full bg-emerald-500 p-1 ring-2 ring-orange-400"><span className="h-4 w-4 rounded-full bg-white" /></span></div><Point>روشن کن، سپس ذخیره کن</Point><PaintedButton marked>ذخیره و اتصال ربات</PaintedButton><div className="text-xs text-muted-foreground">توکن تلگرام اعلان‌ها: اختیاری</div></Picture>;
    case 2: return <Picture title="ساخت کلید فروش" label="تصویر مرحله ۳: ساخت توکن API و علامت کپی کنار آن"><PaintedButton marked>ساخت توکن API</PaintedButton><Point>بعد از ساخت، این علامت کپی را بزن</Point><Field tone="token" title="توکن API اتصال فروش" value="pvnet_bridge_••••••••••••••••" /><div className="text-xs font-bold text-orange-700 dark:text-orange-300">توکن واقعی فقط هنگام ساخت قابل کپی است.</div></Picture>;
    case 3: return <Picture title="مدیریت ربات میرزا" label="تصویر مرحله ۴: اضافه کردن پنل، انتخاب 3x-ui و نام دلخواه"><div className="grid grid-cols-2 gap-2"><PaintedButton>✏️ مدیریت پنل</PaintedButton><PaintedButton marked>🖥 اضافه کردن پنل</PaintedButton></div><Point>نوع پنل را انتخاب کن</Point><PaintedButton marked><span dir="ltr">3x-ui</span></PaintedButton><Chat ask="نام پنل را بفرست" answer="فروش من" /></Picture>;
    case 4: return <Picture title="پیام‌های میرزا هنگام افزودن پنل" label="تصویر مرحله ۵: آدرس پنل در پاسخ آدرس و توکن فروش در پاسخ توکن"><Chat ask="آدرس پنل را بفرست" answer={samplePanel} /><Point>توکن فروش را در پاسخ بعدی بفرست</Point><Chat ask="توکن را ارسال نمایید" answer="pvnet_bridge_••••••••••••••••" tone="token" /><div className="text-[11px] text-muted-foreground">YOUR_USERNAME فقط نمونه است؛ آدرس حساب خودت را کپی کن.</div></Picture>;
    case 5: return <Picture title="کاربران من در پنل نمایندگی" label="تصویر مرحله ۶: نام کاربری زیر عنوان و لینک کامل ساب همان کاربر"><div className="rounded-xl border border-border p-3"><b className="text-sm">کاربر نمونه</b><div className="mt-2 rounded-lg border-2 border-orange-400 p-2 text-xs" dir="ltr">{sampleUser}</div><div className="mt-2 flex flex-wrap gap-2"><PaintedButton>لوکیشن ۱ ✓</PaintedButton><PaintedButton>لوکیشن ۲ ✓</PaintedButton></div></div><Field tone="subscription" title="لینک کامل ساب همین کاربر" value={sampleSub} /></Picture>;
    case 6: return <Picture title="میرزا ← مدیریت پنل ← فروش من" label="تصویر مرحله ۷: گزینه تنظیم پروتکل و اینباند و ارسال نام کاربری نمونه"><PaintedButton marked>⚙️ تنظیم پروتکل و اینباند</PaintedButton><Point>نام کاربری زیر نام کاربر را بفرست</Point><Chat ask="نام کاربری کانفیگ نمونه را بفرست" answer={sampleUser} /><div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300"><Check className="h-4 w-4" />اینباندها ذخیره شدند</div></Picture>;
    case 7: return <Picture title="میرزا ← مدیریت پنل ← فروش من" label="تصویر مرحله ۸: ارسال لینک کامل دارای شناسه و ذخیره خودکار پایه ساب"><PaintedButton marked>🔗 دامنه لینک ساب</PaintedButton><Chat ask="یک لینک ساب کاربر را بفرست" answer={sampleSub} tone="subscription" /><Point>میرزا خودش قسمت آخر را جدا می‌کند</Point><Field tone="subscription" title="پایه‌ای که ذخیره می‌شود" value="https://npanel.softarg.ir/api/s" /></Picture>;
    case 8: return <Picture title="نمونهٔ بسته و اکانت تست" label="تصویر مرحله ۹: بسته ۱۰ گیگ و اکانت تست ۱۰۲۴ مگابایت برابر یک گیگ"><div className="grid grid-cols-2 gap-2"><Field title="حجم بسته: گیگابایت" value="10 GB" /><Field title="مدت بسته" value="30 روز" /></div><Point>اگر واحد تست مگابایت است، ۱۰۲۴ بفرست</Point><Field tone="token" title="حجم اکانت تست: مگابایت" value="1024 MB = 1 GB" /><div className="text-xs text-muted-foreground">حداقل حجم این اتصال: ۱ گیگ کامل</div></Picture>;
    default: return <Picture title="نمونهٔ نتیجهٔ صحیح" label="تصویر مرحله ۱۰: فهرست لوکیشن‌های قابل فروش و ساب دارای کانفیگ"><PaintedButton marked>بررسی لوکیشن‌های قابل فروش</PaintedButton><div className="grid grid-cols-2 gap-2 text-xs"><span className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-3">✓ لوکیشن ۱</span><span className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-3">✓ لوکیشن ۲</span></div><div className="rounded-xl border border-violet-500/60 bg-violet-500/10 p-3 text-xs">لینک ساب در برنامه باز می‌شود و فهرست کانفیگ‌ها را نشان می‌دهد.</div></Picture>;
  }
}

export function MirzaSetupGuide() {
  const [step, setStep] = useState(0);
  const titleId = useId();
  const current = steps[step];
  return <section data-testid="mirza-setup-guide" className="min-w-0 space-y-5 text-foreground" dir="rtl" aria-label="آموزش تصویری اتصال میرزا">
    <div className="rounded-2xl border border-[var(--brand)]/30 bg-[var(--brand-soft)] p-4 text-xs leading-6"><div className="mb-1 flex items-center gap-2 text-sm font-bold"><BookOpen className="h-4 w-4" />از مرحلهٔ ۱ شروع کن؛ هر بار فقط یک کار</div>برای تنظیم میرزا باید مدیر ربات خودت باشی. تصاویر نمونه‌اند؛ آدرس و توکن حساب خودت را از پنل نمایندگی کپی کن. این آموزش هیچ تنظیمی را خودکار تغییر نمی‌دهد.</div>
    <nav className="grid grid-cols-5 gap-2 sm:grid-cols-10" aria-label="انتخاب مرحله آموزش">
      {steps.map((item, index) => <button key={item.title} type="button" aria-label={`رفتن به مرحله ${number(index + 1)}`} aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)} className={`min-h-10 rounded-xl border text-sm font-bold transition-colors ${step === index ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-deep)] ring-1 ring-[var(--brand)]' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}>{number(index + 1)}</button>)}
    </nav>
    <div role="region" aria-labelledby={titleId} className="space-y-4" data-testid="mirza-guide-step">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-bold text-[var(--brand-deep)]">مرحلهٔ {number(step + 1)} از {number(steps.length)}</span><span className="rounded-full border border-border bg-muted/40 px-3 py-1">کجا؟ {current.place}</span></div>
      <h3 id={titleId} className="text-base font-extrabold sm:text-lg" aria-live="polite">{current.title}</h3><p className="text-sm leading-8">{current.action}</p><Illustration step={step} />
      <div className="flex gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs leading-6"><Check className="mt-1 h-4 w-4 shrink-0 text-emerald-600" /><div><b>بعد از این مرحله باید چه ببینی؟ </b>{current.expected}</div></div>
    </div>
    <div className="flex items-center justify-between gap-2 border-t border-border pt-4"><Button type="button" variant="outline" size="sm" disabled={step === 0} onClick={() => setStep(step - 1)}><ChevronRight className="h-4 w-4" />قبلی</Button><Button type="button" size="sm" onClick={() => setStep(step === steps.length - 1 ? 0 : step + 1)}>{step === steps.length - 1 ? 'مرور از ابتدا' : 'مرحله بعد'}<ChevronLeft className="h-4 w-4" /></Button></div>
    <details className="rounded-2xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-bold">خطا دیدم؛ کدام مرحله را درست کنم؟</summary><dl className="mt-4 space-y-4 text-xs leading-7">
      <div><dt className="font-bold">توکن نامعتبر یا دسترسی غیرمجاز</dt><dd>مرحلهٔ ۳ و ۵: توکن API فروش همین نمایندگی و آدرس مخصوص همان حساب را بگذار. پس از تعویض توکن یا تغییر تنظیمات ورود، کلید جدید را در میرزا جایگزین کن.</dd></div>
      <div><dt className="font-bold">کاربر پیدا نشد / اینباندها تنظیم نشدند</dt><dd>مرحلهٔ ۶ و ۷: نام کاربری ریز زیر نام کاربرِ متعلق به خودت را بفرست؛ نام نمایشی، شمارهٔ تلگرام و عدد اینباند جای آن نیستند.</dd></div>
      <div><dt className="font-bold">لینک ساب فعال نیست یا قبول نمی‌شود</dt><dd>مرحلهٔ ۸: لینک کامل یک کاربر معتبر را بفرست؛ فقط <span dir="ltr">/api/s</span> کافی نیست. شناسهٔ کاربر باید انتهای لینک باشد.</dd></div>
      <div><dt className="font-bold">هیچ لوکیشن قابل فروشی ندارم</dt><dd>لوکیشن باید هم آنلاین و هم از طرف مدیر برایت مجاز باشد. با مدیر بررسی کن؛ شناسهٔ تصادفی وارد نکن.</dd></div>
      <div><dt className="font-bold">ساخت اکانت تست یا بسته خطا می‌دهد</dt><dd>مرحلهٔ ۹: حداقل ۱ گیگ کامل و موجودی کافی لازم است. در فیلد مگابایتِ تست، ۱۰۲۴ برابر ۱ گیگ است.</dd></div>
    </dl></details>
  </section>;
}
