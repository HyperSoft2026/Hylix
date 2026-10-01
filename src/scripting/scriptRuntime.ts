import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  NullContractScriptRuntimeBackend,
  PlatformScriptRuntimeBackendContract,
} from '../platform/platformAbstraction';
import { ScriptBindings, ScriptBindingsOptions } from './scriptBindings';
import { ScriptContext } from './scriptContext';
import {
  createValidatedScriptEvent,
  ScriptEvent,
  ScriptEventPayloadValue,
  ScriptEventType,
  sortScriptEventsDeterministically,
} from './scriptEvents';
import {
  createDeterministicScriptWorldId,
  isValidScriptId,
  isValidScriptInstanceId,
  ScriptId,
  ScriptInstanceId,
  ScriptWorldId,
} from './scriptIdentity';
import {
  ScriptInstanceController,
  ScriptInstanceDescriptor,
} from './scriptInstance';
import {
  ScriptRuntimeLifecycleState,
  validateScriptRuntimeLifecycleTransition,
} from './scriptLifecycle';
import {
  createDefaultScriptPermissionPolicy,
  ScriptPermissionPolicy,
} from './scriptPermissions';
import { RegisteredScriptEntry, ScriptRegistry } from './scriptRegistry';
import {
  createDefaultScriptExecutionBudget,
  PHASE_09_SANDBOX_BOUNDARY_STATEMENT,
  ScriptExecutionBudget,
  ScriptSandbox,
} from './scriptSandbox';
import {
  ScriptExecutionSchedulePlan,
  ScriptScheduler,
  sortScriptInstancesDeterministically,
} from './scriptScheduler';
import {
  createScriptError,
  isFiniteScriptNumber,
  MAX_SCRIPTS_PER_PROJECT,
  ScriptDiagnosticError,
  ScriptValidationResult,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Project-Isolated ScriptRuntime (ScriptWorld)
 *
 * Coordinates `ScriptRegistry`, `ScriptSandbox`, `ScriptBindings`, `ScriptScheduler`,
 * `ScriptInstanceController` lifecycles, deterministic event queues, and
 * `PlatformScriptRuntimeBackendContract` without executing untrusted source code.
 */

export interface ScriptRuntimeOptions {
  readonly projectId: string;
  readonly maxScripts?: number;
  readonly policy?: ScriptPermissionPolicy;
  readonly budget?: ScriptExecutionBudget;
  readonly backend?: PlatformScriptRuntimeBackendContract;
  readonly subsystems?: Omit<ScriptBindingsOptions, 'projectId' | 'sandbox'>;
  readonly logger?: RedactedDiagnosticLogger;
}

export interface ScriptFrameUpdateSummary {
  readonly frameNumber: number;
  readonly fixedStepNumber: number;
  readonly elapsedSeconds: number;
  readonly updatePlan: ScriptExecutionSchedulePlan;
  readonly eventPlan: ScriptExecutionSchedulePlan;
  readonly lateUpdatePlan: ScriptExecutionSchedulePlan;
  readonly processedEvents: readonly ScriptEvent[];
}

export class ScriptRuntime {
  public readonly scriptWorldId: ScriptWorldId;
  public readonly projectId: string;

  private state: ScriptRuntimeLifecycleState = 'uninitialized';
  private readonly registry: ScriptRegistry;
  private readonly sandbox: ScriptSandbox;
  private readonly bindings: ScriptBindings;
  private readonly scheduler: ScriptScheduler;
  private readonly backend: PlatformScriptRuntimeBackendContract;
  private readonly logger?: RedactedDiagnosticLogger;

  private readonly instancesById = new Map<
    ScriptInstanceId,
    ScriptInstanceController
  >();
  private readonly destroyedInstancesById = new Map<
    ScriptInstanceId,
    ScriptInstanceDescriptor
  >();

  private readonly pendingEvents: ScriptEvent[] = [];
  private readonly processedEventHistory: ScriptEvent[] = [];
  private nextEventSequence = 1;

  private frameNumber = 0;
  private fixedStepNumber = 0;
  private elapsedSeconds = 0;
  private fixedDeltaTime = 1 / 60;

  constructor(options: ScriptRuntimeOptions) {
    this.projectId = options.projectId.trim();
    this.scriptWorldId = createDeterministicScriptWorldId(this.projectId);
    this.logger = options.logger;

    const initialPolicy =
      options.policy ?? createDefaultScriptPermissionPolicy();
    const initialBudget =
      options.budget ?? createDefaultScriptExecutionBudget(initialPolicy);

    this.registry = new ScriptRegistry({
      projectId: this.projectId,
      maxScripts: options.maxScripts ?? MAX_SCRIPTS_PER_PROJECT,
      logger: this.logger,
    });

    this.sandbox = new ScriptSandbox({
      projectId: this.projectId,
      policy: initialPolicy,
      budget: initialBudget,
      logger: this.logger,
    });

    this.bindings = new ScriptBindings({
      projectId: this.projectId,
      sandbox: this.sandbox,
      assetRegistry: options.subsystems?.assetRegistry,
      inputManager: options.subsystems?.inputManager,
      physicsWorld: options.subsystems?.physicsWorld,
      audioWorld: options.subsystems?.audioWorld,
      logger: this.logger,
    });

    this.scheduler = new ScriptScheduler(this.projectId);
    this.backend = options.backend ?? new NullContractScriptRuntimeBackend();
  }

  public getProjectId(): string {
    return this.projectId;
  }

  public getScriptWorldId(): ScriptWorldId {
    return this.scriptWorldId;
  }

  public getState(): ScriptRuntimeLifecycleState {
    return this.state;
  }

  public getBoundaryStatement(): string {
    return PHASE_09_SANDBOX_BOUNDARY_STATEMENT;
  }

  public getRegistry(): ScriptRegistry {
    return this.registry;
  }

  public getSandbox(): ScriptSandbox {
    return this.sandbox;
  }

  public getBindings(): ScriptBindings {
    return this.bindings;
  }

  public getScheduler(): ScriptScheduler {
    return this.scheduler;
  }

  public getBackend(): PlatformScriptRuntimeBackendContract {
    return this.backend;
  }

  public getFrameNumber(): number {
    return this.frameNumber;
  }

  public getFixedStepNumber(): number {
    return this.fixedStepNumber;
  }

  public getElapsedSeconds(): number {
    return this.elapsedSeconds;
  }

  public initialize(): ScriptValidationResult<true> {
    if (this.state !== 'uninitialized') {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `Cannot initialize ScriptRuntime from state '${this.state}' (expected 'uninitialized').`
          ),
        ],
      };
    }

    const trans = validateScriptRuntimeLifecycleTransition(
      this.state,
      'ready'
    );
    if (!trans.valid) {
      return { valid: false, value: null, errors: trans.errors };
    }

    const backendInit = this.backend.initialize();
    if (!backendInit.success) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_RUNTIME_ERROR',
            backendInit.error ?? 'Failed to initialize script runtime backend.'
          ),
        ],
      };
    }

    this.state = 'ready';
    this.logger?.record(
      'scripting',
      'INFO',
      `script_runtime_initialized: worldId=${this.scriptWorldId} projectId=${this.projectId}`
    );

    return { valid: true, value: true, errors: [] };
  }

  public shutdown(): ScriptValidationResult<true> {
    if (this.state === 'shutdown') {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            'ScriptRuntime is already shut down.'
          ),
        ],
      };
    }

    const trans = validateScriptRuntimeLifecycleTransition(
      this.state,
      'shutdown'
    );
    if (!trans.valid) {
      return { valid: false, value: null, errors: trans.errors };
    }

    // Deterministically destroy all active instances during shutdown
    const sortedInstances = this.listInstances();
    for (const desc of sortedInstances) {
      const ctrl = this.instancesById.get(desc.instanceId);
      if (ctrl && ctrl.getLifecycleState() !== 'destroyed') {
        ctrl.transitionTo('destroyed', this.frameNumber);
        this.destroyedInstancesById.set(desc.instanceId, ctrl.getDescriptor());
      }
    }
    this.instancesById.clear();
    this.pendingEvents.length = 0;
    this.sandbox.resetFrameBudget();
    this.backend.shutdown();

    this.state = 'shutdown';
    this.logger?.record(
      'scripting',
      'INFO',
      `script_runtime_shutdown: worldId=${this.scriptWorldId} projectId=${this.projectId}`
    );

    return { valid: true, value: true, errors: [] };
  }

  /**
   * Completely cleans up all scripts, instances, bindings, events, and budgets on project close.
   */
  public resetForProjectClose(): void {
    if (this.state !== 'shutdown') {
      this.shutdown();
    }
    this.instancesById.clear();
    this.destroyedInstancesById.clear();
    this.registry.clear();
    this.bindings.clear();
    this.sandbox.resetFrameBudget();
    this.pendingEvents.length = 0;
    this.processedEventHistory.length = 0;
    this.nextEventSequence = 1;
    this.frameNumber = 0;
    this.fixedStepNumber = 0;
    this.elapsedSeconds = 0;
  }

  public registerScript(
    manifestCandidate: unknown,
    sourceCandidate?: unknown
  ): ScriptValidationResult<RegisteredScriptEntry> {
    if (this.state === 'shutdown') {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            'Cannot register scripts after ScriptRuntime shutdown.'
          ),
        ],
      };
    }
    return this.registry.registerScript(manifestCandidate, sourceCandidate);
  }

  public unregisterScript(
    scriptId: ScriptId,
    options?: { readonly forceDestroyInstances?: boolean }
  ): ScriptValidationResult<true> {
    if (!isValidScriptId(scriptId)) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `Invalid ScriptId '${String(scriptId)}'.`
          ),
        ],
      };
    }

    const normId = scriptId.toLowerCase() as ScriptId;
    const activeForScript = Array.from(this.instancesById.values()).filter(
      (inst) =>
        inst.getScriptId() === normId &&
        inst.getLifecycleState() !== 'destroyed'
    );

    if (activeForScript.length > 0 && !options?.forceDestroyInstances) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `Cannot unregister script '${normId}' while ${activeForScript.length} active ScriptInstance(s) exist.`
          ),
        ],
      };
    }

    for (const inst of activeForScript) {
      this.destroyInstance(inst.getInstanceId());
    }

    const res = this.registry.unregisterScript(normId);
    if (!res.success) {
      return { valid: false, value: null, errors: res.errors };
    }
    return { valid: true, value: true, errors: [] };
  }

  public createInstance(options: {
    readonly instanceId?: ScriptInstanceId;
    readonly scriptId: ScriptId;
    readonly entityId?: string | null;
    readonly slotKey?: string;
    readonly executionPriority?: number;
    readonly autoInitialize?: boolean;
    readonly autoEnable?: boolean;
  }): ScriptValidationResult<ScriptInstanceDescriptor> {
    if (this.state !== 'ready') {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `ScriptRuntime must be in 'ready' state to create instances (current: '${this.state}').`
          ),
        ],
      };
    }

    const entry = this.registry.findScript(options.scriptId);
    if (!entry) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `Cannot create ScriptInstance: script '${String(options.scriptId)}' is not registered in project '${this.projectId}'.`
          ),
        ],
      };
    }

    const policy = this.sandbox.getPermissionPolicy();
    if (
      entry.manifest.category === 'Editor' &&
      !policy.allowEditorCategoryExecution
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_PERMISSION_ERROR',
            `Script '${entry.manifest.scriptId}' has category 'Editor', which cannot be instantiated in runtime when allowEditorCategoryExecution is false.`
          ),
        ],
      };
    }

    if (this.instancesById.size >= policy.maxInstances) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BUDGET_EXCEEDED_ERROR',
            `Maximum active ScriptInstances limit (${policy.maxInstances}) reached for project '${this.projectId}'.`
          ),
        ],
      };
    }

    const createdRes = ScriptInstanceController.create({
      instanceId: options.instanceId,
      scriptId: entry.manifest.scriptId,
      projectId: this.projectId,
      entityId: options.entityId ?? null,
      slotKey: options.slotKey,
      category: entry.manifest.category,
      executionPriority: options.executionPriority ?? 0,
      capabilities: entry.manifest.capabilities,
    });

    if (!createdRes.valid || !createdRes.value) {
      return { valid: false, value: null, errors: createdRes.errors };
    }

    const controller = createdRes.value;
    const instId = controller.getInstanceId();

    if (
      this.instancesById.has(instId) ||
      this.destroyedInstancesById.has(instId)
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `Duplicate or previously destroyed ScriptInstanceId '${instId}' cannot be reused.`
          ),
        ],
      };
    }

    this.instancesById.set(instId, controller);

    const shouldInit =
      options.autoInitialize === true || options.autoEnable === true;
    if (shouldInit) {
      const initRes = this.initializeInstance(instId);
      if (!initRes.valid) return initRes;
    }

    if (options.autoEnable === true) {
      const enableRes = this.enableInstance(instId);
      if (!enableRes.valid) return enableRes;
    }

    return {
      valid: true,
      value: controller.getDescriptor(),
      errors: [],
    };
  }

  public initializeInstance(
    instanceId: ScriptInstanceId
  ): ScriptValidationResult<ScriptInstanceDescriptor> {
    const ctrl = this.instancesById.get(instanceId);
    if (!ctrl) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `ScriptInstance '${String(instanceId)}' does not exist in active runtime.`
          ),
        ],
      };
    }

    const res = ctrl.transitionTo('initialized', this.frameNumber);
    if (!res.valid || !res.value) return res;

    this.backend.recordScheduledStep({
      instanceId: ctrl.getInstanceId(),
      scriptId: ctrl.getScriptId(),
      projectId: this.projectId,
      phase: 'Initialization',
      frameNumber: this.frameNumber,
      fixedStepNumber: this.fixedStepNumber,
      instructionCostEstimate: 1,
    });

    this.enqueueLifecycleEvent(ctrl, 'ScriptInitialized');
    this.logger?.record(
      'scripting',
      'INFO',
      `script_instance_initialized: instanceId=${ctrl.getInstanceId()} scriptId=${ctrl.getScriptId()}`
    );

    return res;
  }

  public enableInstance(
    instanceId: ScriptInstanceId
  ): ScriptValidationResult<ScriptInstanceDescriptor> {
    const ctrl = this.instancesById.get(instanceId);
    if (!ctrl) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `ScriptInstance '${String(instanceId)}' does not exist in active runtime.`
          ),
        ],
      };
    }

    const res = ctrl.transitionTo('enabled', this.frameNumber);
    if (!res.valid || !res.value) return res;

    this.enqueueLifecycleEvent(ctrl, 'ScriptEnabled');
    return res;
  }

  public disableInstance(
    instanceId: ScriptInstanceId
  ): ScriptValidationResult<ScriptInstanceDescriptor> {
    const ctrl = this.instancesById.get(instanceId);
    if (!ctrl) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `ScriptInstance '${String(instanceId)}' does not exist in active runtime.`
          ),
        ],
      };
    }

    const res = ctrl.transitionTo('disabled', this.frameNumber);
    if (!res.valid || !res.value) return res;

    this.enqueueLifecycleEvent(ctrl, 'ScriptDisabled');
    return res;
  }

  public destroyInstance(
    instanceId: ScriptInstanceId
  ): ScriptValidationResult<ScriptInstanceDescriptor> {
    if (!isValidScriptInstanceId(instanceId)) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `Invalid ScriptInstanceId '${String(instanceId)}'.`
          ),
        ],
      };
    }

    const normId = instanceId.toLowerCase() as ScriptInstanceId;
    if (this.destroyedInstancesById.has(normId)) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `ScriptInstance '${normId}' is already destroyed and cannot transition or execute again.`
          ),
        ],
      };
    }

    const ctrl = this.instancesById.get(normId);
    if (!ctrl) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `ScriptInstance '${normId}' does not exist in active runtime.`
          ),
        ],
      };
    }

    const res = ctrl.transitionTo('destroyed', this.frameNumber);
    if (!res.valid || !res.value) return res;

    this.instancesById.delete(normId);
    this.destroyedInstancesById.set(normId, res.value);
    this.enqueueLifecycleEvent(ctrl, 'ScriptDestroyed');

    this.logger?.record(
      'scripting',
      'INFO',
      `script_instance_destroyed: instanceId=${normId}`
    );

    return res;
  }

  private enqueueLifecycleEvent(
    ctrl: ScriptInstanceController,
    eventType:
      | 'ScriptInitialized'
      | 'ScriptEnabled'
      | 'ScriptDisabled'
      | 'ScriptDestroyed'
  ): void {
    const policy = this.sandbox.getPermissionPolicy();
    if (this.pendingEvents.length >= policy.maxEventsPerFrame) {
      return;
    }
    const seq = this.nextEventSequence++;
    const ev = createValidatedScriptEvent({
      sequence: seq,
      source: ctrl.getInstanceId(),
      projectId: this.projectId,
      entityId: ctrl.getEntityId(),
      eventType,
      customEventName: null,
      payload: {
        scriptId: ctrl.getScriptId(),
        instanceId: ctrl.getInstanceId(),
      },
    });
    if (ev.valid && ev.value) {
      this.pendingEvents.push(ev.value);
    }
  }

  public getInstance(instanceId: string): ScriptInstanceDescriptor | undefined {
    if (!isValidScriptInstanceId(instanceId)) return undefined;
    const norm = instanceId.toLowerCase() as ScriptInstanceId;
    const active = this.instancesById.get(norm);
    if (active) return active.getDescriptor();
    return this.destroyedInstancesById.get(norm);
  }

  public listInstances(): readonly ScriptInstanceDescriptor[] {
    const descriptors = Array.from(this.instancesById.values()).map((c) =>
      c.getDescriptor()
    );
    return sortScriptInstancesDeterministically(descriptors);
  }

  public createContextForInstance(
    instanceId: ScriptInstanceId
  ): ScriptValidationResult<ScriptContext> {
    if (this.state !== 'ready' && this.state !== 'updating') {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `Cannot create ScriptContext when ScriptRuntime is '${this.state}'.`
          ),
        ],
      };
    }

    if (!isValidScriptInstanceId(instanceId)) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `Invalid ScriptInstanceId '${String(instanceId)}'.`
          ),
        ],
      };
    }

    const norm = instanceId.toLowerCase() as ScriptInstanceId;
    if (this.destroyedInstancesById.has(norm)) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `Cannot create ScriptContext for destroyed ScriptInstance '${norm}'.`
          ),
        ],
      };
    }

    const ctrl = this.instancesById.get(norm);
    if (!ctrl) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `ScriptInstance '${norm}' is not registered in this ScriptRuntime.`
          ),
        ],
      };
    }

    return {
      valid: true,
      value: new ScriptContext({
        instance: ctrl,
        sandbox: this.sandbox,
        bindings: this.bindings,
      }),
      errors: [],
    };
  }

  public enqueueEvent(options: {
    readonly source: string;
    readonly eventType: ScriptEventType;
    readonly entityId?: string | null;
    readonly customEventName?: string | null;
    readonly payload?: Readonly<Record<string, ScriptEventPayloadValue>>;
    readonly projectId?: string;
  }): ScriptValidationResult<ScriptEvent> {
    if (this.state !== 'ready' && this.state !== 'updating') {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `Cannot enqueue ScriptEvent when ScriptRuntime is '${this.state}'.`
          ),
        ],
      };
    }

    if (options.projectId !== undefined) {
      const projCheck = this.sandbox.verifyProjectOwnership(
        options.projectId,
        'enqueueEvent'
      );
      if (!projCheck.valid) {
        return { valid: false, value: null, errors: projCheck.errors };
      }
    }

    const policy = this.sandbox.getPermissionPolicy();
    if (this.pendingEvents.length >= policy.maxEventsPerFrame) {
      const err = createScriptError(
        'SCRIPT_BUDGET_EXCEEDED_ERROR',
        `ScriptRuntime pending event queue limit (${policy.maxEventsPerFrame}) reached for frame ${this.frameNumber}.`
      );
      this.logger?.record(
        'scripting',
        'WARN',
        `script_event_overflow: ${err.message}`
      );
      return { valid: false, value: null, errors: [err] };
    }

    const seq = this.nextEventSequence++;
    const evRes = createValidatedScriptEvent({
      sequence: seq,
      source: options.source,
      projectId: this.projectId,
      entityId: options.entityId ?? null,
      eventType: options.eventType,
      customEventName: options.customEventName ?? null,
      payload: options.payload ?? {},
    });

    if (!evRes.valid || !evRes.value) {
      return evRes;
    }

    this.pendingEvents.push(evRes.value);
    return evRes;
  }

  public getPendingEvents(): readonly ScriptEvent[] {
    return sortScriptEventsDeterministically(this.pendingEvents);
  }

  public getProcessedEventHistory(): readonly ScriptEvent[] {
    return Object.freeze([...this.processedEventHistory]);
  }

  /**
   * Executes a deterministic `FixedUpdate` step across all enabled `ScriptInstance`s.
   */
  public stepFixedUpdate(
    fixedDeltaTime = this.fixedDeltaTime
  ): ScriptValidationResult<ScriptExecutionSchedulePlan> {
    if (this.state !== 'ready') {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `Cannot run stepFixedUpdate from state '${this.state}' (expected 'ready').`
          ),
        ],
      };
    }

    if (
      !isFiniteScriptNumber(fixedDeltaTime) ||
      fixedDeltaTime <= 0 ||
      fixedDeltaTime > 1.0
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            'fixedDeltaTime must be a finite number in (0, 1.0].'
          ),
        ],
      };
    }

    this.fixedDeltaTime = fixedDeltaTime;
    this.state = 'updating';

    const planRes = this.scheduler.buildPhaseSchedule({
      phase: 'FixedUpdate',
      instances: this.listInstances(),
      frameNumber: this.frameNumber,
      fixedStepNumber: this.fixedStepNumber,
    });

    if (!planRes.valid || !planRes.value) {
      this.state = 'ready';
      return planRes;
    }

    const errors: ScriptDiagnosticError[] = [];
    for (const slot of planRes.value.slots) {
      const budgetRes = this.sandbox.consumeBudget('instruction', 1);
      if (!budgetRes.valid) {
        errors.push(...budgetRes.errors);
        break;
      }
      const ctrl = this.instancesById.get(slot.instanceId);
      if (ctrl) {
        ctrl.recordPhaseExecution('FixedUpdate', { instructions: 1 });
        this.backend.recordScheduledStep({
          instanceId: slot.instanceId,
          scriptId: slot.scriptId,
          projectId: this.projectId,
          phase: 'FixedUpdate',
          frameNumber: this.frameNumber,
          fixedStepNumber: this.fixedStepNumber,
          instructionCostEstimate: 1,
        });
      }
    }

    this.fixedStepNumber += 1;
    this.bindings.setTimeSnapshot({
      frameNumber: this.frameNumber,
      fixedStepNumber: this.fixedStepNumber,
      deltaTime: this.bindings.getTimeSnapshot().deltaTime,
      fixedDeltaTime: this.fixedDeltaTime,
      elapsedSeconds: this.elapsedSeconds,
    });

    this.state = 'ready';

    if (errors.length > 0) {
      return { valid: false, value: null, errors };
    }

    return planRes;
  }

  /**
   * Executes a deterministic frame update (`Update -> Event -> LateUpdate`).
   */
  public stepUpdate(
    deltaTime: number
  ): ScriptValidationResult<ScriptFrameUpdateSummary> {
    if (this.state !== 'ready') {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `Cannot run stepUpdate from state '${this.state}' (expected 'ready').`
          ),
        ],
      };
    }

    if (!isFiniteScriptNumber(deltaTime) || deltaTime <= 0 || deltaTime > 1.0) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            'deltaTime must be a finite number in (0, 1.0].'
          ),
        ],
      };
    }

    this.sandbox.resetFrameBudget();
    this.state = 'updating';

    this.frameNumber += 1;
    this.elapsedSeconds = Number((this.elapsedSeconds + deltaTime).toFixed(6));

    this.bindings.setTimeSnapshot({
      frameNumber: this.frameNumber,
      fixedStepNumber: this.fixedStepNumber,
      deltaTime,
      fixedDeltaTime: this.fixedDeltaTime,
      elapsedSeconds: this.elapsedSeconds,
    });

    const activeInstances = this.listInstances();

    const updatePlanRes = this.scheduler.buildPhaseSchedule({
      phase: 'Update',
      instances: activeInstances,
      frameNumber: this.frameNumber,
      fixedStepNumber: this.fixedStepNumber,
    });
    const eventPlanRes = this.scheduler.buildPhaseSchedule({
      phase: 'Event',
      instances: activeInstances,
      frameNumber: this.frameNumber,
      fixedStepNumber: this.fixedStepNumber,
    });
    const lateUpdatePlanRes = this.scheduler.buildPhaseSchedule({
      phase: 'LateUpdate',
      instances: activeInstances,
      frameNumber: this.frameNumber,
      fixedStepNumber: this.fixedStepNumber,
    });

    if (
      !updatePlanRes.valid ||
      !updatePlanRes.value ||
      !eventPlanRes.valid ||
      !eventPlanRes.value ||
      !lateUpdatePlanRes.valid ||
      !lateUpdatePlanRes.value
    ) {
      this.state = 'ready';
      return {
        valid: false,
        value: null,
        errors: [
          ...updatePlanRes.errors,
          ...eventPlanRes.errors,
          ...lateUpdatePlanRes.errors,
        ],
      };
    }

    // Drain events emitted through ScriptBindings and combine with pendingEvents
    const boundEmitted = this.bindings.drainEmittedEvents();
    const combinedEvents = sortScriptEventsDeterministically([
      ...this.pendingEvents,
      ...boundEmitted,
    ]);
    this.pendingEvents.length = 0;

    const errors: ScriptDiagnosticError[] = [];

    // 1. Update Phase
    for (const slot of updatePlanRes.value.slots) {
      const budgetRes = this.sandbox.consumeBudget('instruction', 1);
      if (!budgetRes.valid) {
        errors.push(...budgetRes.errors);
        break;
      }
      const ctrl = this.instancesById.get(slot.instanceId);
      if (ctrl) {
        ctrl.recordPhaseExecution('Update', { instructions: 1 });
        this.backend.recordScheduledStep({
          instanceId: slot.instanceId,
          scriptId: slot.scriptId,
          projectId: this.projectId,
          phase: 'Update',
          frameNumber: this.frameNumber,
          fixedStepNumber: this.fixedStepNumber,
          instructionCostEstimate: 1,
        });
      }
    }

    // 2. Event Phase
    if (errors.length === 0 && combinedEvents.length > 0) {
      for (const ev of combinedEvents) {
        this.processedEventHistory.push(ev);
        for (const slot of eventPlanRes.value.slots) {
          if (ev.entityId !== null && slot.entityId !== ev.entityId) {
            continue;
          }
          const budgetRes = this.sandbox.consumeBudget('instruction', 1);
          if (!budgetRes.valid) {
            errors.push(...budgetRes.errors);
            break;
          }
          const ctrl = this.instancesById.get(slot.instanceId);
          if (ctrl) {
            ctrl.recordPhaseExecution('Event', { instructions: 1 });
            this.backend.recordScheduledStep({
              instanceId: slot.instanceId,
              scriptId: slot.scriptId,
              projectId: this.projectId,
              phase: 'Event',
              frameNumber: this.frameNumber,
              fixedStepNumber: this.fixedStepNumber,
              instructionCostEstimate: 1,
            });
          }
        }
        if (errors.length > 0) break;
      }
    }

    // 3. LateUpdate Phase
    if (errors.length === 0) {
      for (const slot of lateUpdatePlanRes.value.slots) {
        const budgetRes = this.sandbox.consumeBudget('instruction', 1);
        if (!budgetRes.valid) {
          errors.push(...budgetRes.errors);
          break;
        }
        const ctrl = this.instancesById.get(slot.instanceId);
        if (ctrl) {
          ctrl.recordPhaseExecution('LateUpdate', { instructions: 1 });
          this.backend.recordScheduledStep({
            instanceId: slot.instanceId,
            scriptId: slot.scriptId,
            projectId: this.projectId,
            phase: 'LateUpdate',
            frameNumber: this.frameNumber,
            fixedStepNumber: this.fixedStepNumber,
            instructionCostEstimate: 1,
          });
        }
      }
    }

    this.state = 'ready';

    if (errors.length > 0) {
      return { valid: false, value: null, errors };
    }

    return {
      valid: true,
      value: Object.freeze({
        frameNumber: this.frameNumber,
        fixedStepNumber: this.fixedStepNumber,
        elapsedSeconds: this.elapsedSeconds,
        updatePlan: updatePlanRes.value,
        eventPlan: eventPlanRes.value,
        lateUpdatePlan: lateUpdatePlanRes.value,
        processedEvents: combinedEvents,
      }),
      errors: [],
    };
  }
}

export { ScriptRuntime as ScriptWorld };
