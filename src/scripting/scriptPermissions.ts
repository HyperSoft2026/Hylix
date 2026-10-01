import {
  ALL_SCRIPT_CAPABILITIES,
  ScriptCapability,
  validateScriptCapabilityList,
} from './scriptCapabilities';
import {
  createScriptError,
  DEFAULT_MAX_SCRIPT_MEMORY_ESTIMATE_BYTES,
  isFiniteScriptNumber,
  isPlainScriptObject,
  MAX_SCRIPT_AUDIO_COMMANDS_PER_FRAME,
  MAX_SCRIPT_ENTITY_OPERATIONS_PER_FRAME,
  MAX_SCRIPT_EVENTS_PER_FRAME,
  MAX_SCRIPT_INSTANCES,
  MAX_SCRIPT_INSTRUCTIONS_PER_FRAME,
  MAX_SCRIPT_PHYSICS_QUERIES_PER_FRAME,
  ScriptDiagnosticError,
  ScriptValidationResult,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Project/Runtime Script Permission Policy
 *
 * Strictly separates:
 * - `ScriptCapability` (what a script manifest declares it wants to use)
 * - `ScriptPermissionPolicy` (what the project/runtime policy permits or denies, plus resource budgets)
 *
 * Default policy is conservative and enforces explicit deny precedence (`deniedCapabilities` overrides `allowedCapabilities`).
 */

export interface ScriptPermissionPolicy {
  readonly allowedCapabilities: readonly ScriptCapability[];
  readonly deniedCapabilities: readonly ScriptCapability[];
  readonly allowEditorCategoryExecution: boolean;
  readonly maxInstructions: number;
  readonly maxEventsPerFrame: number;
  readonly maxMemoryEstimate: number;
  readonly maxInstances: number;
  readonly maxEntityOperations: number;
  readonly maxPhysicsQueries: number;
  readonly maxAudioCommands: number;
}

const ALLOWED_PERMISSION_POLICY_KEYS: ReadonlySet<string> = new Set<string>([
  'allowedCapabilities',
  'deniedCapabilities',
  'allowEditorCategoryExecution',
  'maxInstructions',
  'maxEventsPerFrame',
  'maxMemoryEstimate',
  'maxInstances',
  'maxEntityOperations',
  'maxPhysicsQueries',
  'maxAudioCommands',
]);

/**
 * Creates a conservative default `ScriptPermissionPolicy` for gameplay/runtime projects.
 * Note: Editor script execution is disabled (`allowEditorCategoryExecution: false`) in Phase 09.
 */
export function createDefaultScriptPermissionPolicy(): ScriptPermissionPolicy {
  return Object.freeze({
    allowedCapabilities: Object.freeze([...ALL_SCRIPT_CAPABILITIES]),
    deniedCapabilities: Object.freeze([] as const),
    allowEditorCategoryExecution: false,
    maxInstructions: MAX_SCRIPT_INSTRUCTIONS_PER_FRAME,
    maxEventsPerFrame: MAX_SCRIPT_EVENTS_PER_FRAME,
    maxMemoryEstimate: DEFAULT_MAX_SCRIPT_MEMORY_ESTIMATE_BYTES,
    maxInstances: MAX_SCRIPT_INSTANCES,
    maxEntityOperations: MAX_SCRIPT_ENTITY_OPERATIONS_PER_FRAME,
    maxPhysicsQueries: MAX_SCRIPT_PHYSICS_QUERIES_PER_FRAME,
    maxAudioCommands: MAX_SCRIPT_AUDIO_COMMANDS_PER_FRAME,
  });
}

export function validateScriptPermissionPolicy(
  candidate: unknown
): ScriptValidationResult<ScriptPermissionPolicy> {
  if (!isPlainScriptObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_PERMISSION_ERROR',
          'ScriptPermissionPolicy must be a non-null plain object.'
        ),
      ],
    };
  }

  const errors: ScriptDiagnosticError[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_PERMISSION_POLICY_KEYS.has(key)) {
      errors.push(
        createScriptError(
          'SCRIPT_PERMISSION_ERROR',
          `Unexpected property '${key}' in ScriptPermissionPolicy.`
        )
      );
    }
  }

  const allowedCheck =
    candidate.allowedCapabilities !== undefined
      ? validateScriptCapabilityList(candidate.allowedCapabilities, false)
      : {
          valid: true,
          value: ALL_SCRIPT_CAPABILITIES,
          errors: [] as readonly ScriptDiagnosticError[],
        };
  if (!allowedCheck.valid || !allowedCheck.value) {
    for (const err of allowedCheck.errors) {
      errors.push(
        createScriptError('SCRIPT_PERMISSION_ERROR', err.message)
      );
    }
  }

  const deniedCheck =
    candidate.deniedCapabilities !== undefined
      ? validateScriptCapabilityList(candidate.deniedCapabilities, false)
      : {
          valid: true,
          value: Object.freeze([] as ScriptCapability[]),
          errors: [] as readonly ScriptDiagnosticError[],
        };
  if (!deniedCheck.valid || !deniedCheck.value) {
    for (const err of deniedCheck.errors) {
      errors.push(
        createScriptError('SCRIPT_PERMISSION_ERROR', err.message)
      );
    }
  }

  const allowEditor =
    candidate.allowEditorCategoryExecution !== undefined
      ? candidate.allowEditorCategoryExecution
      : false;
  if (typeof allowEditor !== 'boolean') {
    errors.push(
      createScriptError(
        'SCRIPT_PERMISSION_ERROR',
        'ScriptPermissionPolicy.allowEditorCategoryExecution must be a boolean.'
      )
    );
  }

  const checkBoundedInt = (
    raw: unknown,
    defaultVal: number,
    maxAllowed: number,
    fieldName: string
  ): number => {
    const val = raw !== undefined ? raw : defaultVal;
    if (
      !isFiniteScriptNumber(val) ||
      !Number.isInteger(val) ||
      val < 1 ||
      val > maxAllowed
    ) {
      errors.push(
        createScriptError(
          'SCRIPT_PERMISSION_ERROR',
          `ScriptPermissionPolicy.${fieldName} must be an integer in [1, ${maxAllowed}].`
        )
      );
      return defaultVal;
    }
    return val;
  };

  const maxInstructions = checkBoundedInt(
    candidate.maxInstructions,
    MAX_SCRIPT_INSTRUCTIONS_PER_FRAME,
    MAX_SCRIPT_INSTRUCTIONS_PER_FRAME * 10,
    'maxInstructions'
  );
  const maxEventsPerFrame = checkBoundedInt(
    candidate.maxEventsPerFrame,
    MAX_SCRIPT_EVENTS_PER_FRAME,
    MAX_SCRIPT_EVENTS_PER_FRAME * 4,
    'maxEventsPerFrame'
  );
  const maxMemoryEstimate = checkBoundedInt(
    candidate.maxMemoryEstimate,
    DEFAULT_MAX_SCRIPT_MEMORY_ESTIMATE_BYTES,
    64 * 1024 * 1024,
    'maxMemoryEstimate'
  );
  const maxInstances = checkBoundedInt(
    candidate.maxInstances,
    MAX_SCRIPT_INSTANCES,
    MAX_SCRIPT_INSTANCES * 2,
    'maxInstances'
  );
  const maxEntityOperations = checkBoundedInt(
    candidate.maxEntityOperations,
    MAX_SCRIPT_ENTITY_OPERATIONS_PER_FRAME,
    MAX_SCRIPT_ENTITY_OPERATIONS_PER_FRAME * 4,
    'maxEntityOperations'
  );
  const maxPhysicsQueries = checkBoundedInt(
    candidate.maxPhysicsQueries,
    MAX_SCRIPT_PHYSICS_QUERIES_PER_FRAME,
    MAX_SCRIPT_PHYSICS_QUERIES_PER_FRAME * 4,
    'maxPhysicsQueries'
  );
  const maxAudioCommands = checkBoundedInt(
    candidate.maxAudioCommands,
    MAX_SCRIPT_AUDIO_COMMANDS_PER_FRAME,
    MAX_SCRIPT_AUDIO_COMMANDS_PER_FRAME * 4,
    'maxAudioCommands'
  );

  if (errors.length > 0 || !allowedCheck.value || !deniedCheck.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      allowedCapabilities: allowedCheck.value,
      deniedCapabilities: deniedCheck.value,
      allowEditorCategoryExecution: allowEditor as boolean,
      maxInstructions,
      maxEventsPerFrame,
      maxMemoryEstimate,
      maxInstances,
      maxEntityOperations,
      maxPhysicsQueries,
      maxAudioCommands,
    }),
    errors: [],
  };
}

/**
 * Evaluates whether a capability is permitted by BOTH the script's declared `capabilities`
 * AND the active `ScriptPermissionPolicy` (where `deniedCapabilities` always takes precedence).
 */
export function evaluateCapabilityPermission(
  scriptId: string,
  declaredCapabilities: readonly ScriptCapability[],
  policy: ScriptPermissionPolicy,
  requiredCapability: ScriptCapability
): ScriptValidationResult<true> {
  if (!declaredCapabilities.includes(requiredCapability)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_CAPABILITY_ERROR',
          `Script '${scriptId}' did not declare capability '${requiredCapability}'.`
        ),
      ],
    };
  }

  if (policy.deniedCapabilities.includes(requiredCapability)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_PERMISSION_ERROR',
          `Capability '${requiredCapability}' for script '${scriptId}' is explicitly denied by ScriptPermissionPolicy.`
        ),
      ],
    };
  }

  if (!policy.allowedCapabilities.includes(requiredCapability)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_PERMISSION_ERROR',
          `Capability '${requiredCapability}' for script '${scriptId}' is not in ScriptPermissionPolicy.allowedCapabilities.`
        ),
      ],
    };
  }

  return { valid: true, value: true, errors: [] };
}
