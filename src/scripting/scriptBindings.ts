import { AssetType, HylixAssetRegistry } from '../assets/assetRegistry';
import { AudioSourceId, AudioWorld } from '../audio/audioValidation';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  createDefaultTransformData,
  HylixEntity,
  TRANSFORM_COMPONENT_TYPE,
  TransformComponentData,
  validateTransformComponentData,
} from '../ecs/ecsCore';
import {
  createGameplayInputSnapshot,
  GameplayInputReadOnlySnapshot,
  InputActionEvaluatedState,
  InputManager,
} from '../input/inputValidation';
import {
  overlapCircle,
  overlapSphere,
  OverlapQueryMatch,
  PhysicsWorld,
  RaycastHit,
  raycastPhysicsWorld,
} from '../physics/physicsValidation';
import {
  ScriptAssetDescriptorSnapshot,
  ScriptEntitySnapshot,
  ScriptRenderMetadataSnapshot,
  ScriptTimeSnapshot,
} from './scriptApi';
import {
  createValidatedScriptEvent,
  ScriptEvent,
  ScriptEventPayloadValue,
  ScriptEventType,
} from './scriptEvents';
import { ScriptSandbox } from './scriptSandbox';
import {
  createScriptError,
  isForbiddenScriptString,
  isPlainScriptObject,
  ScriptValidationResult,
  Vector2,
  Vector3,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Controlled ScriptBindings to Engine Subsystems
 *
 * Connects future scripting runtimes to Hylix ECS, Input, Physics, Audio,
 * Rendering metadata, and AssetRegistry while enforcing:
 * - Project ownership (`projectId` boundary checks)
 * - Entity & Asset existence/ownership validation
 * - Read/Write separation
 * - Zero direct exposure of mutable engine internals
 */

export interface ScriptBindingsOptions {
  readonly projectId: string;
  readonly sandbox: ScriptSandbox;
  readonly assetRegistry?: HylixAssetRegistry;
  readonly inputManager?: InputManager;
  readonly physicsWorld?: PhysicsWorld;
  readonly audioWorld?: AudioWorld;
  readonly logger?: RedactedDiagnosticLogger;
}

export class ScriptBindings {
  private readonly projectId: string;
  private readonly sandbox: ScriptSandbox;
  private assetRegistry?: HylixAssetRegistry;
  private inputManager?: InputManager;
  private physicsWorld?: PhysicsWorld;
  private audioWorld?: AudioWorld;
  private readonly logger?: RedactedDiagnosticLogger;

  private readonly entitiesById = new Map<string, HylixEntity>();
  private readonly renderMetadataByEntityId = new Map<
    string,
    ScriptRenderMetadataSnapshot
  >();
  private readonly emittedEvents: ScriptEvent[] = [];
  private eventSequenceCounter = 0;

  private timeSnapshot: ScriptTimeSnapshot = Object.freeze({
    frameNumber: 0,
    fixedStepNumber: 0,
    deltaTime: 1 / 60,
    fixedDeltaTime: 1 / 60,
    elapsedSeconds: 0,
  });

  constructor(options: ScriptBindingsOptions) {
    this.projectId = options.projectId.trim();
    this.sandbox = options.sandbox;
    this.assetRegistry = options.assetRegistry;
    this.inputManager = options.inputManager;
    this.physicsWorld = options.physicsWorld;
    this.audioWorld = options.audioWorld;
    this.logger = options.logger;
  }

  public getProjectId(): string {
    return this.projectId;
  }

  public setSubsystems(subsystems: {
    readonly assetRegistry?: HylixAssetRegistry;
    readonly inputManager?: InputManager;
    readonly physicsWorld?: PhysicsWorld;
    readonly audioWorld?: AudioWorld;
  }): ScriptValidationResult<true> {
    if (subsystems.assetRegistry) {
      const check = this.sandbox.verifyProjectOwnership(
        subsystems.assetRegistry.getProjectId(),
        'AssetRegistry binding'
      );
      if (!check.valid) return check;
      this.assetRegistry = subsystems.assetRegistry;
    }
    if (subsystems.inputManager) {
      const check = this.sandbox.verifyProjectOwnership(
        subsystems.inputManager.getProjectId(),
        'InputManager binding'
      );
      if (!check.valid) return check;
      this.inputManager = subsystems.inputManager;
    }
    if (subsystems.physicsWorld) {
      const check = this.sandbox.verifyProjectOwnership(
        subsystems.physicsWorld.projectId,
        'PhysicsWorld binding'
      );
      if (!check.valid) return check;
      this.physicsWorld = subsystems.physicsWorld;
    }
    if (subsystems.audioWorld) {
      const check = this.sandbox.verifyProjectOwnership(
        subsystems.audioWorld.getProjectId(),
        'AudioWorld binding'
      );
      if (!check.valid) return check;
      this.audioWorld = subsystems.audioWorld;
    }
    return { valid: true, value: true, errors: [] };
  }

  public bindEntities(
    entities: readonly HylixEntity[],
    sourceProjectId = this.projectId
  ): ScriptValidationResult<number> {
    const projCheck = this.sandbox.verifyProjectOwnership(
      sourceProjectId,
      'bindEntities'
    );
    if (!projCheck.valid) {
      return { valid: false, value: null, errors: projCheck.errors };
    }

    for (const ent of entities) {
      this.entitiesById.set(ent.entityId, ent);
      if (!this.renderMetadataByEntityId.has(ent.entityId)) {
        this.renderMetadataByEntityId.set(
          ent.entityId,
          Object.freeze({
            entityId: ent.entityId,
            visible: ent.enabled,
            materialAssetId: null,
            sortingOrder: 0,
          })
        );
      }
    }

    return { valid: true, value: this.entitiesById.size, errors: [] };
  }

  public setTimeSnapshot(snapshot: ScriptTimeSnapshot): void {
    this.timeSnapshot = Object.freeze({ ...snapshot });
  }

  public getTimeSnapshot(): ScriptTimeSnapshot {
    return this.timeSnapshot;
  }

  public readEntity(
    entityId: string
  ): ScriptValidationResult<ScriptEntitySnapshot> {
    const check = this.sandbox.verifyEntityOwnership(
      entityId,
      this.entitiesById
    );
    if (!check.valid || !check.value) {
      return { valid: false, value: null, errors: check.errors };
    }

    const ent = this.entitiesById.get(check.value)!;
    return {
      valid: true,
      value: Object.freeze({
        entityId: ent.entityId,
        name: ent.name,
        enabled: ent.enabled,
        parentEntityId: ent.parentEntityId,
        childrenEntityIds: Object.freeze([...ent.childrenEntityIds]),
        componentTypes: Object.freeze(Object.keys(ent.components).sort()),
      }),
      errors: [],
    };
  }

  public writeEntityEnabled(
    entityId: string,
    enabled: boolean
  ): ScriptValidationResult<ScriptEntitySnapshot> {
    const check = this.sandbox.verifyEntityOwnership(
      entityId,
      this.entitiesById
    );
    if (!check.valid || !check.value) {
      return { valid: false, value: null, errors: check.errors };
    }

    if (typeof enabled !== 'boolean') {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            'setEntityEnabled requires a boolean value.'
          ),
        ],
      };
    }

    const ent = this.entitiesById.get(check.value)!;
    const updated: HylixEntity = Object.freeze({
      ...ent,
      enabled,
    });
    this.entitiesById.set(check.value, updated);
    return this.readEntity(check.value);
  }

  public readTransform(
    entityId: string
  ): ScriptValidationResult<TransformComponentData> {
    const check = this.sandbox.verifyEntityOwnership(
      entityId,
      this.entitiesById
    );
    if (!check.valid || !check.value) {
      return { valid: false, value: null, errors: check.errors };
    }

    const ent = this.entitiesById.get(check.value)!;
    const raw = ent.components[TRANSFORM_COMPONENT_TYPE];
    const val = raw
      ? validateTransformComponentData(raw)
      : { valid: true, data: createDefaultTransformData(), errors: [] };

    return {
      valid: true,
      value: val.data ?? createDefaultTransformData(),
      errors: [],
    };
  }

  public writeTransformField(
    entityId: string,
    field: 'position' | 'rotation' | 'scale',
    vector: Vector3
  ): ScriptValidationResult<TransformComponentData> {
    const currentRes = this.readTransform(entityId);
    if (!currentRes.valid || !currentRes.value) {
      return currentRes;
    }

    if (
      field === 'scale' &&
      isPlainScriptObject(vector) &&
      (vector.x === 0 || vector.y === 0 || vector.z === 0)
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            'Transform.scale components must be non-zero finite numbers.'
          ),
        ],
      };
    }

    const candidateTransform = {
      ...currentRes.value,
      [field]: vector,
    };
    const valCheck = validateTransformComponentData(candidateTransform);
    if (!valCheck.valid || !valCheck.data) {
      return {
        valid: false,
        value: null,
        errors: valCheck.errors.map((m) =>
          createScriptError('SCRIPT_VALIDATION_ERROR', m)
        ),
      };
    }

    const ent = this.entitiesById.get(entityId)!;
    const updatedEnt: HylixEntity = Object.freeze({
      ...ent,
      components: Object.freeze({
        ...ent.components,
        [TRANSFORM_COMPONENT_TYPE]: valCheck.data,
      }),
    });
    this.entitiesById.set(entityId, updatedEnt);

    return {
      valid: true,
      value: valCheck.data,
      errors: [],
    };
  }

  public readInputSnapshot(
    contextName?: string
  ): ScriptValidationResult<GameplayInputReadOnlySnapshot> {
    if (!this.inputManager) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            'No InputManager is bound to ScriptBindings.'
          ),
        ],
      };
    }
    const projCheck = this.sandbox.verifyProjectOwnership(
      this.inputManager.getProjectId(),
      'InputManager'
    );
    if (!projCheck.valid) {
      return { valid: false, value: null, errors: projCheck.errors };
    }

    return {
      valid: true,
      value: createGameplayInputSnapshot(this.inputManager, contextName),
      errors: [],
    };
  }

  public readInputActionState(
    actionName: string,
    contextName?: string
  ): ScriptValidationResult<InputActionEvaluatedState> {
    if (!this.inputManager) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            'No InputManager is bound to ScriptBindings.'
          ),
        ],
      };
    }
    const projCheck = this.sandbox.verifyProjectOwnership(
      this.inputManager.getProjectId(),
      'InputManager'
    );
    if (!projCheck.valid) {
      return { valid: false, value: null, errors: projCheck.errors };
    }

    const state = this.inputManager.getActionState(actionName, contextName);
    if (!state) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            `InputAction '${actionName}' is not registered in InputManager.`
          ),
        ],
      };
    }

    return {
      valid: true,
      value: state,
      errors: [],
    };
  }

  public executePhysicsRaycast(ray: {
    readonly origin: Vector3;
    readonly direction: Vector3;
    readonly maxDistance: number;
    readonly layerMask?: number;
    readonly includeTriggers?: boolean;
  }): ScriptValidationResult<readonly RaycastHit[]> {
    if (!this.physicsWorld) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            'No PhysicsWorld is bound to ScriptBindings.'
          ),
        ],
      };
    }
    const projCheck = this.sandbox.verifyProjectOwnership(
      this.physicsWorld.projectId,
      'PhysicsWorld'
    );
    if (!projCheck.valid) {
      return { valid: false, value: null, errors: projCheck.errors };
    }

    const res = raycastPhysicsWorld(this.physicsWorld, ray, {
      projectId: this.projectId,
      logger: this.logger,
    });
    if (!res.valid || !res.value) {
      return {
        valid: false,
        value: null,
        errors: res.errors.map((m) =>
          createScriptError('SCRIPT_VALIDATION_ERROR', m)
        ),
      };
    }
    return { valid: true, value: res.value, errors: [] };
  }

  public executePhysicsOverlapCircle(
    center: Vector2,
    radius: number
  ): ScriptValidationResult<readonly OverlapQueryMatch[]> {
    if (!this.physicsWorld) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            'No PhysicsWorld is bound to ScriptBindings.'
          ),
        ],
      };
    }
    const projCheck = this.sandbox.verifyProjectOwnership(
      this.physicsWorld.projectId,
      'PhysicsWorld'
    );
    if (!projCheck.valid) {
      return { valid: false, value: null, errors: projCheck.errors };
    }

    const res = overlapCircle(this.physicsWorld, center, radius, {
      logger: this.logger,
    });
    if (!res.valid || !res.value) {
      return {
        valid: false,
        value: null,
        errors: res.errors.map((m) =>
          createScriptError('SCRIPT_VALIDATION_ERROR', m)
        ),
      };
    }
    return { valid: true, value: res.value, errors: [] };
  }

  public executePhysicsOverlapSphere(
    center: Vector3,
    radius: number
  ): ScriptValidationResult<readonly OverlapQueryMatch[]> {
    if (!this.physicsWorld) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            'No PhysicsWorld is bound to ScriptBindings.'
          ),
        ],
      };
    }
    const projCheck = this.sandbox.verifyProjectOwnership(
      this.physicsWorld.projectId,
      'PhysicsWorld'
    );
    if (!projCheck.valid) {
      return { valid: false, value: null, errors: projCheck.errors };
    }

    const res = overlapSphere(this.physicsWorld, center, radius, {
      logger: this.logger,
    });
    if (!res.valid || !res.value) {
      return {
        valid: false,
        value: null,
        errors: res.errors.map((m) =>
          createScriptError('SCRIPT_VALIDATION_ERROR', m)
        ),
      };
    }
    return { valid: true, value: res.value, errors: [] };
  }

  public executeAudioCommand(
    command: 'play' | 'stop' | 'pause' | 'resume',
    sourceId: string
  ): ScriptValidationResult<{
    readonly sourceId: string;
    readonly voiceId: string | null;
  }> {
    if (!this.audioWorld) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            'No AudioWorld is bound to ScriptBindings.'
          ),
        ],
      };
    }
    const projCheck = this.sandbox.verifyProjectOwnership(
      this.audioWorld.getProjectId(),
      'AudioWorld'
    );
    if (!projCheck.valid) {
      return { valid: false, value: null, errors: projCheck.errors };
    }

    const typedId = sourceId as AudioSourceId;
    if (command === 'play') {
      const res = this.audioWorld.playSource(typedId);
      if (!res.success || !res.voice) {
        return {
          valid: false,
          value: null,
          errors: res.errors.map((errText) =>
            createScriptError('SCRIPT_BINDING_ERROR', errText)
          ),
        };
      }
      return {
        valid: true,
        value: Object.freeze({
          sourceId: typedId,
          voiceId: res.voice.voiceId,
        }),
        errors: [],
      };
    }

    const res =
      command === 'stop'
        ? this.audioWorld.stopSource(typedId)
        : command === 'pause'
          ? this.audioWorld.pauseSource(typedId)
          : this.audioWorld.resumeSource(typedId);

    if (!res.success) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            res.error ?? `Audio command '${command}' failed for '${typedId}'.`
          ),
        ],
      };
    }

    return {
      valid: true,
      value: Object.freeze({ sourceId: typedId, voiceId: null }),
      errors: [],
    };
  }

  public readRenderMetadata(
    entityId: string
  ): ScriptValidationResult<ScriptRenderMetadataSnapshot> {
    const check = this.sandbox.verifyEntityOwnership(
      entityId,
      this.entitiesById
    );
    if (!check.valid || !check.value) {
      return { valid: false, value: null, errors: check.errors };
    }
    const meta = this.renderMetadataByEntityId.get(check.value)!;
    return { valid: true, value: meta, errors: [] };
  }

  public writeRenderVisibility(
    entityId: string,
    visible: boolean
  ): ScriptValidationResult<ScriptRenderMetadataSnapshot> {
    const check = this.sandbox.verifyEntityOwnership(
      entityId,
      this.entitiesById
    );
    if (!check.valid || !check.value) {
      return { valid: false, value: null, errors: check.errors };
    }
    if (typeof visible !== 'boolean') {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            'setRenderVisibility requires a boolean value.'
          ),
        ],
      };
    }
    const existing = this.renderMetadataByEntityId.get(check.value)!;
    const updated: ScriptRenderMetadataSnapshot = Object.freeze({
      ...existing,
      visible,
    });
    this.renderMetadataByEntityId.set(check.value, updated);
    return { valid: true, value: updated, errors: [] };
  }

  public writeRenderMaterialReference(
    entityId: string,
    materialAssetId: string
  ): ScriptValidationResult<ScriptRenderMetadataSnapshot> {
    const entCheck = this.sandbox.verifyEntityOwnership(
      entityId,
      this.entitiesById
    );
    if (!entCheck.valid || !entCheck.value) {
      return { valid: false, value: null, errors: entCheck.errors };
    }

    const assetRes = this.readAssetInfo(materialAssetId, 'material');
    if (!assetRes.valid || !assetRes.value) {
      return { valid: false, value: null, errors: assetRes.errors };
    }

    const existing = this.renderMetadataByEntityId.get(entCheck.value)!;
    const updated: ScriptRenderMetadataSnapshot = Object.freeze({
      ...existing,
      materialAssetId: assetRes.value.assetId,
    });
    this.renderMetadataByEntityId.set(entCheck.value, updated);
    return { valid: true, value: updated, errors: [] };
  }

  public readAssetInfo(
    assetId: string,
    expectedType?: AssetType
  ): ScriptValidationResult<ScriptAssetDescriptorSnapshot> {
    if (!this.assetRegistry) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            'No HylixAssetRegistry is bound to ScriptBindings.'
          ),
        ],
      };
    }

    const assetCheck = this.sandbox.verifyAssetOwnership(
      assetId,
      this.assetRegistry
    );
    if (!assetCheck.valid || !assetCheck.value) {
      return { valid: false, value: null, errors: assetCheck.errors };
    }

    const record = this.assetRegistry.getAsset(assetCheck.value)!;
    if (expectedType !== undefined && record.type !== expectedType) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `Asset '${assetId}' has type '${record.type}', expected '${expectedType}'.`
          ),
        ],
      };
    }

    return {
      valid: true,
      value: Object.freeze({
        assetId: record.assetId,
        name: record.name,
        type: record.type,
        contentHash: record.contentHash,
      }),
      errors: [],
    };
  }

  public emitScriptEvent(
    sourceInstanceId: string,
    options: {
      readonly eventType?: ScriptEventType;
      readonly customEventName?: string;
      readonly entityId?: string | null;
      readonly payload?: Readonly<Record<string, ScriptEventPayloadValue>>;
    }
  ): ScriptValidationResult<ScriptEvent> {
    if (options.entityId !== undefined && options.entityId !== null) {
      const entCheck = this.sandbox.verifyEntityOwnership(
        options.entityId,
        this.entitiesById
      );
      if (!entCheck.valid) {
        return { valid: false, value: null, errors: entCheck.errors };
      }
    }

    const nextSeq = this.eventSequenceCounter + 1;
    const evRes = createValidatedScriptEvent({
      sequence: nextSeq,
      source: sourceInstanceId,
      projectId: this.projectId,
      entityId: options.entityId ?? null,
      eventType: options.eventType ?? 'Custom',
      customEventName: options.customEventName ?? null,
      payload: options.payload ?? {},
    });

    if (!evRes.valid || !evRes.value) {
      return evRes;
    }

    this.eventSequenceCounter = nextSeq;
    this.emittedEvents.push(evRes.value);
    return evRes;
  }

  public drainEmittedEvents(): readonly ScriptEvent[] {
    const drained = Object.freeze([...this.emittedEvents]);
    this.emittedEvents.length = 0;
    return drained;
  }

  public writeLog(
    instanceId: string,
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string
  ): ScriptValidationResult<true> {
    if (typeof message !== 'string' || message.trim().length === 0) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            'Log message must be a non-empty string.'
          ),
        ],
      };
    }
    const sec = isForbiddenScriptString(message);
    if (sec.forbidden) {
      return {
        valid: false,
        value: null,
        errors: [createScriptError('SCRIPT_VALIDATION_ERROR', sec.reason!)],
      };
    }
    this.logger?.record(
      'scripting',
      level,
      `script_log [${instanceId}]: ${message}`
    );
    return { valid: true, value: true, errors: [] };
  }

  public clear(): void {
    this.entitiesById.clear();
    this.renderMetadataByEntityId.clear();
    this.emittedEvents.length = 0;
    this.eventSequenceCounter = 0;
    this.assetRegistry = undefined;
    this.inputManager = undefined;
    this.physicsWorld = undefined;
    this.audioWorld = undefined;
  }
}
