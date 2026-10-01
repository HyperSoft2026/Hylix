import { computeDeterministicChecksum } from '../storage/atomicStorage';
import {
  createDefaultVector2,
  createDefaultVector3,
  validateVector2,
  validateVector3,
  Vector2,
  Vector3,
} from '../rendering/matrices';

/**
 * Hylix V1.0.0 — Phase 06: Physics Foundation Common Types, Deterministic IDs & Vector Math
 *
 * Platform-independent, Local-First 2D/3D Physics Foundation built from scratch
 * by HyperSoft with zero external physics engine dependencies (no Box2D, Bullet,
 * PhysX, Havok, Rapier, Matter.js, Cannon.js, or Ammo.js).
 */

export {
  createDefaultVector2,
  createDefaultVector3,
  validateVector2,
  validateVector3,
};
export type { Vector2, Vector3 };

export type PhysicsIdPrefix = 'physics' | 'body' | 'collider' | 'pmat';

export type PhysicsWorldId = `physics_${string}`;
export type PhysicsBodyId = `body_${string}`;
export type ColliderId = `collider_${string}`;
export type PhysicsMaterialId = `pmat_${string}`;

export type PhysicsSimulationState =
  | 'uninitialized'
  | 'ready'
  | 'simulating'
  | 'paused'
  | 'shutdown';

export interface PhysicsValidationResult<T> {
  readonly valid: boolean;
  readonly value: T | null;
  readonly errors: readonly string[];
}

const VALID_PHYSICS_ID_REGEX: Record<PhysicsIdPrefix, RegExp> = {
  physics: /^physics_[a-f0-9]{16}$/,
  body: /^body_[a-f0-9]{16}$/,
  collider: /^collider_[a-f0-9]{16}$/,
  pmat: /^pmat_[a-f0-9]{16}$/,
};

/**
 * Generates a 100% deterministic Physics ID (`<prefix>_<16-hex>`) from a canonical seed string.
 * Never uses `Math.random()`, `Date.now()`, or array index identity.
 * Remains invariant across save, load, scene reorder, and entity reorder.
 */
export function createPhysicsId<P extends PhysicsIdPrefix>(
  prefix: P,
  seedInput: string
): `${P}_${string}` {
  const normalizedSeed =
    typeof seedInput === 'string' && seedInput.trim().length > 0
      ? seedInput.trim()
      : 'default_seed';
  const hex16 = computeDeterministicChecksum(
    `hylix_physics_v1::${prefix}::${normalizedSeed}`
  );
  return `${prefix}_${hex16}` as `${P}_${string}`;
}

export function isValidPhysicsId<P extends PhysicsIdPrefix>(
  prefix: P,
  candidate: unknown
): candidate is `${P}_${string}` {
  if (typeof candidate !== 'string') return false;
  const regex = VALID_PHYSICS_ID_REGEX[prefix];
  return regex ? regex.test(candidate) : false;
}

export function isValidPhysicsWorldId(
  candidate: unknown
): candidate is PhysicsWorldId {
  return isValidPhysicsId('physics', candidate);
}

export function isValidPhysicsBodyId(
  candidate: unknown
): candidate is PhysicsBodyId {
  return isValidPhysicsId('body', candidate);
}

export function isValidColliderId(candidate: unknown): candidate is ColliderId {
  return isValidPhysicsId('collider', candidate);
}

export function isValidPhysicsMaterialId(
  candidate: unknown
): candidate is PhysicsMaterialId {
  return isValidPhysicsId('pmat', candidate);
}

export function isFinitePhysicsNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

export function isPlainPhysicsObject(
  val: unknown
): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

const ALLOWED_SIMULATION_TRANSITIONS: Readonly<
  Record<PhysicsSimulationState, readonly PhysicsSimulationState[]>
> = Object.freeze({
  uninitialized: Object.freeze(['ready', 'shutdown'] as const),
  ready: Object.freeze(['simulating', 'paused', 'shutdown'] as const),
  simulating: Object.freeze(['ready', 'paused'] as const),
  paused: Object.freeze(['ready', 'simulating', 'shutdown'] as const),
  shutdown: Object.freeze([] as const),
});

/**
 * Enforces legal PhysicsWorld simulation state transitions (STEP 4).
 * Explicitly forbids transitions out of `shutdown` (e.g., `shutdown -> simulating`).
 */
export function isValidPhysicsStateTransition(
  from: PhysicsSimulationState,
  to: PhysicsSimulationState
): boolean {
  const allowed = ALLOWED_SIMULATION_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * Security filter (STEP 30 & STEP 31):
 * Blocks raw filesystem paths (`/sdcard`, `/system`, `/data`, `/proc`),
 * parent directory traversal (`..`), remote URLs (`http://`, `https://`),
 * and dynamic code execution patterns (`eval`, `Function`, `child_process`).
 */
const FORBIDDEN_PHYSICS_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly reason: string;
}[] = Object.freeze([
  {
    pattern: /^(https?|ftp|file|ws|wss):\/\//i,
    reason: 'Remote or external URL schemes are forbidden in Local-First Physics.',
  },
  {
    pattern: /(^|\/)(sdcard|system|data|proc|etc|dev|var|usr)(\/|$)/i,
    reason: 'Direct OS / Android system or /sdcard paths are forbidden in Physics.',
  },
  {
    pattern: /\.\.(\/|\\)/,
    reason: 'Parent directory path traversal (../) is forbidden in Physics.',
  },
  {
    pattern: /^[a-zA-Z]:\\/,
    reason: 'Absolute host filesystem paths are forbidden in Physics.',
  },
  {
    pattern: /\b(eval\s*\(|new\s+Function\s*\(|Function\s*\(|child_process|execSync|spawnSync)/,
    reason: 'Dynamic code execution and process spawning are forbidden in Physics.',
  },
]);

export function isForbiddenPhysicsInputString(value: string): {
  readonly forbidden: boolean;
  readonly reason: string | null;
} {
  for (const rule of FORBIDDEN_PHYSICS_PATTERNS) {
    if (rule.pattern.test(value)) {
      return { forbidden: true, reason: rule.reason };
    }
  }
  return { forbidden: false, reason: null };
}

/**
 * Pure deterministic Vector2 / Vector3 arithmetic helpers (STEP 6).
 * Reuses `Vector2` and `Vector3` contracts from `src/rendering/matrices.ts`.
 */
export function addVector2(a: Vector2, b: Vector2): Vector2 {
  const x = a.x + b.x;
  const y = a.y + b.y;
  return Object.freeze({
    x: x === 0 ? 0 : x,
    y: y === 0 ? 0 : y,
  });
}

export function subVector2(a: Vector2, b: Vector2): Vector2 {
  const x = a.x - b.x;
  const y = a.y - b.y;
  return Object.freeze({
    x: x === 0 ? 0 : x,
    y: y === 0 ? 0 : y,
  });
}

export function scaleVector2(v: Vector2, scalar: number): Vector2 {
  const x = v.x * scalar;
  const y = v.y * scalar;
  return Object.freeze({
    x: x === 0 ? 0 : x,
    y: y === 0 ? 0 : y,
  });
}

export function dotVector2(a: Vector2, b: Vector2): number {
  const d = a.x * b.x + a.y * b.y;
  return d === 0 ? 0 : d;
}

export function lengthSquaredVector2(v: Vector2): number {
  return dotVector2(v, v);
}

export function lengthVector2(v: Vector2): number {
  return Math.sqrt(lengthSquaredVector2(v));
}

export function normalizeVector2(v: Vector2): Vector2 {
  const len = lengthVector2(v);
  if (len <= 1e-12) {
    return Object.freeze({ x: 0, y: 0 });
  }
  return scaleVector2(v, 1 / len);
}

export function addVector3(a: Vector3, b: Vector3): Vector3 {
  const x = a.x + b.x;
  const y = a.y + b.y;
  const z = a.z + b.z;
  return Object.freeze({
    x: x === 0 ? 0 : x,
    y: y === 0 ? 0 : y,
    z: z === 0 ? 0 : z,
  });
}

export function subVector3(a: Vector3, b: Vector3): Vector3 {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return Object.freeze({
    x: x === 0 ? 0 : x,
    y: y === 0 ? 0 : y,
    z: z === 0 ? 0 : z,
  });
}

export function scaleVector3(v: Vector3, scalar: number): Vector3 {
  const x = v.x * scalar;
  const y = v.y * scalar;
  const z = v.z * scalar;
  return Object.freeze({
    x: x === 0 ? 0 : x,
    y: y === 0 ? 0 : y,
    z: z === 0 ? 0 : z,
  });
}

export function dotVector3(a: Vector3, b: Vector3): number {
  const d = a.x * b.x + a.y * b.y + a.z * b.z;
  return d === 0 ? 0 : d;
}

export function crossVector3(a: Vector3, b: Vector3): Vector3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  return Object.freeze({
    x: x === 0 ? 0 : x,
    y: y === 0 ? 0 : y,
    z: z === 0 ? 0 : z,
  });
}

export function lengthSquaredVector3(v: Vector3): number {
  return dotVector3(v, v);
}

export function lengthVector3(v: Vector3): number {
  return Math.sqrt(lengthSquaredVector3(v));
}

export function normalizeVector3(v: Vector3): Vector3 {
  const len = lengthVector3(v);
  if (len <= 1e-12) {
    return Object.freeze({ x: 0, y: 0, z: 0 });
  }
  return scaleVector3(v, 1 / len);
}

export function clampPhysicsNumber(
  val: number,
  minVal: number,
  maxVal: number
): number {
  if (val < minVal) return minVal;
  if (val > maxVal) return maxVal;
  return val === 0 ? 0 : val;
}

export interface PhysicsMotionQuantityState {
  readonly velocity: Vector3;
  readonly angularVelocity: Vector3;
  readonly force: Vector3;
  readonly torque: Vector3;
  readonly acceleration: Vector3;
}

/**
 * Validates physical motion quantities (velocity, angularVelocity, force, torque, acceleration)
 * rejecting NaN, +Infinity, and -Infinity (STEP 6).
 */
export function validatePhysicsMotionQuantities(
  candidate: unknown
): PhysicsValidationResult<PhysicsMotionQuantityState> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['Physics motion state must be a non-null object.'],
    };
  }

  const velRes = validateVector3(
    candidate.velocity ?? createDefaultVector3(),
    'velocity'
  );
  const angVelRes = validateVector3(
    candidate.angularVelocity ?? createDefaultVector3(),
    'angularVelocity'
  );
  const forceRes = validateVector3(
    candidate.force ?? createDefaultVector3(),
    'force'
  );
  const torqueRes = validateVector3(
    candidate.torque ?? createDefaultVector3(),
    'torque'
  );
  const accelRes = validateVector3(
    candidate.acceleration ?? createDefaultVector3(),
    'acceleration'
  );

  const errors = [
    ...velRes.errors,
    ...angVelRes.errors,
    ...forceRes.errors,
    ...torqueRes.errors,
    ...accelRes.errors,
  ];

  if (
    errors.length > 0 ||
    !velRes.value ||
    !angVelRes.value ||
    !forceRes.value ||
    !torqueRes.value ||
    !accelRes.value
  ) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      velocity: velRes.value,
      angularVelocity: angVelRes.value,
      force: forceRes.value,
      torque: torqueRes.value,
      acceleration: accelRes.value,
    }),
    errors: [],
  };
}
