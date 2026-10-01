import { isValidAssetId } from '../assets/assetRegistry';
import { isValidEntityId } from '../ecs/ecsCore';
import { AABB2D, AABB3D } from './bounds';
import {
  ALL_COLLISION_LAYERS_MASK,
  DEFAULT_COLLISION_LAYER_BITMASK,
  validateCollisionBitmask,
} from './collisionLayers';
import {
  addVector3,
  ColliderId,
  createDefaultVector3,
  createPhysicsId,
  isPlainPhysicsObject,
  isValidColliderId,
  isValidPhysicsBodyId,
  isValidPhysicsMaterialId,
  PhysicsBodyId,
  PhysicsMaterialId,
  PhysicsValidationResult,
  validateVector3,
  Vector3,
} from './physicsTypes';
import {
  computeShapeAABB2D,
  computeShapeAABB3D,
  PhysicsShape,
  PhysicsShape2D,
  PhysicsShape3D,
  validatePhysicsShape,
} from './shapes';

/**
 * Hylix V1.0.0 — Phase 06: Collider Foundation & Bounding Volume Generation (STEP 9, STEP 13, STEP 18)
 *
 * Collider is decoupled from RigidBody:
 *   Entity -> Transform + RigidBody + Collider
 *
 * Properties:
 * - colliderId (`collider_<16-hex>`)
 * - entityId (`ent_<16-hex>`)
 * - bodyId (`body_<16-hex>`)
 * - projectId
 * - shape (`PhysicsShape2D | PhysicsShape3D`)
 * - localTransform (`offset`, `rotation`)
 * - isTrigger (`boolean`)
 * - collisionLayer (32-bit unsigned bitmask)
 * - collisionMask (32-bit unsigned bitmask)
 * - enabled (`boolean`)
 */

export interface ColliderLocalTransform {
  readonly offset: Vector3;
  readonly rotation: Vector3;
}

export interface ColliderDescriptor {
  readonly colliderId: ColliderId;
  readonly entityId: string;
  readonly bodyId: PhysicsBodyId;
  readonly projectId: string;
  readonly shape: PhysicsShape;
  readonly localTransform: ColliderLocalTransform;
  readonly isTrigger: boolean;
  readonly collisionLayer: number;
  readonly collisionMask: number;
  readonly physicsMaterialId?: PhysicsMaterialId;
  readonly physicsMaterialAssetId?: string;
  readonly enabled: boolean;
}

export function createDefaultColliderLocalTransform(): ColliderLocalTransform {
  return Object.freeze({
    offset: createDefaultVector3(),
    rotation: createDefaultVector3(),
  });
}

export function validateColliderLocalTransform(
  candidate: unknown
): PhysicsValidationResult<ColliderLocalTransform> {
  if (candidate === undefined) {
    return {
      valid: true,
      value: createDefaultColliderLocalTransform(),
      errors: [],
    };
  }
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['Collider.localTransform must be a non-null object.'],
    };
  }

  const offsetRes = validateVector3(
    candidate.offset ?? createDefaultVector3(),
    'Collider.localTransform.offset'
  );
  const rotRes = validateVector3(
    candidate.rotation ?? createDefaultVector3(),
    'Collider.localTransform.rotation'
  );

  const errors = [...offsetRes.errors, ...rotRes.errors];
  if (errors.length > 0 || !offsetRes.value || !rotRes.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      offset: offsetRes.value,
      rotation: rotRes.value,
    }),
    errors: [],
  };
}

export function validateCollider(
  candidate: unknown
): PhysicsValidationResult<ColliderDescriptor> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['Collider must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  for (const forbiddenKey of ['filePath', 'path', 'meshPath', 'materialPath', 'url']) {
    if (forbiddenKey in candidate) {
      errors.push(
        `Forbidden raw path property '${forbiddenKey}' in Collider; use AssetIds only.`
      );
    }
  }

  if (!isValidEntityId(candidate.entityId)) {
    errors.push(
      `Invalid Collider.entityId '${String(candidate.entityId)}'; expected 'ent_<16-hex>'.`
    );
  }

  const projectId =
    typeof candidate.projectId === 'string' && candidate.projectId.trim().length > 0
      ? candidate.projectId.trim()
      : 'prj_default';

  const bodyId: PhysicsBodyId =
    candidate.bodyId !== undefined
      ? (candidate.bodyId as PhysicsBodyId)
      : createPhysicsId('body', `${projectId}::${String(candidate.entityId)}`);

  if (!isValidPhysicsBodyId(bodyId)) {
    errors.push(
      `Invalid Collider.bodyId '${String(bodyId)}'; expected 'body_<16-hex>'.`
    );
  }

  const shapeRes = validatePhysicsShape(candidate.shape);
  errors.push(...shapeRes.errors);

  const localTransformRes = validateColliderLocalTransform(
    candidate.localTransform
  );
  errors.push(...localTransformRes.errors);

  const colliderId: ColliderId =
    candidate.colliderId !== undefined
      ? (candidate.colliderId as ColliderId)
      : createPhysicsId(
          'collider',
          `${projectId}::${String(candidate.entityId)}::${String(shapeRes.value?.kind ?? 'shape')}`
        );

  if (!isValidColliderId(colliderId)) {
    errors.push(
      `Invalid Collider.colliderId '${String(colliderId)}'; expected 'collider_<16-hex>'.`
    );
  }

  const layerRes = validateCollisionBitmask(
    candidate.collisionLayer ?? DEFAULT_COLLISION_LAYER_BITMASK,
    'Collider.collisionLayer'
  );
  const maskRes = validateCollisionBitmask(
    candidate.collisionMask ?? ALL_COLLISION_LAYERS_MASK,
    'Collider.collisionMask'
  );
  errors.push(...layerRes.errors, ...maskRes.errors);

  let physicsMaterialId: PhysicsMaterialId | undefined;
  if (candidate.physicsMaterialId !== undefined) {
    if (!isValidPhysicsMaterialId(candidate.physicsMaterialId)) {
      errors.push(
        `Invalid Collider.physicsMaterialId '${String(candidate.physicsMaterialId)}'.`
      );
    } else {
      physicsMaterialId = candidate.physicsMaterialId;
    }
  }

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

  const isTrigger =
    candidate.isTrigger !== undefined ? Boolean(candidate.isTrigger) : false;
  const enabled =
    candidate.enabled !== undefined ? Boolean(candidate.enabled) : true;

  if (
    errors.length > 0 ||
    !shapeRes.value ||
    !localTransformRes.value ||
    layerRes.value === null ||
    maskRes.value === null
  ) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      colliderId,
      entityId: candidate.entityId as string,
      bodyId,
      projectId,
      shape: shapeRes.value,
      localTransform: localTransformRes.value,
      isTrigger,
      collisionLayer: layerRes.value,
      collisionMask: maskRes.value,
      ...(physicsMaterialId ? { physicsMaterialId } : {}),
      ...(physicsMaterialAssetId ? { physicsMaterialAssetId } : {}),
      enabled,
    }),
    errors: [],
  };
}

/**
 * Computes world-space center of a Collider given its parent RigidBody position.
 */
export function computeColliderWorldPosition(
  collider: ColliderDescriptor,
  bodyPosition: Vector3
): Vector3 {
  return addVector3(bodyPosition, collider.localTransform.offset);
}

/**
 * Produces a 2D Bounding Volume (`AABB2D`) for a Collider (STEP 13).
 */
export function computeColliderAABB2D(
  collider: ColliderDescriptor,
  bodyPosition: Vector3
): AABB2D {
  const worldPos = computeColliderWorldPosition(collider, bodyPosition);
  if (collider.shape.dimension === '2D') {
    return computeShapeAABB2D(collider.shape as PhysicsShape2D, {
      x: worldPos.x,
      y: worldPos.y,
    });
  }
  const aabb3 = computeShapeAABB3D(collider.shape as PhysicsShape3D, worldPos);
  return Object.freeze({
    min: Object.freeze({ x: aabb3.min.x, y: aabb3.min.y }),
    max: Object.freeze({ x: aabb3.max.x, y: aabb3.max.y }),
  });
}

/**
 * Produces a 3D Bounding Volume (`AABB3D`) for a Collider (STEP 13).
 */
export function computeColliderAABB3D(
  collider: ColliderDescriptor,
  bodyPosition: Vector3
): AABB3D {
  const worldPos = computeColliderWorldPosition(collider, bodyPosition);
  if (collider.shape.dimension === '3D') {
    return computeShapeAABB3D(collider.shape as PhysicsShape3D, worldPos);
  }
  const aabb2 = computeShapeAABB2D(collider.shape as PhysicsShape2D, {
    x: worldPos.x,
    y: worldPos.y,
  });
  return Object.freeze({
    min: Object.freeze({ x: aabb2.min.x, y: aabb2.min.y, z: worldPos.z - 0.5 }),
    max: Object.freeze({ x: aabb2.max.x, y: aabb2.max.y, z: worldPos.z + 0.5 }),
  });
}
