import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import { redactSensitiveData } from '../security/securityFoundation';
import { ScriptWorldId } from './scriptIdentity';
import { ScriptRuntimeLifecycleState } from './scriptLifecycle';
import { ScriptRuntime } from './scriptRuntime';
import {
  ScriptExecutionBudget,
  ScriptExecutionBudgetUsage,
} from './scriptSandbox';

/**
 * Hylix V1.0.0 — Phase 09: Script Diagnostics & Redacted Telemetry Snapshot
 *
 * Provides safe, read-only diagnostic snapshots of `ScriptRuntime` health,
 * budget usage, and structured logs without leaking secrets, keystore paths,
 * credentials, or raw script source code.
 */

export interface ScriptRuntimeDiagnosticSnapshot {
  readonly scriptWorldId: ScriptWorldId;
  readonly projectId: string;
  readonly runtimeState: ScriptRuntimeLifecycleState;
  readonly registeredScriptCount: number;
  readonly activeInstanceCount: number;
  readonly pendingEventCount: number;
  readonly frameNumber: number;
  readonly fixedStepNumber: number;
  readonly budget: ScriptExecutionBudget;
  readonly budgetUsage: ScriptExecutionBudgetUsage;
  readonly boundaryStatement: string;
}

export function inspectScriptRuntimeDiagnostics(
  runtime: ScriptRuntime
): ScriptRuntimeDiagnosticSnapshot {
  return Object.freeze({
    scriptWorldId: runtime.getScriptWorldId(),
    projectId: redactSensitiveData(runtime.getProjectId()),
    runtimeState: runtime.getState(),
    registeredScriptCount: runtime.getRegistry().size(),
    activeInstanceCount: runtime.listInstances().length,
    pendingEventCount: runtime.getPendingEvents().length,
    frameNumber: runtime.getFrameNumber(),
    fixedStepNumber: runtime.getFixedStepNumber(),
    budget: runtime.getSandbox().getExecutionBudget(),
    budgetUsage: runtime.getSandbox().getBudgetUsage(),
    boundaryStatement: runtime.getBoundaryStatement(),
  });
}

export function recordScriptDiagnosticEvent(
  logger: RedactedDiagnosticLogger | undefined,
  severity: 'INFO' | 'WARN' | 'ERROR' | 'SECURITY_AUDIT',
  eventKey: string,
  detailMessage: string
): void {
  if (!logger) return;
  logger.record(
    'scripting',
    severity,
    `${eventKey}: ${redactSensitiveData(detailMessage)}`
  );
}
