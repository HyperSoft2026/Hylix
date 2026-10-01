import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  isForbiddenInputString,
  isPlainInputObject,
} from './inputTypes';

/**
 * Hylix V1.0.0 — Phase 08: Input Security Policy Auditor & Barrel Exports
 */

export function validateInputPayloadSecurity(
  candidate: unknown,
  logger?: RedactedDiagnosticLogger
): {
  readonly safe: boolean;
  readonly violations: readonly string[];
} {
  const violations: string[] = [];

  const inspectValue = (val: unknown, path: string): void => {
    if (typeof val === 'string') {
      const check = isForbiddenInputString(val);
      if (check.forbidden && check.reason) {
        violations.push(`${path}: ${check.reason}`);
      }
      return;
    }

    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        inspectValue(val[i], `${path}[${i}]`);
      }
      return;
    }

    if (isPlainInputObject(val)) {
      for (const [key, nested] of Object.entries(val)) {
        const keyCheck = isForbiddenInputString(key);
        if (keyCheck.forbidden && keyCheck.reason) {
          violations.push(`${path}.${key}: ${keyCheck.reason}`);
        }
        inspectValue(nested, `${path}.${key}`);
      }
    }
  };

  inspectValue(candidate, 'inputPayload');

  if (violations.length > 0) {
    logger?.record(
      'security',
      'ERROR',
      `input_security_violation: ${violations.join('; ')}`
    );
  }

  return Object.freeze({
    safe: violations.length === 0,
    violations: Object.freeze(violations),
  });
}

export * from './inputTypes';
export * from './inputDevice';
export * from './inputEvent';
export * from './inputBuffer';
export * from './inputState';
export * from './keyboardInput';
export * from './mouseInput';
export * from './touchInput';
export * from './gamepadInput';
export * from './gestureInput';
export * from './inputAction';
export * from './inputMap';
export * from './inputContext';
export * from './inputManager';
export * from './inputExtraction';
export * from './inputIntegration';
