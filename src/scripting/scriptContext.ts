import { AssetType } from '../assets/assetRegistry';
import {
  ScriptApiContract,
  ScriptAssetDescriptorSnapshot,
  ScriptEntitySnapshot,
  ScriptRenderMetadataSnapshot,
  ScriptTimeSnapshot,
} from './scriptApi';
import { ScriptBindings } from './scriptBindings';
import {
  ScriptEvent,
  ScriptEventPayloadValue,
  ScriptEventType,
} from './scriptEvents';
import { ScriptInstanceController } from './scriptInstance';
import { ScriptSandbox } from './scriptSandbox';
import {
  ScriptValidationResult,
  Vector2,
  Vector3,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Controlled ScriptContext Bridge
 *
 * `ScriptContext` is the ONLY conceptual bridge between a `ScriptInstance`
 * and Hylix engine systems. Every API method enforces:
 * 1. Project isolation
 * 2. Instance lifecycle state (`initialized` or `enabled`)
 * 3. Explicit `ScriptCapability` & `ScriptPermissionPolicy`
 * 4. Per-frame `ScriptExecutionBudget` accounting
 * 5. Read/Write separation
 */

export class ScriptContext {
  private readonly instance: ScriptInstanceController;
  private readonly sandbox: ScriptSandbox;
  private readonly bindings: ScriptBindings;
  public readonly api: ScriptApiContract;

  constructor(options: {
    readonly instance: ScriptInstanceController;
    readonly sandbox: ScriptSandbox;
    readonly bindings: ScriptBindings;
  }) {
    this.instance = options.instance;
    this.sandbox = options.sandbox;
    this.bindings = options.bindings;
    this.api = this.createBoundedApiFacade();
    Object.freeze(this);
  }

  public getProjectId(): string {
    return this.instance.getProjectId();
  }

  public getInstanceId(): string {
    return this.instance.getInstanceId();
  }

  public getScriptId(): string {
    return this.instance.getScriptId();
  }

  private createBoundedApiFacade(): ScriptApiContract {
    const entityApi = Object.freeze({
      getEntity: (
        entityId: string
      ): ScriptValidationResult<ScriptEntitySnapshot> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'ReadEntity',
          'entity',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          entityOps: 1,
        });
        return this.bindings.readEntity(entityId);
      },

      setEntityEnabled: (
        entityId: string,
        enabled: boolean
      ): ScriptValidationResult<ScriptEntitySnapshot> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'WriteEntity',
          'entity',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          entityOps: 1,
        });
        return this.bindings.writeEntityEnabled(entityId, enabled);
      },
    });

    const transformApi = Object.freeze({
      getTransform: (entityId: string) => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'ReadTransform',
          'entity',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          entityOps: 1,
        });
        return this.bindings.readTransform(entityId);
      },

      setPosition: (entityId: string, position: Vector3) => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'WriteTransform',
          'entity',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          entityOps: 1,
        });
        return this.bindings.writeTransformField(
          entityId,
          'position',
          position
        );
      },

      setRotation: (entityId: string, rotation: Vector3) => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'WriteTransform',
          'entity',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          entityOps: 1,
        });
        return this.bindings.writeTransformField(
          entityId,
          'rotation',
          rotation
        );
      },

      setScale: (entityId: string, scale: Vector3) => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'WriteTransform',
          'entity',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          entityOps: 1,
        });
        return this.bindings.writeTransformField(entityId, 'scale', scale);
      },
    });

    const inputApi = Object.freeze({
      getSnapshot: (contextName?: string) => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'ReadInput',
          'instruction',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Update', { instructions: 1 });
        return this.bindings.readInputSnapshot(contextName);
      },

      getActionState: (actionName: string, contextName?: string) => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'ReadInput',
          'instruction',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Update', { instructions: 1 });
        return this.bindings.readInputActionState(actionName, contextName);
      },
    });

    const physicsApi = Object.freeze({
      raycast: (ray: {
        readonly origin: Vector3;
        readonly direction: Vector3;
        readonly maxDistance: number;
        readonly layerMask?: number;
        readonly includeTriggers?: boolean;
      }) => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'PhysicsQuery',
          'physics',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          physicsQueries: 1,
        });
        return this.bindings.executePhysicsRaycast(ray);
      },

      overlapCircle: (center: Vector2, radius: number) => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'PhysicsQuery',
          'physics',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          physicsQueries: 1,
        });
        return this.bindings.executePhysicsOverlapCircle(center, radius);
      },

      overlapSphere: (center: Vector3, radius: number) => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'PhysicsQuery',
          'physics',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          physicsQueries: 1,
        });
        return this.bindings.executePhysicsOverlapSphere(center, radius);
      },
    });

    const audioApi = Object.freeze({
      playSource: (sourceId: string) => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'PlayAudio',
          'audio',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          audioCommands: 1,
        });
        const res = this.bindings.executeAudioCommand('play', sourceId);
        if (!res.valid || !res.value || !res.value.voiceId) {
          return { valid: false, value: null, errors: res.errors };
        }
        return {
          valid: true,
          value: Object.freeze({
            sourceId: res.value.sourceId,
            voiceId: res.value.voiceId,
          }),
          errors: [],
        };
      },

      stopSource: (sourceId: string): ScriptValidationResult<true> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'PlayAudio',
          'audio',
          1
        );
        if (!auth.valid) return auth;
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          audioCommands: 1,
        });
        const res = this.bindings.executeAudioCommand('stop', sourceId);
        if (!res.valid) {
          return { valid: false, value: null, errors: res.errors };
        }
        return { valid: true, value: true, errors: [] };
      },

      pauseSource: (sourceId: string): ScriptValidationResult<true> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'PlayAudio',
          'audio',
          1
        );
        if (!auth.valid) return auth;
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          audioCommands: 1,
        });
        const res = this.bindings.executeAudioCommand('pause', sourceId);
        if (!res.valid) {
          return { valid: false, value: null, errors: res.errors };
        }
        return { valid: true, value: true, errors: [] };
      },

      resumeSource: (sourceId: string): ScriptValidationResult<true> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'PlayAudio',
          'audio',
          1
        );
        if (!auth.valid) return auth;
        this.instance.recordPhaseExecution('Update', {
          instructions: 1,
          audioCommands: 1,
        });
        const res = this.bindings.executeAudioCommand('resume', sourceId);
        if (!res.valid) {
          return { valid: false, value: null, errors: res.errors };
        }
        return { valid: true, value: true, errors: [] };
      },
    });

    const renderingApi = Object.freeze({
      getRenderMetadata: (
        entityId: string
      ): ScriptValidationResult<ScriptRenderMetadataSnapshot> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'ReadEntity',
          'entity',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        return this.bindings.readRenderMetadata(entityId);
      },

      setRenderVisibility: (
        entityId: string,
        visible: boolean
      ): ScriptValidationResult<ScriptRenderMetadataSnapshot> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'WriteRenderMetadata',
          'entity',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        return this.bindings.writeRenderVisibility(entityId, visible);
      },

      setMaterialReference: (
        entityId: string,
        materialAssetId: string
      ): ScriptValidationResult<ScriptRenderMetadataSnapshot> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'WriteRenderMetadata',
          'entity',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        return this.bindings.writeRenderMaterialReference(
          entityId,
          materialAssetId
        );
      },
    });

    const assetsApi = Object.freeze({
      getAssetInfo: (
        assetId: string,
        expectedType?: AssetType
      ): ScriptValidationResult<ScriptAssetDescriptorSnapshot> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'ReadAsset',
          'instruction',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        return this.bindings.readAssetInfo(assetId, expectedType);
      },
    });

    const timeApi = Object.freeze({
      getTime: (): ScriptValidationResult<ScriptTimeSnapshot> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'ReadTime',
          'instruction',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        return {
          valid: true,
          value: this.bindings.getTimeSnapshot(),
          errors: [],
        };
      },
    });

    const eventsApi = Object.freeze({
      emit: (options: {
        readonly eventType?: ScriptEventType;
        readonly customEventName?: string;
        readonly entityId?: string | null;
        readonly payload?: Readonly<Record<string, ScriptEventPayloadValue>>;
      }): ScriptValidationResult<ScriptEvent> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'EmitEvent',
          'event',
          1
        );
        if (!auth.valid) {
          return { valid: false, value: null, errors: auth.errors };
        }
        this.instance.recordPhaseExecution('Event', { instructions: 1 });
        return this.bindings.emitScriptEvent(
          this.instance.getInstanceId(),
          options
        );
      },
    });

    const logApi = Object.freeze({
      info: (message: string): ScriptValidationResult<true> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'Log',
          'instruction',
          1
        );
        if (!auth.valid) return auth;
        return this.bindings.writeLog(
          this.instance.getInstanceId(),
          'INFO',
          message
        );
      },
      warn: (message: string): ScriptValidationResult<true> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'Log',
          'instruction',
          1
        );
        if (!auth.valid) return auth;
        return this.bindings.writeLog(
          this.instance.getInstanceId(),
          'WARN',
          message
        );
      },
      error: (message: string): ScriptValidationResult<true> => {
        const auth = this.sandbox.authorizeOperation(
          this.instance.getDescriptor(),
          'Log',
          'instruction',
          1
        );
        if (!auth.valid) return auth;
        return this.bindings.writeLog(
          this.instance.getInstanceId(),
          'ERROR',
          message
        );
      },
    });

    return Object.freeze({
      entity: entityApi,
      transform: transformApi,
      input: inputApi,
      physics: physicsApi,
      audio: audioApi,
      rendering: renderingApi,
      assets: assetsApi,
      time: timeApi,
      events: eventsApi,
      log: logApi,
    });
  }
}
