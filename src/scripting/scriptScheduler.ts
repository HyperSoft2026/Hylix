import { ScriptId, ScriptInstanceId } from './scriptIdentity';
import { ScriptInstanceDescriptor } from './scriptInstance';
import {
  createScriptError,
  ScriptSchedulerPhase,
  ScriptValidationResult,
  VALID_SCRIPT_SCHEDULER_PHASES,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Deterministic ScriptScheduler
 *
 * Defines deterministic execution ordering across conceptual phases:
 * `Initialization | FixedUpdate | Update | LateUpdate | Event | Shutdown`
 *
 * Canonical ordering:
 *   1. `executionPriority ASC`
 *   2. `scriptId ASC`
 *   3. `instanceId ASC`
 *
 * Never relies on `Math.random()`, wall-clock time, or JavaScript object insertion order.
 */

export interface ScheduledScriptSlot {
  readonly orderIndex: number;
  readonly phase: ScriptSchedulerPhase;
  readonly instanceId: ScriptInstanceId;
  readonly scriptId: ScriptId;
  readonly entityId: string | null;
  readonly executionPriority: number;
}

export interface ScriptExecutionSchedulePlan {
  readonly projectId: string;
  readonly phase: ScriptSchedulerPhase;
  readonly frameNumber: number;
  readonly fixedStepNumber: number;
  readonly slots: readonly ScheduledScriptSlot[];
}

/**
 * Deterministically sorts `ScriptInstanceDescriptor` items by:
 * 1. `executionPriority ASC`
 * 2. `scriptId ASC`
 * 3. `instanceId ASC`
 */
export function sortScriptInstancesDeterministically(
  instances: readonly ScriptInstanceDescriptor[]
): readonly ScriptInstanceDescriptor[] {
  return Object.freeze(
    instances.slice().sort((a, b) => {
      if (a.executionPriority !== b.executionPriority) {
        return a.executionPriority - b.executionPriority;
      }
      const scriptCmp = a.scriptId.localeCompare(b.scriptId);
      if (scriptCmp !== 0) {
        return scriptCmp;
      }
      return a.instanceId.localeCompare(b.instanceId);
    })
  );
}

export class ScriptScheduler {
  private readonly projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId.trim();
  }

  public getProjectId(): string {
    return this.projectId;
  }

  /**
   * Builds a deterministic, read-only execution schedule plan for the requested phase.
   * Does NOT execute arbitrary source code.
   */
  public buildPhaseSchedule(options: {
    readonly phase: ScriptSchedulerPhase;
    readonly instances: readonly ScriptInstanceDescriptor[];
    readonly frameNumber: number;
    readonly fixedStepNumber: number;
  }): ScriptValidationResult<ScriptExecutionSchedulePlan> {
    if (!VALID_SCRIPT_SCHEDULER_PHASES.has(options.phase)) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `Invalid ScriptSchedulerPhase '${String(options.phase)}'.`
          ),
        ],
      };
    }

    if (
      !Number.isInteger(options.frameNumber) ||
      options.frameNumber < 0 ||
      !Number.isInteger(options.fixedStepNumber) ||
      options.fixedStepNumber < 0
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            'frameNumber and fixedStepNumber must be non-negative integers.'
          ),
        ],
      };
    }

    for (const inst of options.instances) {
      if (inst.projectId !== this.projectId) {
        return {
          valid: false,
          value: null,
          errors: [
            createScriptError(
              'SCRIPT_PROJECT_ISOLATION_ERROR',
              `Cannot schedule ScriptInstance '${inst.instanceId}' from project '${inst.projectId}' in ScriptScheduler for project '${this.projectId}'.`
            ),
          ],
        };
      }
    }

    const eligible = options.instances.filter((inst) => {
      if (inst.lifecycleState === 'destroyed') return false;
      if (options.phase === 'Initialization') {
        return inst.lifecycleState === 'created' || inst.lifecycleState === 'initialized';
      }
      if (options.phase === 'Shutdown') {
        return true;
      }
      // FixedUpdate, Update, LateUpdate, Event require enabled instances
      return inst.enabled && inst.lifecycleState === 'enabled';
    });

    const sorted = sortScriptInstancesDeterministically(eligible);
    const slots: ScheduledScriptSlot[] = sorted.map((inst, idx) =>
      Object.freeze({
        orderIndex: idx,
        phase: options.phase,
        instanceId: inst.instanceId,
        scriptId: inst.scriptId,
        entityId: inst.entityId,
        executionPriority: inst.executionPriority,
      })
    );

    return {
      valid: true,
      value: Object.freeze({
        projectId: this.projectId,
        phase: options.phase,
        frameNumber: options.frameNumber,
        fixedStepNumber: options.fixedStepNumber,
        slots: Object.freeze(slots),
      }),
      errors: [],
    };
  }
}
