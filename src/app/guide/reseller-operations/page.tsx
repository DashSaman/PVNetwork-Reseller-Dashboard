import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, Copy, Link2, Pencil, RotateCcw, Trash2, UserX } from 'lucide-react';
import Markdown from 'react-markdown';
import { PvLogo } from '@/components/panel/shared';

export const metadata: Metadata = {
  title: 'راهنمای امکانات پنل نمایندگی | PvNetWork',
  description: 'راهنمای منوها، بخش‌ها و آیکون‌های پنل نماینده روی گوشی و رایانه، از ساخت کاربر تا پشتیبانی',
};

const bodyClass = 'space-y-3 text-sm leading-7 wrap-anywhere [&_ol]:list-decimal [&_ul]:list-disc [&_li]:ms-5 [&_li+li]:mt-1 [&_a]:font-semibold [&_a]:text-brand-deep [&_a]:underline [&_code]:[unicode-bidi:isolate]';

const userActions = [
  { icon: Link2, name: 'لینک‌ها و QR' },
  { icon: Copy, name: 'کپی لینک ساب' },
  { icon: RotateCcw, name: 'ریست ترافیک' },
  { icon: UserX, name: 'فعال / غیرفعال' },
  { icon: Pencil, name: 'ویرایش' },
  { icon: Trash2, name: 'حذف' },
];

export default async function ResellerGuidePage() {
  const source = await readFile(join(process.cwd(), 'docs', 'reseller-operations-features.fa.md'), 'utf-8');
  const [intro, ...chapters] = source.trim().split(/^## /m);
  const [title, ...description] = intro.replace(/^# /, '').trim().split(/\r?\n/);
  const sections = chapters.map(chapter => {
    const [heading, ...body] = chapter.trim().split(/\r?\n/);
    return { heading, body: body.join('\n'), id: heading.replaceAll(' ', '-') };
  });
  const technical = sections.pop();

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12" dir="rtl">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PvLogo size={40} />
          <Link href="/" prefetch={false} className="rounded-lg border bg-card px-3 py-2 text-sm font-semibold hover:border-brand">
            بازگشت به پنل
          </Link>
        </div>
        <h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1>
        <div className="text-sm leading-7 text-muted-foreground"><Markdown>{description.join('\n')}</Markdown></div>
      </header>

      <div className="space-y-2 rounded-xl border border-brand/40 bg-brand-soft p-4">
        <a href={'#' + sections[0].id} className="font-bold text-brand-deep underline underline-offset-4">تمدید خودکار کجاست؟</a>
        <p className="text-sm leading-7">در «کاربران من»، روی تقویم کنار نام مشتری بزنید. این آیکون روی گوشی هم از ابتدای ردیف دیده می‌شود.</p>
        <div className="flex flex-wrap gap-2 text-sm font-medium">
          <span className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-blue-700 dark:text-blue-300"><CalendarClock className="size-4" aria-hidden /> روشن</span>
          <span className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-700 dark:text-red-300"><CalendarClock className="size-4" aria-hidden /> خاموش</span>
        </div>
      </div>

      <nav aria-label="فهرست راهنما" className="rounded-xl border bg-card p-4">
        <ul className="grid gap-2 sm:grid-cols-2">
          {sections.map(section => (
            <li key={section.id}>
              <a href={'#' + section.id} className="block rounded-md bg-muted px-3 py-2.5 text-sm font-medium hover:text-brand-deep">
                {section.heading}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {sections.map(section => (
        <section key={section.id} aria-labelledby={section.id} className="space-y-3 rounded-xl border bg-card p-4 sm:p-6">
          <h2 id={section.id} tabIndex={-1} className="scroll-mt-4 text-lg font-bold">{section.heading}</h2>
          {section.heading === 'آیکون‌های ردیف کاربر' && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {userActions.map(({ icon: Icon, name }) => (
                <li key={name} className="flex items-center gap-2 rounded-md border bg-muted px-2 py-2 text-xs sm:text-sm">
                  <Icon aria-hidden className="size-4 shrink-0" /> {name}
                </li>
              ))}
            </ul>
          )}
          <div className={bodyClass}><Markdown>{section.body}</Markdown></div>
        </section>
      ))}

      {technical && (
        <details className="rounded-xl border bg-card p-4 sm:p-6">
          <summary className="cursor-pointer font-bold">{technical.heading}</summary>
          <div className={'mt-4 ' + bodyClass}><Markdown>{technical.body}</Markdown></div>
        </details>
      )}
    </main>
  );
}
