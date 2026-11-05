import type { Metadata } from "next";
import type { ReactNode } from 'react';
import { PvLogo } from "@/components/panel/shared";

export const metadata: Metadata = {
  title: "راهنمای اتصال ربات میرزا | سامانه نمایندگی",
  description: "راهنمای اتصال ربات میرزا به پنل نمایندگی با توکن API فروش",
};

const steps: { n: string; title: string; body: ReactNode; img?: string; imgAlt?: string }[] = [
  {
    n: "۱",
    title: "سوییچ اتصال را روشن کنید",
    body: (
      <>
        وارد <b>تنظیمات حساب ← اتصال فروش به میرزا</b> شوید. سوییچ را روشن و با دکمه
        <b> «ذخیره و اتصال ربات» </b> ذخیره کنید. توکن تلگرام برای فعال‌کردن فروش لازم نیست.
      </>
    ),
  },
  {
    n: "۲",
    title: "توکن API مخصوص نمایندگی را بسازید",
    body: (
      <>
        روی <b>«ساخت توکن API»</b> بزنید و همان بار توکن را کپی کنید. آدرس پنلِ همان جعبه را هم بردارید.
        این کلید تا زمان لغو یا تغییر تنظیمات ورود معتبر است و فقط برای کاربران و لوکیشن‌های مجاز همین نمایندگی کار می‌کند.
      </>
    ),
  },
  {
    n: "۳",
    title: "در ربات میرزا پنل اضافه کنید",
    body: (
      <>
        در میرزا، پنل <b>ثنایی / 3x-ui</b> با نوع <b dir="ltr">x-ui_single</b> اضافه کنید.
        آدرس پنل و توکن API فروش را وارد کنید. اگر نام کاربری خواست، نام همین نمایندگی را بگذارید.
        در نسخهٔ ۰٫۸٫۱، فیلد <b dir="ltr">password_panel</b> محل همین توکن API است.
      </>
    ),
  },
  {
    n: "۴",
    title: "اینباندهای مجاز را انتخاب کنید",
    body: (
      <>
        در داشبورد روی <b>«بررسی لوکیشن‌های قابل فروش»</b> بزنید. شناسه‌های موردنظر را در انتخاب اینباندهای پنل یا محصول میرزا ثبت کنید.
        نسخهٔ جدید انتخاب چندگانه دارد؛ مقدار <b dir="ltr">inbounds</b> آرایه‌ای مانند <b dir="ltr">[17, 21]</b> است.
        اینباندهای حذف‌شده، غیرفعال یا آفلاین قابل انتخاب نیستند.
      </>
    ),
  },
  {
    n: "۵",
    title: "لینک ساب (linksubx) را تنظیم کنید",
    body: (
      <>
        ربات لینک اشتراک خریدار را به شکل <b dir="ltr">linksubx/شناسه</b> می‌سازد. پس در تنظیمات پنل داخل ربات،
        فیلد <b dir="ltr">linksubx</b> را از جعبهٔ اتصال داشبورد کپی کنید؛ برای دامنهٔ اصلی، مقدار آن
        <b dir="ltr"> https://npanel.softarg.ir/api/s </b> است. لینک خریدار با افزودن شناسهٔ اشتراک به همین آدرس ساخته می‌شود.
      </>
    ),
  },
  {
    n: "۶",
    title: "ذخیره کنید و بفروشید",
    body: (
      <>
        حجم بسته‌ها را با عدد صحیح گیگابایت و حداقل ۱ گیگ تنظیم کنید. پس از ذخیره، ساخت و تمدید طبق موجودی شما انجام می‌شود.
        شروع اعتبار از اولین اتصال پشتیبانی می‌شود. برای اعلان‌های تلگرام، بخش اختیاری اعلان‌ها را جداگانه تنظیم کنید.
      </>
    ),
  },
];

export default function MirzaGuidePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
        {/* هدر */}
        <header className="flex items-center gap-3">
          <PvLogo size={44} />
          <div>
            <h1 className="text-xl font-extrabold">اتصال ربات میرزا به پنل نمایندگی</h1>
            <p className="text-xs text-muted-foreground mt-1">
              فروش خودکار سرویس از طریق ربات تلگرامی خودتان — با همان اینباندها و همان سقف پول ترافیک داشبورد
            </p>
          </div>
        </header>

        {/* نحوه کار */}
        <section className="rounded-2xl border border-border bg-muted/30 p-4">
          <h2 className="font-bold text-sm mb-2">کار به چه شکلی انجام می‌شود؟</h2>
          <div className="flex flex-col sm:flex-row items-stretch gap-2 text-center text-xs">
            <div className="flex-1 rounded-xl border border-border bg-card p-3">
              <div className="text-lg">🛒</div>
              <div className="font-bold mt-1">خریدار</div>
              <div className="text-muted-foreground mt-0.5">در تلگرام از ربات شما خرید می‌کند</div>
            </div>
            <div className="self-center text-[var(--brand)] text-xl">←</div>
            <div className="flex-1 rounded-xl border border-[var(--brand)]/40 bg-[var(--brand-soft)] p-3">
              <div className="text-lg">🤖</div>
              <div className="font-bold mt-1">ربات میرزا</div>
              <div className="text-muted-foreground mt-0.5">پرداخت را می‌گیرد و به پنل وصل می‌شود</div>
            </div>
            <div className="self-center text-[var(--brand)] text-xl">←</div>
            <div className="flex-1 rounded-xl border border-[var(--brand)]/40 bg-[var(--brand-soft)] p-3">
              <div className="text-lg">📊</div>
              <div className="font-bold mt-1">این داشبورد</div>
              <div className="text-muted-foreground mt-0.5">کاربر را می‌سازد و از پول شما کم می‌کند</div>
            </div>
            <div className="self-center text-[var(--brand)] text-xl">←</div>
            <div className="flex-1 rounded-xl border border-border bg-card p-3">
              <div className="text-lg">✅</div>
              <div className="font-bold mt-1">تحویل سرویس</div>
              <div className="text-muted-foreground mt-0.5">لینک سابسکریپشن برای خریدار ارسال می‌شود</div>
            </div>
          </div>
        </section>

        {/* مراحل */}
        <section className="space-y-4">
          {steps.map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <h2 className="font-bold text-sm flex items-center gap-2">
                <span className="inline-flex items-center justify-center h-7 w-7 rounded-full brand-gradient text-white text-xs font-extrabold shrink-0">
                  {s.n}
                </span>
                {s.title}
              </h2>
              <p className="text-[13px] text-muted-foreground leading-6 mt-2">{s.body}</p>
              {s.img && (
                <img
                  src={s.img}
                  alt={s.imgAlt || ""}
                  className="mt-3 rounded-xl border border-border w-full"
                  loading="lazy"
                />
              )}
            </div>
          ))}
        </section>

        {/* جدول نگاشت فیلدها */}
        <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h2 className="font-bold text-sm mb-3">جدول کامل: کدام مقدار در کدام فیلد ربات؟</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-right">
                  <th className="border border-border px-3 py-2 bg-muted/50">فیلد در ربات میرزا</th>
                  <th className="border border-border px-3 py-2 bg-muted/50">مقداری که وارد کنید</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-border px-3 py-2" dir="ltr">URL / url_panel</td>
                  <td className="border border-border px-3 py-2">آدرس پنل از جعبه سبز داشبورد (دکمه کپی)</td>
                </tr>
                <tr>
                  <td className="border border-border px-3 py-2" dir="ltr">username / username_panel</td>
                  <td className="border border-border px-3 py-2">نام کاربری داشبورد شما</td>
                </tr>
                <tr>
                  <td className="border border-border px-3 py-2" dir="ltr">password / password_panel</td>
                  <td className="border border-border px-3 py-2">توکن API اتصال فروش، ساخته‌شده در همین نمایندگی</td>
                </tr>
                <tr>
                  <td className="border border-border px-3 py-2" dir="ltr">inbounds / inboundid</td>
                  <td className="border border-border px-3 py-2">انتخاب اینباندهای مجاز از فهرست زندهٔ داشبورد؛ نسخهٔ جدید آرایهٔ شناسه‌ها می‌گیرد</td>
                </tr>
                <tr>
                  <td className="border border-border px-3 py-2" dir="ltr">linksubx</td>
                  <td className="border border-border px-3 py-2">آدرس سابسکریپشن همین سامانه (پایه لینک خریدار)</td>
                </tr>
                <tr>
                  <td className="border border-border px-3 py-2" dir="ltr">type</td>
                  <td className="border border-border px-3 py-2" dir="ltr">x-ui_single (3x-ui)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* سوالات پرتکرار */}
        <section className="space-y-2">
          <h2 className="font-bold text-sm">سوالات پرتکرار</h2>
          <details className="rounded-xl border border-border bg-card p-3.5">
            <summary className="text-[13px] font-bold cursor-pointer">فروش ربات چقدر از پول ترافیک من کم می‌کند؟</summary>
            <p className="text-xs text-muted-foreground leading-6 mt-2">
              دقیقاً به اندازه سهمیه‌ای که برای خریدار تعریف می‌شود. مصرف قطعی کاربران حتی بعد از حذف یا ریست ترافیک هم
              ثبت می‌ماند و به پول شما برنمی‌گردد — پس حساب پول شما همیشه با مصرف واقعی یکی است.
            </p>
          </details>
          <details className="rounded-xl border border-border bg-card p-3.5">
            <summary className="text-[13px] font-bold cursor-pointer">ربات به اینباندهای دیگری هم دسترسی دارد؟</summary>
            <p className="text-xs text-muted-foreground leading-6 mt-2">
              کلید API فقط متعلق به حساب شماست؛ ساخت و افزودن اینباند با دسترسی‌های تعیین‌شدهٔ مدیر و وضعیت زندهٔ لوکیشن‌ها بررسی می‌شود.
            </p>
          </details>
          <details className="rounded-xl border border-border bg-card p-3.5">
            <summary className="text-[13px] font-bold cursor-pointer">تست اتصال ربات خطا می‌دهد — چه کنم؟</summary>
            <p className="text-xs text-muted-foreground leading-6 mt-2">
              سوییچ فروش را روشن و ذخیره کنید، توکن API فروش را در فیلد توکن پنل میرزا بگذارید و آدرس پنل و لینک ساب را از همین داشبورد کپی کنید.
              اگر توکن را تعویض کرده‌اید، مقدار جدید را در میرزا جایگزین کنید.
            </p>
          </details>
          <details className="rounded-xl border border-border bg-card p-3.5">
            <summary className="text-[13px] font-bold cursor-pointer">امنیت آن چطور است؟</summary>
            <p className="text-xs text-muted-foreground leading-6 mt-2">
              تنها اثر انگشت کلید فروش ذخیره می‌شود. کلید فقط هنگام ساخت نمایش داده می‌شود؛ با لغو، تعویض، خاموش‌کردن اتصال
              یا تغییر تنظیمات ورود، کلید قبلی از کار می‌افتد. دسترسی روتینگ، پروتکل و تنظیمات زیرساخت به ربات داده نمی‌شود.
            </p>
          </details>
        </section>

        <footer className="text-center text-[11px] text-muted-foreground pt-4 border-t border-border">
          سامانه نمایندگی PvNetWork — در صورت بروز مشکل با مدیر سامانه تماس بگیرید
        </footer>
      </div>
    </main>
  );
}
