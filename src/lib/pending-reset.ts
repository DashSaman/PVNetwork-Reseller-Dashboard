import type { OperationJournal } from '@prisma/client';

function metadata(value: string | null): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function emptyList(value: string): boolean {
  try { const parsed: unknown = JSON.parse(value);return Array.isArray(parsed) && parsed.length === 0; }
  catch { return false; }
}

export function isCurrentDestructiveRequest(row: OperationJournal, installation: string | null): boolean {
  const meta = metadata(row.metadata);
  return !!installation && ['DELETE', 'RESET'].includes(row.type)
    && ['PENDING', 'RUNNING', 'PARTIAL'].includes(row.status)
    && meta?.explicitDestructive === true && meta.operationInstallation === installation;
}

/** No native mutation can have begun: even an empty nodeSync/usage ledger means
 * execution crossed the readiness gate, so unknown/started writes stay locked. */
export function canCancelUnstartedOperation(row: OperationJournal, installation: string | null): boolean {
  const meta = metadata(row.metadata);
  return isCurrentDestructiveRequest(row, installation)
    && !row.accountingCommitted && Number.isFinite(row.reservedGB) && row.reservedGB >= 0
    && row.usageSnapshotGB !== null && Number.isFinite(row.usageSnapshotGB) && row.usageSnapshotGB >= 0
    && emptyList(row.completedPanels) && emptyList(row.failedPanels)
    && (row.type !== 'DELETE' || row.reservedGB === 0)
    && !!meta && !Object.hasOwn(meta, 'nodeSync') && !Object.hasOwn(meta, 'usageByPanel');
}

export function canCancelUnstartedReset(row: OperationJournal, installation: string | null): boolean {
  return row.type === 'RESET' && canCancelUnstartedOperation(row, installation);
}

/** Local completion only. Every immutable panel and native step must already
 * acknowledge this deletion; reads must never dispatch an uncertain operation. */
export function canFinalizeAcknowledgedDeletion(row: OperationJournal, installation: string | null): boolean {
  if (row.type !== 'DELETE' || !isCurrentDestructiveRequest(row, installation) || row.reservedGB !== 0
    || row.usageSnapshotGB === null || !Number.isFinite(row.usageSnapshotGB) || row.usageSnapshotGB < 0 || !emptyList(row.failedPanels)) return false;
  const meta = metadata(row.metadata);
  try {
    const targets: unknown = JSON.parse(row.targetPanels), completed: unknown = JSON.parse(row.completedPanels);
    if (!Array.isArray(targets) || !targets.length || targets.some(p => typeof p !== 'string' || !p)
      || new Set(targets).size !== targets.length || !Array.isArray(completed) || completed.length !== targets.length
      || new Set(completed).size !== completed.length || !targets.every(p => completed.includes(p))) return false;
    const ledger = meta?.usageByPanel, states = meta?.nodeSync;
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger) || !states || typeof states !== 'object' || Array.isArray(states)) return false;
    if (Object.keys(ledger).length !== targets.length || Object.keys(states).length !== targets.length) return false;
    let usage = 0;
    for (const panel of targets as string[]) {
      const amount = (ledger as Record<string, unknown>)[panel], state = (states as Record<string, unknown>)[panel];
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || !state || typeof state !== 'object' || Array.isArray(state)) return false;
      usage += amount;
      const value = state as Record<string, unknown>;
      if (value.version !== 1 || value.email !== row.email || value.op !== 'delete' || !Array.isArray(value.steps) || !value.steps.length
        || !value.steps.every(step => step && typeof step === 'object' && step.status === 'DONE' && typeof step.key === 'string' && !!step.key && typeof step.identity === 'string' && !!step.identity)) return false;
    }
    return Math.abs(usage - row.usageSnapshotGB) < 1e-9;
  } catch { return false; }
}

export function wasCancelledBeforeExecution(row: OperationJournal): boolean {
  return ['RESET', 'DELETE'].includes(row.type) && row.status === 'CANCELLED' && !row.accountingCommitted
    && row.reservedGB === 0 && metadata(row.metadata)?.cancelledBeforeExecution === true;
}
