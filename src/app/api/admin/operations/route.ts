import { requireAdmin } from '@/lib/session';
import { operationFeed } from '@/lib/operation-feed';

export async function GET(request: Request) {
  if (!await requireAdmin()) return Response.json({ error: 'دسترسی غیرمجاز' }, { status: 401 });
  const query = new URL(request.url).searchParams;
  return Response.json(await operationFeed(undefined, query.get('pending') !== '0', query.get('before') || undefined), { headers: { 'Cache-Control': 'private, no-store' } });
}
