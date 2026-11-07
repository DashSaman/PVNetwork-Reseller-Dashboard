import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireReseller } from '@/lib/session';
import { getPanelById, getPrimaryPanel, buildSubLink } from '@/lib/panel-manager';
import { getSelectableInboundCatalog } from '@/lib/inbound-catalog';
import { getResellerWithAccess, parseInboundRefs, refKey } from '@/lib/reseller-helpers';
import { readNativeSubscription, nativeLinksForInbounds, type NativeLink } from '@/lib/native-subscription';
import { PUBLIC_SERVICE_NAME, PUBLIC_SERVICE_ERROR, publicLocationLabel } from '@/lib/reseller-presentation';

type Ctx = { params: Promise<{ email: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await requireReseller();
  if (!session) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const { email } = await ctx.params;
  try {
    const reseller = await getResellerWithAccess(session.uid);
    if (!reseller) return NextResponse.json({ error: 'حساب شما فعال نیست' }, { status: 403 });
    const tracked = await db.resellerUser.findUnique({ where: { resellerId_email: { resellerId: reseller.id, email } } });
    if (!tracked) return NextResponse.json({ error: 'کاربر پیدا نشد' }, { status: 404 });
    const subLink = await buildSubLink(tracked.subId || '', reseller, tracked.panelId || undefined);
    const catalog = await getSelectableInboundCatalog(), primary = (await getPrimaryPanel())?.id || '';
    const allowed = new Set(reseller.inbounds.map(i => refKey({ panelId: i.panelId || primary, inboundId: i.inboundId })));
    const refs = new Set(parseInboundRefs(tracked.inboundIds, tracked.panelId || primary).map(refKey));
    const links: (NativeLink & { tag: string; panelName: string })[] = [];
    for (const bundle of catalog.panels) {
      const eligible = bundle.inbounds.filter(i => {
        const key = refKey({ panelId: bundle.panelId, inboundId: i.id });
        return allowed.has(key) && refs.has(key) && catalog.available.has(key) && i.clients.some(c => c.email === email && c.subId === tracked.subId);
      });
      if (!eligible.length) continue;
      const panel = await getPanelById(bundle.panelId);
      if (!panel) throw new Error('Missing native panel');
      const canonical = await readNativeSubscription(panel, tracked.subId || '');
      for (const link of nativeLinksForInbounds(canonical, eligible, bundle.inbounds)) {
        const label = publicLocationLabel(link.remark, bundle.panelName);
        links.push({ ...link, remark: label, tag: label, panelName: PUBLIC_SERVICE_NAME });
      }
    }
    if (!links.length) return NextResponse.json({ error: PUBLIC_SERVICE_ERROR }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ email, subId: tracked.subId, subLink, links, panelError: null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'دریافت کانفیگ اصلی موقتاً ممکن نیست؛ دوباره تلاش کنید' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
