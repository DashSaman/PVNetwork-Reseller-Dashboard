export const BYTES_PER_MIB = 1024 ** 2;
export const BYTES_PER_GIB = 1024 ** 3;

export function isTrafficQuotaGB(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 8388607 && Number.isSafeInteger(value * 1024);
}

export function quotaGBFromNativeBytes(bytes: number): number | null {
  if (!Number.isSafeInteger(bytes) || bytes % BYTES_PER_MIB !== 0) return null;
  const gib = bytes / BYTES_PER_GIB;
  return isTrafficQuotaGB(gib) ? gib : null;
}
