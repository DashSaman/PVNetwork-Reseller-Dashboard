import { db } from './db';
import { readDeletionSettlement } from './deletion-refund';

/** The existing backup already includes the durable operation journal. Keep
 * forfeited unused allocation distinct from measured network consumption. */
export async function getForfeitedGBByReseller(resellerId?: string): Promise<Map<string, number>> {
  const rows = await db.operationJournal.findMany({
    where: { ...(resellerId === undefined ? {} : { resellerId }), type: 'DELETE', accountingCommitted: true },
    select: { resellerId: true, metadata: true },
  });
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.resellerId, (totals.get(row.resellerId) || 0) + (readDeletionSettlement(row.metadata)?.forfeitedGB || 0));
  return totals;
}

export async function getForfeitedGB(resellerId: string): Promise<number> {
  return (await getForfeitedGBByReseller(resellerId)).get(resellerId) || 0;
}
