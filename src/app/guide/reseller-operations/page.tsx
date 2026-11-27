import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowDownUp, BarChart3, BookOpen, CalendarClock, Copy, Headphones, History,
  Link2, Maximize2, Package, Palette, Pencil, RotateCcw, ShieldCheck, Tags,
  Trash2, UserPlus, Users, UserX, Webhook, type LucideIcon,
} from 'lucide-react';
import Markdown from 'react-markdown';
import { PvLogo } from '@/components/panel/shared';
import photoSizes from './photo-sizes.json';

export const metadata: Metadata = {
  title: 'راهنمای تصویری پنل نمایندگی | PvNetWork',
  description: 'آموزش تصویری همهٔ منوها و آیکون‌های پنل نمایندگی، از ساخت مشتری و ارسال لینک تا تمدید و پشتیبانی',
};

type GuidePhoto = { file: string; caption: string; width: number; height: number };
const bodyClass = 'space-y-3 text-sm leading-7 wrap-anywhere [&_ol]:list-decimal [&_ul]:list-disc [&_li]:ms-5 [&_li+li]:mt-1 [&_a]:font-semibold [&_a]:text-brand-deep [&_a]:underline [&_code]:[unicode-bidi:isolate]';
const photoPattern = /^!\[([^\]\n]+)\]\(\.\.\/public\/guide\/reseller-operations\/([a-z-]+)\.webp\)[ \t]*$/gm;

const sectionNav: Record<string, { icon: LucideIcon; label: string }> = {
  'تمدید خودکار و شروع دورهٔ جدید': { icon: CalendarClock, label: 'تمدید خودکار' },
  'منوهای پنل نماینده': { icon: BookOpen, label: 'منوهای پنل' },
  'کاربران من و ساخت حساب': { icon: UserPlus, label: 'ساخت کاربر' },
  'آیکون‌های ردیف کاربر': { icon: Users, label: 'آیکون‌های کاربر' },
  'گروه‌بندی، هشدار و افزایش گروهی': { icon: Tags, label: 'کارهای گروهی' },
  'بسته‌های آماده برای ساخت کاربر': { icon: Package, label: 'بسته‌های آماده' },
  'پیگیری ساخت، ویرایش، تمدید و حذف': { icon: History, label: 'پیگیری عملیات' },
  'آخرین دریافت ساب و آخرین اتصال': { icon: ArrowDownUp, label: 'آخرین اتصال' },
  'صفحهٔ مشتری و پشتیبانی تلگرام': { icon: Link2, label: 'لینک و تلگرام مشتری' },
  'حساب همکار پشتیبانی': { icon: Headphones, label: 'همکار پشتیبانی' },
  'آمار و مصرف': { icon: BarChart3, label: 'آمار و مصرف' },
  'برند و دامنه اختصاصی': { icon: Palette, label: 'برند و دامنه' },
  'تنظیمات حساب و ربات‌ها': { icon: ShieldCheck, label: 'تنظیمات و ربات‌ها' },
  'وب‌هوک رویدادهای اشتراک': { icon: Webhook, label: 'وب‌هوک ادمین' },
};

const userActions = [
  { icon: Link2, name: 'لینک‌ها و QR' },
  { icon: Copy, name: 'کپی لینک ساب' },
  { icon: RotateCcw, name: 'ریست ترافیک' },
  { icon: UserX, name: 'فعال / غیرفعال' },
  { icon: Pencil, name: 'ویرایش' },
  { icon: Trash2, name: 'حذف' },
];

function Screenshot({ photo }: { photo: GuidePhoto }) {
  const href = '/guide/reseller-operations/' + photo.file + '.webp';
  return (
    <figure className="min-w-0 overflow-hidden rounded-xl border bg-background">
      <a href={href} target="_blank" rel="noreferrer" aria-label={'باز کردن عکس در اندازهٔ اصلی · ' + photo.caption}
        className="group relative grid min-h-16 place-items-center bg-muted/35 p-2 focus-visible:outline-2 focus-visible:outline-brand-deep">
        <Image src={href} alt={photo.caption} width={photo.width} height={photo.height} unoptimized
          className="h-auto w-auto max-w-full rounded-md border border-slate-200 object-contain" />
        <Maximize2 className="absolute end-3 top-3 size-7 rounded-md border bg-card p-1.5 text-foreground shadow-sm transition-colors group-hover:text-brand-deep" aria-hidden />
      </a>
      <figcaption className="border-t px-3 py-2.5 text-sm leading-6">{photo.caption}</figcaption>
    </figure>
  );
}

export default async function ResellerGuidePage() {
  const source = await readFile(join(process.cwd(), 'docs', 'reseller-operations-features.fa.md'), 'utf-8');
  const [intro, ...chapters] = source.trim().split(/^## /m);
  const [title, ...description] = intro.replace(/^# /, '').trim().split(/\r?\n/);
  const sections = chapters.map(chapter => {
    const [heading, ...lines] = chapter.trim().split(/\r?\n/);
    const text = lines.join('\n');
    const photos = [...text.matchAll(photoPattern)].map(([, caption, file]) => {
      const size = photoSizes[file as keyof typeof photoSizes];
      if (!size) throw new Error('Missing reseller guide screenshot size for ' + file);
      return { file, caption, ...size };
    });
    return { heading, id: heading.replaceAll(' ', '-'), body: text.replace(photoPattern, '').trim(), photos };
  });
  const technical = sections.pop();

  return (
    <main id="guide-top" className="mx-auto w-full max-w-5xl space-y-6 px-4 py-7 sm:px-6 sm:py-12" dir="rtl">
      <header className="space-y-4 rounded-2xl border bg-card p-4 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PvLogo size={42} />
          <Link href="/" prefetch={false} className="rounded-lg border bg-background px-3 py-2 text-sm font-semibold hover:border-brand">
            بازگشت به پنل
          </Link>
        </div>
        <div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1>
          <div className="mt-2 text-sm leading-7 text-muted-foreground"><Markdown>{description.join('\n')}</Markdown></div>
        </div>
        <a href={'#' + sections[0].id} className="inline-flex items-center gap-2 rounded-md border border-brand/40 bg-brand-soft px-3 py-2 text-sm font-bold text-brand-deep">
          <CalendarClock className="size-4" aria-hidden /> تمدید خودکار کجاست؟
        </a>
      </header>

      <nav aria-label="فهرست راهنما" className="rounded-2xl border bg-card p-3 sm:p-4">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {sections.map(section => {
            const { icon: Icon, label } = sectionNav[section.heading] ?? { icon: BookOpen, label: section.heading };
            return (
              <li key={section.id}>
                <a href={'#' + section.id} className="flex h-full min-h-11 items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs font-semibold hover:text-brand-deep sm:text-sm">
                  <Icon className="size-4 shrink-0 text-brand-deep" aria-hidden /> {label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {sections.map(section => {
        const Icon = sectionNav[section.heading]?.icon ?? BookOpen;
        return (
          <section key={section.id} aria-labelledby={section.id} className="space-y-4 rounded-2xl border bg-card p-3 sm:p-6">
            <h2 id={section.id} tabIndex={-1} className="flex scroll-mt-4 items-center gap-2 text-lg font-bold sm:text-xl">
              <span className="rounded-lg bg-brand-soft p-2 text-brand-deep"><Icon className="size-5" aria-hidden /></span>
              {section.heading}
            </h2>
            {section.heading === 'آیکون‌های ردیف کاربر' && (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {userActions.map(({ icon: ActionIcon, name }) => (
                  <li key={name} className="flex items-center gap-2 rounded-md border bg-muted px-2 py-2 text-xs sm:text-sm">
                    <ActionIcon aria-hidden className="size-4 shrink-0" /> {name}
                  </li>
                ))}
              </ul>
            )}
            {section.photos.length ? (
              <>
                <div className="grid items-start gap-3 sm:grid-cols-2">
                  {section.photos.map(photo => <Screenshot key={photo.file} photo={photo} />)}
                </div>
                <details className="rounded-lg border bg-background px-3 py-2.5">
                  <summary className="cursor-pointer text-sm font-semibold">توضیح بیشتر دربارهٔ {sectionNav[section.heading]?.label ?? section.heading}</summary>
                  <div className={'mt-3 ' + bodyClass}><Markdown>{section.body}</Markdown></div>
                </details>
              </>
            ) : <div className={bodyClass}><Markdown>{section.body}</Markdown></div>}
          </section>
        );
      })}

      {technical && (
        <details className="rounded-xl border bg-card p-4 sm:p-6">
          <summary className="cursor-pointer font-bold">{technical.heading}</summary>
          <div className={'mt-4 ' + bodyClass}><Markdown>{technical.body}</Markdown></div>
        </details>
      )}
      <a className="inline-block text-sm font-semibold text-brand-deep underline underline-offset-4" href="#guide-top">بازگشت به فهرست</a>
    </main>
  );
}
