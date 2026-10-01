import {
  isFinitePhysicsNumber,
  isPlainPhysicsObject,
  PhysicsValidationResult,
} from './physicsTypes';

/**
 * Hylix V1.0.0 — Phase 06: 32-Bit Collision Layers & Masks (STEP 14)
 *
 * Uses deterministic 32-bit unsigned integer bitmasks (`0x00000000` .. `0xFFFFFFFF`).
 * Runtime string comparisons for collision layers are strictly prohibited.
 *
 * Two colliders A and B can interact iff:
 *   ((layerA & maskB) !== 0) && ((layerB & maskA) !== 0)
 */

export const MAX_COLLISION_LAYERS = 32;
export const DEFAULT_COLLISION_LAYER_BITMASK = 0x00000001; // Layer 0
export const ALL_COLLISION_LAYERS_MASK = 0xffffffff;

export interface CollisionFilter {
  readonly collisionLayer: number;
  readonly collisionMask: number;
}

export function validateCollisionBitmask(
  candidate: unknown,
  fieldName = 'collisionBitmask'
): PhysicsValidationResult<number> {
  if (
    !isFinitePhysicsNumber(candidate) ||
    !Number.isInteger(candidate) ||
    candidate < 0 ||
    candidate > ALL_COLLISION_LAYERS_MASK
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        `${fieldName} must be an unsigned 32-bit integer in [0, 0xFFFFFFFF] (received ${String(candidate)}).`,
      ],
    };
  }

  return {
    valid: true,
    value: candidate >>> 0,
    errors: [],
  };
}

/**
 * Converts a layer index in `[0, 31]` into its corresponding 32-bit unsigned bitmask `(1 << index) >>> 0`.
 */
export function layerIndexToBitmask(
  layerIndex: unknown
): PhysicsValidationResult<number> {
  if (
    !isFinitePhysicsNumber(layerIndex) ||
    !Number.isInteger(layerIndex) ||
    layerIndex < 0 ||
    layerIndex >= MAX_COLLISION_LAYERS
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        `Collision layer index must be an integer in [0, ${MAX_COLLISION_LAYERS - 1}] (received ${String(layerIndex)}).`,
      ],
    };
  }

  return {
    valid: true,
    value: (1 << layerIndex) >>> 0,
    errors: [],
  };
}

export function validateCollisionFilter(
  candidate: unknown
): PhysicsValidationResult<CollisionFilter> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['CollisionFilter must be a non-null object.'],
    };
  }

  const layerRes = validateCollisionBitmask(
    candidate.collisionLayer,
    'collisionLayer'
  );
  const maskRes = validateCollisionBitmask(
    candidate.collisionMask,
    'collisionMask'
  );

  const errors: string[] = [...layerRes.errors, ...maskRes.errors];
  if (errors.length > 0 || layerRes.value === null || maskRes.value === null) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      collisionLayer: layerRes.value,
      collisionMask: maskRes.value,
    }),
    errors: [],
  };
}

/**
 * Deterministic 32-bit unsigned bitmask check (STEP 14):
 *   ((layerA & maskB) !== 0) && ((layerB & maskA) !== 0)
 */
export function canCollideByLayers(
  layerA: number,
  maskA: number,
  layerB: number,
  maskB: number
): boolean {
  const la = layerA >>> 0;
  const ma = maskA >>> 0;
  const lb = layerB >>> 0;
  const mb = maskB >>> 0;
  return (la & mb) !== 0 && (lb & ma) !== 0;
}
