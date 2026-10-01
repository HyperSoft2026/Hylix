import { AABB2D, AABB3D } from './bounds';
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
 * Hylix V1.0.0 — Phase 06: 2D & 3D Collision Shapes & Bounding Volumes (STEP 10, STEP 11, STEP 13)
 *
 * 2D Shapes:
 * - CircleShape2D (`radius > 0`)
 * - BoxShape2D (`halfExtents.x > 0`, `halfExtents.y > 0`)
 * - CapsuleShape2D (`radius > 0`, `halfHeight >= 0`)
 *
 * 3D Shapes:
 * - SphereShape3D (`radius > 0`)
 * - BoxShape3D (`halfExtents.x > 0`, `halfExtents.y > 0`, `halfExtents.z > 0`)
 * - CapsuleShape3D (`radius > 0`, `halfHeight >= 0`)
 *
 * Note: Mesh Collider is intentionally reserved for a future dedicated phase and
 * rejected in Phase 06.
 */

export interface CircleShape2D {
  readonly kind: 'circle2d';
  readonly dimension: '2D';
  readonly radius: number;
}

export interface BoxShape2D {
  readonly kind: 'box2d';
  readonly dimension: '2D';
  readonly halfExtents: Vector2;
}

export interface CapsuleShape2D {
  readonly kind: 'capsule2d';
  readonly dimension: '2D';
  readonly radius: number;
  readonly halfHeight: number;
}

export interface SphereShape3D {
  readonly kind: 'sphere3d';
  readonly dimension: '3D';
  readonly radius: number;
}

export interface BoxShape3D {
  readonly kind: 'box3d';
  readonly dimension: '3D';
  readonly halfExtents: Vector3;
}

export interface CapsuleShape3D {
  readonly kind: 'capsule3d';
  readonly dimension: '3D';
  readonly radius: number;
  readonly halfHeight: number;
}

export type PhysicsShape2D = CircleShape2D | BoxShape2D | CapsuleShape2D;
export type PhysicsShape3D = SphereShape3D | BoxShape3D | CapsuleShape3D;
export type PhysicsShape = PhysicsShape2D | PhysicsShape3D;

export function validateCircleShape2D(
  candidate: unknown
): PhysicsValidationResult<CircleShape2D> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['CircleShape2D must be a non-null object.'],
    };
  }

  if (!isFinitePhysicsNumber(candidate.radius) || candidate.radius <= 0) {
    return {
      valid: false,
      value: null,
      errors: [
        `CircleShape2D.radius must be a finite number > 0 (received ${String(candidate.radius)}).`,
      ],
    };
  }

  return {
    valid: true,
    value: Object.freeze({
      kind: 'circle2d',
      dimension: '2D',
      radius: candidate.radius,
    }),
    errors: [],
  };
}

export function validateBoxShape2D(
  candidate: unknown
): PhysicsValidationResult<BoxShape2D> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['BoxShape2D must be a non-null object.'],
    };
  }

  const extRes = validateVector2(candidate.halfExtents, 'BoxShape2D.halfExtents');
  const errors: string[] = [...extRes.errors];

  if (extRes.value) {
    if (extRes.value.x <= 0) {
      errors.push(
        `BoxShape2D.halfExtents.x must be > 0 (received ${extRes.value.x}).`
      );
    }
    if (extRes.value.y <= 0) {
      errors.push(
        `BoxShape2D.halfExtents.y must be > 0 (received ${extRes.value.y}).`
      );
    }
  }

  if (errors.length > 0 || !extRes.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      kind: 'box2d',
      dimension: '2D',
      halfExtents: extRes.value,
    }),
    errors: [],
  };
}

export function validateCapsuleShape2D(
  candidate: unknown
): PhysicsValidationResult<CapsuleShape2D> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['CapsuleShape2D must be a non-null object.'],
    };
  }

  const errors: string[] = [];
  if (!isFinitePhysicsNumber(candidate.radius) || candidate.radius <= 0) {
    errors.push(
      `CapsuleShape2D.radius must be a finite number > 0 (received ${String(candidate.radius)}).`
    );
  }
  if (!isFinitePhysicsNumber(candidate.halfHeight) || candidate.halfHeight <= 0) {
    errors.push(
      `CapsuleShape2D.halfHeight must be a finite number > 0 (received ${String(candidate.halfHeight)}).`
    );
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      kind: 'capsule2d',
      dimension: '2D',
      radius: candidate.radius as number,
      halfHeight: candidate.halfHeight as number,
    }),
    errors: [],
  };
}

export function validateSphereShape3D(
  candidate: unknown
): PhysicsValidationResult<SphereShape3D> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['SphereShape3D must be a non-null object.'],
    };
  }

  if (!isFinitePhysicsNumber(candidate.radius) || candidate.radius <= 0) {
    return {
      valid: false,
      value: null,
      errors: [
        `SphereShape3D.radius must be a finite number > 0 (received ${String(candidate.radius)}).`,
      ],
    };
  }

  return {
    valid: true,
    value: Object.freeze({
      kind: 'sphere3d',
      dimension: '3D',
      radius: candidate.radius,
    }),
    errors: [],
  };
}

export function validateBoxShape3D(
  candidate: unknown
): PhysicsValidationResult<BoxShape3D> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['BoxShape3D must be a non-null object.'],
    };
  }

  const extRes = validateVector3(candidate.halfExtents, 'BoxShape3D.halfExtents');
  const errors: string[] = [...extRes.errors];

  if (extRes.value) {
    if (extRes.value.x <= 0) {
      errors.push(
        `BoxShape3D.halfExtents.x must be > 0 (received ${extRes.value.x}).`
      );
    }
    if (extRes.value.y <= 0) {
      errors.push(
        `BoxShape3D.halfExtents.y must be > 0 (received ${extRes.value.y}).`
      );
    }
    if (extRes.value.z <= 0) {
      errors.push(
        `BoxShape3D.halfExtents.z must be > 0 (received ${extRes.value.z}).`
      );
    }
  }

  if (errors.length > 0 || !extRes.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      kind: 'box3d',
      dimension: '3D',
      halfExtents: extRes.value,
    }),
    errors: [],
  };
}

export function validateCapsuleShape3D(
  candidate: unknown
): PhysicsValidationResult<CapsuleShape3D> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['CapsuleShape3D must be a non-null object.'],
    };
  }

  const errors: string[] = [];
  if (!isFinitePhysicsNumber(candidate.radius) || candidate.radius <= 0) {
    errors.push(
      `CapsuleShape3D.radius must be a finite number > 0 (received ${String(candidate.radius)}).`
    );
  }
  if (!isFinitePhysicsNumber(candidate.halfHeight) || candidate.halfHeight <= 0) {
    errors.push(
      `CapsuleShape3D.halfHeight must be a finite number > 0 (received ${String(candidate.halfHeight)}).`
    );
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      kind: 'capsule3d',
      dimension: '3D',
      radius: candidate.radius as number,
      halfHeight: candidate.halfHeight as number,
    }),
    errors: [],
  };
}

export function validatePhysicsShape(
  candidate: unknown
): PhysicsValidationResult<PhysicsShape> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['PhysicsShape must be a non-null object.'],
    };
  }

  switch (candidate.kind) {
    case 'circle2d':
      return validateCircleShape2D(candidate);
    case 'box2d':
      return validateBoxShape2D(candidate);
    case 'capsule2d':
      return validateCapsuleShape2D(candidate);
    case 'sphere3d':
      return validateSphereShape3D(candidate);
    case 'box3d':
      return validateBoxShape3D(candidate);
    case 'capsule3d':
      return validateCapsuleShape3D(candidate);
    default:
      return {
        valid: false,
        value: null,
        errors: [
          `Unsupported PhysicsShape kind '${String(candidate.kind)}'. Supported kinds: circle2d, box2d, capsule2d, sphere3d, box3d, capsule3d.`,
        ],
      };
  }
}

/**
 * Computes the 2D Axis-Aligned Bounding Box (AABB2D) for any 2D shape at a given world position (STEP 13).
 */
export function computeShapeAABB2D(
  shape: PhysicsShape2D,
  worldPosition: Vector2
): AABB2D {
  switch (shape.kind) {
    case 'circle2d':
      return Object.freeze({
        min: Object.freeze({
          x: worldPosition.x - shape.radius,
          y: worldPosition.y - shape.radius,
        }),
        max: Object.freeze({
          x: worldPosition.x + shape.radius,
          y: worldPosition.y + shape.radius,
        }),
      });
    case 'box2d':
      return Object.freeze({
        min: Object.freeze({
          x: worldPosition.x - shape.halfExtents.x,
          y: worldPosition.y - shape.halfExtents.y,
        }),
        max: Object.freeze({
          x: worldPosition.x + shape.halfExtents.x,
          y: worldPosition.y + shape.halfExtents.y,
        }),
      });
    case 'capsule2d': {
      const halfY = shape.halfHeight + shape.radius;
      return Object.freeze({
        min: Object.freeze({
          x: worldPosition.x - shape.radius,
          y: worldPosition.y - halfY,
        }),
        max: Object.freeze({
          x: worldPosition.x + shape.radius,
          y: worldPosition.y + halfY,
        }),
      });
    }
  }
}

/**
 * Computes the 3D Axis-Aligned Bounding Box (AABB3D) for any 3D shape at a given world position (STEP 13).
 */
export function computeShapeAABB3D(
  shape: PhysicsShape3D,
  worldPosition: Vector3
): AABB3D {
  switch (shape.kind) {
    case 'sphere3d':
      return Object.freeze({
        min: Object.freeze({
          x: worldPosition.x - shape.radius,
          y: worldPosition.y - shape.radius,
          z: worldPosition.z - shape.radius,
        }),
        max: Object.freeze({
          x: worldPosition.x + shape.radius,
          y: worldPosition.y + shape.radius,
          z: worldPosition.z + shape.radius,
        }),
      });
    case 'box3d':
      return Object.freeze({
        min: Object.freeze({
          x: worldPosition.x - shape.halfExtents.x,
          y: worldPosition.y - shape.halfExtents.y,
          z: worldPosition.z - shape.halfExtents.z,
        }),
        max: Object.freeze({
          x: worldPosition.x + shape.halfExtents.x,
          y: worldPosition.y + shape.halfExtents.y,
          z: worldPosition.z + shape.halfExtents.z,
        }),
      });
    case 'capsule3d': {
      const halfY = shape.halfHeight + shape.radius;
      return Object.freeze({
        min: Object.freeze({
          x: worldPosition.x - shape.radius,
          y: worldPosition.y - halfY,
          z: worldPosition.z - shape.radius,
        }),
        max: Object.freeze({
          x: worldPosition.x + shape.radius,
          y: worldPosition.y + halfY,
          z: worldPosition.z + shape.radius,
        }),
      });
    }
  }
}
