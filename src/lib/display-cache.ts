// Display snapshots only. Accounting and writes must always read fresh panel data.
type Entry<T> = { value?: T; at: number; flight?: Promise<void>; controller?: AbortController; error?: string; failedAt?: number; retryAt: number };
export type DisplayCache<T> = { entries: Map<string, Entry<T>> };
export function createDisplayCache<T>(): DisplayCache<T> { return { entries: new Map() }; }
const shared = globalThis as { __pvnetDisplayCache?: DisplayCache<unknown> };
export function sharedDisplayCache<T>(): DisplayCache<T> {
  return (shared.__pvnetDisplayCache ??= createDisplayCache()) as DisplayCache<T>;
}
export function clearDisplayCache<T>(cache: DisplayCache<T>) {
  for (const entry of cache.entries.values()) entry.controller?.abort();
  cache.entries.clear();
}
export async function readDisplayEntry<T>(
  cache: DisplayCache<T>, key: string, loader: (signal: AbortSignal) => Promise<T>,
  options: { deadlineMs: number; freshMs: number; maxAgeMs: number; retryMs: number },
) {
  let entry = cache.entries.get(key);
  if (!entry) { entry = { at: 0, retryAt: 0 }; cache.entries.set(key, entry); }
  const current = entry;
  const now = Date.now();
  if ((!current.at || now - current.at > options.freshMs) && !current.flight && now >= current.retryAt) {
    current.controller = new AbortController();
    current.flight = Promise.resolve().then(() => loader(current.controller!.signal)).then(value => {
      if (cache.entries.get(key) !== current) return;
      current.value = value; current.at = Date.now(); current.error = undefined;
    }).catch((e: unknown) => {
      if (cache.entries.get(key) === current) { current.error = e instanceof Error ? e.message : "Read failed"; current.failedAt = Date.now(); }
    }).finally(() => {
      current.flight = undefined; current.controller = undefined;
      current.retryAt = current.error ? Date.now() + options.retryMs : 0;
    });
  }
  // A cold request has a small display deadline; the shared bounded fetch keeps
  // running so a slow response can complete rather than being discarded forever.
  if (current.value === undefined && current.flight) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([current.flight, new Promise<void>(resolve => { timer = setTimeout(resolve, options.deadlineMs); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  if (cache.entries.get(key) !== current) return { value: undefined, pending: true, stale: false, observedAt: null, error: undefined };
  const age = Date.now() - current.at;
  return {
    value: age <= options.maxAgeMs ? current.value : undefined,
    pending: !!current.flight,
    stale: !!current.at && age > options.freshMs,
    observedAt: current.at || null,
    error: current.error,
    failedAt: current.failedAt || null,
  };
}
