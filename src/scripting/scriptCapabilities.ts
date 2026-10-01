import {
  createScriptError,
  ScriptDiagnosticError,
  ScriptValidationResult,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Explicit Script Capability System
 *
 * Enforces Least-Privilege / Default-Deny:
 * Each script receives ONLY its explicitly declared capabilities.
 * Default capability set is minimal (`['ReadTime']`).
 */

export type ScriptCapability =
  | 'ReadEntity'
  | 'WriteEntity'
  | 'ReadTransform'
  | 'WriteTransform'
  | 'ReadInput'
  | 'EmitEvent'
  | 'PlayAudio'
  | 'PhysicsQuery'
  | 'Log'
  | 'ReadTime'
  | 'ReadAsset'
  | 'WriteRenderMetadata';

export const ALL_SCRIPT_CAPABILITIES: readonly ScriptCapability[] =
  Object.freeze([
    'ReadEntity',
    'WriteEntity',
    'ReadTransform',
    'WriteTransform',
    'ReadInput',
    'EmitEvent',
    'PlayAudio',
    'PhysicsQuery',
    'Log',
    'ReadTime',
    'ReadAsset',
    'WriteRenderMetadata',
  ] as const);

export const VALID_SCRIPT_CAPABILITIES: ReadonlySet<ScriptCapability> =
  new Set<ScriptCapability>(ALL_SCRIPT_CAPABILITIES);

export const DEFAULT_MINIMAL_SCRIPT_CAPABILITIES: readonly ScriptCapability[] =
  Object.freeze(['ReadTime'] as const);

export function isValidScriptCapability(
  candidate: unknown
): candidate is ScriptCapability {
  return (
    typeof candidate === 'string' &&
    VALID_SCRIPT_CAPABILITIES.has(candidate as ScriptCapability)
  );
}

/**
 * Validates and normalizes an array of `ScriptCapability` values in deterministic sorted order.
 * Rejects any unknown or fabricated capability.
 */
export function validateScriptCapabilityList(
  candidate: unknown,
  defaultToMinimal = true
): ScriptValidationResult<readonly ScriptCapability[]> {
  if (candidate === undefined) {
    return {
      valid: true,
      value: defaultToMinimal
        ? DEFAULT_MINIMAL_SCRIPT_CAPABILITIES
        : Object.freeze([]),
      errors: [],
    };
  }

  if (!Array.isArray(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_CAPABILITY_ERROR',
          'Script capabilities must be an array of canonical ScriptCapability strings.'
        ),
      ],
    };
  }

  const errors: ScriptDiagnosticError[] = [];
  const unique = new Set<ScriptCapability>();

  for (const item of candidate) {
    if (!isValidScriptCapability(item)) {
      errors.push(
        createScriptError(
          'SCRIPT_CAPABILITY_ERROR',
          `Unsupported or unknown ScriptCapability '${String(item)}'.`
        )
      );
    } else {
      unique.add(item);
    }
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  const sorted = Object.freeze(
    Array.from(unique).sort((a, b) => a.localeCompare(b))
  );

  return {
    valid: true,
    value: sorted,
    errors: [],
  };
}

/**
 * Deterministic capability guard: returns true only if `requiredCapability` is present in `declaredCapabilities`.
 */
export function hasScriptCapability(
  declaredCapabilities: readonly ScriptCapability[],
  requiredCapability: ScriptCapability
): boolean {
  return declaredCapabilities.includes(requiredCapability);
}

export function verifyScriptCapability(
  scriptId: string,
  declaredCapabilities: readonly ScriptCapability[],
  requiredCapability: ScriptCapability
): ScriptValidationResult<true> {
  if (!hasScriptCapability(declaredCapabilities, requiredCapability)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_CAPABILITY_ERROR',
          `Script '${scriptId}' lacks required capability '${requiredCapability}' (default-deny enforced).`
        ),
      ],
    };
  }
  return { valid: true, value: true, errors: [] };
}
