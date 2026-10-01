import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  isForbiddenPhysicsInputString,
  isPlainPhysicsObject,
} from './physicsTypes';

/**
 * Hylix V1.0.0 — Phase 06: Physics Security Policy Verifier & Module Barrel (STEP 31)
 *
 * Ensures no physics payload contains:
 * - raw filesystem paths (`/sdcard`, `/system`, `/data`, `/proc`, `../`, `filePath`)
 * - external URLs (`http://`, `https://`, `file://`)
 * - dynamic code execution (`eval`, `Function()`, `child_process`)
 */

export interface PhysicsSecurityAuditResult {
  readonly safe: boolean;
  readonly violations: readonly string[];
}

const FORBIDDEN_RAW_PATH_KEYS = new Set([
  'filePath',
  'path',
  'meshPath',
  'materialPath',
  'physicsMaterialPath',
  'url',
  'scriptCode',
]);

export function validatePhysicsPayloadSecurity(
  payload: unknown,
  logger?: RedactedDiagnosticLogger
): PhysicsSecurityAuditResult {
  const violations: string[] = [];

  function walk(node: unknown, currentPath: string): void {
    if (typeof node === 'string') {
      const check = isForbiddenPhysicsInputString(node);
      if (check.forbidden) {
        violations.push(`${currentPath}: ${check.reason} (value="${node}")`);
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, idx) => walk(item, `${currentPath}[${idx}]`));
      return;
    }

    if (isPlainPhysicsObject(node)) {
      for (const [k, v] of Object.entries(node)) {
        if (FORBIDDEN_RAW_PATH_KEYS.has(k)) {
          violations.push(
            `${currentPath}.${k}: Raw path/URL property '${k}' is forbidden in Physics payloads; use deterministic AssetId ('asset_<16-hex>').`
          );
        }
        walk(v, `${currentPath}.${k}`);
      }
    }
  }

  walk(payload, 'root');

  if (violations.length > 0) {
    logger?.record(
      'physics',
      'SECURITY_AUDIT',
      `physics_validation_failed: Security policy violation (${violations.join('; ')})`
    );
  }

  return Object.freeze({
    safe: violations.length === 0,
    violations: Object.freeze(violations),
  });
}

export * from './physicsTypes';
export * from './bounds';
export * from './shapes';
export * from './collisionLayers';
export * from './physicsMaterial';
export * from './physicsBody';
export * from './collider';
export * from './collision';
export * from './fixedTimestep';
export * from './raycast';
export * from './spatialQueries';
export * from './physicsWorld';
export * from './physicsQueries';
export * from './physicsExtraction';
export * from './physicsIntegration';
