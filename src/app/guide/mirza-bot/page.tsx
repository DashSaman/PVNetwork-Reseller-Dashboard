import type { Metadata } from "next";
import { PvLogo } from "@/components/panel/shared";

export const metadata: Metadata = {
  title: "راهنمای اتصال ربات میرزا | سامانه نمایندگی",
  description: "آموزش تصویری اتصال ربات میرزا به پنل نمایندگی و فروش سرویس",
};

const steps = [
  {
    n: "۱",
    title: "سوییچ اتصال را روشن کنید",
    body: (
      <>
        وارد پنل نمایندگی شوید و به تب <b>«تنظیمات حساب»</b> بروید. پایین صفحه، کارت <b>«ربات میرزا پنل»</b> را پیدا کنید و
        سوییچ آن را روشن و با دکمه <b>«ذخیره و اتصال ربات»</b> ذخیره کنید. با روشن شدن سوییچ، جعبه سبز تنظیمات اتصال نمایش داده می‌شود.
      </>
    ),
    img: "/guide/mirza-card.png",
    imgAlt: "کارت ربات میرزا پنل در تنظیمات حساب نماینده",
  },
  {
    n: "۲",
    title: "سه مقدار اتصال را بردارید",
    body: (
      <>
        از جعبه سبز این سه مقدار را کپی کنید: <b>آدرس پنل</b> (دکمه کپی کنارش هست)، <b>نام کاربری</b> و <b>رمز عبور</b>
        (همان مشخصات ورود شما به همین داشبورد).
      </>
    ),
  },
  {
    n: "۳",
    title: "در ربات میرزا پنل اضافه کنید",
    body: (
      <>
        در ربات میرزا وارد بخش مدیریت پنل‌ها شوید، یک پنل جدید اضافه کنید و نوع آن را <b>x-ui (ثنایی)</b> انتخاب کنید.
        سپس به ترتیب: آدرس پنل، نام کاربری و رمز عبور کپی‌شده را وارد کنید.
      </>
    ),
  },
  {
    n: "۴",
    title: "شناسه اینباند (inboundid) را وارد کنید",
    body: (
      <>
        در داشبورد، دکمه <b>«تست اتصال ربات»</b> را بزنید؛ نتیجه تست همراه با <b>شناسه اینباندهای</b> در دسترس شما نمایش داده می‌شود.
        همان عدد را در فیلد <b dir="ltr">inboundid</b> ربات وارد کنید. فروش ربات فقط روی این اینباند انجام می‌شود.
      </>
    ),
  },
  {
    n: "۵",
    title: "لینک ساب (linksubx) را تنظیم کنید",
    body: (
      <>
        ربات لینک اشتراک خریدار را به شکل <b dir="ltr">linksubx/شناسه</b> می‌سازد. پس در تنظیمات پنل داخل ربات،
        فیلد <b dir="ltr">linksubx</b> را روی آدرس سابسکریپشن پنل 3x-ui شما تنظیم کنید؛ مثلاً{" "}
        <b dir="ltr">https://sub.example.com/sub</b>. اگر مطمئن نیستید، این مقدار را از ادمین سامانه بپرسید.
      </>
    ),
  },
  {
    n: "۶",
    title: "ذخیره کنید و بفروشید",
    body: (
      <>
        ربات را ذخیره کنید. از این به بعد هر خرید در ربات، به‌صورت خودکار روی همین پنل کاربر ساخته می‌شود؛ سهمیه از
        پول ترافیک شما کسر می‌شود، لینک ساب برای خریدار ارسال می‌شود و اعلان‌ها هم به تلگرام شما می‌آیند.
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
                  <td className="border border-border px-3 py-2">رمز داشبورد شما</td>
                </tr>
                <tr>
                  <td className="border border-border px-3 py-2" dir="ltr">inboundid</td>
                  <td className="border border-border px-3 py-2">شناسه اینباند از «تست اتصال ربات» در داشبورد</td>
                </tr>
                <tr>
                  <td className="border border-border px-3 py-2" dir="ltr">linksubx</td>
                  <td className="border border-border px-3 py-2">آدرس سابسکریپشن پنل 3x-ui شما (پایه لینک خریدار)</td>
                </tr>
                <tr>
                  <td className="border border-border px-3 py-2" dir="ltr">type</td>
                  <td className="border border-border px-3 py-2">x-ui (ثنایی)</td>
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
              خیر. ربات با مشخصات خود شما وارد می‌شود و فقط به اینباندهایی دسترسی دارد که ادمین به حساب شما داده است.
            </p>
          </details>
          <details className="rounded-xl border border-border bg-card p-3.5">
            <summary className="text-[13px] font-bold cursor-pointer">تست اتصال ربات خطا می‌دهد — چه کنم؟</summary>
            <p className="text-xs text-muted-foreground leading-6 mt-2">
              اول مطمئن شوید سوییچ ربات روشن و ذخیره شده است. اگر پیام «هیچ اینباندی در دسترس نیست» دیدید، با مدیر
              سامانه تماس بگیرید تا اینباند به حساب شما اختصاص داده شود.
            </p>
          </details>
          <details className="rounded-xl border border-border bg-card p-3.5">
            <summary className="text-[13px] font-bold cursor-pointer">امنیت آن چطور است؟</summary>
            <p className="text-xs text-muted-foreground leading-6 mt-2">
              توکن‌ها رمزنگاری‌شده ذخیره می‌شوند، ورود ربات محدودیت تلاش دارد و در هر لحظه می‌توانید با خاموش‌کردن
              سوییچ، دسترسی ربات را کامل قطع کنید.
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
