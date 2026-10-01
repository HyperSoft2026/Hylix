import {
  AABB2D,
  AABB3D,
  containsPointAABB2D,
  containsPointAABB3D,
  intersectsAABB2D,
  intersectsAABB3D,
  validateAABB2D,
  validateAABB3D,
} from './bounds';
import {
  ColliderDescriptor,
  computeColliderAABB2D,
  computeColliderAABB3D,
  computeColliderWorldPosition,
} from './collider';
import {
  detectAABBVsAABBManifold3D,
  detectBoxVsBoxManifold2D,
  detectCircleVsBoxManifold2D,
  detectCircleVsCircleManifold2D,
  detectSphereVsAABBManifold3D,
  detectSphereVsSphereManifold3D,
} from './collision';
import { ALL_COLLISION_LAYERS_MASK } from './collisionLayers';
import {
  ColliderId,
  isFinitePhysicsNumber,
  lengthVector2,
  lengthVector3,
  PhysicsBodyId,
  PhysicsValidationResult,
  subVector2,
  subVector3,
  validateVector2,
  validateVector3,
  Vector2,
  Vector3,
} from './physicsTypes';
import { BoxShape2D, BoxShape3D, CircleShape2D, SphereShape3D } from './shapes';

/**
 * Hylix V1.0.0 — Phase 06: Deterministic Spatial & Overlap Queries (STEP 22 & STEP 24)
 *
 * Reference deterministic query implementation supporting:
 * - AABB2D / AABB3D queries
 * - Point2D / Point3D queries
 * - overlapCircle (2D)
 * - overlapBox2D (2D)
 * - overlapSphere (3D)
 * - overlapAABB3D / overlapBox3D (3D)
 *
 * Guarantees:
 * - 100% deterministic ordering (sorted by `colliderId` ascending)
 * - Unique results (zero duplicate `colliderId` entries)
 * - Project-isolated (rejects queries from mismatched `projectId`)
 */

export interface SpatialQueryFilterOptions {
  readonly projectId?: string;
  readonly layerMask?: number;
  readonly includeTriggers?: boolean;
}

export interface OverlapQueryMatch {
  readonly colliderId: ColliderId;
  readonly bodyId: PhysicsBodyId;
  readonly entityId: string;
  readonly projectId: string;
  readonly isTrigger: boolean;
}

export interface SpatialColliderEntry {
  readonly collider: ColliderDescriptor;
  readonly bodyPosition: Vector3;
}

function passesQueryFilter(
  collider: ColliderDescriptor,
  expectedWorldProjectId: string,
  options?: SpatialQueryFilterOptions
): { allowed: boolean; crossProjectViolation: boolean } {
  if (
    options?.projectId !== undefined &&
    options.projectId !== expectedWorldProjectId
  ) {
    return { allowed: false, crossProjectViolation: true };
  }
  if (collider.projectId !== expectedWorldProjectId) {
    return { allowed: false, crossProjectViolation: true };
  }
  if (!collider.enabled) {
    return { allowed: false, crossProjectViolation: false };
  }
  const includeTriggers = options?.includeTriggers ?? true;
  if (!includeTriggers && collider.isTrigger) {
    return { allowed: false, crossProjectViolation: false };
  }
  const mask = (options?.layerMask ?? ALL_COLLISION_LAYERS_MASK) >>> 0;
  if (((collider.collisionLayer >>> 0) & mask) === 0) {
    return { allowed: false, crossProjectViolation: false };
  }
  return { allowed: true, crossProjectViolation: false };
}

function finalizeDeterministicMatches(
  rawMatches: readonly ColliderDescriptor[]
): readonly OverlapQueryMatch[] {
  const uniqueById = new Map<ColliderId, OverlapQueryMatch>();
  for (const col of rawMatches) {
    if (!uniqueById.has(col.colliderId)) {
      uniqueById.set(
        col.colliderId,
        Object.freeze({
          colliderId: col.colliderId,
          bodyId: col.bodyId,
          entityId: col.entityId,
          projectId: col.projectId,
          isTrigger: col.isTrigger,
        })
      );
    }
  }
  const sorted = Array.from(uniqueById.values()).sort((a, b) =>
    a.colliderId < b.colliderId ? -1 : a.colliderId > b.colliderId ? 1 : 0
  );
  return Object.freeze(sorted);
}

/**
 * Queries all colliders whose 2D bounding volume intersects `queryBox`.
 */
export function executeAABB2DQuery(
  worldProjectId: string,
  entries: readonly SpatialColliderEntry[],
  queryBox: unknown,
  options?: SpatialQueryFilterOptions
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  if (
    options?.projectId !== undefined &&
    options.projectId !== worldProjectId
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        `Cross-project spatial query rejected: world belongs to '${worldProjectId}', query requested '${options.projectId}'.`,
      ],
    };
  }

  const boxCheck = validateAABB2D(queryBox, 'queryAABB2D');
  if (!boxCheck.valid || !boxCheck.value) {
    return { valid: false, value: null, errors: boxCheck.errors };
  }

  const matched: ColliderDescriptor[] = [];
  for (const entry of entries) {
    const filter = passesQueryFilter(entry.collider, worldProjectId, options);
    if (!filter.allowed) continue;

    const colAABB = computeColliderAABB2D(entry.collider, entry.bodyPosition);
    if (intersectsAABB2D(boxCheck.value, colAABB)) {
      matched.push(entry.collider);
    }
  }

  return {
    valid: true,
    value: finalizeDeterministicMatches(matched),
    errors: [],
  };
}

/**
 * Queries all colliders whose 3D bounding volume intersects `queryBox`.
 */
export function executeAABB3DQuery(
  worldProjectId: string,
  entries: readonly SpatialColliderEntry[],
  queryBox: unknown,
  options?: SpatialQueryFilterOptions
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  if (
    options?.projectId !== undefined &&
    options.projectId !== worldProjectId
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        `Cross-project spatial query rejected: world belongs to '${worldProjectId}', query requested '${options.projectId}'.`,
      ],
    };
  }

  const boxCheck = validateAABB3D(queryBox, 'queryAABB3D');
  if (!boxCheck.valid || !boxCheck.value) {
    return { valid: false, value: null, errors: boxCheck.errors };
  }

  const matched: ColliderDescriptor[] = [];
  for (const entry of entries) {
    const filter = passesQueryFilter(entry.collider, worldProjectId, options);
    if (!filter.allowed) continue;

    const colAABB = computeColliderAABB3D(entry.collider, entry.bodyPosition);
    if (intersectsAABB3D(boxCheck.value, colAABB)) {
      matched.push(entry.collider);
    }
  }

  return {
    valid: true,
    value: finalizeDeterministicMatches(matched),
    errors: [],
  };
}

/**
 * Point Query 2D: finds all colliders containing `point` in 2D space.
 */
export function executePoint2DQuery(
  worldProjectId: string,
  entries: readonly SpatialColliderEntry[],
  point: unknown,
  options?: SpatialQueryFilterOptions
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  if (
    options?.projectId !== undefined &&
    options.projectId !== worldProjectId
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        `Cross-project spatial query rejected: world belongs to '${worldProjectId}', query requested '${options.projectId}'.`,
      ],
    };
  }

  const ptCheck = validateVector2(point, 'queryPoint2D');
  if (!ptCheck.valid || !ptCheck.value) {
    return { valid: false, value: null, errors: ptCheck.errors };
  }

  const p = ptCheck.value;
  const matched: ColliderDescriptor[] = [];

  for (const entry of entries) {
    const filter = passesQueryFilter(entry.collider, worldProjectId, options);
    if (!filter.allowed) continue;

    const worldPos = computeColliderWorldPosition(
      entry.collider,
      entry.bodyPosition
    );
    const c2d = { x: worldPos.x, y: worldPos.y };

    if (entry.collider.shape.kind === 'circle2d') {
      const r = (entry.collider.shape as CircleShape2D).radius;
      if (lengthVector2(subVector2(p, c2d)) <= r) {
        matched.push(entry.collider);
      }
    } else {
      const aabb = computeColliderAABB2D(entry.collider, entry.bodyPosition);
      if (containsPointAABB2D(aabb, p)) {
        matched.push(entry.collider);
      }
    }
  }

  return {
    valid: true,
    value: finalizeDeterministicMatches(matched),
    errors: [],
  };
}

/**
 * Point Query 3D: finds all colliders containing `point` in 3D space.
 */
export function executePoint3DQuery(
  worldProjectId: string,
  entries: readonly SpatialColliderEntry[],
  point: unknown,
  options?: SpatialQueryFilterOptions
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  if (
    options?.projectId !== undefined &&
    options.projectId !== worldProjectId
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        `Cross-project spatial query rejected: world belongs to '${worldProjectId}', query requested '${options.projectId}'.`,
      ],
    };
  }

  const ptCheck = validateVector3(point, 'queryPoint3D');
  if (!ptCheck.valid || !ptCheck.value) {
    return { valid: false, value: null, errors: ptCheck.errors };
  }

  const p = ptCheck.value;
  const matched: ColliderDescriptor[] = [];

  for (const entry of entries) {
    const filter = passesQueryFilter(entry.collider, worldProjectId, options);
    if (!filter.allowed) continue;

    const worldPos = computeColliderWorldPosition(
      entry.collider,
      entry.bodyPosition
    );

    if (entry.collider.shape.kind === 'sphere3d') {
      const r = (entry.collider.shape as SphereShape3D).radius;
      if (lengthVector3(subVector3(p, worldPos)) <= r) {
        matched.push(entry.collider);
      }
    } else {
      const aabb = computeColliderAABB3D(entry.collider, entry.bodyPosition);
      if (containsPointAABB3D(aabb, p)) {
        matched.push(entry.collider);
      }
    }
  }

  return {
    valid: true,
    value: finalizeDeterministicMatches(matched),
    errors: [],
  };
}

/**
 * Overlap Circle Query (2D) (STEP 24).
 */
export function executeOverlapCircleQuery(
  worldProjectId: string,
  entries: readonly SpatialColliderEntry[],
  center: unknown,
  radius: unknown,
  options?: SpatialQueryFilterOptions
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  if (
    options?.projectId !== undefined &&
    options.projectId !== worldProjectId
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        `Cross-project overlapCircle rejected: world belongs to '${worldProjectId}', query requested '${options.projectId}'.`,
      ],
    };
  }

  const cCheck = validateVector2(center, 'overlapCircle.center');
  const errors: string[] = [...cCheck.errors];
  if (!isFinitePhysicsNumber(radius) || radius <= 0) {
    errors.push(
      `overlapCircle.radius must be a finite number > 0 (received ${String(radius)}).`
    );
  }
  if (errors.length > 0 || !cCheck.value) {
    return { valid: false, value: null, errors };
  }

  const r = radius as number;
  const c = cCheck.value;
  const matched: ColliderDescriptor[] = [];

  for (const entry of entries) {
    const filter = passesQueryFilter(entry.collider, worldProjectId, options);
    if (!filter.allowed) continue;

    const worldPos = computeColliderWorldPosition(
      entry.collider,
      entry.bodyPosition
    );
    const colCenter2D = { x: worldPos.x, y: worldPos.y };

    if (entry.collider.shape.kind === 'circle2d') {
      const hit = detectCircleVsCircleManifold2D(
        c,
        r,
        colCenter2D,
        (entry.collider.shape as CircleShape2D).radius
      );
      if (hit) matched.push(entry.collider);
    } else if (entry.collider.shape.kind === 'box2d') {
      const hit = detectCircleVsBoxManifold2D(
        c,
        r,
        colCenter2D,
        (entry.collider.shape as BoxShape2D).halfExtents
      );
      if (hit) matched.push(entry.collider);
    } else {
      const aabb = computeColliderAABB2D(entry.collider, entry.bodyPosition);
      const hit = detectCircleVsBoxManifold2D(c, r, colCenter2D, {
        x: (aabb.max.x - aabb.min.x) * 0.5,
        y: (aabb.max.y - aabb.min.y) * 0.5,
      });
      if (hit) matched.push(entry.collider);
    }
  }

  return {
    valid: true,
    value: finalizeDeterministicMatches(matched),
    errors: [],
  };
}

/**
 * Overlap Box Query (2D) (STEP 24).
 */
export function executeOverlapBox2DQuery(
  worldProjectId: string,
  entries: readonly SpatialColliderEntry[],
  center: unknown,
  halfExtents: unknown,
  options?: SpatialQueryFilterOptions
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  if (
    options?.projectId !== undefined &&
    options.projectId !== worldProjectId
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        `Cross-project overlapBox2D rejected: world belongs to '${worldProjectId}', query requested '${options.projectId}'.`,
      ],
    };
  }

  const cCheck = validateVector2(center, 'overlapBox2D.center');
  const extCheck = validateVector2(halfExtents, 'overlapBox2D.halfExtents');
  const errors: string[] = [...cCheck.errors, ...extCheck.errors];
  if (extCheck.value && (extCheck.value.x <= 0 || extCheck.value.y <= 0)) {
    errors.push('overlapBox2D.halfExtents components must be > 0.');
  }
  if (errors.length > 0 || !cCheck.value || !extCheck.value) {
    return { valid: false, value: null, errors };
  }

  const queryAABB: AABB2D = {
    min: {
      x: cCheck.value.x - extCheck.value.x,
      y: cCheck.value.y - extCheck.value.y,
    },
    max: {
      x: cCheck.value.x + extCheck.value.x,
      y: cCheck.value.y + extCheck.value.y,
    },
  };

  return executeAABB2DQuery(worldProjectId, entries, queryAABB, options);
}

/**
 * Overlap Sphere Query (3D) (STEP 24).
 */
export function executeOverlapSphereQuery(
  worldProjectId: string,
  entries: readonly SpatialColliderEntry[],
  center: unknown,
  radius: unknown,
  options?: SpatialQueryFilterOptions
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  if (
    options?.projectId !== undefined &&
    options.projectId !== worldProjectId
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        `Cross-project overlapSphere rejected: world belongs to '${worldProjectId}', query requested '${options.projectId}'.`,
      ],
    };
  }

  const cCheck = validateVector3(center, 'overlapSphere.center');
  const errors: string[] = [...cCheck.errors];
  if (!isFinitePhysicsNumber(radius) || radius <= 0) {
    errors.push(
      `overlapSphere.radius must be a finite number > 0 (received ${String(radius)}).`
    );
  }
  if (errors.length > 0 || !cCheck.value) {
    return { valid: false, value: null, errors };
  }

  const r = radius as number;
  const c = cCheck.value;
  const matched: ColliderDescriptor[] = [];

  for (const entry of entries) {
    const filter = passesQueryFilter(entry.collider, worldProjectId, options);
    if (!filter.allowed) continue;

    const worldPos = computeColliderWorldPosition(
      entry.collider,
      entry.bodyPosition
    );

    if (entry.collider.shape.kind === 'sphere3d') {
      const hit = detectSphereVsSphereManifold3D(
        c,
        r,
        worldPos,
        (entry.collider.shape as SphereShape3D).radius
      );
      if (hit) matched.push(entry.collider);
    } else if (entry.collider.shape.kind === 'box3d') {
      const hit = detectSphereVsAABBManifold3D(
        c,
        r,
        worldPos,
        (entry.collider.shape as BoxShape3D).halfExtents
      );
      if (hit) matched.push(entry.collider);
    } else {
      const aabb = computeColliderAABB3D(entry.collider, entry.bodyPosition);
      const hit = detectSphereVsAABBManifold3D(c, r, worldPos, {
        x: (aabb.max.x - aabb.min.x) * 0.5,
        y: (aabb.max.y - aabb.min.y) * 0.5,
        z: (aabb.max.z - aabb.min.z) * 0.5,
      });
      if (hit) matched.push(entry.collider);
    }
  }

  return {
    valid: true,
    value: finalizeDeterministicMatches(matched),
    errors: [],
  };
}

/**
 * Overlap Box / AABB Query (3D) (STEP 24).
 */
export function executeOverlapBox3DQuery(
  worldProjectId: string,
  entries: readonly SpatialColliderEntry[],
  center: unknown,
  halfExtents: unknown,
  options?: SpatialQueryFilterOptions
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  if (
    options?.projectId !== undefined &&
    options.projectId !== worldProjectId
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        `Cross-project overlapBox3D rejected: world belongs to '${worldProjectId}', query requested '${options.projectId}'.`,
      ],
    };
  }

  const cCheck = validateVector3(center, 'overlapBox3D.center');
  const extCheck = validateVector3(halfExtents, 'overlapBox3D.halfExtents');
  const errors: string[] = [...cCheck.errors, ...extCheck.errors];
  if (
    extCheck.value &&
    (extCheck.value.x <= 0 || extCheck.value.y <= 0 || extCheck.value.z <= 0)
  ) {
    errors.push('overlapBox3D.halfExtents components must be > 0.');
  }
  if (errors.length > 0 || !cCheck.value || !extCheck.value) {
    return { valid: false, value: null, errors };
  }

  const matched: ColliderDescriptor[] = [];
  for (const entry of entries) {
    const filter = passesQueryFilter(entry.collider, worldProjectId, options);
    if (!filter.allowed) continue;

    const aabb = computeColliderAABB3D(entry.collider, entry.bodyPosition);
    const colCenter = {
      x: (aabb.min.x + aabb.max.x) * 0.5,
      y: (aabb.min.y + aabb.max.y) * 0.5,
      z: (aabb.min.z + aabb.max.z) * 0.5,
    };
    const colExtents = {
      x: (aabb.max.x - aabb.min.x) * 0.5,
      y: (aabb.max.y - aabb.min.y) * 0.5,
      z: (aabb.max.z - aabb.min.z) * 0.5,
    };
    if (
      detectAABBVsAABBManifold3D(
        cCheck.value,
        extCheck.value,
        colCenter,
        colExtents
      )
    ) {
      matched.push(entry.collider);
    }
  }

  return {
    valid: true,
    value: finalizeDeterministicMatches(matched),
    errors: [],
  };
}
