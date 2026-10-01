import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  isForbiddenAudioInputString,
  isPlainAudioObject,
} from './audioTypes';

/**
 * Hylix V1.0.0 — Phase 07: Audio Security Policy Auditor & Barrel Exports
 */

export function validateAudioPayloadSecurity(
  candidate: unknown,
  logger?: RedactedDiagnosticLogger
): {
  readonly safe: boolean;
  readonly violations: readonly string[];
} {
  const violations: string[] = [];

  const inspectValue = (val: unknown, path: string): void => {
    if (typeof val === 'string') {
      const check = isForbiddenAudioInputString(val);
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

    if (isPlainAudioObject(val)) {
      for (const [key, nested] of Object.entries(val)) {
        const keyCheck = isForbiddenAudioInputString(key);
        if (keyCheck.forbidden && keyCheck.reason) {
          violations.push(`${path}.${key}: ${keyCheck.reason}`);
        }
        inspectValue(nested, `${path}.${key}`);
      }
    }
  };

  inspectValue(candidate, 'audioPayload');

  if (violations.length > 0) {
    logger?.record(
      'security',
      'ERROR',
      `audio_security_violation: ${violations.join('; ')}`
    );
  }

  return Object.freeze({
    safe: violations.length === 0,
    violations: Object.freeze(violations),
  });
}

export * from './audioTypes';
export * from './soundResource';
export * from './audioBus';
export * from './audioSource';
export * from './audioListener';
export * from './spatialAudio';
export * from './voiceManagement';
export * from './audioWorld';
export * from './audioExtraction';
export * from './audioIntegration';
