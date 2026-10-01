import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import { PhysicsValidationResult } from './physicsTypes';
import { PhysicsWorld } from './physicsWorld';
import {
  intersectRayCollider,
  RaycastHit,
  sortRaycastHitsDeterministically,
  validateRay,
} from './raycast';
import {
  executeAABB2DQuery,
  executeAABB3DQuery,
  executeOverlapBox2DQuery,
  executeOverlapBox3DQuery,
  executeOverlapCircleQuery,
  executeOverlapSphereQuery,
  executePoint2DQuery,
  executePoint3DQuery,
  OverlapQueryMatch,
  SpatialColliderEntry,
  SpatialQueryFilterOptions,
} from './spatialQueries';

/**
 * Hylix V1.0.0 — Phase 06: High-Level PhysicsWorld Queries Facade (STEP 22, STEP 23, STEP 24)
 *
 * Provides deterministic, project-isolated spatial queries and raycasts against a `PhysicsWorld`
 * and records `physics_query_executed` / `physics_validation_failed` diagnostics.
 */

function collectWorldSpatialEntries(
  world: PhysicsWorld
): readonly SpatialColliderEntry[] {
  const entries: SpatialColliderEntry[] = [];
  for (const col of world.listColliders()) {
    const body = world.getBody(col.bodyId);
    if (!body || !body.isEnabled) continue;
    entries.push({
      collider: col,
      bodyPosition: body.position,
    });
  }
  return entries;
}

export function raycastPhysicsWorld(
  world: PhysicsWorld,
  rayCandidate: unknown,
  options?: {
    readonly projectId?: string;
    readonly logger?: RedactedDiagnosticLogger;
  }
): PhysicsValidationResult<readonly RaycastHit[]> {
  const logger = options?.logger;

  if (
    options?.projectId !== undefined &&
    options.projectId !== world.projectId
  ) {
    const msg = `Cross-project raycast rejected: world belongs to '${world.projectId}', query requested '${options.projectId}'.`;
    logger?.record('physics', 'ERROR', `physics_validation_failed: ${msg}`);
    return { valid: false, value: null, errors: [msg] };
  }

  const rayCheck = validateRay(rayCandidate);
  if (!rayCheck.valid || !rayCheck.value) {
    logger?.record(
      'physics',
      'ERROR',
      `physics_validation_failed: ${rayCheck.errors.join('; ')}`
    );
    return { valid: false, value: null, errors: rayCheck.errors };
  }

  const hits: RaycastHit[] = [];
  for (const col of world.listColliders()) {
    const body = world.getBody(col.bodyId);
    if (!body || !body.isEnabled) continue;

    const hit = intersectRayCollider(rayCheck.value, col, body.position);
    if (hit) {
      hits.push(hit);
    }
  }

  const sortedHits = sortRaycastHitsDeterministically(hits);
  logger?.record(
    'physics',
    'INFO',
    `physics_query_executed: query=raycast worldId=${world.worldId} hits=${sortedHits.length}`
  );

  return {
    valid: true,
    value: sortedHits,
    errors: [],
  };
}

export function queryWorldAABB2D(
  world: PhysicsWorld,
  aabbCandidate: unknown,
  options?: SpatialQueryFilterOptions & {
    readonly logger?: RedactedDiagnosticLogger;
  }
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  const res = executeAABB2DQuery(
    world.projectId,
    collectWorldSpatialEntries(world),
    aabbCandidate,
    options
  );
  if (!res.valid) {
    options?.logger?.record(
      'physics',
      'ERROR',
      `physics_validation_failed: ${res.errors.join('; ')}`
    );
  } else {
    options?.logger?.record(
      'physics',
      'INFO',
      `physics_query_executed: query=queryAABB2D worldId=${world.worldId} matches=${res.value?.length ?? 0}`
    );
  }
  return res;
}

export function queryWorldAABB3D(
  world: PhysicsWorld,
  aabbCandidate: unknown,
  options?: SpatialQueryFilterOptions & {
    readonly logger?: RedactedDiagnosticLogger;
  }
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  const res = executeAABB3DQuery(
    world.projectId,
    collectWorldSpatialEntries(world),
    aabbCandidate,
    options
  );
  if (!res.valid) {
    options?.logger?.record(
      'physics',
      'ERROR',
      `physics_validation_failed: ${res.errors.join('; ')}`
    );
  } else {
    options?.logger?.record(
      'physics',
      'INFO',
      `physics_query_executed: query=queryAABB3D worldId=${world.worldId} matches=${res.value?.length ?? 0}`
    );
  }
  return res;
}

export function queryWorldPoint2D(
  world: PhysicsWorld,
  pointCandidate: unknown,
  options?: SpatialQueryFilterOptions & {
    readonly logger?: RedactedDiagnosticLogger;
  }
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  const res = executePoint2DQuery(
    world.projectId,
    collectWorldSpatialEntries(world),
    pointCandidate,
    options
  );
  if (!res.valid) {
    options?.logger?.record(
      'physics',
      'ERROR',
      `physics_validation_failed: ${res.errors.join('; ')}`
    );
  } else {
    options?.logger?.record(
      'physics',
      'INFO',
      `physics_query_executed: query=queryPoint2D worldId=${world.worldId} matches=${res.value?.length ?? 0}`
    );
  }
  return res;
}

export function queryWorldPoint3D(
  world: PhysicsWorld,
  pointCandidate: unknown,
  options?: SpatialQueryFilterOptions & {
    readonly logger?: RedactedDiagnosticLogger;
  }
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  const res = executePoint3DQuery(
    world.projectId,
    collectWorldSpatialEntries(world),
    pointCandidate,
    options
  );
  if (!res.valid) {
    options?.logger?.record(
      'physics',
      'ERROR',
      `physics_validation_failed: ${res.errors.join('; ')}`
    );
  } else {
    options?.logger?.record(
      'physics',
      'INFO',
      `physics_query_executed: query=queryPoint3D worldId=${world.worldId} matches=${res.value?.length ?? 0}`
    );
  }
  return res;
}

export function overlapCircle(
  world: PhysicsWorld,
  center: unknown,
  radius: unknown,
  options?: SpatialQueryFilterOptions & {
    readonly logger?: RedactedDiagnosticLogger;
  }
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  const res = executeOverlapCircleQuery(
    world.projectId,
    collectWorldSpatialEntries(world),
    center,
    radius,
    options
  );
  if (!res.valid) {
    options?.logger?.record(
      'physics',
      'ERROR',
      `physics_validation_failed: ${res.errors.join('; ')}`
    );
  } else {
    options?.logger?.record(
      'physics',
      'INFO',
      `physics_query_executed: query=overlapCircle worldId=${world.worldId} matches=${res.value?.length ?? 0}`
    );
  }
  return res;
}

export function overlapBox(
  world: PhysicsWorld,
  center: unknown,
  halfExtents: unknown,
  options?: SpatialQueryFilterOptions & {
    readonly logger?: RedactedDiagnosticLogger;
  }
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  const is3D =
    typeof center === 'object' &&
    center !== null &&
    'z' in center &&
    typeof halfExtents === 'object' &&
    halfExtents !== null &&
    'z' in halfExtents;

  const res = is3D
    ? executeOverlapBox3DQuery(
        world.projectId,
        collectWorldSpatialEntries(world),
        center,
        halfExtents,
        options
      )
    : executeOverlapBox2DQuery(
        world.projectId,
        collectWorldSpatialEntries(world),
        center,
        halfExtents,
        options
      );

  if (!res.valid) {
    options?.logger?.record(
      'physics',
      'ERROR',
      `physics_validation_failed: ${res.errors.join('; ')}`
    );
  } else {
    options?.logger?.record(
      'physics',
      'INFO',
      `physics_query_executed: query=overlapBox worldId=${world.worldId} matches=${res.value?.length ?? 0}`
    );
  }
  return res;
}

export function overlapSphere(
  world: PhysicsWorld,
  center: unknown,
  radius: unknown,
  options?: SpatialQueryFilterOptions & {
    readonly logger?: RedactedDiagnosticLogger;
  }
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  const res = executeOverlapSphereQuery(
    world.projectId,
    collectWorldSpatialEntries(world),
    center,
    radius,
    options
  );
  if (!res.valid) {
    options?.logger?.record(
      'physics',
      'ERROR',
      `physics_validation_failed: ${res.errors.join('; ')}`
    );
  } else {
    options?.logger?.record(
      'physics',
      'INFO',
      `physics_query_executed: query=overlapSphere worldId=${world.worldId} matches=${res.value?.length ?? 0}`
    );
  }
  return res;
}

export function overlapAABB(
  world: PhysicsWorld,
  aabbCandidate: unknown,
  options?: SpatialQueryFilterOptions & {
    readonly logger?: RedactedDiagnosticLogger;
  }
): PhysicsValidationResult<readonly OverlapQueryMatch[]> {
  const is3D =
    typeof aabbCandidate === 'object' &&
    aabbCandidate !== null &&
    'min' in aabbCandidate &&
    typeof (aabbCandidate as { min: unknown }).min === 'object' &&
    (aabbCandidate as { min: unknown }).min !== null &&
    'z' in ((aabbCandidate as { min: Record<string, unknown> }).min);

  return is3D
    ? queryWorldAABB3D(world, aabbCandidate, options)
    : queryWorldAABB2D(world, aabbCandidate, options);
}
