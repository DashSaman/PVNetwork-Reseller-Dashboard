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

export function wasCancelledBeforeExecution(row: OperationJournal): boolean {
  return ['RESET', 'DELETE'].includes(row.type) && row.status === 'CANCELLED' && !row.accountingCommitted
    && row.reservedGB === 0 && metadata(row.metadata)?.cancelledBeforeExecution === true;
}
