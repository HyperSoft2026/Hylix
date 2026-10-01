import {
  ColliderDescriptor,
  computeColliderAABB2D,
  computeColliderAABB3D,
  computeColliderWorldPosition,
} from './collider';
import { canCollideByLayers } from './collisionLayers';
import {
  addVector3,
  clampPhysicsNumber,
  ColliderId,
  isFinitePhysicsNumber,
  isPlainPhysicsObject,
  isValidColliderId,
  isValidPhysicsBodyId,
  lengthVector2,
  lengthVector3,
  normalizeVector3,
  PhysicsBodyId,
  PhysicsValidationResult,
  scaleVector3,
  subVector2,
  subVector3,
  validateVector3,
  Vector2,
  Vector3,
} from './physicsTypes';
import { BoxShape2D, BoxShape3D, CircleShape2D, SphereShape3D } from './shapes';

/**
 * Hylix V1.0.0 — Phase 06: Collision Detection, Contact Data & Deterministic Events (STEP 15, 16, 17, 18)
 *
 * Supports:
 * - 2D Collision Detection:
 *   - Circle vs Circle
 *   - Box vs Box (2D AABB)
 *   - Circle vs Box
 *   - Capsule2D bounding/sphere-swept support
 * - 3D Collision Detection:
 *   - Sphere vs Sphere
 *   - AABB vs AABB (Box3D vs Box3D)
 *   - Sphere vs AABB (Sphere3D vs Box3D)
 *   - Capsule3D bounding/sphere-swept support
 * - Immutable ContactPoint (`point`, `normal`, `penetrationDepth`, `bodyA`, `bodyB`, `colliderA`, `colliderB`)
 * - Deterministic Collider Pair Keys (`createDeterministicColliderPairKey`) so (A,B) === (B,A)
 * - Collision & Trigger Events (`collisionEnter`, `collisionStay`, `collisionExit`, `triggerEnter`, `triggerStay`, `triggerExit`)
 */

export interface ContactPoint {
  readonly point: Vector3;
  readonly normal: Vector3;
  readonly penetrationDepth: number;
  readonly bodyA: PhysicsBodyId;
  readonly bodyB: PhysicsBodyId;
  readonly colliderA: ColliderId;
  readonly colliderB: ColliderId;
}

export type PhysicsCollisionEventType =
  | 'collisionEnter'
  | 'collisionStay'
  | 'collisionExit'
  | 'triggerEnter'
  | 'triggerStay'
  | 'triggerExit';

export interface PhysicsCollisionEvent {
  readonly eventType: PhysicsCollisionEventType;
  readonly pairKey: string;
  readonly colliderA: ColliderId;
  readonly colliderB: ColliderId;
  readonly bodyA: PhysicsBodyId;
  readonly bodyB: PhysicsBodyId;
  readonly entityA: string;
  readonly entityB: string;
  readonly isTriggerEvent: boolean;
  readonly contact: ContactPoint | null;
}

/**
 * Produces a 100% deterministic pair key from two Collider IDs (STEP 17).
 * Guarantees `createDeterministicColliderPairKey(A, B) === createDeterministicColliderPairKey(B, A)`.
 */
export function createDeterministicColliderPairKey(
  colliderA: ColliderId,
  colliderB: ColliderId
): string {
  return colliderA <= colliderB
    ? `${colliderA}::${colliderB}`
    : `${colliderB}::${colliderA}`;
}

export function validateContactPoint(
  candidate: unknown
): PhysicsValidationResult<ContactPoint> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['ContactPoint must be a non-null object.'],
    };
  }

  const errors: string[] = [];
  const ptRes = validateVector3(candidate.point, 'ContactPoint.point');
  const normRes = validateVector3(candidate.normal, 'ContactPoint.normal');
  errors.push(...ptRes.errors, ...normRes.errors);

  if (normRes.value) {
    const len = lengthVector3(normRes.value);
    if (len <= 1e-9) {
      errors.push('ContactPoint.normal cannot be a zero vector.');
    }
  }

  if (
    !isFinitePhysicsNumber(candidate.penetrationDepth) ||
    candidate.penetrationDepth < 0
  ) {
    errors.push(
      `ContactPoint.penetrationDepth must be a finite number >= 0 (received ${String(candidate.penetrationDepth)}).`
    );
  }

  if (!isValidPhysicsBodyId(candidate.bodyA)) {
    errors.push(`Invalid ContactPoint.bodyA '${String(candidate.bodyA)}'.`);
  }
  if (!isValidPhysicsBodyId(candidate.bodyB)) {
    errors.push(`Invalid ContactPoint.bodyB '${String(candidate.bodyB)}'.`);
  }
  if (!isValidColliderId(candidate.colliderA)) {
    errors.push(`Invalid ContactPoint.colliderA '${String(candidate.colliderA)}'.`);
  }
  if (!isValidColliderId(candidate.colliderB)) {
    errors.push(`Invalid ContactPoint.colliderB '${String(candidate.colliderB)}'.`);
  }

  if (errors.length > 0 || !ptRes.value || !normRes.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      point: ptRes.value,
      normal: normalizeVector3(normRes.value),
      penetrationDepth:
        (candidate.penetrationDepth as number) === 0
          ? 0
          : (candidate.penetrationDepth as number),
      bodyA: candidate.bodyA as PhysicsBodyId,
      bodyB: candidate.bodyB as PhysicsBodyId,
      colliderA: candidate.colliderA as ColliderId,
      colliderB: candidate.colliderB as ColliderId,
    }),
    errors: [],
  };
}

interface RawManifoldHit {
  readonly point: Vector3;
  readonly normal: Vector3;
  readonly penetrationDepth: number;
}

/**
 * 2D Circle vs Circle collision manifold (normal points from A to B).
 */
export function detectCircleVsCircleManifold2D(
  centerA: Vector2,
  radiusA: number,
  centerB: Vector2,
  radiusB: number,
  zPlane = 0
): RawManifoldHit | null {
  const delta = subVector2(centerB, centerA);
  const dist = lengthVector2(delta);
  const totalRadius = radiusA + radiusB;

  if (dist > totalRadius) {
    return null;
  }

  const normal: Vector3 =
    dist > 1e-9
      ? Object.freeze({ x: delta.x / dist, y: delta.y / dist, z: 0 })
      : Object.freeze({ x: 1, y: 0, z: 0 });

  const penetrationDepth = totalRadius - dist;
  const point: Vector3 = Object.freeze({
    x: centerA.x + normal.x * (radiusA - penetrationDepth * 0.5),
    y: centerA.y + normal.y * (radiusA - penetrationDepth * 0.5),
    z: zPlane,
  });

  return Object.freeze({ point, normal, penetrationDepth });
}

/**
 * 2D Box vs Box (AABB2D vs AABB2D) collision manifold (normal points from A to B).
 */
export function detectBoxVsBoxManifold2D(
  centerA: Vector2,
  halfExtentsA: Vector2,
  centerB: Vector2,
  halfExtentsB: Vector2,
  zPlane = 0
): RawManifoldHit | null {
  const dx = centerB.x - centerA.x;
  const px = halfExtentsA.x + halfExtentsB.x - Math.abs(dx);
  if (px < 0) return null;

  const dy = centerB.y - centerA.y;
  const py = halfExtentsA.y + halfExtentsB.y - Math.abs(dy);
  if (py < 0) return null;

  if (px <= py) {
    const sx = dx < 0 ? -1 : 1;
    const normal: Vector3 = Object.freeze({ x: sx, y: 0, z: 0 });
    const point: Vector3 = Object.freeze({
      x: centerA.x + halfExtentsA.x * sx,
      y: (centerA.y + centerB.y) * 0.5,
      z: zPlane,
    });
    return Object.freeze({ point, normal, penetrationDepth: px });
  } else {
    const sy = dy < 0 ? -1 : 1;
    const normal: Vector3 = Object.freeze({ x: 0, y: sy, z: 0 });
    const point: Vector3 = Object.freeze({
      x: (centerA.x + centerB.x) * 0.5,
      y: centerA.y + halfExtentsA.y * sy,
      z: zPlane,
    });
    return Object.freeze({ point, normal, penetrationDepth: py });
  }
}

/**
 * 2D Circle (A) vs Box (B) collision manifold (normal points from Circle A to Box B).
 */
export function detectCircleVsBoxManifold2D(
  circleCenter: Vector2,
  circleRadius: number,
  boxCenter: Vector2,
  boxHalfExtents: Vector2,
  zPlane = 0
): RawManifoldHit | null {
  const relX = circleCenter.x - boxCenter.x;
  const relY = circleCenter.y - boxCenter.y;

  const closestX = clampPhysicsNumber(relX, -boxHalfExtents.x, boxHalfExtents.x);
  const closestY = clampPhysicsNumber(relY, -boxHalfExtents.y, boxHalfExtents.y);

  const inside = relX === closestX && relY === closestY;

  if (!inside) {
    // Circle center is outside Box: vector from Circle to closest point on Box
    const toBoxX = boxCenter.x + closestX - circleCenter.x;
    const toBoxY = boxCenter.y + closestY - circleCenter.y;
    const distSq = toBoxX * toBoxX + toBoxY * toBoxY;
    if (distSq > circleRadius * circleRadius) {
      return null;
    }
    const dist = Math.sqrt(distSq);
    const normal: Vector3 =
      dist > 1e-9
        ? Object.freeze({ x: toBoxX / dist, y: toBoxY / dist, z: 0 })
        : Object.freeze({ x: 1, y: 0, z: 0 });
    const penetrationDepth = circleRadius - dist;
    const point: Vector3 = Object.freeze({
      x: boxCenter.x + closestX,
      y: boxCenter.y + closestY,
      z: zPlane,
    });
    return Object.freeze({ point, normal, penetrationDepth });
  }

  // Circle center is inside Box
  const dx = boxHalfExtents.x - Math.abs(relX);
  const dy = boxHalfExtents.y - Math.abs(relY);
  if (dx <= dy) {
    const sx = relX < 0 ? 1 : -1;
    const normal: Vector3 = Object.freeze({ x: sx, y: 0, z: 0 });
    return Object.freeze({
      point: Object.freeze({ x: circleCenter.x, y: circleCenter.y, z: zPlane }),
      normal,
      penetrationDepth: circleRadius + dx,
    });
  } else {
    const sy = relY < 0 ? 1 : -1;
    const normal: Vector3 = Object.freeze({ x: 0, y: sy, z: 0 });
    return Object.freeze({
      point: Object.freeze({ x: circleCenter.x, y: circleCenter.y, z: zPlane }),
      normal,
      penetrationDepth: circleRadius + dy,
    });
  }
}

/**
 * 3D Sphere vs Sphere collision manifold (normal points from A to B).
 */
export function detectSphereVsSphereManifold3D(
  centerA: Vector3,
  radiusA: number,
  centerB: Vector3,
  radiusB: number
): RawManifoldHit | null {
  const delta = subVector3(centerB, centerA);
  const dist = lengthVector3(delta);
  const totalRadius = radiusA + radiusB;

  if (dist > totalRadius) {
    return null;
  }

  const normal: Vector3 =
    dist > 1e-9
      ? scaleVector3(delta, 1 / dist)
      : Object.freeze({ x: 1, y: 0, z: 0 });

  const penetrationDepth = totalRadius - dist;
  const point = addVector3(
    centerA,
    scaleVector3(normal, radiusA - penetrationDepth * 0.5)
  );

  return Object.freeze({ point, normal, penetrationDepth });
}

/**
 * 3D AABB vs AABB (Box3D vs Box3D) collision manifold (normal points from A to B).
 */
export function detectAABBVsAABBManifold3D(
  centerA: Vector3,
  halfExtentsA: Vector3,
  centerB: Vector3,
  halfExtentsB: Vector3
): RawManifoldHit | null {
  const dx = centerB.x - centerA.x;
  const px = halfExtentsA.x + halfExtentsB.x - Math.abs(dx);
  if (px < 0) return null;

  const dy = centerB.y - centerA.y;
  const py = halfExtentsA.y + halfExtentsB.y - Math.abs(dy);
  if (py < 0) return null;

  const dz = centerB.z - centerA.z;
  const pz = halfExtentsA.z + halfExtentsB.z - Math.abs(dz);
  if (pz < 0) return null;

  if (px <= py && px <= pz) {
    const sx = dx < 0 ? -1 : 1;
    return Object.freeze({
      point: Object.freeze({
        x: centerA.x + halfExtentsA.x * sx,
        y: (centerA.y + centerB.y) * 0.5,
        z: (centerA.z + centerB.z) * 0.5,
      }),
      normal: Object.freeze({ x: sx, y: 0, z: 0 }),
      penetrationDepth: px,
    });
  } else if (py <= px && py <= pz) {
    const sy = dy < 0 ? -1 : 1;
    return Object.freeze({
      point: Object.freeze({
        x: (centerA.x + centerB.x) * 0.5,
        y: centerA.y + halfExtentsA.y * sy,
        z: (centerA.z + centerB.z) * 0.5,
      }),
      normal: Object.freeze({ x: 0, y: sy, z: 0 }),
      penetrationDepth: py,
    });
  } else {
    const sz = dz < 0 ? -1 : 1;
    return Object.freeze({
      point: Object.freeze({
        x: (centerA.x + centerB.x) * 0.5,
        y: (centerA.y + centerB.y) * 0.5,
        z: centerA.z + halfExtentsA.z * sz,
      }),
      normal: Object.freeze({ x: 0, y: 0, z: sz }),
      penetrationDepth: pz,
    });
  }
}

/**
 * 3D Sphere (A) vs AABB/Box3D (B) collision manifold (normal points from Sphere A to Box B).
 */
export function detectSphereVsAABBManifold3D(
  sphereCenter: Vector3,
  sphereRadius: number,
  boxCenter: Vector3,
  boxHalfExtents: Vector3
): RawManifoldHit | null {
  const relX = sphereCenter.x - boxCenter.x;
  const relY = sphereCenter.y - boxCenter.y;
  const relZ = sphereCenter.z - boxCenter.z;

  const closestX = clampPhysicsNumber(relX, -boxHalfExtents.x, boxHalfExtents.x);
  const closestY = clampPhysicsNumber(relY, -boxHalfExtents.y, boxHalfExtents.y);
  const closestZ = clampPhysicsNumber(relZ, -boxHalfExtents.z, boxHalfExtents.z);

  const inside = relX === closestX && relY === closestY && relZ === closestZ;

  if (!inside) {
    const toBox = Object.freeze({
      x: boxCenter.x + closestX - sphereCenter.x,
      y: boxCenter.y + closestY - sphereCenter.y,
      z: boxCenter.z + closestZ - sphereCenter.z,
    });
    const dist = lengthVector3(toBox);
    if (dist > sphereRadius) {
      return null;
    }
    const normal =
      dist > 1e-9
        ? scaleVector3(toBox, 1 / dist)
        : Object.freeze({ x: 1, y: 0, z: 0 });
    return Object.freeze({
      point: Object.freeze({
        x: boxCenter.x + closestX,
        y: boxCenter.y + closestY,
        z: boxCenter.z + closestZ,
      }),
      normal,
      penetrationDepth: sphereRadius - dist,
    });
  }

  const dx = boxHalfExtents.x - Math.abs(relX);
  const dy = boxHalfExtents.y - Math.abs(relY);
  const dz = boxHalfExtents.z - Math.abs(relZ);

  if (dx <= dy && dx <= dz) {
    const sx = relX < 0 ? 1 : -1;
    return Object.freeze({
      point: sphereCenter,
      normal: Object.freeze({ x: sx, y: 0, z: 0 }),
      penetrationDepth: sphereRadius + dx,
    });
  } else if (dy <= dx && dy <= dz) {
    const sy = relY < 0 ? 1 : -1;
    return Object.freeze({
      point: sphereCenter,
      normal: Object.freeze({ x: 0, y: sy, z: 0 }),
      penetrationDepth: sphereRadius + dy,
    });
  } else {
    const sz = relZ < 0 ? 1 : -1;
    return Object.freeze({
      point: sphereCenter,
      normal: Object.freeze({ x: 0, y: 0, z: sz }),
      penetrationDepth: sphereRadius + dz,
    });
  }
}

/**
 * Deterministic Collider Pair Collision Detection (STEP 15 & STEP 16).
 *
 * Canonicalizes collider order (`colliderA.colliderId <= colliderB.colliderId`),
 * enforces `enabled` and `canCollideByLayers`, and returns an immutable `ContactPoint | null`.
 */
export function detectColliderPairCollision(
  firstCollider: ColliderDescriptor,
  firstBodyPosition: Vector3,
  secondCollider: ColliderDescriptor,
  secondBodyPosition: Vector3
): ContactPoint | null {
  if (!firstCollider.enabled || !secondCollider.enabled) {
    return null;
  }

  if (firstCollider.colliderId === secondCollider.colliderId) {
    return null;
  }

  if (
    !canCollideByLayers(
      firstCollider.collisionLayer,
      firstCollider.collisionMask,
      secondCollider.collisionLayer,
      secondCollider.collisionMask
    )
  ) {
    return null;
  }

  // Canonicalize A and B by deterministic colliderId ordering
  const isFirstCanonical = firstCollider.colliderId <= secondCollider.colliderId;
  const colA = isFirstCanonical ? firstCollider : secondCollider;
  const posA = isFirstCanonical ? firstBodyPosition : secondBodyPosition;
  const colB = isFirstCanonical ? secondCollider : firstCollider;
  const posB = isFirstCanonical ? secondBodyPosition : firstBodyPosition;

  const worldPosA = computeColliderWorldPosition(colA, posA);
  const worldPosB = computeColliderWorldPosition(colB, posB);

  let manifold: RawManifoldHit | null = null;

  // 2D vs 2D Shapes
  if (colA.shape.dimension === '2D' && colB.shape.dimension === '2D') {
    const cA = { x: worldPosA.x, y: worldPosA.y };
    const cB = { x: worldPosB.x, y: worldPosB.y };
    const zAvg = (worldPosA.z + worldPosB.z) * 0.5;

    if (colA.shape.kind === 'circle2d' && colB.shape.kind === 'circle2d') {
      manifold = detectCircleVsCircleManifold2D(
        cA,
        (colA.shape as CircleShape2D).radius,
        cB,
        (colB.shape as CircleShape2D).radius,
        zAvg
      );
    } else if (colA.shape.kind === 'box2d' && colB.shape.kind === 'box2d') {
      manifold = detectBoxVsBoxManifold2D(
        cA,
        (colA.shape as BoxShape2D).halfExtents,
        cB,
        (colB.shape as BoxShape2D).halfExtents,
        zAvg
      );
    } else if (colA.shape.kind === 'circle2d' && colB.shape.kind === 'box2d') {
      manifold = detectCircleVsBoxManifold2D(
        cA,
        (colA.shape as CircleShape2D).radius,
        cB,
        (colB.shape as BoxShape2D).halfExtents,
        zAvg
      );
    } else if (colA.shape.kind === 'box2d' && colB.shape.kind === 'circle2d') {
      const reversed = detectCircleVsBoxManifold2D(
        cB,
        (colB.shape as CircleShape2D).radius,
        cA,
        (colA.shape as BoxShape2D).halfExtents,
        zAvg
      );
      if (reversed) {
        manifold = {
          point: reversed.point,
          normal: scaleVector3(reversed.normal, -1),
          penetrationDepth: reversed.penetrationDepth,
        };
      }
    } else {
      // Capsule2D fallback via bounding box / capsule extents
      const aabbA = computeColliderAABB2D(colA, posA);
      const aabbB = computeColliderAABB2D(colB, posB);
      manifold = detectBoxVsBoxManifold2D(
        cA,
        {
          x: (aabbA.max.x - aabbA.min.x) * 0.5,
          y: (aabbA.max.y - aabbA.min.y) * 0.5,
        },
        cB,
        {
          x: (aabbB.max.x - aabbB.min.x) * 0.5,
          y: (aabbB.max.y - aabbB.min.y) * 0.5,
        },
        zAvg
      );
    }
  } else {
    // 3D vs 3D Shapes (or mixed 2D/3D promoted to 3D)
    if (colA.shape.kind === 'sphere3d' && colB.shape.kind === 'sphere3d') {
      manifold = detectSphereVsSphereManifold3D(
        worldPosA,
        (colA.shape as SphereShape3D).radius,
        worldPosB,
        (colB.shape as SphereShape3D).radius
      );
    } else if (colA.shape.kind === 'box3d' && colB.shape.kind === 'box3d') {
      manifold = detectAABBVsAABBManifold3D(
        worldPosA,
        (colA.shape as BoxShape3D).halfExtents,
        worldPosB,
        (colB.shape as BoxShape3D).halfExtents
      );
    } else if (colA.shape.kind === 'sphere3d' && colB.shape.kind === 'box3d') {
      manifold = detectSphereVsAABBManifold3D(
        worldPosA,
        (colA.shape as SphereShape3D).radius,
        worldPosB,
        (colB.shape as BoxShape3D).halfExtents
      );
    } else if (colA.shape.kind === 'box3d' && colB.shape.kind === 'sphere3d') {
      const reversed = detectSphereVsAABBManifold3D(
        worldPosB,
        (colB.shape as SphereShape3D).radius,
        worldPosA,
        (colA.shape as BoxShape3D).halfExtents
      );
      if (reversed) {
        manifold = {
          point: reversed.point,
          normal: scaleVector3(reversed.normal, -1),
          penetrationDepth: reversed.penetrationDepth,
        };
      }
    } else {
      const aabbA = computeColliderAABB3D(colA, posA);
      const aabbB = computeColliderAABB3D(colB, posB);
      manifold = detectAABBVsAABBManifold3D(
        worldPosA,
        {
          x: (aabbA.max.x - aabbA.min.x) * 0.5,
          y: (aabbA.max.y - aabbA.min.y) * 0.5,
          z: (aabbA.max.z - aabbA.min.z) * 0.5,
        },
        worldPosB,
        {
          x: (aabbB.max.x - aabbB.min.x) * 0.5,
          y: (aabbB.max.y - aabbB.min.y) * 0.5,
          z: (aabbB.max.z - aabbB.min.z) * 0.5,
        }
      );
    }
  }

  if (!manifold) {
    return null;
  }

  return Object.freeze({
    point: manifold.point,
    normal: normalizeVector3(manifold.normal),
    penetrationDepth:
      manifold.penetrationDepth === 0 ? 0 : manifold.penetrationDepth,
    bodyA: colA.bodyId,
    bodyB: colB.bodyId,
    colliderA: colA.colliderId,
    colliderB: colB.colliderId,
  });
}
