import { AABB3D } from './bounds';
import {
  ColliderDescriptor,
  computeColliderAABB3D,
  computeColliderWorldPosition,
} from './collider';
import { ALL_COLLISION_LAYERS_MASK, validateCollisionBitmask } from './collisionLayers';
import {
  addVector3,
  ColliderId,
  dotVector3,
  isFinitePhysicsNumber,
  isPlainPhysicsObject,
  lengthVector3,
  normalizeVector3,
  PhysicsBodyId,
  PhysicsValidationResult,
  scaleVector3,
  subVector3,
  validateVector3,
  Vector3,
} from './physicsTypes';
import { CircleShape2D, SphereShape3D } from './shapes';

/**
 * Hylix V1.0.0 — Phase 06: Raycast Contract & Deterministic Hit Ordering (STEP 23)
 *
 * Ray:
 * - origin: Vector3
 * - direction: normalized Vector3 (zero vector `(0,0,0)` is strictly rejected!)
 * - maxDistance: finite number > 0
 * - layerMask?: 32-bit unsigned bitmask
 * - includeTriggers?: boolean
 *
 * RaycastHit:
 * - entityId
 * - bodyId
 * - colliderId
 * - distance
 * - point
 * - normal
 *
 * Deterministic Sorting:
 *   1. `distance` ascending
 *   2. `colliderId` ascending (tie-breaker)
 */

export interface Ray {
  readonly origin: Vector3;
  readonly direction: Vector3;
  readonly maxDistance: number;
  readonly layerMask: number;
  readonly includeTriggers: boolean;
}

export interface RaycastHit {
  readonly entityId: string;
  readonly bodyId: PhysicsBodyId;
  readonly colliderId: ColliderId;
  readonly distance: number;
  readonly point: Vector3;
  readonly normal: Vector3;
}

export function validateRay(candidate: unknown): PhysicsValidationResult<Ray> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['Ray must be a non-null object.'],
    };
  }

  const errors: string[] = [];
  const originRes = validateVector3(candidate.origin, 'Ray.origin');
  const dirRes = validateVector3(candidate.direction, 'Ray.direction');
  errors.push(...originRes.errors, ...dirRes.errors);

  let normalizedDirection: Vector3 | null = null;
  if (dirRes.value) {
    const dirLen = lengthVector3(dirRes.value);
    if (dirLen <= 1e-9) {
      errors.push('Ray.direction cannot be a zero vector (0, 0, 0).');
    } else {
      normalizedDirection = normalizeVector3(dirRes.value);
    }
  }

  if (
    !isFinitePhysicsNumber(candidate.maxDistance) ||
    candidate.maxDistance <= 0
  ) {
    errors.push(
      `Ray.maxDistance must be a finite number > 0 (received ${String(candidate.maxDistance)}).`
    );
  }

  const maskRes = validateCollisionBitmask(
    candidate.layerMask ?? ALL_COLLISION_LAYERS_MASK,
    'Ray.layerMask'
  );
  errors.push(...maskRes.errors);

  const includeTriggers =
    candidate.includeTriggers !== undefined
      ? Boolean(candidate.includeTriggers)
      : true;

  if (
    errors.length > 0 ||
    !originRes.value ||
    !normalizedDirection ||
    maskRes.value === null
  ) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      origin: originRes.value,
      direction: normalizedDirection,
      maxDistance: candidate.maxDistance as number,
      layerMask: maskRes.value,
      includeTriggers,
    }),
    errors: [],
  };
}

function intersectRaySphere(
  ray: Ray,
  sphereCenter: Vector3,
  sphereRadius: number
): { distance: number; point: Vector3; normal: Vector3 } | null {
  const oc = subVector3(ray.origin, sphereCenter);
  const b = dotVector3(oc, ray.direction);
  const c = dotVector3(oc, oc) - sphereRadius * sphereRadius;
  const discriminant = b * b - c;

  if (discriminant < 0) {
    return null;
  }

  const sqrtDisc = Math.sqrt(discriminant);
  let t = -b - sqrtDisc;
  if (t < 0) {
    // Ray origin is inside sphere
    t = 0;
  }

  if (t > ray.maxDistance) {
    return null;
  }

  const point = addVector3(ray.origin, scaleVector3(ray.direction, t));
  const rawNormal = subVector3(point, sphereCenter);
  const normal =
    lengthVector3(rawNormal) > 1e-9
      ? normalizeVector3(rawNormal)
      : scaleVector3(ray.direction, -1);

  return {
    distance: t === 0 ? 0 : t,
    point,
    normal,
  };
}

function intersectRayAABB3D(
  ray: Ray,
  aabb: AABB3D
): { distance: number; point: Vector3; normal: Vector3 } | null {
  let tMin = 0;
  let tMax = ray.maxDistance;
  let hitNormal: Vector3 = Object.freeze({
    x: -ray.direction.x,
    y: -ray.direction.y,
    z: -ray.direction.z,
  });

  const axes: readonly ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];

  for (const axis of axes) {
    const originVal = ray.origin[axis];
    const dirVal = ray.direction[axis];
    const minVal = aabb.min[axis];
    const maxVal = aabb.max[axis];

    if (Math.abs(dirVal) < 1e-12) {
      if (originVal < minVal || originVal > maxVal) {
        return null;
      }
    } else {
      const invD = 1 / dirVal;
      let t1 = (minVal - originVal) * invD;
      let t2 = (maxVal - originVal) * invD;
      let normalSign = -1;

      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        normalSign = 1;
      }

      if (t1 > tMin) {
        tMin = t1;
        hitNormal = Object.freeze({
          x: axis === 'x' ? normalSign : 0,
          y: axis === 'y' ? normalSign : 0,
          z: axis === 'z' ? normalSign : 0,
        });
      }

      if (t2 < tMax) {
        tMax = t2;
      }

      if (tMin > tMax) {
        return null;
      }
    }
  }

  if (tMin < 0 || tMin > ray.maxDistance) {
    return null;
  }

  const point = addVector3(ray.origin, scaleVector3(ray.direction, tMin));
  return {
    distance: tMin === 0 ? 0 : tMin,
    point,
    normal: normalizeVector3(hitNormal),
  };
}

/**
 * Tests a validated `Ray` against a single `ColliderDescriptor`.
 */
export function intersectRayCollider(
  ray: Ray,
  collider: ColliderDescriptor,
  bodyPosition: Vector3
): RaycastHit | null {
  if (!collider.enabled) {
    return null;
  }
  if (!ray.includeTriggers && collider.isTrigger) {
    return null;
  }
  if (((collider.collisionLayer >>> 0) & (ray.layerMask >>> 0)) === 0) {
    return null;
  }

  const worldPos = computeColliderWorldPosition(collider, bodyPosition);
  let hitResult: { distance: number; point: Vector3; normal: Vector3 } | null =
    null;

  if (collider.shape.kind === 'sphere3d') {
    hitResult = intersectRaySphere(
      ray,
      worldPos,
      (collider.shape as SphereShape3D).radius
    );
  } else if (collider.shape.kind === 'circle2d') {
    // 2D Circle tested in XY plane when ray Z is aligned
    const circleCenter = Object.freeze({
      x: worldPos.x,
      y: worldPos.y,
      z: ray.origin.z,
    });
    hitResult = intersectRaySphere(
      ray,
      circleCenter,
      (collider.shape as CircleShape2D).radius
    );
  } else {
    const aabb = computeColliderAABB3D(collider, bodyPosition);
    hitResult = intersectRayAABB3D(ray, aabb);
  }

  if (!hitResult) {
    return null;
  }

  return Object.freeze({
    entityId: collider.entityId,
    bodyId: collider.bodyId,
    colliderId: collider.colliderId,
    distance: hitResult.distance,
    point: hitResult.point,
    normal: hitResult.normal,
  });
}

/**
 * Deterministic comparator for `RaycastHit` arrays (STEP 23):
 *   1. `distance` ascending
 *   2. `colliderId` ascending
 */
export function compareRaycastHitsDeterministically(
  a: RaycastHit,
  b: RaycastHit
): number {
  const distDiff = a.distance - b.distance;
  if (Math.abs(distDiff) > 1e-9) {
    return distDiff < 0 ? -1 : 1;
  }
  if (a.colliderId !== b.colliderId) {
    return a.colliderId < b.colliderId ? -1 : 1;
  }
  return 0;
}

export function sortRaycastHitsDeterministically(
  hits: readonly RaycastHit[]
): readonly RaycastHit[] {
  const copy = [...hits];
  copy.sort(compareRaycastHitsDeterministically);
  return Object.freeze(copy);
}
