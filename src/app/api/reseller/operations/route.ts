import { requireReseller } from '@/lib/session';
import { operationFeed } from '@/lib/operation-feed';

export async function GET(request: Request) {
  const owner = await requireReseller();
  if (!owner) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const query = new URL(request.url).searchParams;
  return Response.json(await operationFeed(owner.uid, query.get('pending') !== '0', query.get('before') || undefined), { headers: { 'Cache-Control': 'private, no-store' } });
}
