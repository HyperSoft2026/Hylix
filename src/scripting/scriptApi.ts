import { AssetType } from '../assets/assetRegistry';
import { TransformComponentData } from '../ecs/ecsCore';
import {
  GameplayInputReadOnlySnapshot,
  InputActionEvaluatedState,
} from '../input/inputValidation';
import { OverlapQueryMatch, RaycastHit } from '../physics/physicsValidation';
import {
  ScriptEvent,
  ScriptEventPayloadValue,
  ScriptEventType,
} from './scriptEvents';
import {
  ScriptValidationResult,
  Vector2,
  Vector3,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Controlled Engine-Facing ScriptApi Contracts
 *
 * Defines deterministic, capability-gated API facades (`api.entity`, `api.transform`,
 * `api.input`, `api.physics`, `api.audio`, `api.rendering`, `api.assets`, `api.time`,
 * `api.events`, `api.log`).
 *
 * Strictly forbids exposing Node.js globals, `process`, `fs`, sockets, HTTP, secrets,
 * or raw mutable engine internals.
 */

export interface ScriptEntitySnapshot {
  readonly entityId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly parentEntityId: string | null;
  readonly childrenEntityIds: readonly string[];
  readonly componentTypes: readonly string[];
}

export interface ScriptRenderMetadataSnapshot {
  readonly entityId: string;
  readonly visible: boolean;
  readonly materialAssetId: string | null;
  readonly sortingOrder: number;
}

export interface ScriptAssetDescriptorSnapshot {
  readonly assetId: string;
  readonly name: string;
  readonly type: AssetType;
  readonly contentHash: string;
}

export interface ScriptTimeSnapshot {
  readonly frameNumber: number;
  readonly fixedStepNumber: number;
  readonly deltaTime: number;
  readonly fixedDeltaTime: number;
  readonly elapsedSeconds: number;
}

export interface ScriptEntityApiContract {
  getEntity(entityId: string): ScriptValidationResult<ScriptEntitySnapshot>;
  setEntityEnabled(
    entityId: string,
    enabled: boolean
  ): ScriptValidationResult<ScriptEntitySnapshot>;
}

export interface ScriptTransformApiContract {
  getTransform(
    entityId: string
  ): ScriptValidationResult<TransformComponentData>;
  setPosition(
    entityId: string,
    position: Vector3
  ): ScriptValidationResult<TransformComponentData>;
  setRotation(
    entityId: string,
    rotation: Vector3
  ): ScriptValidationResult<TransformComponentData>;
  setScale(
    entityId: string,
    scale: Vector3
  ): ScriptValidationResult<TransformComponentData>;
}

export interface ScriptInputApiContract {
  getSnapshot(
    contextName?: string
  ): ScriptValidationResult<GameplayInputReadOnlySnapshot>;
  getActionState(
    actionName: string,
    contextName?: string
  ): ScriptValidationResult<InputActionEvaluatedState>;
}

export interface ScriptPhysicsApiContract {
  raycast(ray: {
    readonly origin: Vector3;
    readonly direction: Vector3;
    readonly maxDistance: number;
    readonly layerMask?: number;
    readonly includeTriggers?: boolean;
  }): ScriptValidationResult<readonly RaycastHit[]>;
  overlapCircle(
    center: Vector2,
    radius: number
  ): ScriptValidationResult<readonly OverlapQueryMatch[]>;
  overlapSphere(
    center: Vector3,
    radius: number
  ): ScriptValidationResult<readonly OverlapQueryMatch[]>;
}

export interface ScriptAudioApiContract {
  playSource(sourceId: string): ScriptValidationResult<{
    readonly sourceId: string;
    readonly voiceId: string;
  }>;
  stopSource(sourceId: string): ScriptValidationResult<true>;
  pauseSource(sourceId: string): ScriptValidationResult<true>;
  resumeSource(sourceId: string): ScriptValidationResult<true>;
}

export interface ScriptRenderingApiContract {
  getRenderMetadata(
    entityId: string
  ): ScriptValidationResult<ScriptRenderMetadataSnapshot>;
  setRenderVisibility(
    entityId: string,
    visible: boolean
  ): ScriptValidationResult<ScriptRenderMetadataSnapshot>;
  setMaterialReference(
    entityId: string,
    materialAssetId: string
  ): ScriptValidationResult<ScriptRenderMetadataSnapshot>;
}

export interface ScriptAssetApiContract {
  getAssetInfo(
    assetId: string,
    expectedType?: AssetType
  ): ScriptValidationResult<ScriptAssetDescriptorSnapshot>;
}

export interface ScriptTimeApiContract {
  getTime(): ScriptValidationResult<ScriptTimeSnapshot>;
}

export interface ScriptEventsApiContract {
  emit(options: {
    readonly eventType?: ScriptEventType;
    readonly customEventName?: string;
    readonly entityId?: string | null;
    readonly payload?: Readonly<Record<string, ScriptEventPayloadValue>>;
  }): ScriptValidationResult<ScriptEvent>;
}

export interface ScriptLogApiContract {
  info(message: string): ScriptValidationResult<true>;
  warn(message: string): ScriptValidationResult<true>;
  error(message: string): ScriptValidationResult<true>;
}

export interface ScriptApiContract {
  readonly entity: ScriptEntityApiContract;
  readonly transform: ScriptTransformApiContract;
  readonly input: ScriptInputApiContract;
  readonly physics: ScriptPhysicsApiContract;
  readonly audio: ScriptAudioApiContract;
  readonly rendering: ScriptRenderingApiContract;
  readonly assets: ScriptAssetApiContract;
  readonly time: ScriptTimeApiContract;
  readonly events: ScriptEventsApiContract;
  readonly log: ScriptLogApiContract;
}
