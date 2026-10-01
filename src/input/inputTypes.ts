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
 * Hylix V1.0.0 — Phase 08: Input System Types, Deterministic IDs, Axis Math & Error Codes
 *
 * Built from scratch by HyperSoft. Zero external input engines or frameworks
 * (No Unity Input, Unreal Enhanced Input, Godot Input, SDL, GLFW, libinput, Phaser, or React DOM events).
 */

export {
  createDefaultVector2,
  createDefaultVector3,
  validateVector2,
  validateVector3,
};
export type { Vector2, Vector3 };

export type InputIdPrefix =
  | 'input'
  | 'device'
  | 'event'
  | 'action'
  | 'binding'
  | 'context';

export type InputManagerId = `input_${string}`;
export type InputDeviceId = `device_${string}`;
export type InputEventId = `event_${string}`;
export type InputActionId = `action_${string}`;
export type InputBindingId = `binding_${string}`;
export type InputContextId = `context_${string}`;

export type ActiveInputDeviceType =
  | 'keyboard'
  | 'mouse'
  | 'touch'
  | 'gamepad'
  | 'virtual';

export type ReservedFutureInputDeviceType =
  | 'pen'
  | 'joystick'
  | 'motion'
  | 'sensor';

export type InputDeviceType =
  | ActiveInputDeviceType
  | ReservedFutureInputDeviceType;

export type DigitalControlPhase = 'idle' | 'pressed' | 'held' | 'released';

export type TouchPhase =
  | 'began'
  | 'moved'
  | 'stationary'
  | 'ended'
  | 'cancelled';

export type InputActionValueType = 'button' | 'axis1D' | 'axis2D' | 'axis3D';

export type InputLifecycleState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'processing'
  | 'shutdown';

export type InputBufferOverflowPolicy = 'rejectNewest' | 'dropOldest';

export type InputErrorCode =
  | 'INPUT_NOT_INITIALIZED'
  | 'INPUT_DEVICE_NOT_FOUND'
  | 'INPUT_EVENT_INVALID'
  | 'INPUT_BUFFER_FULL'
  | 'INPUT_ACTION_NOT_FOUND'
  | 'INPUT_BINDING_INVALID'
  | 'INPUT_CONTEXT_INVALID'
  | 'INPUT_CROSS_PROJECT_ACCESS'
  | 'INPUT_INVALID_VALUE'
  | 'INPUT_ILLEGAL_STATE_TRANSITION';

export interface InputDiagnosticError {
  readonly code: InputErrorCode;
  readonly message: string;
}

export interface InputValidationResult<T = unknown> {
  readonly valid: boolean;
  readonly value: T | null;
  readonly errors: readonly InputDiagnosticError[];
}

export const DEFAULT_MAX_INPUT_EVENTS = 512;
export const MIN_SAFE_INPUT_EVENTS = 1;
export const MAX_SAFE_INPUT_EVENTS = 8192;

export const DEFAULT_MAX_INPUT_DEVICES = 32;
export const DEFAULT_MAX_INPUT_CONTEXTS = 32;
export const DEFAULT_MAX_INPUT_ACTIONS = 256;
export const DEFAULT_MAX_BINDINGS_PER_ACTION = 16;
export const DEFAULT_MAX_ACTIVE_TOUCHES = 16;

export const IMPLEMENTED_INPUT_DEVICE_TYPES: ReadonlySet<ActiveInputDeviceType> =
  new Set<ActiveInputDeviceType>([
    'keyboard',
    'mouse',
    'touch',
    'gamepad',
    'virtual',
  ]);

export const RESERVED_FUTURE_INPUT_DEVICE_TYPES: ReadonlySet<ReservedFutureInputDeviceType> =
  new Set<ReservedFutureInputDeviceType>([
    'pen',
    'joystick',
    'motion',
    'sensor',
  ]);

const INPUT_ID_REGEX_BY_PREFIX: Readonly<Record<InputIdPrefix, RegExp>> =
  Object.freeze({
    input: /^input_[a-f0-9]{16}$/i,
    device: /^device_[a-f0-9]{16}$/i,
    event: /^event_[a-f0-9]{16}$/i,
    action: /^action_[a-f0-9]{16}$/i,
    binding: /^binding_[a-f0-9]{16}$/i,
    context: /^context_[a-f0-9]{16}$/i,
  });

const ALLOWED_INPUT_LIFECYCLE_TRANSITIONS: Readonly<
  Record<InputLifecycleState, readonly InputLifecycleState[]>
> = Object.freeze({
  uninitialized: Object.freeze(['initializing', 'shutdown'] as const),
  initializing: Object.freeze(['ready', 'shutdown'] as const),
  ready: Object.freeze(['processing', 'shutdown'] as const),
  processing: Object.freeze(['ready', 'shutdown'] as const),
  shutdown: Object.freeze([] as const),
});

const FORBIDDEN_INPUT_STRING_PATTERNS: readonly RegExp[] = Object.freeze([
  /\0/,
  /(^|[\\/])\.\.([\\/]|$)/,
  /^(https?|wss?|ftp|file):\/\//i,
  /^\/(sdcard|storage|system|data|proc|dev|etc|root|mnt)(\/|$)/i,
  /^[a-zA-Z]:[\\/]/,
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /\bchild_process\b/i,
  /\b(sh|bash|cmd|powershell)\s+-c\b/i,
  /\.(jks|keystore|p12|pfx|pem)$/i,
  /signing\.properties$/i,
]);

export function createInputError(
  code: InputErrorCode,
  message: string
): InputDiagnosticError {
  return Object.freeze({ code, message });
}

/**
 * Generates a deterministic Input ID (`<prefix>_<16-hex>`) from a canonical seed.
 * Never uses `Math.random()`, `Date.now()`, or array indices.
 */
export function createInputId<TPrefix extends InputIdPrefix>(
  prefix: TPrefix,
  canonicalSeed: string
): `${TPrefix}_${string}` {
  const cleanSeed = canonicalSeed.trim();
  const hex = computeDeterministicChecksum(
    `hylix_input_id::${prefix}::${cleanSeed}`
  );
  return `${prefix}_${hex}` as `${TPrefix}_${string}`;
}

export function isValidInputId<TPrefix extends InputIdPrefix>(
  prefix: TPrefix,
  candidate: unknown
): candidate is `${TPrefix}_${string}` {
  if (typeof candidate !== 'string') return false;
  const regex = INPUT_ID_REGEX_BY_PREFIX[prefix];
  return Boolean(regex && regex.test(candidate));
}

export function isValidInputManagerId(
  candidate: unknown
): candidate is InputManagerId {
  return isValidInputId('input', candidate);
}

export function isValidInputDeviceId(
  candidate: unknown
): candidate is InputDeviceId {
  return isValidInputId('device', candidate);
}

export function isValidInputEventId(
  candidate: unknown
): candidate is InputEventId {
  return isValidInputId('event', candidate);
}

export function isValidInputActionId(
  candidate: unknown
): candidate is InputActionId {
  return isValidInputId('action', candidate);
}

export function isValidInputBindingId(
  candidate: unknown
): candidate is InputBindingId {
  return isValidInputId('binding', candidate);
}

export function isValidInputContextId(
  candidate: unknown
): candidate is InputContextId {
  return isValidInputId('context', candidate);
}

export function isValidInputLifecycleTransition(
  from: InputLifecycleState,
  to: InputLifecycleState
): boolean {
  const allowed = ALLOWED_INPUT_LIFECYCLE_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

export function isFiniteInputNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function clampInputNumber(
  value: number,
  min: number,
  max: number
): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function isPlainInputObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isForbiddenInputString(candidate: string): {
  readonly forbidden: boolean;
  readonly reason?: string;
} {
  for (const pattern of FORBIDDEN_INPUT_STRING_PATTERNS) {
    if (pattern.test(candidate)) {
      return {
        forbidden: true,
        reason: `String '${candidate}' violates Hylix Input Local-First/Security policy (${pattern.source}).`,
      };
    }
  }
  return { forbidden: false };
}

/**
 * Deterministically computes the digital control phase from `(previousDown, currentDown)`:
 * - `!previousDown && currentDown` -> `'pressed'`
 * - `previousDown && currentDown`  -> `'held'`
 * - `previousDown && !currentDown` -> `'released'`
 * - `!previousDown && !currentDown` -> `'idle'`
 */
export function computeDigitalControlPhase(
  previousDown: boolean,
  currentDown: boolean
): DigitalControlPhase {
  if (currentDown) {
    return previousDown ? 'held' : 'pressed';
  }
  return previousDown ? 'released' : 'idle';
}

export interface AxisProcessingOptions {
  readonly deadZone?: number;
  readonly sensitivity?: number;
  readonly invert?: boolean;
  readonly min?: number;
  readonly max?: number;
}

/**
 * Processes a raw 1D axis value with dead-zone filtering, sensitivity scaling,
 * optional inversion, and strict `[min, max]` clamping (Section 16).
 */
export function processAxisValue(
  rawValue: number,
  options?: AxisProcessingOptions
): InputValidationResult<number> {
  if (!isFiniteInputNumber(rawValue)) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_INVALID_VALUE',
          `Axis rawValue '${String(rawValue)}' must be a finite number.`
        ),
      ],
    };
  }

  const deadZone = options?.deadZone ?? 0.1;
  const sensitivity = options?.sensitivity ?? 1.0;
  const invert = options?.invert ?? false;
  const min = options?.min ?? -1.0;
  const max = options?.max ?? 1.0;

  if (
    !isFiniteInputNumber(deadZone) ||
    deadZone < 0 ||
    deadZone >= 1.0 ||
    !isFiniteInputNumber(sensitivity) ||
    sensitivity <= 0 ||
    !isFiniteInputNumber(min) ||
    !isFiniteInputNumber(max) ||
    min >= max
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_INVALID_VALUE',
          'Invalid axis processing options (deadZone in [0, 1), sensitivity > 0, min < max).'
        ),
      ],
    };
  }

  const clampedRaw = clampInputNumber(rawValue, min, max);
  if (Math.abs(clampedRaw) <= deadZone) {
    return {
      valid: true,
      value: 0,
      errors: [],
    };
  }

  const sign = invert ? -1 : 1;
  const scaled = clampedRaw * sensitivity * sign;
  const finalValue = clampInputNumber(scaled, min, max);

  return {
    valid: true,
    value: finalValue === 0 ? 0 : finalValue,
    errors: [],
  };
}
