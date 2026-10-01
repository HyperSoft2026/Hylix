import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  createScriptError,
  isForbiddenScriptString,
  isPlainScriptObject,
  ScriptDiagnosticError,
  ScriptValidationResult,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Scripting Security Policy Auditor & Barrel Exports
 */

export function validateScriptPayloadSecurity(
  payload: unknown,
  logger?: RedactedDiagnosticLogger
): ScriptValidationResult<true> {
  const errors: ScriptDiagnosticError[] = [];

  const inspectRecursive = (val: unknown, depth: number): void => {
    if (depth > 8) {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          'Script payload nesting depth exceeds maximum allowed depth (8).'
        )
      );
      return;
    }

    if (typeof val === 'string') {
      const check = isForbiddenScriptString(val);
      if (check.forbidden) {
        errors.push(
          createScriptError('SCRIPT_PERMISSION_ERROR', check.reason!)
        );
      }
      return;
    }

    if (typeof val === 'function' || typeof val === 'symbol') {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `Script payload cannot contain executable functions or symbols ('${typeof val}').`
        )
      );
      return;
    }

    if (Array.isArray(val)) {
      for (const item of val) {
        inspectRecursive(item, depth + 1);
      }
      return;
    }

    if (isPlainScriptObject(val)) {
      for (const [k, v] of Object.entries(val)) {
        const keyCheck = isForbiddenScriptString(k);
        if (keyCheck.forbidden) {
          errors.push(
            createScriptError('SCRIPT_PERMISSION_ERROR', keyCheck.reason!)
          );
        }
        inspectRecursive(v, depth + 1);
      }
    }
  };

  inspectRecursive(payload, 0);

  if (errors.length > 0) {
    logger?.record(
      'scripting',
      'SECURITY_AUDIT',
      `script_security_violation: ${errors.map((e) => e.message).join('; ')}`
    );
    return { valid: false, value: null, errors };
  }

  return { valid: true, value: true, errors: [] };
}

export * from './scriptTypes';
export * from './scriptIdentity';
export * from './scriptCapabilities';
export * from './scriptPermissions';
export * from './scriptSource';
export * from './scriptManifest';
export * from './scriptRegistry';
export * from './scriptLifecycle';
export * from './scriptInstance';
export * from './scriptSandbox';
export * from './scriptEvents';
export * from './scriptScheduler';
export * from './scriptApi';
export * from './scriptBindings';
export * from './scriptContext';
export * from './scriptRuntime';
export * from './scriptExtraction';
export * from './scriptIntegration';
export * from './scriptDiagnostics';
