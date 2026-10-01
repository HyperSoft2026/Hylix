import {
  HylixAssetRegistry,
  isValidAssetId,
} from '../assets/assetRegistry';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  ComponentRegistry,
  ComponentSpecification,
  ComponentValidationResult,
  HylixEntity,
  TRANSFORM_COMPONENT_TYPE,
  validateTransformComponentData,
} from '../ecs/ecsCore';
import { SceneDefinition } from '../scene/sceneSystem';
import {
  ColliderDescriptor,
  ColliderLocalTransform,
  createDefaultColliderLocalTransform,
  validateColliderLocalTransform,
} from './collider';
import {
  ALL_COLLISION_LAYERS_MASK,
  DEFAULT_COLLISION_LAYER_BITMASK,
  validateCollisionBitmask,
} from './collisionLayers';
import {
  DEFAULT_FIXED_DELTA_TIME,
  DEFAULT_MAX_SUBSTEPS,
  validateFixedTimestepConfig,
} from './fixedTimestep';
import { RigidBodyDescriptor, RigidBodyType } from './physicsBody';
import {
  createDefaultVector3,
  createPhysicsId,
  isFinitePhysicsNumber,
  isForbiddenPhysicsInputString,
  isPlainPhysicsObject,
  PhysicsValidationResult,
  validateVector3,
  Vector3,
} from './physicsTypes';
import { DEFAULT_WORLD_GRAVITY, PhysicsWorld } from './physicsWorld';
import { PhysicsShape, validatePhysicsShape } from './shapes';

/**
 * Hylix V1.0.0 — Phase 06: ECS & Scene Physics Extraction (STEP 27, STEP 28, STEP 30)
 *
 * Architecture:
 *   ECS / Scene (Read-Only)
 *     -> Physics Extraction (`extractScenePhysicsData`)
 *     -> PhysicsWorld
 *
 * Strictly enforces:
 * - ECS components (`RigidBody`, `Collider`) are pure serializable data contracts.
 * - `SceneDefinition` may store `physicsConfig` (`gravity`, `fixedDeltaTime`, `maxSubsteps`),
 *   but NEVER runtime state (`collisionCache`, `activeContacts`, `contactArrays`, `broadphaseState`).
 * - Asset references (`physicsMaterialAssetId`) use `asset_<16-hex>` only and are verified via `HylixAssetRegistry`.
 */

export const RIGID_BODY_COMPONENT_TYPE = 'RigidBody';
export const COLLIDER_COMPONENT_TYPE = 'Collider';

export interface RigidBodyComponentData {
  readonly bodyType: RigidBodyType;
  readonly mass: number;
  readonly linearVelocity: Vector3;
  readonly angularVelocity: Vector3;
  readonly linearDamping: number;
  readonly angularDamping: number;
  readonly gravityScale: number;
  readonly isSleeping: boolean;
  readonly isEnabled: boolean;
}

export interface ColliderComponentData {
  readonly shape: PhysicsShape;
  readonly localTransform: ColliderLocalTransform;
  readonly isTrigger: boolean;
  readonly collisionLayer: number;
  readonly collisionMask: number;
  readonly physicsMaterialAssetId?: string;
  readonly enabled: boolean;
}

export interface ScenePhysicsConfig {
  readonly gravity: Vector3;
  readonly fixedDeltaTime: number;
  readonly maxSubsteps: number;
}

const FORBIDDEN_SCENE_RUNTIME_PHYSICS_KEYS = new Set([
  'collisionCache',
  'currentCollisionCache',
  'contactArrays',
  'activeContacts',
  'broadphaseState',
  'temporaryBroadphaseState',
  'runtimeBodies',
  'runtimeColliders',
]);

export function createDefaultScenePhysicsConfig(): ScenePhysicsConfig {
  return Object.freeze({
    gravity: DEFAULT_WORLD_GRAVITY,
    fixedDeltaTime: DEFAULT_FIXED_DELTA_TIME,
    maxSubsteps: DEFAULT_MAX_SUBSTEPS,
  });
}

/**
 * Validates Scene Physics Configuration (STEP 28) and explicitly rejects any attempt
 * to serialize runtime physics state (`collisionCache`, `contactArrays`, `broadphaseState`).
 */
export function validateScenePhysicsConfig(
  candidate: unknown
): PhysicsValidationResult<ScenePhysicsConfig> {
  if (candidate === undefined) {
    return {
      valid: true,
      value: createDefaultScenePhysicsConfig(),
      errors: [],
    };
  }

  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['Scene physicsConfig must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  for (const key of Object.keys(candidate)) {
    if (FORBIDDEN_SCENE_RUNTIME_PHYSICS_KEYS.has(key)) {
      errors.push(
        `Scene Physics Violation: Forbidden runtime state property '${key}' cannot be stored in Scene configuration.`
      );
    } else if (
      key !== 'gravity' &&
      key !== 'fixedDeltaTime' &&
      key !== 'maxSubsteps'
    ) {
      errors.push(`Unexpected property '${key}' in Scene physicsConfig.`);
    }
  }

  const gravRes = validateVector3(
    candidate.gravity ?? DEFAULT_WORLD_GRAVITY,
    'physicsConfig.gravity'
  );
  const tsRes = validateFixedTimestepConfig({
    fixedDeltaTime: candidate.fixedDeltaTime ?? DEFAULT_FIXED_DELTA_TIME,
    maxSubsteps: candidate.maxSubsteps ?? DEFAULT_MAX_SUBSTEPS,
  });

  errors.push(...gravRes.errors, ...tsRes.errors);

  if (errors.length > 0 || !gravRes.value || !tsRes.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      gravity: gravRes.value,
      fixedDeltaTime: tsRes.value.fixedDeltaTime,
      maxSubsteps: tsRes.value.maxSubsteps,
    }),
    errors: [],
  };
}

export function createDefaultRigidBodyComponentData(): RigidBodyComponentData {
  return Object.freeze({
    bodyType: 'dynamic',
    mass: 1,
    linearVelocity: createDefaultVector3(),
    angularVelocity: createDefaultVector3(),
    linearDamping: 0.01,
    angularDamping: 0.05,
    gravityScale: 1,
    isSleeping: false,
    isEnabled: true,
  });
}

export function validateRigidBodyComponentData(
  candidate: unknown
): ComponentValidationResult<RigidBodyComponentData> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      data: null,
      errors: ['RigidBody component must be a non-null object.'],
    };
  }

  const errors: string[] = [];
  const bodyType = candidate.bodyType ?? 'dynamic';
  if (
    bodyType !== 'static' &&
    bodyType !== 'dynamic' &&
    bodyType !== 'kinematic'
  ) {
    errors.push(
      `Invalid RigidBody.bodyType '${String(bodyType)}'; expected 'static' | 'dynamic' | 'kinematic'.`
    );
  }

  const mass =
    candidate.mass !== undefined
      ? candidate.mass
      : bodyType === 'dynamic'
      ? 1
      : 0;

  if (!isFinitePhysicsNumber(mass) || mass < 0) {
    errors.push(
      `RigidBody.mass must be a finite number >= 0 (received ${String(mass)}).`
    );
  } else if (bodyType === 'dynamic' && mass <= 0) {
    errors.push(`Dynamic RigidBody must have mass > 0 (received ${mass}).`);
  }

  const linVelRes = validateVector3(
    candidate.linearVelocity ?? createDefaultVector3(),
    'RigidBody.linearVelocity'
  );
  const angVelRes = validateVector3(
    candidate.angularVelocity ?? createDefaultVector3(),
    'RigidBody.angularVelocity'
  );
  errors.push(...linVelRes.errors, ...angVelRes.errors);

  const linearDamping =
    candidate.linearDamping !== undefined ? candidate.linearDamping : 0.01;
  if (!isFinitePhysicsNumber(linearDamping) || linearDamping < 0) {
    errors.push('RigidBody.linearDamping must be a finite number >= 0.');
  }

  const angularDamping =
    candidate.angularDamping !== undefined ? candidate.angularDamping : 0.05;
  if (!isFinitePhysicsNumber(angularDamping) || angularDamping < 0) {
    errors.push('RigidBody.angularDamping must be a finite number >= 0.');
  }

  const gravityScale =
    candidate.gravityScale !== undefined ? candidate.gravityScale : 1;
  if (!isFinitePhysicsNumber(gravityScale)) {
    errors.push('RigidBody.gravityScale must be a finite number.');
  }

  if (errors.length > 0 || !linVelRes.value || !angVelRes.value) {
    return { valid: false, data: null, errors };
  }

  return {
    valid: true,
    data: Object.freeze({
      bodyType: bodyType as RigidBodyType,
      mass: mass as number,
      linearVelocity: linVelRes.value,
      angularVelocity: angVelRes.value,
      linearDamping: linearDamping as number,
      angularDamping: angularDamping as number,
      gravityScale: gravityScale as number,
      isSleeping:
        candidate.isSleeping !== undefined ? Boolean(candidate.isSleeping) : false,
      isEnabled:
        candidate.isEnabled !== undefined ? Boolean(candidate.isEnabled) : true,
    }),
    errors: [],
  };
}

export function createDefaultColliderComponentData(): ColliderComponentData {
  return Object.freeze({
    shape: Object.freeze({
      kind: 'box3d',
      dimension: '3D',
      halfExtents: Object.freeze({ x: 0.5, y: 0.5, z: 0.5 }),
    }),
    localTransform: createDefaultColliderLocalTransform(),
    isTrigger: false,
    collisionLayer: DEFAULT_COLLISION_LAYER_BITMASK,
    collisionMask: ALL_COLLISION_LAYERS_MASK,
    enabled: true,
  });
}

export function validateColliderComponentData(
  candidate: unknown
): ComponentValidationResult<ColliderComponentData> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      data: null,
      errors: ['Collider component must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  for (const forbiddenKey of [
    'filePath',
    'path',
    'materialPath',
    'meshPath',
    'url',
  ]) {
    if (forbiddenKey in candidate) {
      errors.push(
        `Forbidden raw path property '${forbiddenKey}' in Collider component; use 'physicsMaterialAssetId'.`
      );
    }
  }

  const shapeRes = validatePhysicsShape(candidate.shape);
  const localTransRes = validateColliderLocalTransform(
    candidate.localTransform
  );
  const layerRes = validateCollisionBitmask(
    candidate.collisionLayer ?? DEFAULT_COLLISION_LAYER_BITMASK,
    'Collider.collisionLayer'
  );
  const maskRes = validateCollisionBitmask(
    candidate.collisionMask ?? ALL_COLLISION_LAYERS_MASK,
    'Collider.collisionMask'
  );

  errors.push(
    ...shapeRes.errors,
    ...localTransRes.errors,
    ...layerRes.errors,
    ...maskRes.errors
  );

  let physicsMaterialAssetId: string | undefined;
  if (candidate.physicsMaterialAssetId !== undefined) {
    if (!isValidAssetId(candidate.physicsMaterialAssetId)) {
      errors.push(
        `Invalid Collider.physicsMaterialAssetId '${String(candidate.physicsMaterialAssetId)}'; expected 'asset_<16-hex>'.`
      );
    } else {
      physicsMaterialAssetId = candidate.physicsMaterialAssetId;
    }
  }

  if (
    errors.length > 0 ||
    !shapeRes.value ||
    !localTransRes.value ||
    layerRes.value === null ||
    maskRes.value === null
  ) {
    return { valid: false, data: null, errors };
  }

  return {
    valid: true,
    data: Object.freeze({
      shape: shapeRes.value,
      localTransform: localTransRes.value,
      isTrigger:
        candidate.isTrigger !== undefined ? Boolean(candidate.isTrigger) : false,
      collisionLayer: layerRes.value,
      collisionMask: maskRes.value,
      ...(physicsMaterialAssetId ? { physicsMaterialAssetId } : {}),
      enabled:
        candidate.enabled !== undefined ? Boolean(candidate.enabled) : true,
    }),
    errors: [],
  };
}

export const OFFICIAL_RIGID_BODY_COMPONENT_SPEC: ComponentSpecification<RigidBodyComponentData> =
  Object.freeze({
    type: RIGID_BODY_COMPONENT_TYPE,
    schemaVersion: 1,
    createDefault: createDefaultRigidBodyComponentData,
    validate: validateRigidBodyComponentData,
  });

export const OFFICIAL_COLLIDER_COMPONENT_SPEC: ComponentSpecification<ColliderComponentData> =
  Object.freeze({
    type: COLLIDER_COMPONENT_TYPE,
    schemaVersion: 1,
    createDefault: createDefaultColliderComponentData,
    validate: validateColliderComponentData,
  });

/**
 * Registers `RigidBody` and `Collider` component specifications into an ECS `ComponentRegistry`.
 */
export function registerPhysicsEcsComponents(
  registry: ComponentRegistry
): ComponentRegistry {
  if (!registry.isRegistered(RIGID_BODY_COMPONENT_TYPE)) {
    registry.registerComponentType(OFFICIAL_RIGID_BODY_COMPONENT_SPEC);
  }
  if (!registry.isRegistered(COLLIDER_COMPONENT_TYPE)) {
    registry.registerComponentType(OFFICIAL_COLLIDER_COMPONENT_SPEC);
  }
  return registry;
}

export interface MissingPhysicsAssetDiagnostic {
  readonly entityId: string;
  readonly entityName: string;
  readonly assetId: string;
  readonly reason: string;
}

export interface ScenePhysicsExtractionResult {
  readonly sceneId: string;
  readonly projectId: string;
  readonly readOnlyVerified: true;
  readonly world: PhysicsWorld;
  readonly extractedBodies: readonly RigidBodyDescriptor[];
  readonly extractedColliders: readonly ColliderDescriptor[];
  readonly missingAssetDiagnostics: readonly MissingPhysicsAssetDiagnostic[];
  readonly validationErrors: readonly string[];
}

function readEntityTransformVectors(entity: HylixEntity): {
  position: Vector3;
  rotation: Vector3;
} {
  const rawTransform = entity.components[TRANSFORM_COMPONENT_TYPE];
  if (rawTransform) {
    const check = validateTransformComponentData(rawTransform);
    if (check.valid && check.data) {
      return {
        position: Object.freeze({ ...check.data.position }),
        rotation: Object.freeze({ ...check.data.rotation }),
      };
    }
  }
  return {
    position: createDefaultVector3(),
    rotation: createDefaultVector3(),
  };
}

/**
 * Read-Only Scene/ECS Physics Extraction (STEP 27, STEP 28, STEP 30).
 *
 * Extracts `RigidBody` and `Collider` components from `SceneDefinition` into a
 * project-isolated `PhysicsWorld` with deterministic IDs that remain identical
 * regardless of entity ordering in `scene.entities`.
 */
export function extractScenePhysicsData(
  scene: SceneDefinition,
  options: {
    readonly projectId: string;
    readonly physicsConfig?: Partial<ScenePhysicsConfig>;
    readonly assetRegistry?: HylixAssetRegistry;
    readonly logger?: RedactedDiagnosticLogger;
  }
): ScenePhysicsExtractionResult {
  const logger = options.logger;
  const assetRegistry = options.assetRegistry;
  const projectId = options.projectId.trim() || 'prj_default';

  const sceneConfigCandidate =
    options.physicsConfig ?? scene.physicsConfig ?? undefined;
  const configCheck = validateScenePhysicsConfig(sceneConfigCandidate);
  const validationErrors: string[] = [...configCheck.errors];
  const resolvedConfig =
    configCheck.value ?? createDefaultScenePhysicsConfig();

  const world = new PhysicsWorld({
    projectId,
    worldId: createPhysicsId('physics', `${projectId}::${scene.sceneId}`),
    gravity: resolvedConfig.gravity,
    fixedTimestep: {
      fixedDeltaTime: resolvedConfig.fixedDeltaTime,
      maxSubsteps: resolvedConfig.maxSubsteps,
    },
    logger,
    autoInitialize: true,
  });

  const missingAssetDiagnostics: MissingPhysicsAssetDiagnostic[] = [];

  // Sort entities deterministically by entityId so extraction is 100% invariant to scene/entity reorder
  const sortedEntities = [...scene.entities].sort((a, b) =>
    a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0
  );

  for (const entity of sortedEntities) {
    if (!entity.enabled) continue;

    const secCheck = isForbiddenPhysicsInputString(entity.name);
    if (secCheck.forbidden) {
      validationErrors.push(secCheck.reason!);
      logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${secCheck.reason}`
      );
      continue;
    }

    const { position, rotation } = readEntityTransformVectors(entity);
    const hasRigidBody = RIGID_BODY_COMPONENT_TYPE in entity.components;
    const hasCollider = COLLIDER_COMPONENT_TYPE in entity.components;

    if (!hasRigidBody && !hasCollider) continue;

    const deterministicBodyId = createPhysicsId(
      'body',
      `${projectId}::${entity.entityId}`
    );

    if (hasRigidBody) {
      const rbVal = validateRigidBodyComponentData(
        entity.components[RIGID_BODY_COMPONENT_TYPE]
      );
      if (!rbVal.valid || !rbVal.data) {
        validationErrors.push(...rbVal.errors);
        logger?.record(
          'physics',
          'ERROR',
          `physics_validation_failed: Entity '${entity.entityId}' invalid RigidBody (${rbVal.errors.join('; ')})`
        );
      } else {
        world.addBody({
          bodyId: deterministicBodyId,
          entityId: entity.entityId,
          projectId,
          bodyType: rbVal.data.bodyType,
          position,
          rotation,
          linearVelocity: rbVal.data.linearVelocity,
          angularVelocity: rbVal.data.angularVelocity,
          mass: rbVal.data.mass,
          linearDamping: rbVal.data.linearDamping,
          angularDamping: rbVal.data.angularDamping,
          gravityScale: rbVal.data.gravityScale,
          isSleeping: rbVal.data.isSleeping,
          isEnabled: rbVal.data.isEnabled,
        });
      }
    } else if (hasCollider) {
      // Standalone Collider on an Entity without explicit RigidBody gets a deterministic Static body at Entity's Transform
      world.addBody({
        bodyId: deterministicBodyId,
        entityId: entity.entityId,
        projectId,
        bodyType: 'static',
        position,
        rotation,
        mass: 0,
      });
    }

    if (hasCollider) {
      const colVal = validateColliderComponentData(
        entity.components[COLLIDER_COMPONENT_TYPE]
      );
      if (!colVal.valid || !colVal.data) {
        validationErrors.push(...colVal.errors);
        logger?.record(
          'physics',
          'ERROR',
          `physics_validation_failed: Entity '${entity.entityId}' invalid Collider (${colVal.errors.join('; ')})`
        );
      } else {
        const matAssetId = colVal.data.physicsMaterialAssetId;
        if (matAssetId && assetRegistry) {
          const resolved = assetRegistry.resolveAssetReference(matAssetId);
          if (resolved.status !== 'available') {
            const reason =
              resolved.reason ??
              `PhysicsMaterial asset '${matAssetId}' is ${resolved.status}.`;
            missingAssetDiagnostics.push(
              Object.freeze({
                entityId: entity.entityId,
                entityName: entity.name,
                assetId: matAssetId,
                reason,
              })
            );
            logger?.record(
              'physics',
              'WARN',
              `physics_validation_failed: missing/unavailable physicsMaterialAssetId '${matAssetId}' on entity '${entity.entityId}'`
            );
          }
        }

        const deterministicColliderId = createPhysicsId(
          'collider',
          `${projectId}::${entity.entityId}::${colVal.data.shape.kind}`
        );

        world.addCollider({
          colliderId: deterministicColliderId,
          entityId: entity.entityId,
          bodyId: deterministicBodyId,
          projectId,
          shape: colVal.data.shape,
          localTransform: colVal.data.localTransform,
          isTrigger: colVal.data.isTrigger,
          collisionLayer: colVal.data.collisionLayer,
          collisionMask: colVal.data.collisionMask,
          ...(matAssetId ? { physicsMaterialAssetId: matAssetId } : {}),
          enabled: colVal.data.enabled,
        });
      }
    }
  }

  return Object.freeze({
    sceneId: scene.sceneId,
    projectId,
    readOnlyVerified: true,
    world,
    extractedBodies: world.listBodies(),
    extractedColliders: world.listColliders(),
    missingAssetDiagnostics: Object.freeze(missingAssetDiagnostics),
    validationErrors: Object.freeze(validationErrors),
  });
}
