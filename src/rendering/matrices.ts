import {
  isFiniteNumber,
  isPlainRenderObject,
  RenderValidationResult,
} from './renderTypes';

/**
 * Hylix V1.0.0 — Phase 05: Mathematical Foundation (Vectors, Matrix4, Transform)
 *
 * Implements pure, deterministic 2D/3D vector and 4x4 column-major matrix mathematics
 * with zero external libraries and strict NaN / Infinity rejection.
 */

export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Vector4 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface ColorRGBA {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * 4x4 column-major matrix (16 finite numbers).
 */
export interface Matrix4 {
  readonly elements: readonly number[];
}

export interface RenderTransform {
  readonly position: Vector3;
  readonly rotation: Vector3;
  readonly scale: Vector3;
}

export function createDefaultVector2(): Vector2 {
  return Object.freeze({ x: 0, y: 0 });
}

export function createDefaultVector3(): Vector3 {
  return Object.freeze({ x: 0, y: 0, z: 0 });
}

export function createDefaultScaleVector3(): Vector3 {
  return Object.freeze({ x: 1, y: 1, z: 1 });
}

export function createDefaultVector4(): Vector4 {
  return Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
}

export function createDefaultColorRGBA(): ColorRGBA {
  return Object.freeze({ r: 1, g: 1, b: 1, a: 1 });
}

/**
 * Canonical default RenderTransform:
 * position = (0, 0, 0), rotation = (0, 0, 0), scale = (1, 1, 1)
 */
export function createDefaultRenderTransform(): RenderTransform {
  return Object.freeze({
    position: createDefaultVector3(),
    rotation: createDefaultVector3(),
    scale: createDefaultScaleVector3(),
  });
}

export function validateVector2(
  candidate: unknown,
  fieldName = 'Vector2'
): RenderValidationResult<Vector2> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [`${fieldName} must be a non-null object with finite x, y numbers.`],
    };
  }

  const errors: string[] = [];
  for (const key of Object.keys(candidate)) {
    if (key !== 'x' && key !== 'y') {
      errors.push(`Unexpected property '${key}' in ${fieldName}.`);
    }
  }

  if (!isFiniteNumber(candidate.x)) {
    errors.push(`${fieldName}.x must be a finite number (received ${String(candidate.x)}).`);
  }
  if (!isFiniteNumber(candidate.y)) {
    errors.push(`${fieldName}.y must be a finite number (received ${String(candidate.y)}).`);
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      x: candidate.x as number,
      y: candidate.y as number,
    }),
    errors: [],
  };
}

export function validateVector3(
  candidate: unknown,
  fieldName = 'Vector3'
): RenderValidationResult<Vector3> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [`${fieldName} must be a non-null object with finite x, y, z numbers.`],
    };
  }

  const errors: string[] = [];
  for (const key of Object.keys(candidate)) {
    if (key !== 'x' && key !== 'y' && key !== 'z') {
      errors.push(`Unexpected property '${key}' in ${fieldName}.`);
    }
  }

  if (!isFiniteNumber(candidate.x)) {
    errors.push(`${fieldName}.x must be a finite number (received ${String(candidate.x)}).`);
  }
  if (!isFiniteNumber(candidate.y)) {
    errors.push(`${fieldName}.y must be a finite number (received ${String(candidate.y)}).`);
  }
  if (!isFiniteNumber(candidate.z)) {
    errors.push(`${fieldName}.z must be a finite number (received ${String(candidate.z)}).`);
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      x: candidate.x as number,
      y: candidate.y as number,
      z: candidate.z as number,
    }),
    errors: [],
  };
}

export function validateVector4(
  candidate: unknown,
  fieldName = 'Vector4'
): RenderValidationResult<Vector4> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [`${fieldName} must be a non-null object with finite x, y, z, w numbers.`],
    };
  }

  const errors: string[] = [];
  for (const key of Object.keys(candidate)) {
    if (key !== 'x' && key !== 'y' && key !== 'z' && key !== 'w') {
      errors.push(`Unexpected property '${key}' in ${fieldName}.`);
    }
  }

  if (!isFiniteNumber(candidate.x)) {
    errors.push(`${fieldName}.x must be a finite number.`);
  }
  if (!isFiniteNumber(candidate.y)) {
    errors.push(`${fieldName}.y must be a finite number.`);
  }
  if (!isFiniteNumber(candidate.z)) {
    errors.push(`${fieldName}.z must be a finite number.`);
  }
  if (!isFiniteNumber(candidate.w)) {
    errors.push(`${fieldName}.w must be a finite number.`);
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      x: candidate.x as number,
      y: candidate.y as number,
      z: candidate.z as number,
      w: candidate.w as number,
    }),
    errors: [],
  };
}

export function validateColorRGBA(
  candidate: unknown,
  fieldName = 'ColorRGBA'
): RenderValidationResult<ColorRGBA> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [`${fieldName} must be a non-null object with finite r, g, b, a numbers.`],
    };
  }

  const errors: string[] = [];
  for (const key of Object.keys(candidate)) {
    if (key !== 'r' && key !== 'g' && key !== 'b' && key !== 'a') {
      errors.push(`Unexpected property '${key}' in ${fieldName}.`);
    }
  }

  const channels = ['r', 'g', 'b', 'a'] as const;
  for (const ch of channels) {
    const val = candidate[ch];
    if (!isFiniteNumber(val)) {
      errors.push(`${fieldName}.${ch} must be a finite number.`);
    } else if (val < 0 || val > 1) {
      errors.push(`${fieldName}.${ch} must be normalized in [0, 1] (received ${val}).`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      r: candidate.r as number,
      g: candidate.g as number,
      b: candidate.b as number,
      a: candidate.a as number,
    }),
    errors: [],
  };
}

export function validateRenderTransform(
  candidate: unknown,
  fieldName = 'RenderTransform'
): RenderValidationResult<RenderTransform> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [`${fieldName} must be a non-null object.`],
    };
  }

  const errors: string[] = [];
  for (const key of Object.keys(candidate)) {
    if (key !== 'position' && key !== 'rotation' && key !== 'scale') {
      errors.push(`Unexpected property '${key}' in ${fieldName}.`);
    }
  }

  const posRes = validateVector3(candidate.position, `${fieldName}.position`);
  const rotRes = validateVector3(candidate.rotation, `${fieldName}.rotation`);
  const scaleRes = validateVector3(candidate.scale, `${fieldName}.scale`);

  errors.push(...posRes.errors, ...rotRes.errors, ...scaleRes.errors);

  if (errors.length > 0 || !posRes.value || !rotRes.value || !scaleRes.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      position: posRes.value,
      rotation: rotRes.value,
      scale: scaleRes.value,
    }),
    errors: [],
  };
}

export function createIdentityMatrix4(): Matrix4 {
  return Object.freeze({
    elements: Object.freeze([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
  });
}

export function validateMatrix4(
  candidate: unknown,
  fieldName = 'Matrix4'
): RenderValidationResult<Matrix4> {
  if (!isPlainRenderObject(candidate) || !Array.isArray(candidate.elements)) {
    return {
      valid: false,
      value: null,
      errors: [`${fieldName} must be an object containing a 16-element finite number array.`],
    };
  }

  if (candidate.elements.length !== 16) {
    return {
      valid: false,
      value: null,
      errors: [`${fieldName}.elements must have exactly 16 numbers (found ${candidate.elements.length}).`],
    };
  }

  const errors: string[] = [];
  const normalized: number[] = [];

  for (let i = 0; i < 16; i++) {
    const val = candidate.elements[i];
    if (!isFiniteNumber(val)) {
      errors.push(`${fieldName}.elements[${i}] must be a finite number (found ${String(val)}).`);
    } else {
      normalized.push(val === 0 ? 0 : val);
    }
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      elements: Object.freeze(normalized),
    }),
    errors: [],
  };
}

/**
 * Multiplies two column-major 4x4 matrices: C = A * B.
 */
export function multiplyMatrix4(a: Matrix4, b: Matrix4): Matrix4 {
  const ae = a.elements;
  const be = b.elements;
  const out = new Array<number>(16).fill(0);

  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += ae[k * 4 + row] * be[col * 4 + k];
      }
      out[col * 4 + row] = sum === 0 ? 0 : sum;
    }
  }

  return Object.freeze({
    elements: Object.freeze(out),
  });
}

export function createTranslationMatrix4(position: Vector3): Matrix4 {
  const x = position.x === 0 ? 0 : position.x;
  const y = position.y === 0 ? 0 : position.y;
  const z = position.z === 0 ? 0 : position.z;
  return Object.freeze({
    elements: Object.freeze([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1,
    ]),
  });
}

export function createScaleMatrix4(scale: Vector3): Matrix4 {
  const sx = scale.x === 0 ? 0 : scale.x;
  const sy = scale.y === 0 ? 0 : scale.y;
  const sz = scale.z === 0 ? 0 : scale.z;
  return Object.freeze({
    elements: Object.freeze([
      sx, 0, 0, 0,
      0, sy, 0, 0,
      0, 0, sz, 0,
      0, 0, 0, 1,
    ]),
  });
}

export function createRotationMatrix4(eulerDegrees: Vector3): Matrix4 {
  const degToRad = Math.PI / 180;
  const rx = eulerDegrees.x * degToRad;
  const ry = eulerDegrees.y * degToRad;
  const rz = eulerDegrees.z * degToRad;

  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);

  // Intrinsic Z * Y * X rotation matrix (column-major)
  const m00 = cy * cz;
  const m01 = cy * sz;
  const m02 = -sy;

  const m10 = sx * sy * cz - cx * sz;
  const m11 = sx * sy * sz + cx * cz;
  const m12 = sx * cy;

  const m20 = cx * sy * cz + sx * sz;
  const m21 = cx * sy * sz - sx * cz;
  const m22 = cx * cy;

  const clean = (n: number) => (Math.abs(n) < 1e-12 ? 0 : n);

  return Object.freeze({
    elements: Object.freeze([
      clean(m00), clean(m01), clean(m02), 0,
      clean(m10), clean(m11), clean(m12), 0,
      clean(m20), clean(m21), clean(m22), 0,
      0, 0, 0, 1,
    ]),
  });
}

/**
 * Computes Model Matrix: M = Translation * Rotation * Scale.
 */
export function createModelMatrix4(transform: RenderTransform): Matrix4 {
  const t = createTranslationMatrix4(transform.position);
  const r = createRotationMatrix4(transform.rotation);
  const s = createScaleMatrix4(transform.scale);
  return multiplyMatrix4(multiplyMatrix4(t, r), s);
}

/**
 * Computes View Matrix from camera world position and Euler rotation (degrees).
 */
export function createViewMatrix4(
  cameraPosition: Vector3,
  cameraRotationDegrees: Vector3
): Matrix4 {
  const invRotation = createRotationMatrix4({
    x: -cameraRotationDegrees.x,
    y: -cameraRotationDegrees.y,
    z: -cameraRotationDegrees.z,
  });
  const invTranslation = createTranslationMatrix4({
    x: -cameraPosition.x,
    y: -cameraPosition.y,
    z: -cameraPosition.z,
  });
  return multiplyMatrix4(invRotation, invTranslation);
}

/**
 * Computes right-handed Perspective Projection Matrix4 (column-major).
 */
export function createPerspectiveProjectionMatrix4(
  fovYDegrees: number,
  aspectRatio: number,
  nearPlane: number,
  farPlane: number
): Matrix4 {
  const fovRad = (fovYDegrees * Math.PI) / 180;
  const f = 1.0 / Math.tan(fovRad / 2);
  const nf = 1.0 / (nearPlane - farPlane);

  const clean = (n: number) => (Math.abs(n) < 1e-12 ? 0 : n);

  return Object.freeze({
    elements: Object.freeze([
      clean(f / aspectRatio), 0, 0, 0,
      0, clean(f), 0, 0,
      0, 0, clean((farPlane + nearPlane) * nf), -1,
      0, 0, clean(2 * farPlane * nearPlane * nf), 0,
    ]),
  });
}

/**
 * Computes right-handed Orthographic Projection Matrix4 (column-major).
 */
export function createOrthographicProjectionMatrix4(
  left: number,
  right: number,
  bottom: number,
  top: number,
  nearPlane: number,
  farPlane: number
): Matrix4 {
  const lr = 1.0 / (left - right);
  const bt = 1.0 / (bottom - top);
  const nf = 1.0 / (nearPlane - farPlane);

  const clean = (n: number) => (Math.abs(n) < 1e-12 ? 0 : n);

  return Object.freeze({
    elements: Object.freeze([
      clean(-2 * lr), 0, 0, 0,
      0, clean(-2 * bt), 0, 0,
      0, 0, clean(2 * nf), 0,
      clean((left + right) * lr), clean((top + bottom) * bt), clean((farPlane + nearPlane) * nf), 1,
    ]),
  });
}
