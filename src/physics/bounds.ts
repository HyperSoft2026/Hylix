import {
  isFinitePhysicsNumber,
  isPlainPhysicsObject,
  PhysicsValidationResult,
  validateVector2,
  validateVector3,
  Vector2,
  Vector3,
} from './physicsTypes';

/**
 * Hylix V1.0.0 — Phase 06: Axis-Aligned Bounding Boxes (AABB2D & AABB3D) (STEP 12)
 *
 * Supports:
 * - min / max validation (strictly rejects min > max, NaN, Infinity)
 * - containsPoint()
 * - intersects()
 * - expand()
 * - union()
 * - getCenter()
 * - getSize()
 */

export interface AABB2D {
  readonly min: Vector2;
  readonly max: Vector2;
}

export interface AABB3D {
  readonly min: Vector3;
  readonly max: Vector3;
}

export function validateAABB2D(
  candidate: unknown,
  fieldName = 'AABB2D'
): PhysicsValidationResult<AABB2D> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [`${fieldName} must be a non-null object with min and max Vector2.`],
    };
  }

  const minRes = validateVector2(candidate.min, `${fieldName}.min`);
  const maxRes = validateVector2(candidate.max, `${fieldName}.max`);
  const errors: string[] = [...minRes.errors, ...maxRes.errors];

  if (minRes.value && maxRes.value) {
    if (minRes.value.x > maxRes.value.x) {
      errors.push(
        `${fieldName} invalid: min.x (${minRes.value.x}) cannot exceed max.x (${maxRes.value.x}).`
      );
    }
    if (minRes.value.y > maxRes.value.y) {
      errors.push(
        `${fieldName} invalid: min.y (${minRes.value.y}) cannot exceed max.y (${maxRes.value.y}).`
      );
    }
  }

  if (errors.length > 0 || !minRes.value || !maxRes.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      min: minRes.value,
      max: maxRes.value,
    }),
    errors: [],
  };
}

export function validateAABB3D(
  candidate: unknown,
  fieldName = 'AABB3D'
): PhysicsValidationResult<AABB3D> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [`${fieldName} must be a non-null object with min and max Vector3.`],
    };
  }

  const minRes = validateVector3(candidate.min, `${fieldName}.min`);
  const maxRes = validateVector3(candidate.max, `${fieldName}.max`);
  const errors: string[] = [...minRes.errors, ...maxRes.errors];

  if (minRes.value && maxRes.value) {
    if (minRes.value.x > maxRes.value.x) {
      errors.push(
        `${fieldName} invalid: min.x (${minRes.value.x}) cannot exceed max.x (${maxRes.value.x}).`
      );
    }
    if (minRes.value.y > maxRes.value.y) {
      errors.push(
        `${fieldName} invalid: min.y (${minRes.value.y}) cannot exceed max.y (${maxRes.value.y}).`
      );
    }
    if (minRes.value.z > maxRes.value.z) {
      errors.push(
        `${fieldName} invalid: min.z (${minRes.value.z}) cannot exceed max.z (${maxRes.value.z}).`
      );
    }
  }

  if (errors.length > 0 || !minRes.value || !maxRes.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      min: minRes.value,
      max: maxRes.value,
    }),
    errors: [],
  };
}

export function createAABB2D(
  min: Vector2,
  max: Vector2
): PhysicsValidationResult<AABB2D> {
  return validateAABB2D({ min, max });
}

export function createAABB3D(
  min: Vector3,
  max: Vector3
): PhysicsValidationResult<AABB3D> {
  return validateAABB3D({ min, max });
}

export function containsPointAABB2D(aabb: AABB2D, point: Vector2): boolean {
  if (!isFinitePhysicsNumber(point.x) || !isFinitePhysicsNumber(point.y)) {
    return false;
  }
  return (
    point.x >= aabb.min.x &&
    point.x <= aabb.max.x &&
    point.y >= aabb.min.y &&
    point.y <= aabb.max.y
  );
}

export function containsPointAABB3D(aabb: AABB3D, point: Vector3): boolean {
  if (
    !isFinitePhysicsNumber(point.x) ||
    !isFinitePhysicsNumber(point.y) ||
    !isFinitePhysicsNumber(point.z)
  ) {
    return false;
  }
  return (
    point.x >= aabb.min.x &&
    point.x <= aabb.max.x &&
    point.y >= aabb.min.y &&
    point.y <= aabb.max.y &&
    point.z >= aabb.min.z &&
    point.z <= aabb.max.z
  );
}

export function intersectsAABB2D(a: AABB2D, b: AABB2D): boolean {
  return (
    a.min.x <= b.max.x &&
    a.max.x >= b.min.x &&
    a.min.y <= b.max.y &&
    a.max.y >= b.min.y
  );
}

export function intersectsAABB3D(a: AABB3D, b: AABB3D): boolean {
  return (
    a.min.x <= b.max.x &&
    a.max.x >= b.min.x &&
    a.min.y <= b.max.y &&
    a.max.y >= b.min.y &&
    a.min.z <= b.max.z &&
    a.max.z >= b.min.z
  );
}

export function expandAABB2D(
  aabb: AABB2D,
  margin: number
): PhysicsValidationResult<AABB2D> {
  if (!isFinitePhysicsNumber(margin)) {
    return {
      valid: false,
      value: null,
      errors: ['AABB2D expand margin must be a finite number.'],
    };
  }
  return validateAABB2D({
    min: { x: aabb.min.x - margin, y: aabb.min.y - margin },
    max: { x: aabb.max.x + margin, y: aabb.max.y + margin },
  });
}

export function expandAABB3D(
  aabb: AABB3D,
  margin: number
): PhysicsValidationResult<AABB3D> {
  if (!isFinitePhysicsNumber(margin)) {
    return {
      valid: false,
      value: null,
      errors: ['AABB3D expand margin must be a finite number.'],
    };
  }
  return validateAABB3D({
    min: {
      x: aabb.min.x - margin,
      y: aabb.min.y - margin,
      z: aabb.min.z - margin,
    },
    max: {
      x: aabb.max.x + margin,
      y: aabb.max.y + margin,
      z: aabb.max.z + margin,
    },
  });
}

export function unionAABB2D(a: AABB2D, b: AABB2D): AABB2D {
  return Object.freeze({
    min: Object.freeze({
      x: Math.min(a.min.x, b.min.x),
      y: Math.min(a.min.y, b.min.y),
    }),
    max: Object.freeze({
      x: Math.max(a.max.x, b.max.x),
      y: Math.max(a.max.y, b.max.y),
    }),
  });
}

export function unionAABB3D(a: AABB3D, b: AABB3D): AABB3D {
  return Object.freeze({
    min: Object.freeze({
      x: Math.min(a.min.x, b.min.x),
      y: Math.min(a.min.y, b.min.y),
      z: Math.min(a.min.z, b.min.z),
    }),
    max: Object.freeze({
      x: Math.max(a.max.x, b.max.x),
      y: Math.max(a.max.y, b.max.y),
      z: Math.max(a.max.z, b.max.z),
    }),
  });
}

export function getCenterAABB2D(aabb: AABB2D): Vector2 {
  return Object.freeze({
    x: (aabb.min.x + aabb.max.x) * 0.5,
    y: (aabb.min.y + aabb.max.y) * 0.5,
  });
}

export function getCenterAABB3D(aabb: AABB3D): Vector3 {
  return Object.freeze({
    x: (aabb.min.x + aabb.max.x) * 0.5,
    y: (aabb.min.y + aabb.max.y) * 0.5,
    z: (aabb.min.z + aabb.max.z) * 0.5,
  });
}

export function getSizeAABB2D(aabb: AABB2D): Vector2 {
  return Object.freeze({
    x: aabb.max.x - aabb.min.x,
    y: aabb.max.y - aabb.min.y,
  });
}

export function getSizeAABB3D(aabb: AABB3D): Vector3 {
  return Object.freeze({
    x: aabb.max.x - aabb.min.x,
    y: aabb.max.y - aabb.min.y,
    z: aabb.max.z - aabb.min.z,
  });
}
