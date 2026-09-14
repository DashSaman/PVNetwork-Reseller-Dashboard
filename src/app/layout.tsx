import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "سامانه نمایندگی PvNetWork",
  description: "پنل نمایندگی PvNetWork — مدیریت نماینده‌ها و کاربران با زیرساخت اختصاصی",
  icons: {
    icon: "/logo.webp",
    apple: "/logo.webp",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1119" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* اعمال تم ذخیره‌شده قبل از رندر برای جلوگیری از فلش */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=document.cookie.match(/(?:^|; )theme=(light|dark)/);var t=m?m[1]:null;if(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches){t='light';}if(t==='light'){document.documentElement.classList.remove('dark');}else{document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased bg-background text-foreground min-h-screen flex flex-col [font-family:Vazirmatn,system-ui,sans-serif]">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
