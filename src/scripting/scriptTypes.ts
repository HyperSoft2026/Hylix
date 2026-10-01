import { redactSensitiveData } from '../security/securityFoundation';
import {
  createDefaultVector2,
  createDefaultVector3,
  validateVector2,
  validateVector3,
  Vector2,
  Vector3,
} from '../rendering/matrices';

/**
 * Hylix V1.0.0 — Phase 09: Scripting System Types, Resource Limits & Controlled Errors
 *
 * IMPORTANT ARCHITECTURAL BOUNDARY:
 * Phase 09 provides the scripting security boundary and runtime contracts;
 * execution of untrusted source requires a dedicated isolated runtime implementation
 * in a future phase. Phase 09 does NOT execute arbitrary JavaScript/TypeScript source
 * (Zero eval, Function(), vm, child_process, dynamic import, or shell execution).
 */

export {
  createDefaultVector2,
  createDefaultVector3,
  validateVector2,
  validateVector3,
};
export type { Vector2, Vector3 };

export const CURRENT_SCRIPT_MANIFEST_SCHEMA_VERSION = 1;

// Conservative Resource Limits (Safety Constants)
export const MAX_SCRIPTS_PER_PROJECT = 512;
export const MAX_SCRIPT_INSTANCES = 2048;
export const MAX_SCRIPT_DEPENDENCIES = 16;
export const MAX_SCRIPT_EVENTS_PER_FRAME = 256;
export const MAX_SCRIPT_EVENT_PAYLOAD_SIZE = 4096;
export const MAX_SCRIPT_OPERATIONS_PER_FRAME = 1000;
export const MAX_SCRIPT_INSTRUCTIONS_PER_FRAME = 50000;
export const MAX_SCRIPT_ENTITY_OPERATIONS_PER_FRAME = 256;
export const MAX_SCRIPT_PHYSICS_QUERIES_PER_FRAME = 64;
export const MAX_SCRIPT_AUDIO_COMMANDS_PER_FRAME = 32;
export const MAX_SCRIPT_NAME_LENGTH = 64;
export const MAX_SCRIPT_VERSION_LENGTH = 32;
export const MAX_SCRIPT_METADATA_SIZE = 2048;
export const DEFAULT_MAX_SCRIPT_MEMORY_ESTIMATE_BYTES = 4 * 1024 * 1024; // 4 MiB

export type ScriptCategory =
  | 'Gameplay'
  | 'Component'
  | 'System'
  | 'Editor'
  | 'Utility';

export const VALID_SCRIPT_CATEGORIES: ReadonlySet<ScriptCategory> =
  new Set<ScriptCategory>([
    'Gameplay',
    'Component',
    'System',
    'Editor',
    'Utility',
  ]);

export type ScriptLanguage =
  | 'TypeScript'
  | 'JavaScript'
  | 'HylixScript'
  | 'FutureNative'
  | 'Unknown';

export const SUPPORTED_SCRIPT_LANGUAGES: ReadonlySet<ScriptLanguage> =
  new Set<ScriptLanguage>(['TypeScript', 'JavaScript', 'HylixScript']);

export const RESERVED_SCRIPT_LANGUAGES: ReadonlySet<ScriptLanguage> =
  new Set<ScriptLanguage>(['FutureNative']);

export type ScriptSchedulerPhase =
  | 'Initialization'
  | 'FixedUpdate'
  | 'Update'
  | 'LateUpdate'
  | 'Event'
  | 'Shutdown';

export const VALID_SCRIPT_SCHEDULER_PHASES: ReadonlySet<ScriptSchedulerPhase> =
  new Set<ScriptSchedulerPhase>([
    'Initialization',
    'FixedUpdate',
    'Update',
    'LateUpdate',
    'Event',
    'Shutdown',
  ]);

export type ScriptErrorCode =
  | 'SCRIPT_VALIDATION_ERROR'
  | 'SCRIPT_PERMISSION_ERROR'
  | 'SCRIPT_CAPABILITY_ERROR'
  | 'SCRIPT_LIFECYCLE_ERROR'
  | 'SCRIPT_BUDGET_EXCEEDED_ERROR'
  | 'SCRIPT_PROJECT_ISOLATION_ERROR'
  | 'SCRIPT_BINDING_ERROR'
  | 'SCRIPT_RUNTIME_ERROR';

export interface ScriptDiagnosticError {
  readonly code: ScriptErrorCode;
  readonly errorClass:
    | 'ScriptValidationError'
    | 'ScriptPermissionError'
    | 'ScriptCapabilityError'
    | 'ScriptLifecycleError'
    | 'ScriptBudgetExceededError'
    | 'ScriptProjectIsolationError'
    | 'ScriptBindingError'
    | 'ScriptRuntimeError';
  readonly message: string;
}

export interface ScriptValidationResult<T = unknown> {
  readonly valid: boolean;
  readonly value: T | null;
  readonly errors: readonly ScriptDiagnosticError[];
}

export class HylixScriptError extends Error {
  public readonly code: ScriptErrorCode;
  public readonly errorClass: ScriptDiagnosticError['errorClass'];

  constructor(
    code: ScriptErrorCode,
    errorClass: ScriptDiagnosticError['errorClass'],
    rawMessage: string
  ) {
    const sanitized = redactSensitiveData(rawMessage);
    super(sanitized);
    this.name = errorClass;
    this.code = code;
    this.errorClass = errorClass;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toDiagnostic(): ScriptDiagnosticError {
    return Object.freeze({
      code: this.code,
      errorClass: this.errorClass,
      message: this.message,
    });
  }
}

export class ScriptValidationError extends HylixScriptError {
  constructor(message: string) {
    super('SCRIPT_VALIDATION_ERROR', 'ScriptValidationError', message);
  }
}

export class ScriptPermissionError extends HylixScriptError {
  constructor(message: string) {
    super('SCRIPT_PERMISSION_ERROR', 'ScriptPermissionError', message);
  }
}

export class ScriptCapabilityError extends HylixScriptError {
  constructor(message: string) {
    super('SCRIPT_CAPABILITY_ERROR', 'ScriptCapabilityError', message);
  }
}

export class ScriptLifecycleError extends HylixScriptError {
  constructor(message: string) {
    super('SCRIPT_LIFECYCLE_ERROR', 'ScriptLifecycleError', message);
  }
}

export class ScriptBudgetExceededError extends HylixScriptError {
  constructor(message: string) {
    super(
      'SCRIPT_BUDGET_EXCEEDED_ERROR',
      'ScriptBudgetExceededError',
      message
    );
  }
}

export class ScriptProjectIsolationError extends HylixScriptError {
  constructor(message: string) {
    super(
      'SCRIPT_PROJECT_ISOLATION_ERROR',
      'ScriptProjectIsolationError',
      message
    );
  }
}

export class ScriptBindingError extends HylixScriptError {
  constructor(message: string) {
    super('SCRIPT_BINDING_ERROR', 'ScriptBindingError', message);
  }
}

export class ScriptRuntimeError extends HylixScriptError {
  constructor(message: string) {
    super('SCRIPT_RUNTIME_ERROR', 'ScriptRuntimeError', message);
  }
}

const ERROR_CLASS_BY_CODE: Readonly<
  Record<ScriptErrorCode, ScriptDiagnosticError['errorClass']>
> = Object.freeze({
  SCRIPT_VALIDATION_ERROR: 'ScriptValidationError',
  SCRIPT_PERMISSION_ERROR: 'ScriptPermissionError',
  SCRIPT_CAPABILITY_ERROR: 'ScriptCapabilityError',
  SCRIPT_LIFECYCLE_ERROR: 'ScriptLifecycleError',
  SCRIPT_BUDGET_EXCEEDED_ERROR: 'ScriptBudgetExceededError',
  SCRIPT_PROJECT_ISOLATION_ERROR: 'ScriptProjectIsolationError',
  SCRIPT_BINDING_ERROR: 'ScriptBindingError',
  SCRIPT_RUNTIME_ERROR: 'ScriptRuntimeError',
});

/**
 * Creates a sanitized, deeply frozen `ScriptDiagnosticError` with automatic secret/credential redaction.
 */
export function createScriptError(
  code: ScriptErrorCode,
  rawMessage: string
): ScriptDiagnosticError {
  return Object.freeze({
    code,
    errorClass: ERROR_CLASS_BY_CODE[code],
    message: redactSensitiveData(rawMessage),
  });
}

const FORBIDDEN_SCRIPT_STRING_PATTERNS: readonly RegExp[] = Object.freeze([
  /\0/,
  /(^|[\\/])\.\.([\\/]|$)/,
  /^(https?|wss?|ftp|file|data|javascript):/i,
  /(^|[\s'"])\/(sdcard|storage|system|data|proc|dev|etc|root|mnt|Users|home)(\/|$)/i,
  /^[a-zA-Z]:[\\/]/,
  /\beval\s*\(/i,
  /\bnew\s+Function\s*\(/i,
  /\bFunction\s*\(/i,
  /\bvm\.runIn(This|New)Context\b/i,
  /\bchild_process\b/i,
  /\b(exec|execSync|spawn|spawnSync)\s*\(/i,
  /\bprocess\.env\b/i,
  /\b(sh|bash|cmd|powershell)\s+-c\b/i,
  /\.(jks|keystore|p12|pfx|pem)$/i,
  /signing\.properties$/i,
]);

export function isPlainScriptObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFiniteScriptNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isForbiddenScriptString(candidate: string): {
  readonly forbidden: boolean;
  readonly reason?: string;
} {
  for (const pattern of FORBIDDEN_SCRIPT_STRING_PATTERNS) {
    if (pattern.test(candidate)) {
      return {
        forbidden: true,
        reason: `String '${redactSensitiveData(candidate)}' violates Hylix Scripting Security/Local-First policy (${pattern.source}).`,
      };
    }
  }
  return { forbidden: false };
}

export function estimateSerializedByteSize(payload: unknown): number {
  try {
    const json = JSON.stringify(payload);
    if (typeof json !== 'string') return 0;
    return new TextEncoder().encode(json).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
