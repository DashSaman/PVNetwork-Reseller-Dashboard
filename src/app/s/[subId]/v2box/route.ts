import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { buildSubLink } from '@/lib/panel-manager';
import { buildV2BoxSubscriptionLink } from '@/lib/v2box-subscription';

const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(_request: Request, { params }: { params: Promise<{ subId: string }> }) {
  const { subId } = await params;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(subId)) {
    return new Response('اشتراک یافت نشد', { status: 404, headers: privateHeaders });
  }

  const customer = await db.resellerUser.findUnique({
    where: { subId },
    select: { email: true, panelId: true },
  });
  const nativeUrl = customer && await buildSubLink(subId, null, customer.panelId);
  const appLink = buildV2BoxSubscriptionLink(nativeUrl, customer?.email);
  if (!appLink) {
    return new Response('اشتراک یافت نشد', { status: 404, headers: privateHeaders });
  }

  // Encoded URL parameters and a fixed scheme are safe inside a quoted attribute.
  const nonce = randomBytes(16).toString('base64');
  return new Response(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>افزودن اشتراک در V2Box</title>
  <style nonce="${nonce}">
    body { margin: 0; min-height: 100svh; display: grid; place-items: center; background: #101823; color: #f3f8fa; font: 16px system-ui, sans-serif; }
    main { text-align: center; padding: 1.5rem; }
    a { display: inline-block; color: #071518; background: #54ded0; padding: .9rem 1.2rem; border-radius: .7rem; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <a id="open-v2box" href="${appLink}">افزودن با نام در V2Box</a>
    <p>اگر برنامه خودکار باز نشد، روی دکمه بزنید.</p>
  </main>
  <script nonce="${nonce}">location.href = document.getElementById('open-v2box').href;</script>
</body>
</html>`, {
    headers: {
      ...privateHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}
