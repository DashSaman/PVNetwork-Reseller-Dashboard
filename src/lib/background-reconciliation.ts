export type ReconciliationResult = { completed: number; pending: number };
type Options = {
  reconcile(owner: string): Promise<ReconciliationResult>;
  setTimer?(callback: () => void, delayMs: number): unknown;
  clearTimer?(timer: unknown): void;
  maxPasses?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
  progressDelayMs?: number;
};

/** Only schedules the existing reconciler. No native mutation or accounting
 * decision belongs here. Durable journals remain the authority after a restart. */
export function createReconciliationRunner(options: Options) {
  type Entry = { running?: Promise<void>; timer?: unknown; retryMs: number; changed: boolean };
  const entries = new Map<string, Entry>(), min = options.retryMinMs ?? 30000, max = options.retryMaxMs ?? 300000;
  let stopped = false;
  const setTimer = options.setTimer ?? ((callback, delay) => { const timer = setTimeout(callback, delay);timer.unref();return timer; });
  const clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const start = (owner: string, explicit: boolean): Promise<void> => {
    if (stopped) return Promise.resolve();
    let entry = entries.get(owner);
    if (entry?.running) { if (explicit) entry.changed = true;return entry.running; }
    if (entry?.timer !== undefined) {
      if (!explicit) return Promise.resolve();
      clearTimer(entry.timer);entry.timer = undefined;
    }
    if (!entry) { entry = { retryMs: min, changed: false };entries.set(owner, entry); }
    const current = entry;let pending = false, madeProgress = false;
    const work = Promise.resolve().then(async () => {
      for (let pass = 0; pass < (options.maxPasses ?? 5) && !stopped; pass++) {
        current.changed = false;
        const result = await options.reconcile(owner);
        madeProgress ||= result.completed > 0;pending = result.pending > 0 || current.changed;
        if (!pending || !result.completed && !current.changed) break;
      }
    }).catch(() => { pending = true; }).finally(() => {
      if (entries.get(owner) !== current || stopped) return;
      current.running = undefined;
      if (!pending && !current.changed) { entries.delete(owner);return; }
      const delay = madeProgress ? options.progressDelayMs ?? 1000 : current.retryMs;
      current.retryMs = madeProgress ? min : Math.min(max, current.retryMs * 2);
      current.timer = setTimer(() => { current.timer = undefined;void start(owner, false); }, delay);
    });
    current.running = work;return work;
  };
  return { run: (owner: string) => start(owner, true), ensure: (owner: string) => start(owner, false),
    stop() { stopped = true;for (const entry of entries.values()) if (entry.timer !== undefined) clearTimer(entry.timer);entries.clear(); } };
}
