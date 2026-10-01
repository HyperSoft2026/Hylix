import { isValidEntityId } from '../ecs/ecsCore';
import { ScriptCapability } from './scriptCapabilities';
import {
  createDeterministicScriptInstanceId,
  isValidScriptId,
  isValidScriptInstanceId,
  ScriptId,
  ScriptInstanceId,
} from './scriptIdentity';
import {
  ScriptInstanceLifecycleState,
  validateScriptInstanceLifecycleTransition,
} from './scriptLifecycle';
import {
  createScriptError,
  isFiniteScriptNumber,
  ScriptCategory,
  ScriptValidationResult,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Controlled ScriptInstance Abstraction
 *
 * Encapsulates per-instance state (`instanceId`, `scriptId`, `projectId`, optional `entityId`,
 * `lifecycleState`, `enabled`, `executionPriority`, `capabilities`, and `executionStatistics`)
 * without exposing mutable engine internals.
 */

export interface ScriptExecutionStatistics {
  readonly initializedAtTick: number | null;
  readonly updateTicksCount: number;
  readonly fixedUpdateTicksCount: number;
  readonly lateUpdateTicksCount: number;
  readonly eventsHandledCount: number;
  readonly totalInstructionsCount: number;
  readonly totalEntityOperationsCount: number;
  readonly totalPhysicsQueriesCount: number;
  readonly totalAudioCommandsCount: number;
}

export interface ScriptInstanceDescriptor {
  readonly instanceId: ScriptInstanceId;
  readonly scriptId: ScriptId;
  readonly projectId: string;
  readonly entityId: string | null;
  readonly category: ScriptCategory;
  readonly executionPriority: number;
  readonly lifecycleState: ScriptInstanceLifecycleState;
  readonly enabled: boolean;
  readonly capabilities: readonly ScriptCapability[];
  readonly statistics: ScriptExecutionStatistics;
}

export function createInitialScriptExecutionStatistics(): ScriptExecutionStatistics {
  return Object.freeze({
    initializedAtTick: null,
    updateTicksCount: 0,
    fixedUpdateTicksCount: 0,
    lateUpdateTicksCount: 0,
    eventsHandledCount: 0,
    totalInstructionsCount: 0,
    totalEntityOperationsCount: 0,
    totalPhysicsQueriesCount: 0,
    totalAudioCommandsCount: 0,
  });
}

export class ScriptInstanceController {
  private readonly instanceId: ScriptInstanceId;
  private readonly scriptId: ScriptId;
  private readonly projectId: string;
  private readonly entityId: string | null;
  private readonly category: ScriptCategory;
  private readonly executionPriority: number;
  private readonly capabilities: readonly ScriptCapability[];

  private lifecycleState: ScriptInstanceLifecycleState = 'created';
  private enabled = false;
  private statistics: ScriptExecutionStatistics =
    createInitialScriptExecutionStatistics();

  private constructor(params: {
    readonly instanceId: ScriptInstanceId;
    readonly scriptId: ScriptId;
    readonly projectId: string;
    readonly entityId: string | null;
    readonly category: ScriptCategory;
    readonly executionPriority: number;
    readonly capabilities: readonly ScriptCapability[];
  }) {
    this.instanceId = params.instanceId;
    this.scriptId = params.scriptId;
    this.projectId = params.projectId;
    this.entityId = params.entityId;
    this.category = params.category;
    this.executionPriority = params.executionPriority;
    this.capabilities = Object.freeze([...params.capabilities]);
  }

  public static create(options: {
    readonly instanceId?: ScriptInstanceId;
    readonly scriptId: ScriptId;
    readonly projectId: string;
    readonly entityId?: string | null;
    readonly slotKey?: string;
    readonly category: ScriptCategory;
    readonly executionPriority?: number;
    readonly capabilities: readonly ScriptCapability[];
  }): ScriptValidationResult<ScriptInstanceController> {
    if (
      typeof options.projectId !== 'string' ||
      options.projectId.trim().length === 0
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            'ScriptInstance.projectId must be a non-empty string.'
          ),
        ],
      };
    }

    if (!isValidScriptId(options.scriptId)) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `Invalid ScriptInstance.scriptId '${String(options.scriptId)}'.`
          ),
        ],
      };
    }

    const entityId =
      options.entityId !== undefined && options.entityId !== null
        ? options.entityId
        : null;
    if (entityId !== null && !isValidEntityId(entityId)) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `Invalid ScriptInstance.entityId '${String(entityId)}'. Expected 'ent_<16-hex>' or null.`
          ),
        ],
      };
    }

    const priority =
      options.executionPriority !== undefined ? options.executionPriority : 0;
    if (
      !isFiniteScriptNumber(priority) ||
      !Number.isInteger(priority) ||
      priority < -10000 ||
      priority > 10000
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            'ScriptInstance.executionPriority must be an integer in [-10000, 10000].'
          ),
        ],
      };
    }

    const resolvedInstanceId =
      options.instanceId !== undefined
        ? options.instanceId
        : createDeterministicScriptInstanceId(
            options.projectId,
            options.scriptId,
            entityId ?? options.slotKey ?? 'global_0'
          );

    if (!isValidScriptInstanceId(resolvedInstanceId)) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `Invalid ScriptInstanceId '${String(resolvedInstanceId)}'. Expected 'sinst_<16-hex>'.`
          ),
        ],
      };
    }

    const controller = new ScriptInstanceController({
      instanceId: resolvedInstanceId.toLowerCase() as ScriptInstanceId,
      scriptId: options.scriptId.toLowerCase() as ScriptId,
      projectId: options.projectId.trim(),
      entityId,
      category: options.category,
      executionPriority: priority,
      capabilities: options.capabilities,
    });

    return {
      valid: true,
      value: controller,
      errors: [],
    };
  }

  public getInstanceId(): ScriptInstanceId {
    return this.instanceId;
  }

  public getScriptId(): ScriptId {
    return this.scriptId;
  }

  public getProjectId(): string {
    return this.projectId;
  }

  public getEntityId(): string | null {
    return this.entityId;
  }

  public getCategory(): ScriptCategory {
    return this.category;
  }

  public getExecutionPriority(): number {
    return this.executionPriority;
  }

  public getLifecycleState(): ScriptInstanceLifecycleState {
    return this.lifecycleState;
  }

  public isEnabled(): boolean {
    return this.enabled && this.lifecycleState === 'enabled';
  }

  public getCapabilities(): readonly ScriptCapability[] {
    return this.capabilities;
  }

  public transitionTo(
    targetState: ScriptInstanceLifecycleState,
    currentTick = 0
  ): ScriptValidationResult<ScriptInstanceDescriptor> {
    const check = validateScriptInstanceLifecycleTransition(
      this.instanceId,
      this.lifecycleState,
      targetState
    );
    if (!check.valid) {
      return {
        valid: false,
        value: null,
        errors: check.errors,
      };
    }

    this.lifecycleState = targetState;
    this.enabled = targetState === 'enabled';

    if (
      targetState === 'initialized' &&
      this.statistics.initializedAtTick === null
    ) {
      this.statistics = Object.freeze({
        ...this.statistics,
        initializedAtTick: currentTick,
      });
    }

    return {
      valid: true,
      value: this.getDescriptor(),
      errors: [],
    };
  }

  public recordPhaseExecution(
    phase: 'Update' | 'FixedUpdate' | 'LateUpdate' | 'Event',
    deltaStats?: {
      readonly instructions?: number;
      readonly entityOps?: number;
      readonly physicsQueries?: number;
      readonly audioCommands?: number;
    }
  ): void {
    this.statistics = Object.freeze({
      ...this.statistics,
      updateTicksCount:
        this.statistics.updateTicksCount + (phase === 'Update' ? 1 : 0),
      fixedUpdateTicksCount:
        this.statistics.fixedUpdateTicksCount +
        (phase === 'FixedUpdate' ? 1 : 0),
      lateUpdateTicksCount:
        this.statistics.lateUpdateTicksCount + (phase === 'LateUpdate' ? 1 : 0),
      eventsHandledCount:
        this.statistics.eventsHandledCount + (phase === 'Event' ? 1 : 0),
      totalInstructionsCount:
        this.statistics.totalInstructionsCount +
        (deltaStats?.instructions ?? 0),
      totalEntityOperationsCount:
        this.statistics.totalEntityOperationsCount +
        (deltaStats?.entityOps ?? 0),
      totalPhysicsQueriesCount:
        this.statistics.totalPhysicsQueriesCount +
        (deltaStats?.physicsQueries ?? 0),
      totalAudioCommandsCount:
        this.statistics.totalAudioCommandsCount +
        (deltaStats?.audioCommands ?? 0),
    });
  }

  public getDescriptor(): ScriptInstanceDescriptor {
    return Object.freeze({
      instanceId: this.instanceId,
      scriptId: this.scriptId,
      projectId: this.projectId,
      entityId: this.entityId,
      category: this.category,
      executionPriority: this.executionPriority,
      lifecycleState: this.lifecycleState,
      enabled: this.enabled,
      capabilities: this.capabilities,
      statistics: this.statistics,
    });
  }
}
