export type QuotaChartData = {
  poolGB: number | null;
  soldGB: number;
  unsoldGB: number | null;
  actualUsedGB: number | null;
  soldButUnusedGB: number | null;
  consumedHistoricalGB: number;
  reservedGB: number;
  unlimitedUsers: number;
};

type Segment = { label: string; value: number; color: string };
const amount = (n: number) => Number.isFinite(n) ? Math.max(0, n) : 0;

/** Display partitions only. These figures never participate in billing/writes. */
export function quotaChartModel(data: QuotaChartData) {
  const pool: Segment[] = data.poolGB === null ? [] : [
    { label: "فروخته‌شده", value: amount(data.soldGB), color: "#0ea5e9" },
    { label: "باقی‌مانده", value: amount(data.unsoldGB ?? 0), color: "#10b981" },
    { label: "مصرف تاریخی", value: amount(data.consumedHistoricalGB), color: "#94a3b8" },
    { label: "رزرو", value: amount(data.reservedGB), color: "#eab308" },
  ].filter(s => s.value > 0);
  const sales: Segment[] | null = data.soldButUnusedGB === null || data.actualUsedGB === null || !Number.isFinite(data.soldButUnusedGB) || !Number.isFinite(data.actualUsedGB) || data.unlimitedUsers > 0 ? null : [
    // Used current quota is nested inside sold quota, never added to it.
    { label: "مصرف‌شده از فروش", value: Math.max(0, amount(data.soldGB) - amount(data.soldButUnusedGB)), color: "#f59e0b" },
    { label: "فروخته‌شده، مصرف‌نشده", value: amount(data.soldButUnusedGB), color: "#8b5cf6" },
  ].filter(s => s.value > 0);
  return { pool, sales, overQuotaGB: sales ? Math.max(0, amount(data.actualUsedGB!) - sales.reduce((n, s) => n + (s.color === "#f59e0b" ? s.value : 0), 0)) : null };
}
