type Attempt = { payload: string; requestId: string; at: number };
const ttl = 24 * 60 * 60 * 1000;
/** Tab-local recovery across reload/logout. It contains no credentials. The
 * server still validates owner, intent and quota for every repeated request. */
export function getCreateAttempt(storage: Pick<Storage, 'getItem' | 'setItem'> | null, owner: string, payload: string, newId: () => string, now = Date.now()): Attempt {
  const key = 'pvnet:create-attempts:' + owner;
  let records: Attempt[] = [];
  try { const value = JSON.parse(storage?.getItem(key) || '[]');if (Array.isArray(value)) records = value.filter(v => typeof v?.payload === 'string' && typeof v.requestId === 'string' && Number.isFinite(v.at) && now - v.at >= 0 && now - v.at < ttl).slice(-10); } catch { /* Storage can be unavailable. */ }
  const attempt = records.find(v => v.payload === payload) || { payload, requestId: newId(), at: now };
  if (!records.includes(attempt)) records.push(attempt);
  try { storage?.setItem(key, JSON.stringify(records.slice(-10))); } catch { /* Keep the in-memory attempt. */ }
  return attempt;
}

export function finishCreateAttempt(storage: Pick<Storage, 'getItem' | 'setItem'> | null, owner: string, requestId: string): void {
  const key = 'pvnet:create-attempts:' + owner;
  try { const records = JSON.parse(storage?.getItem(key) || '[]');if (Array.isArray(records)) storage?.setItem(key, JSON.stringify(records.filter(v => v?.requestId !== requestId))); } catch { /* Successful creation must not depend on browser storage. */ }
}
