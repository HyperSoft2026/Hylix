import {
  computeDeterministicChecksum,
  LocalFirstAtomicStore,
} from '../storage/atomicStorage';
import {
  validateProjectScopedPath,
  validateWorkspaceRelativePath,
} from '../security/securityFoundation';
import {
  ComponentRegistry,
  createStandardComponentRegistry,
  HylixEntity,
  isValidEntityId,
} from '../ecs/ecsCore';
import { registerProjectAssetAtomically } from '../assets/assetRegistry';
import { inspectWorkspaceLock } from '../project/workspaceLock';
import { validateProjectManifestJsonString } from '../project/projectSystem';

/**
 * Hylix V1.0.0 — Scene System & Runtime Separation Contract
 *
 * Implements:
 * - Scene Definition Schema (`schemaVersion`, `sceneId`, `sceneName`, `metadata`, `entities`)
 * - Deterministic Scene ID generation & immutability enforcement
 * - Entity Hierarchy management & cycle/orphan detection
 * - Comprehensive Scene Validator (untrusted JSON, duplicate entity IDs, components, hierarchy)
 * - Atomic Scene Serialization via `LocalFirstAtomicStore`
 * - Separation between `SceneDefinition` (authored data) and `SceneRuntimeInstanceContract`
 */

export const CURRENT_SCENE_SCHEMA_VERSION = 1;

export interface SceneMetadata {
  readonly description: string;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
}

export interface ScenePhysicsConfigurationContract {
  readonly gravity: { readonly x: number; readonly y: number; readonly z: number };
  readonly fixedDeltaTime: number;
  readonly maxSubsteps: number;
}

export interface SceneAudioConfigurationContract {
  readonly masterVolume: number;
  readonly maxVoices: number;
  readonly voiceEvictionPolicy: 'reject' | 'replaceLowestPriority' | 'stopOldestEqualPriority';
  readonly defaultRolloff: number;
}

export interface SceneInputConfigurationContract {
  readonly maxBufferedEvents: number;
  readonly bufferOverflowPolicy: 'rejectNewest' | 'dropOldest';
  readonly defaultDeadZone: number;
  readonly defaultContextName: string;
}

export interface SceneDefinition {
  readonly schemaVersion: number;
  readonly sceneId: string;
  readonly sceneName: string;
  readonly metadata: SceneMetadata;
  readonly entities: readonly HylixEntity[];
  readonly physicsConfig?: ScenePhysicsConfigurationContract;
  readonly audioConfig?: SceneAudioConfigurationContract;
  readonly inputConfig?: SceneInputConfigurationContract;
}

/**
 * Runtime Separation Contract:
 * Separates authored `SceneDefinition` from in-memory runtime state.
 */
export interface SceneRuntimeInstanceContract {
  readonly runtimeInstanceId: string;
  readonly sourceSceneId: string;
  readonly sourceSceneVersion: number;
  readonly isolatedFromProjectData: true;
  readonly lifecycleState: 'INITIALIZED' | 'STOPPED';
  readonly runtimeEntitiesById: ReadonlyMap<string, HylixEntity>;
}

const VALID_SCENE_ID_REGEX = /^(scene_[a-f0-9]{16}|scn_[a-z0-9_]{3,48})$/i;

const ALLOWED_SCENE_TOP_KEYS = new Set([
  'schemaVersion',
  'sceneSchemaVersion', // Legacy Phase-2 bootstrap compatibility
  'sceneId',
  'sceneName',
  'metadata',
  'entities',
  'physicsConfig',
  'audioConfig',
  'inputConfig',
]);

const ALLOWED_ENTITY_TOP_KEYS = new Set([
  'entityId',
  'name',
  'enabled',
  'parentEntityId',
  'childrenEntityIds',
  'components',
]);

let sceneCreationCounter = 0;

export function generateDeterministicSceneId(
  sceneName: string,
  seedHint?: string
): string {
  sceneCreationCounter += 1;
  const seed = seedHint ?? `${sceneName.trim()}::${sceneCreationCounter}`;
  const hex = computeDeterministicChecksum(`hylix_scene::${seed}`);
  return `scene_${hex}`;
}

export function isValidSceneId(sceneId: unknown): sceneId is string {
  return typeof sceneId === 'string' && VALID_SCENE_ID_REGEX.test(sceneId);
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Validates parent/child hierarchy across all entities in a scene:
 * - Blocks self-parent (`entity.parentEntityId === entity.entityId`)
 * - Blocks self-child (`entity.childrenEntityIds.includes(entity.entityId)`)
 * - Blocks non-existent parent IDs
 * - Blocks non-existent child IDs
 * - Blocks duplicate child IDs
 * - Enforces bidirectional parent <-> child symmetry
 * - Blocks circular hierarchies (`A -> B -> A` or `A -> B -> C -> A`)
 */
export function validateEntityHierarchy(
  entities: readonly HylixEntity[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const entityMap = new Map<string, HylixEntity>();

  for (const ent of entities) {
    entityMap.set(ent.entityId, ent);
  }

  for (const ent of entities) {
    // 1. Check self-parent
    if (ent.parentEntityId !== null) {
      if (ent.parentEntityId === ent.entityId) {
        errors.push(
          `Hierarchy Violation: Entity '${ent.entityId}' cannot be its own parent.`
        );
      } else if (!entityMap.has(ent.parentEntityId)) {
        errors.push(
          `Hierarchy Violation: Entity '${ent.entityId}' references non-existent parent '${ent.parentEntityId}'.`
        );
      } else {
        const parentEnt = entityMap.get(ent.parentEntityId)!;
        if (!parentEnt.childrenEntityIds.includes(ent.entityId)) {
          errors.push(
            `Hierarchy Violation: Entity '${ent.entityId}' declares parent '${parentEnt.entityId}', but parent does not list '${ent.entityId}' in childrenEntityIds.`
          );
        }
      }
    }

    // 2. Check children list
    const seenChildren = new Set<string>();
    for (const childId of ent.childrenEntityIds) {
      if (childId === ent.entityId) {
        errors.push(
          `Hierarchy Violation: Entity '${ent.entityId}' cannot list itself in childrenEntityIds.`
        );
        continue;
      }
      if (seenChildren.has(childId)) {
        errors.push(
          `Hierarchy Violation: Entity '${ent.entityId}' contains duplicate child ID '${childId}'.`
        );
        continue;
      }
      seenChildren.add(childId);

      const childEnt = entityMap.get(childId);
      if (!childEnt) {
        errors.push(
          `Hierarchy Violation: Entity '${ent.entityId}' references non-existent child '${childId}'.`
        );
      } else if (childEnt.parentEntityId !== ent.entityId) {
        errors.push(
          `Hierarchy Violation: Entity '${ent.entityId}' lists child '${childId}', but '${childId}.parentEntityId' is '${String(childEnt.parentEntityId)}'.`
        );
      }
    }
  }

  // 3. Detect circular hierarchy via ancestor chain walk for every entity
  for (const ent of entities) {
    const visited = new Set<string>([ent.entityId]);
    let cursorId = ent.parentEntityId;

    while (cursorId !== null) {
      if (visited.has(cursorId)) {
        errors.push(
          `Circular Hierarchy Detected involving entity '${ent.entityId}' and '${cursorId}'.`
        );
        break;
      }
      visited.add(cursorId);
      const parentObj = entityMap.get(cursorId);
      cursorId = parentObj ? parentObj.parentEntityId : null;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface SceneValidationResult {
  readonly valid: boolean;
  readonly scene: SceneDefinition | null;
  readonly errors: readonly string[];
}

/**
 * Validates any untrusted candidate scene object against the Hylix Scene Schema,
 * ComponentRegistry specifications, and Entity Hierarchy constraints.
 */
export function validateSceneDefinition(
  candidate: unknown,
  registry: ComponentRegistry = createStandardComponentRegistry()
): SceneValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(candidate)) {
    return {
      valid: false,
      scene: null,
      errors: ['Scene definition must be a non-null JSON object.'],
    };
  }

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_SCENE_TOP_KEYS.has(key)) {
      errors.push(`Unexpected top-level property '${key}' in Scene definition.`);
    }
  }

  const rawSchemaVer =
    candidate.schemaVersion !== undefined
      ? candidate.schemaVersion
      : candidate.sceneSchemaVersion;

  if (rawSchemaVer !== CURRENT_SCENE_SCHEMA_VERSION) {
    errors.push(
      `Unsupported Scene schemaVersion '${String(rawSchemaVer)}'. Expected ${CURRENT_SCENE_SCHEMA_VERSION}.`
    );
  }

  if (!isValidSceneId(candidate.sceneId)) {
    errors.push(
      `Invalid sceneId '${String(candidate.sceneId)}'. Expected format 'scene_<16-hex-chars>'.`
    );
  }

  if (typeof candidate.sceneName !== 'string' || candidate.sceneName.trim().length === 0) {
    errors.push('sceneName must be a non-empty string.');
  }

  let normalizedMetadata: SceneMetadata = Object.freeze({
    description: '',
    createdAtIso: '2026-01-01T00:00:00.000Z',
    updatedAtIso: '2026-01-01T00:00:00.000Z',
  });

  if (candidate.metadata !== undefined) {
    if (!isPlainObject(candidate.metadata)) {
      errors.push('Scene metadata must be an object.');
    } else {
      const m = candidate.metadata;
      const allowedMetaKeys = new Set(['description', 'createdAtIso', 'updatedAtIso']);
      for (const k of Object.keys(m)) {
        if (!allowedMetaKeys.has(k)) {
          errors.push(`Unexpected property '${k}' in Scene metadata.`);
        }
      }
      if (m.description !== undefined && typeof m.description !== 'string') {
        errors.push('Scene metadata.description must be a string.');
      }
      if (m.createdAtIso !== undefined && typeof m.createdAtIso !== 'string') {
        errors.push('Scene metadata.createdAtIso must be an ISO timestamp string.');
      }
      if (m.updatedAtIso !== undefined && typeof m.updatedAtIso !== 'string') {
        errors.push('Scene metadata.updatedAtIso must be an ISO timestamp string.');
      }

      normalizedMetadata = Object.freeze({
        description: typeof m.description === 'string' ? m.description : '',
        createdAtIso:
          typeof m.createdAtIso === 'string'
            ? m.createdAtIso
            : '2026-01-01T00:00:00.000Z',
        updatedAtIso:
          typeof m.updatedAtIso === 'string'
            ? m.updatedAtIso
            : '2026-01-01T00:00:00.000Z',
      });
    }
  }

  const validatedEntities: HylixEntity[] = [];
  const seenEntityIds = new Set<string>();

  if (!Array.isArray(candidate.entities)) {
    errors.push('Scene entities must be an array.');
  } else {
    for (let i = 0; i < candidate.entities.length; i++) {
      const rawEnt = candidate.entities[i];
      if (!isPlainObject(rawEnt)) {
        errors.push(`Entity at index [${i}] must be a non-null object.`);
        continue;
      }

      for (const k of Object.keys(rawEnt)) {
        if (!ALLOWED_ENTITY_TOP_KEYS.has(k)) {
          errors.push(`Entity [${i}] contains unexpected property '${k}'.`);
        }
      }

      if (!isValidEntityId(rawEnt.entityId)) {
        errors.push(
          `Entity [${i}] has missing or invalid entityId '${String(rawEnt.entityId)}'.`
        );
        continue;
      }

      if (seenEntityIds.has(rawEnt.entityId)) {
        errors.push(`Duplicate entityId '${rawEnt.entityId}' detected in scene.`);
        continue;
      }
      seenEntityIds.add(rawEnt.entityId);

      if (typeof rawEnt.name !== 'string' || rawEnt.name.trim().length === 0) {
        errors.push(`Entity '${rawEnt.entityId}' must have a non-empty name.`);
      }

      if (typeof rawEnt.enabled !== 'boolean') {
        errors.push(`Entity '${rawEnt.entityId}' enabled flag must be a boolean.`);
      }

      const parentId =
        rawEnt.parentEntityId === undefined ? null : rawEnt.parentEntityId;
      if (parentId !== null && typeof parentId !== 'string') {
        errors.push(
          `Entity '${rawEnt.entityId}' parentEntityId must be a string or null.`
        );
      }

      const childrenIds: string[] = [];
      const rawChildren =
        rawEnt.childrenEntityIds === undefined ? [] : rawEnt.childrenEntityIds;
      if (!Array.isArray(rawChildren)) {
        errors.push(`Entity '${rawEnt.entityId}' childrenEntityIds must be an array.`);
      } else {
        for (const cid of rawChildren) {
          if (typeof cid !== 'string') {
            errors.push(
              `Entity '${rawEnt.entityId}' contains non-string child ID '${String(cid)}'.`
            );
          } else {
            childrenIds.push(cid);
          }
        }
      }

      const validatedComponents: Record<string, unknown> = {};
      if (!isPlainObject(rawEnt.components)) {
        errors.push(`Entity '${rawEnt.entityId}' components must be an object.`);
      } else {
        for (const [compType, compPayload] of Object.entries(rawEnt.components)) {
          const compCheck = registry.validateComponent(compType, compPayload);
          if (!compCheck.valid || compCheck.data === null) {
            errors.push(
              `Entity '${rawEnt.entityId}' component '${compType}' invalid: ${compCheck.errors.join('; ')}`
            );
          } else {
            validatedComponents[compType] = compCheck.data;
          }
        }
      }

      validatedEntities.push(
        Object.freeze({
          entityId: rawEnt.entityId,
          name: typeof rawEnt.name === 'string' ? rawEnt.name.trim() : '',
          enabled: Boolean(rawEnt.enabled),
          parentEntityId: typeof parentId === 'string' ? parentId : null,
          childrenEntityIds: Object.freeze(childrenIds),
          components: Object.freeze(validatedComponents),
        })
      );
    }
  }

  // Validate optional Scene physicsConfig (authored configuration only; rejects runtime physics caches)
  let normalizedPhysicsConfig: ScenePhysicsConfigurationContract | undefined;
  if (candidate.physicsConfig !== undefined) {
    if (!isPlainObject(candidate.physicsConfig)) {
      errors.push('Scene physicsConfig must be a non-null object.');
    } else {
      const pc = candidate.physicsConfig;
      const allowedPcKeys = new Set(['gravity', 'fixedDeltaTime', 'maxSubsteps']);
      for (const k of Object.keys(pc)) {
        if (!allowedPcKeys.has(k)) {
          errors.push(
            `Forbidden or unexpected property '${k}' in Scene physicsConfig (runtime physics state cannot be stored in SceneDefinition).`
          );
        }
      }
      const g = isPlainObject(pc.gravity)
        ? pc.gravity
        : { x: 0, y: -9.81, z: 0 };
      const gx = typeof g.x === 'number' && Number.isFinite(g.x) ? g.x : NaN;
      const gy = typeof g.y === 'number' && Number.isFinite(g.y) ? g.y : NaN;
      const gz = typeof g.z === 'number' && Number.isFinite(g.z) ? g.z : NaN;
      if (!Number.isFinite(gx) || !Number.isFinite(gy) || !Number.isFinite(gz)) {
        errors.push('Scene physicsConfig.gravity must have finite x, y, z numbers.');
      }
      const dt =
        pc.fixedDeltaTime !== undefined ? pc.fixedDeltaTime : 1 / 60;
      if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) {
        errors.push('Scene physicsConfig.fixedDeltaTime must be a finite number > 0.');
      }
      const maxSub = pc.maxSubsteps !== undefined ? pc.maxSubsteps : 8;
      if (
        typeof maxSub !== 'number' ||
        !Number.isFinite(maxSub) ||
        !Number.isInteger(maxSub) ||
        maxSub < 1 ||
        maxSub > 120
      ) {
        errors.push('Scene physicsConfig.maxSubsteps must be an integer in [1, 120].');
      }
      if (errors.length === 0) {
        normalizedPhysicsConfig = Object.freeze({
          gravity: Object.freeze({ x: gx, y: gy, z: gz }),
          fixedDeltaTime: dt as number,
          maxSubsteps: maxSub as number,
        });
      }
    }
  }

  // Validate optional Scene audioConfig (authored configuration only; rejects runtime voices/buffers/handles)
  let normalizedAudioConfig: SceneAudioConfigurationContract | undefined;
  if (candidate.audioConfig !== undefined) {
    if (!isPlainObject(candidate.audioConfig)) {
      errors.push('Scene audioConfig must be a non-null object.');
    } else {
      const ac = candidate.audioConfig;
      const allowedAcKeys = new Set([
        'masterVolume',
        'maxVoices',
        'voiceEvictionPolicy',
        'defaultRolloff',
      ]);
      for (const k of Object.keys(ac)) {
        if (!allowedAcKeys.has(k)) {
          errors.push(
            `Forbidden or unexpected property '${k}' in Scene audioConfig (runtime audio state cannot be stored in SceneDefinition).`
          );
        }
      }
      const masterVolume =
        ac.masterVolume !== undefined ? ac.masterVolume : 1.0;
      if (
        typeof masterVolume !== 'number' ||
        !Number.isFinite(masterVolume) ||
        masterVolume < 0
      ) {
        errors.push('Scene audioConfig.masterVolume must be a finite number >= 0.');
      }
      const maxVoices = ac.maxVoices !== undefined ? ac.maxVoices : 32;
      if (
        typeof maxVoices !== 'number' ||
        !Number.isFinite(maxVoices) ||
        !Number.isInteger(maxVoices) ||
        maxVoices < 1 ||
        maxVoices > 256
      ) {
        errors.push('Scene audioConfig.maxVoices must be an integer in [1, 256].');
      }
      const policy =
        ac.voiceEvictionPolicy !== undefined
          ? ac.voiceEvictionPolicy
          : 'replaceLowestPriority';
      if (
        policy !== 'reject' &&
        policy !== 'replaceLowestPriority' &&
        policy !== 'stopOldestEqualPriority'
      ) {
        errors.push(
          `Scene audioConfig.voiceEvictionPolicy '${String(policy)}' is invalid.`
        );
      }
      const defaultRolloff =
        ac.defaultRolloff !== undefined ? ac.defaultRolloff : 1.0;
      if (
        typeof defaultRolloff !== 'number' ||
        !Number.isFinite(defaultRolloff) ||
        defaultRolloff < 0
      ) {
        errors.push('Scene audioConfig.defaultRolloff must be a finite number >= 0.');
      }
      if (errors.length === 0) {
        normalizedAudioConfig = Object.freeze({
          masterVolume: masterVolume as number,
          maxVoices: maxVoices as number,
          voiceEvictionPolicy: policy as
            | 'reject'
            | 'replaceLowestPriority'
            | 'stopOldestEqualPriority',
          defaultRolloff: defaultRolloff as number,
        });
      }
    }
  }

  // Validate optional Scene inputConfig (authored configuration only; rejects runtime input buffers/devices)
  let normalizedInputConfig: SceneInputConfigurationContract | undefined;
  if (candidate.inputConfig !== undefined) {
    if (!isPlainObject(candidate.inputConfig)) {
      errors.push('Scene inputConfig must be a non-null object.');
    } else {
      const ic = candidate.inputConfig;
      const allowedIcKeys = new Set([
        'maxBufferedEvents',
        'bufferOverflowPolicy',
        'defaultDeadZone',
        'defaultContextName',
      ]);
      for (const k of Object.keys(ic)) {
        if (!allowedIcKeys.has(k)) {
          errors.push(
            `Forbidden or unexpected property '${k}' in Scene inputConfig (runtime input state cannot be stored in SceneDefinition).`
          );
        }
      }
      const maxBufferedEvents =
        ic.maxBufferedEvents !== undefined ? ic.maxBufferedEvents : 512;
      if (
        typeof maxBufferedEvents !== 'number' ||
        !Number.isFinite(maxBufferedEvents) ||
        !Number.isInteger(maxBufferedEvents) ||
        maxBufferedEvents < 1 ||
        maxBufferedEvents > 8192
      ) {
        errors.push(
          'Scene inputConfig.maxBufferedEvents must be an integer in [1, 8192].'
        );
      }
      const bufferOverflowPolicy =
        ic.bufferOverflowPolicy !== undefined
          ? ic.bufferOverflowPolicy
          : 'rejectNewest';
      if (
        bufferOverflowPolicy !== 'rejectNewest' &&
        bufferOverflowPolicy !== 'dropOldest'
      ) {
        errors.push(
          `Scene inputConfig.bufferOverflowPolicy '${String(bufferOverflowPolicy)}' is invalid.`
        );
      }
      const defaultDeadZone =
        ic.defaultDeadZone !== undefined ? ic.defaultDeadZone : 0.1;
      if (
        typeof defaultDeadZone !== 'number' ||
        !Number.isFinite(defaultDeadZone) ||
        defaultDeadZone < 0 ||
        defaultDeadZone >= 1.0
      ) {
        errors.push(
          'Scene inputConfig.defaultDeadZone must be a finite number in [0, 1).'
        );
      }
      const defaultContextName =
        ic.defaultContextName !== undefined
          ? ic.defaultContextName
          : 'Gameplay';
      if (
        typeof defaultContextName !== 'string' ||
        defaultContextName.trim().length === 0
      ) {
        errors.push(
          'Scene inputConfig.defaultContextName must be a non-empty string.'
        );
      }
      if (errors.length === 0) {
        normalizedInputConfig = Object.freeze({
          maxBufferedEvents: maxBufferedEvents as number,
          bufferOverflowPolicy: bufferOverflowPolicy as
            | 'rejectNewest'
            | 'dropOldest',
          defaultDeadZone: defaultDeadZone as number,
          defaultContextName: (defaultContextName as string).trim(),
        });
      }
    }
  }

  // Validate Parent/Child Hierarchy across entities
  if (validatedEntities.length > 0) {
    const hierarchyCheck = validateEntityHierarchy(validatedEntities);
    if (!hierarchyCheck.valid) {
      errors.push(...hierarchyCheck.errors);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      scene: null,
      errors,
    };
  }

  const normalizedScene: SceneDefinition = Object.freeze({
    schemaVersion: CURRENT_SCENE_SCHEMA_VERSION,
    sceneId: candidate.sceneId as string,
    sceneName: (candidate.sceneName as string).trim(),
    metadata: normalizedMetadata,
    entities: Object.freeze(validatedEntities),
    ...(normalizedPhysicsConfig ? { physicsConfig: normalizedPhysicsConfig } : {}),
    ...(normalizedAudioConfig ? { audioConfig: normalizedAudioConfig } : {}),
    ...(normalizedInputConfig ? { inputConfig: normalizedInputConfig } : {}),
  });

  return {
    valid: true,
    scene: normalizedScene,
    errors: [],
  };
}

export function validateSceneJsonString(
  rawJson: string,
  registry: ComponentRegistry = createStandardComponentRegistry()
): SceneValidationResult {
  if (typeof rawJson !== 'string' || rawJson.trim().length === 0) {
    return {
      valid: false,
      scene: null,
      errors: ['Scene JSON payload is empty.'],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return {
      valid: false,
      scene: null,
      errors: ['Malformed JSON syntax in Scene file.'],
    };
  }

  return validateSceneDefinition(parsed, registry);
}

/**
 * Pure Scene Graph Mutation Helpers
 */
export function createSceneDefinition(options: {
  readonly sceneName: string;
  readonly sceneId?: string;
  readonly description?: string;
  readonly entities?: readonly HylixEntity[];
  readonly physicsConfig?: ScenePhysicsConfigurationContract;
  readonly audioConfig?: SceneAudioConfigurationContract;
  readonly seedHint?: string;
  readonly registry?: ComponentRegistry;
}): SceneValidationResult {
  const nowIso = new Date().toISOString();
  const resolvedSceneId =
    options.sceneId ??
    generateDeterministicSceneId(options.sceneName || 'Scene', options.seedHint);

  const candidate: SceneDefinition = {
    schemaVersion: CURRENT_SCENE_SCHEMA_VERSION,
    sceneId: resolvedSceneId,
    sceneName: options.sceneName,
    metadata: {
      description: options.description ?? '',
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    },
    entities: options.entities ?? [],
    ...(options.physicsConfig ? { physicsConfig: options.physicsConfig } : {}),
    ...(options.audioConfig ? { audioConfig: options.audioConfig } : {}),
  };

  return validateSceneDefinition(
    candidate,
    options.registry ?? createStandardComponentRegistry()
  );
}

export function addEntityToScene(
  scene: SceneDefinition,
  entity: HylixEntity,
  registry: ComponentRegistry = createStandardComponentRegistry()
): SceneValidationResult {
  const updated: SceneDefinition = {
    ...scene,
    metadata: {
      ...scene.metadata,
      updatedAtIso: new Date().toISOString(),
    },
    entities: [...scene.entities, entity],
  };

  return validateSceneDefinition(updated, registry);
}

export function updateEntityInScene(
  scene: SceneDefinition,
  entityId: string,
  updater: (existing: HylixEntity) => HylixEntity,
  registry: ComponentRegistry = createStandardComponentRegistry()
): SceneValidationResult {
  const found = scene.entities.find((e) => e.entityId === entityId);
  if (!found) {
    return {
      valid: false,
      scene: null,
      errors: [`Entity '${entityId}' does not exist in scene '${scene.sceneId}'.`],
    };
  }

  const nextEntity = updater(found);
  if (nextEntity.entityId !== entityId) {
    return {
      valid: false,
      scene: null,
      errors: [
        `Entity ID Immutability Violation: cannot change entityId from '${entityId}' to '${nextEntity.entityId}'.`,
      ],
    };
  }

  const updated: SceneDefinition = {
    ...scene,
    metadata: {
      ...scene.metadata,
      updatedAtIso: new Date().toISOString(),
    },
    entities: scene.entities.map((e) => (e.entityId === entityId ? nextEntity : e)),
  };

  return validateSceneDefinition(updated, registry);
}

/**
 * Sets or clears `parentEntityId` for `childEntityId` within `scene`,
 * automatically maintaining bidirectional `childrenEntityIds` and validating
 * against self-parenting, missing entities, and circular hierarchies.
 */
export function setEntityParentInScene(
  scene: SceneDefinition,
  childEntityId: string,
  newParentEntityId: string | null,
  registry: ComponentRegistry = createStandardComponentRegistry()
): SceneValidationResult {
  const childExists = scene.entities.some((e) => e.entityId === childEntityId);
  if (!childExists) {
    return {
      valid: false,
      scene: null,
      errors: [`Child entity '${childEntityId}' does not exist in scene.`],
    };
  }

  if (newParentEntityId !== null) {
    if (newParentEntityId === childEntityId) {
      return {
        valid: false,
        scene: null,
        errors: [`Entity '${childEntityId}' cannot be set as its own parent.`],
      };
    }
    const parentExists = scene.entities.some((e) => e.entityId === newParentEntityId);
    if (!parentExists) {
      return {
        valid: false,
        scene: null,
        errors: [`Parent entity '${newParentEntityId}' does not exist in scene.`],
      };
    }
  }

  const updatedEntities = scene.entities.map((ent) => {
    let nextParentId = ent.parentEntityId;
    let nextChildren = ent.childrenEntityIds.filter((id) => id !== childEntityId);

    if (ent.entityId === childEntityId) {
      nextParentId = newParentEntityId;
    }

    if (newParentEntityId !== null && ent.entityId === newParentEntityId) {
      if (!nextChildren.includes(childEntityId)) {
        nextChildren = [...nextChildren, childEntityId];
      }
    }

    return Object.freeze({
      ...ent,
      parentEntityId: nextParentId,
      childrenEntityIds: Object.freeze(nextChildren),
    });
  });

  const candidateScene: SceneDefinition = {
    ...scene,
    metadata: {
      ...scene.metadata,
      updatedAtIso: new Date().toISOString(),
    },
    entities: updatedEntities,
  };

  return validateSceneDefinition(candidateScene, registry);
}

/**
 * Creates an isolated `SceneRuntimeInstanceContract` from a validated `SceneDefinition`.
 * Deep-clones entity and component payloads so runtime state cannot mutate authored Scene Data.
 */
export function createSceneRuntimeInstance(
  scene: SceneDefinition
): SceneRuntimeInstanceContract {
  const runtimeMap = new Map<string, HylixEntity>();

  for (const ent of scene.entities) {
    const clonedComponents = JSON.parse(JSON.stringify(ent.components)) as Record<
      string,
      unknown
    >;
    const clonedEntity: HylixEntity = Object.freeze({
      entityId: ent.entityId,
      name: ent.name,
      enabled: ent.enabled,
      parentEntityId: ent.parentEntityId,
      childrenEntityIds: Object.freeze([...ent.childrenEntityIds]),
      components: Object.freeze(clonedComponents),
    });
    runtimeMap.set(ent.entityId, clonedEntity);
  }

  return Object.freeze({
    runtimeInstanceId: `rt_${computeDeterministicChecksum(`${scene.sceneId}::${Date.now()}`)}`,
    sourceSceneId: scene.sceneId,
    sourceSceneVersion: scene.schemaVersion,
    isolatedFromProjectData: true,
    lifecycleState: 'INITIALIZED',
    runtimeEntitiesById: runtimeMap,
  });
}

/**
 * Decoupled contract allowing Scene System to verify Asset References
 * (`Scene -> Entity -> Component -> Asset Reference`) without direct coupling to ResourceManager.
 */
export interface SceneAssetLookupContract {
  resolveAssetReference(assetId: string): {
    readonly assetId: string;
    readonly status: 'available' | 'missing' | 'corrupted' | 'invalid';
    readonly reason?: string;
  };
}

export interface SceneAssetReferenceStatus {
  readonly entityId: string;
  readonly componentType: string;
  readonly propertyKey: string;
  readonly assetId: string;
  readonly status: 'available' | 'missing' | 'corrupted' | 'invalid';
  readonly reason?: string;
}

export interface SceneAssetInspectionReport {
  readonly sceneId: string;
  readonly allAvailable: boolean;
  readonly references: readonly SceneAssetReferenceStatus[];
  readonly missingAssets: readonly SceneAssetReferenceStatus[];
  readonly corruptedAssets: readonly SceneAssetReferenceStatus[];
}

/**
 * Inspects all `*AssetId` / `assetId` references across all entities and components in a Scene.
 * Gracefully reports `missing` or `corrupted` assets without crashing Scene System
 * and without fabricating fake assets inside the Asset Registry.
 */
export function inspectSceneAssetReferences(
  scene: SceneDefinition,
  assetLookup: SceneAssetLookupContract
): SceneAssetInspectionReport {
  const references: SceneAssetReferenceStatus[] = [];
  const missingAssets: SceneAssetReferenceStatus[] = [];
  const corruptedAssets: SceneAssetReferenceStatus[] = [];

  for (const ent of scene.entities) {
    for (const [compType, compPayload] of Object.entries(ent.components)) {
      if (!isPlainObject(compPayload)) continue;
      for (const [propKey, propVal] of Object.entries(compPayload)) {
        if (
          (propKey === 'assetId' || propKey.endsWith('AssetId')) &&
          typeof propVal === 'string'
        ) {
          const resolved = assetLookup.resolveAssetReference(propVal);
          const item: SceneAssetReferenceStatus = Object.freeze({
            entityId: ent.entityId,
            componentType: compType,
            propertyKey: propKey,
            assetId: propVal,
            status: resolved.status,
            reason: resolved.reason,
          });
          references.push(item);
          if (resolved.status === 'missing') {
            missingAssets.push(item);
          } else if (resolved.status === 'corrupted') {
            corruptedAssets.push(item);
          }
        }
      }
    }
  }

  return Object.freeze({
    sceneId: scene.sceneId,
    allAvailable:
      missingAssets.length === 0 &&
      corruptedAssets.length === 0 &&
      references.every((r) => r.status === 'available'),
    references: Object.freeze(references),
    missingAssets: Object.freeze(missingAssets),
    corruptedAssets: Object.freeze(corruptedAssets),
  });
}

/**
 * HylixSceneManager: Integrates Scene System with `LocalFirstAtomicStore` and `HylixProjectManager`.
 */
export class HylixSceneManager {
  private readonly store: LocalFirstAtomicStore;
  private readonly registry: ComponentRegistry;
  private activeScenesByProject = new Map<string, SceneDefinition>();

  constructor(
    store: LocalFirstAtomicStore,
    registry: ComponentRegistry = createStandardComponentRegistry()
  ) {
    this.store = store;
    this.registry = registry;
  }

  public getComponentRegistry(): ComponentRegistry {
    return this.registry;
  }

  public getCurrentScene(projectRoot: string): SceneDefinition | null {
    const check = validateWorkspaceRelativePath(projectRoot);
    if (!check.safe) return null;
    return this.activeScenesByProject.get(check.normalizedPath) ?? null;
  }

  public listProjectScenePaths(projectRoot: string): readonly string[] {
    const check = validateWorkspaceRelativePath(projectRoot);
    if (!check.safe || check.normalizedPath.includes('/')) return [];
    const root = check.normalizedPath;
    const prefix = `${root}/scenes/`;

    return this.store
      .listProjectFiles(root)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .map((f) => f.slice(root.length + 1));
  }

  public createSceneInProject(params: {
    readonly projectRoot: string;
    readonly sessionId: string;
    readonly sceneRelativePath: string;
    readonly sceneName: string;
    readonly description?: string;
    readonly initialEntities?: readonly HylixEntity[];
    readonly nowEpochMs?: number;
  }): {
    success: boolean;
    scene: SceneDefinition | null;
    sceneRelativePath: string;
    checksumHex: string;
    errors: readonly string[];
  } {
    const pathCheck = validateWorkspaceRelativePath(params.sceneRelativePath);
    if (!pathCheck.safe || !pathCheck.normalizedPath.startsWith('scenes/')) {
      return {
        success: false,
        scene: null,
        sceneRelativePath: params.sceneRelativePath,
        checksumHex: '',
        errors: [
          pathCheck.reason ||
            `Scene path '${params.sceneRelativePath}' must reside inside 'scenes/'.`,
        ],
      };
    }

    const scopedScenePath = validateProjectScopedPath(
      params.projectRoot,
      pathCheck.normalizedPath
    );
    if (!scopedScenePath.safe) {
      return {
        success: false,
        scene: null,
        sceneRelativePath: params.sceneRelativePath,
        checksumHex: '',
        errors: [scopedScenePath.reason || 'Unsafe project scene path.'],
      };
    }

    if (this.store.fileExists(scopedScenePath.normalizedPath)) {
      return {
        success: false,
        scene: null,
        sceneRelativePath: pathCheck.normalizedPath,
        checksumHex: '',
        errors: [`Scene file '${pathCheck.normalizedPath}' already exists in project.`],
      };
    }

    const lockInspect = inspectWorkspaceLock(
      this.store,
      params.projectRoot,
      params.sessionId,
      params.nowEpochMs
    );
    if (lockInspect.state !== 'LOCKED_BY_CURRENT_SESSION' || !lockInspect.record) {
      return {
        success: false,
        scene: null,
        sceneRelativePath: pathCheck.normalizedPath,
        checksumHex: '',
        errors: [
          `Session '${params.sessionId}' must hold an active workspace lock on '${params.projectRoot}' before creating scenes.`,
        ],
      };
    }

    const created = createSceneDefinition({
      sceneName: params.sceneName,
      description: params.description,
      entities: params.initialEntities ?? [],
      seedHint: `${lockInspect.record.projectId}::${pathCheck.normalizedPath}`,
      registry: this.registry,
    });

    if (!created.valid || !created.scene) {
      return {
        success: false,
        scene: null,
        sceneRelativePath: pathCheck.normalizedPath,
        checksumHex: '',
        errors: created.errors,
      };
    }

    const serialized = JSON.stringify(created.scene, null, 2);

    // Register & write atomically (twice to establish initial .bak baseline)
    this.store.writeFileAtomically(scopedScenePath.normalizedPath, serialized);
    const regRes = registerProjectAssetAtomically(
      this.store,
      params.projectRoot,
      lockInspect.record.projectId,
      pathCheck.normalizedPath,
      'Scene',
      serialized
    );

    if (!regRes.success || !regRes.entry) {
      return {
        success: false,
        scene: null,
        sceneRelativePath: pathCheck.normalizedPath,
        checksumHex: '',
        errors: [regRes.error || 'Failed to register scene in project Asset Registry.'],
      };
    }

    this.activeScenesByProject.set(params.projectRoot.trim(), created.scene);

    return {
      success: true,
      scene: created.scene,
      sceneRelativePath: pathCheck.normalizedPath,
      checksumHex: regRes.entry.checksum,
      errors: [],
    };
  }

  public openSceneInProject(
    projectRoot: string,
    sceneRelativePath: string
  ): {
    success: boolean;
    scene: SceneDefinition | null;
    corrupted: boolean;
    errors: readonly string[];
  } {
    const pathCheck = validateWorkspaceRelativePath(sceneRelativePath);
    if (!pathCheck.safe || !pathCheck.normalizedPath.startsWith('scenes/')) {
      return {
        success: false,
        scene: null,
        corrupted: false,
        errors: [
          pathCheck.reason ||
            `Scene path '${sceneRelativePath}' must be a valid relative path inside 'scenes/'.`,
        ],
      };
    }

    const scoped = validateProjectScopedPath(projectRoot, pathCheck.normalizedPath);
    if (!scoped.safe) {
      return {
        success: false,
        scene: null,
        corrupted: false,
        errors: [scoped.reason || 'Invalid project root or scene path.'],
      };
    }

    const readRes = this.store.readVerifiedFile(scoped.normalizedPath, false);
    if (!readRes.valid || !readRes.record) {
      return {
        success: false,
        scene: null,
        corrupted: readRes.corruptedPrimaryDetected,
        errors: [readRes.error || `Scene '${pathCheck.normalizedPath}' could not be read.`],
      };
    }

    const val = validateSceneJsonString(readRes.record.content, this.registry);
    if (!val.valid || !val.scene) {
      return {
        success: false,
        scene: null,
        corrupted: true,
        errors: val.errors,
      };
    }

    this.activeScenesByProject.set(projectRoot.trim(), val.scene);
    return {
      success: true,
      scene: val.scene,
      corrupted: false,
      errors: [],
    };
  }

  public openMainScene(projectRoot: string): {
    success: boolean;
    scene: SceneDefinition | null;
    sceneRelativePath: string;
    errors: readonly string[];
  } {
    const manifestScoped = validateProjectScopedPath(
      projectRoot,
      'project.hylix.json'
    );
    if (!manifestScoped.safe) {
      return {
        success: false,
        scene: null,
        sceneRelativePath: '',
        errors: [manifestScoped.reason || 'Invalid project root.'],
      };
    }

    const manifestRead = this.store.readVerifiedFile(manifestScoped.normalizedPath, false);
    if (!manifestRead.valid || !manifestRead.record) {
      return {
        success: false,
        scene: null,
        sceneRelativePath: '',
        errors: [manifestRead.error || 'Could not read project.hylix.json.'],
      };
    }

    const manifestVal = validateProjectManifestJsonString(
      manifestRead.record.content,
      { store: this.store, projectRoot: projectRoot.trim() }
    );
    if (!manifestVal.valid || !manifestVal.manifest) {
      return {
        success: false,
        scene: null,
        sceneRelativePath: '',
        errors: manifestVal.errors,
      };
    }

    const defaultScenePath = manifestVal.manifest.defaultScene;
    const openRes = this.openSceneInProject(projectRoot, defaultScenePath);
    return {
      success: openRes.success,
      scene: openRes.scene,
      sceneRelativePath: defaultScenePath,
      errors: openRes.errors,
    };
  }

  /**
   * Saves a validated SceneDefinition atomically:
   * Validate -> Check SceneID Persistence -> Serialize -> Atomic Write -> Checksum -> Asset Registry Update.
   */
  public saveSceneInProject(params: {
    readonly projectRoot: string;
    readonly sessionId: string;
    readonly sceneRelativePath: string;
    readonly scene: SceneDefinition;
    readonly nowEpochMs?: number;
  }): {
    success: boolean;
    scene: SceneDefinition | null;
    checksumHex: string;
    errors: readonly string[];
  } {
    const pathCheck = validateWorkspaceRelativePath(params.sceneRelativePath);
    if (!pathCheck.safe || !pathCheck.normalizedPath.startsWith('scenes/')) {
      return {
        success: false,
        scene: null,
        checksumHex: '',
        errors: [
          pathCheck.reason ||
            `Scene path '${params.sceneRelativePath}' must reside inside 'scenes/'.`,
        ],
      };
    }

    const scoped = validateProjectScopedPath(
      params.projectRoot,
      pathCheck.normalizedPath
    );
    if (!scoped.safe) {
      return {
        success: false,
        scene: null,
        checksumHex: '',
        errors: [scoped.reason || 'Unsafe project scene path.'],
      };
    }

    const lockInspect = inspectWorkspaceLock(
      this.store,
      params.projectRoot,
      params.sessionId,
      params.nowEpochMs
    );
    if (lockInspect.state !== 'LOCKED_BY_CURRENT_SESSION' || !lockInspect.record) {
      return {
        success: false,
        scene: null,
        checksumHex: '',
        errors: [
          `Cannot save scene: session '${params.sessionId}' does not hold the active workspace lock.`,
        ],
      };
    }

    // Step 1: Validate SceneDefinition (schema, entities, components, hierarchy)
    const validation = validateSceneDefinition(params.scene, this.registry);
    if (!validation.valid || !validation.scene) {
      return {
        success: false,
        scene: null,
        checksumHex: '',
        errors: validation.errors,
      };
    }

    // Step 2: If file already exists, enforce Scene ID immutability
    if (this.store.fileExists(scoped.normalizedPath)) {
      const existingRead = this.store.readVerifiedFile(scoped.normalizedPath, true);
      if (existingRead.valid && existingRead.record) {
        const existingVal = validateSceneJsonString(
          existingRead.record.content,
          this.registry
        );
        if (
          existingVal.valid &&
          existingVal.scene &&
          existingVal.scene.sceneId !== validation.scene.sceneId
        ) {
          return {
            success: false,
            scene: null,
            checksumHex: '',
            errors: [
              `Scene ID Immutability Violation: cannot change sceneId from '${existingVal.scene.sceneId}' to '${validation.scene.sceneId}'.`,
            ],
          };
        }
      }
    }

    // Step 3: Serialize & Atomic Write + Asset Registry Checksum sync
    const serialized = JSON.stringify(validation.scene, null, 2);
    const regRes = registerProjectAssetAtomically(
      this.store,
      params.projectRoot,
      lockInspect.record.projectId,
      pathCheck.normalizedPath,
      'Scene',
      serialized
    );

    if (!regRes.success || !regRes.entry) {
      return {
        success: false,
        scene: null,
        checksumHex: '',
        errors: [regRes.error || 'Atomic write of scene failed.'],
      };
    }

    this.activeScenesByProject.set(params.projectRoot.trim(), validation.scene);

    return {
      success: true,
      scene: validation.scene,
      checksumHex: regRes.entry.checksum,
      errors: [],
    };
  }

  public closeCurrentScene(projectRoot: string): boolean {
    const check = validateWorkspaceRelativePath(projectRoot);
    if (!check.safe) return false;
    return this.activeScenesByProject.delete(check.normalizedPath);
  }
}
