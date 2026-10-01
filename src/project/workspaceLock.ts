import { LocalFirstAtomicStore } from '../storage/atomicStorage';
import { validateProjectScopedPath } from '../security/securityFoundation';

/**
 * Hylix Workspace Lock Manager
 *
 * Prevents concurrent conflicting opens of the same project workspace.
 * Supports:
 * - Lock creation (`acquireWorkspaceLock`)
 * - Lock validation (`validateWorkspaceLock`)
 * - Stale lock detection (`DEFAULT_LOCK_LEASE_MS = 30000`)
 * - Safe lock release (`releaseWorkspaceLock`)
 * - Crash recovery (`recoverFromStaleLock` without locking the user out forever)
 */

export const DEFAULT_LOCK_LEASE_MS = 30_000;
export const WORKSPACE_LOCK_SUBPATH = '.hylix/workspace.lock';

export interface WorkspaceLockRecord {
  readonly lockSchemaVersion: 1;
  readonly projectId: string;
  readonly sessionId: string;
  readonly ownerTag: string;
  readonly acquiredAtEpochMs: number;
  readonly lastHeartbeatEpochMs: number;
  readonly leaseTimeoutMs: number;
}

export type LockInspectionState =
  | 'UNLOCKED'
  | 'LOCKED_BY_CURRENT_SESSION'
  | 'LOCKED_BY_OTHER_ACTIVE_SESSION'
  | 'STALE_LOCK_DETECTED'
  | 'CORRUPTED_LOCK_DETECTED';

export interface LockInspectionReport {
  readonly state: LockInspectionState;
  readonly record: WorkspaceLockRecord | null;
  readonly ageMs: number;
  readonly isStale: boolean;
  readonly details: string;
}

export function inspectWorkspaceLock(
  store: LocalFirstAtomicStore,
  projectRoot: string,
  currentSessionId: string,
  nowEpochMs: number = Date.now()
): LockInspectionReport {
  const scoped = validateProjectScopedPath(projectRoot, WORKSPACE_LOCK_SUBPATH);
  if (!scoped.safe) {
    return {
      state: 'CORRUPTED_LOCK_DETECTED',
      record: null,
      ageMs: 0,
      isStale: true,
      details: scoped.reason || 'Invalid lock path.',
    };
  }

  if (!store.fileExists(scoped.normalizedPath)) {
    return {
      state: 'UNLOCKED',
      record: null,
      ageMs: 0,
      isStale: false,
      details: 'No active workspace lock present.',
    };
  }

  const readRes = store.readVerifiedFile(scoped.normalizedPath, false);
  if (!readRes.valid || !readRes.record) {
    return {
      state: 'CORRUPTED_LOCK_DETECTED',
      record: null,
      ageMs: 0,
      isStale: true,
      details: 'Lock file failed checksum integrity check (likely interrupted during crash).',
    };
  }

  try {
    const parsed = JSON.parse(readRes.record.content) as Record<string, unknown>;
    if (
      parsed.lockSchemaVersion !== 1 ||
      typeof parsed.projectId !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.acquiredAtEpochMs !== 'number' ||
      typeof parsed.lastHeartbeatEpochMs !== 'number' ||
      typeof parsed.leaseTimeoutMs !== 'number'
    ) {
      return {
        state: 'CORRUPTED_LOCK_DETECTED',
        record: null,
        ageMs: 0,
        isStale: true,
        details: 'Lock file JSON schema is malformed.',
      };
    }

    const record = parsed as unknown as WorkspaceLockRecord;
    const ageMs = Math.max(0, nowEpochMs - record.lastHeartbeatEpochMs);
    const isStale = ageMs > record.leaseTimeoutMs;

    if (isStale) {
      return {
        state: 'STALE_LOCK_DETECTED',
        record,
        ageMs,
        isStale: true,
        details: `Stale lock from session '${record.sessionId}' detected (inactive for ${ageMs}ms > lease ${record.leaseTimeoutMs}ms).`,
      };
    }

    if (record.sessionId === currentSessionId) {
      return {
        state: 'LOCKED_BY_CURRENT_SESSION',
        record,
        ageMs,
        isStale: false,
        details: `Workspace is locked by current session '${currentSessionId}'.`,
      };
    }

    return {
      state: 'LOCKED_BY_OTHER_ACTIVE_SESSION',
      record,
      ageMs,
      isStale: false,
      details: `Workspace is actively locked by another session '${record.sessionId}'.`,
    };
  } catch {
    return {
      state: 'CORRUPTED_LOCK_DETECTED',
      record: null,
      ageMs: 0,
      isStale: true,
      details: 'Lock file contains invalid JSON.',
    };
  }
}

export interface AcquireLockResult {
  readonly acquired: boolean;
  readonly recoveredFromCrashOrStaleLock: boolean;
  readonly previousStaleSessionId?: string;
  readonly lockRecord: WorkspaceLockRecord | null;
  readonly error?: string;
}

export function acquireWorkspaceLock(
  store: LocalFirstAtomicStore,
  projectRoot: string,
  projectId: string,
  sessionId: string,
  options?: {
    nowEpochMs?: number;
    leaseTimeoutMs?: number;
    ownerTag?: string;
  }
): AcquireLockResult {
  const nowMs = options?.nowEpochMs ?? Date.now();
  const leaseMs = options?.leaseTimeoutMs ?? DEFAULT_LOCK_LEASE_MS;
  const ownerTag = options?.ownerTag ?? 'hylix-local-session';

  if (!sessionId || sessionId.trim().length === 0) {
    return {
      acquired: false,
      recoveredFromCrashOrStaleLock: false,
      lockRecord: null,
      error: 'sessionId must be a non-empty string.',
    };
  }

  const scoped = validateProjectScopedPath(projectRoot, WORKSPACE_LOCK_SUBPATH);
  if (!scoped.safe) {
    return {
      acquired: false,
      recoveredFromCrashOrStaleLock: false,
      lockRecord: null,
      error: scoped.reason,
    };
  }

  const inspection = inspectWorkspaceLock(store, projectRoot, sessionId, nowMs);
  if (inspection.state === 'LOCKED_BY_OTHER_ACTIVE_SESSION') {
    return {
      acquired: false,
      recoveredFromCrashOrStaleLock: false,
      lockRecord: null,
      error: `Cannot open project: ${inspection.details}`,
    };
  }

  const recoveredFromCrashOrStaleLock =
    inspection.state === 'STALE_LOCK_DETECTED' ||
    inspection.state === 'CORRUPTED_LOCK_DETECTED';
  const previousStaleSessionId = inspection.record?.sessionId;

  const newLock: WorkspaceLockRecord = Object.freeze({
    lockSchemaVersion: 1,
    projectId,
    sessionId,
    ownerTag,
    acquiredAtEpochMs:
      inspection.state === 'LOCKED_BY_CURRENT_SESSION' && inspection.record
        ? inspection.record.acquiredAtEpochMs
        : nowMs,
    lastHeartbeatEpochMs: nowMs,
    leaseTimeoutMs: leaseMs,
  });

  const writeRes = store.writeFileAtomically(
    scoped.normalizedPath,
    JSON.stringify(newLock, null, 2)
  );
  if (!writeRes.success) {
    return {
      acquired: false,
      recoveredFromCrashOrStaleLock: false,
      lockRecord: null,
      error: writeRes.error || 'Failed to write workspace lock atomically.',
    };
  }

  return {
    acquired: true,
    recoveredFromCrashOrStaleLock,
    previousStaleSessionId,
    lockRecord: newLock,
  };
}

export function releaseWorkspaceLock(
  store: LocalFirstAtomicStore,
  projectRoot: string,
  sessionId: string,
  nowEpochMs: number = Date.now()
): { released: boolean; error?: string } {
  const scoped = validateProjectScopedPath(projectRoot, WORKSPACE_LOCK_SUBPATH);
  if (!scoped.safe) {
    return { released: false, error: scoped.reason };
  }

  const inspection = inspectWorkspaceLock(store, projectRoot, sessionId, nowEpochMs);
  if (inspection.state === 'UNLOCKED') {
    return { released: true };
  }

  if (inspection.state === 'LOCKED_BY_OTHER_ACTIVE_SESSION') {
    return {
      released: false,
      error: `Session '${sessionId}' cannot release an active lock owned by '${inspection.record?.sessionId}'.`,
    };
  }

  store.releaseLockFileOnly(scoped.normalizedPath);
  return { released: true };
}
