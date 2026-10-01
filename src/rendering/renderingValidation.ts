import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  isForbiddenRenderInputString,
  isPlainRenderObject,
} from './renderTypes';

/**
 * Hylix V1.0.0 — Phase 05: Rendering Security & Architectural Validation (`src/rendering/renderingValidation.ts`)
 *
 * Enforces STEP 23 & STEP 24 Security & Local-First Invariants:
 * - Zero network calls or remote asset/shader/texture URLs (`http://`, `https://`, `ftp://`)
 * - Zero dynamic code execution (`eval`, `Function()`, `child_process`, shell commands)
 * - Zero direct Android/OS system path access (`/sdcard`, `/system`, `/data`, `/proc`, `../`, `C:\`)
 */

export interface RenderSecurityAuditResult {
  readonly safe: boolean;
  readonly violations: readonly string[];
}

const FORBIDDEN_PATH_OR_URL_KEYS = new Set([
  'path',
  'filePath',
  'texturePath',
  'spritePath',
  'meshPath',
  'materialPath',
  'shaderPath',
  'url',
  'remoteUrl',
  'shaderUrl',
  'textureUrl',
  'dynamicEval',
  'shellCommand',
]);

export function validateRenderPayloadSecurity(
  candidate: unknown,
  logger?: RedactedDiagnosticLogger
): RenderSecurityAuditResult {
  const violations: string[] = [];

  const inspectNode = (node: unknown, trail: string) => {
    if (typeof node === 'string') {
      const check = isForbiddenRenderInputString(node);
      if (check.forbidden) {
        violations.push(`${trail}: ${check.reason}`);
      }
      return;
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        inspectNode(node[i], `${trail}[${i}]`);
      }
      return;
    }

    if (isPlainRenderObject(node)) {
      for (const [key, value] of Object.entries(node)) {
        if (FORBIDDEN_PATH_OR_URL_KEYS.has(key)) {
          violations.push(
            `${trail}.${key}: Forbidden raw path, URL, or execution key '${key}' in Rendering payload.`
          );
        }
        inspectNode(value, `${trail}.${key}`);
      }
    }
  };

  inspectNode(candidate, 'renderPayload');

  if (violations.length > 0) {
    logger?.record(
      'rendering',
      'ERROR',
      `render_validation_failed: ${violations.join('; ')}`
    );
  }

  return Object.freeze({
    safe: violations.length === 0,
    violations: Object.freeze(violations),
  });
}

export * from './renderTypes';
export * from './matrices';
export * from './viewport';
export * from './camera';
export * from './mesh';
export * from './shader';
export * from './material';
export * from './texture';
export * from './renderable';
export * from './renderBackend';
export * from './renderFrame';
export * from './renderDevice';
export * from './renderQueue';
export * from './renderContext';
export * from './sceneRenderer';
