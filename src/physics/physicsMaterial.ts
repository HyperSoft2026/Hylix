import { isValidAssetId } from '../assets/assetRegistry';
import {
  createPhysicsId,
  isFinitePhysicsNumber,
  isForbiddenPhysicsInputString,
  isPlainPhysicsObject,
  isValidPhysicsMaterialId,
  PhysicsMaterialId,
  PhysicsValidationResult,
} from './physicsTypes';

/**
 * Hylix V1.0.0 — Phase 06: PhysicsMaterial Foundation (STEP 25 & STEP 30)
 *
 * Properties:
 * - friction >= 0 (finite)
 * - 0 <= restitution <= 1 (finite)
 * - optional physicsMaterialAssetId (`asset_<16-hex>`)
 */

export interface PhysicsMaterialDescriptor {
  readonly materialId: PhysicsMaterialId;
  readonly name: string;
  readonly friction: number;
  readonly restitution: number;
  readonly physicsMaterialAssetId?: string;
}

export function createDefaultPhysicsMaterial(
  name = 'DefaultPhysicsMaterial'
): PhysicsMaterialDescriptor {
  return Object.freeze({
    materialId: createPhysicsId('pmat', name),
    name,
    friction: 0.4,
    restitution: 0.2,
  });
}

export function validatePhysicsMaterial(
  candidate: unknown
): PhysicsValidationResult<PhysicsMaterialDescriptor> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['PhysicsMaterial must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  for (const forbiddenKey of ['filePath', 'path', 'materialPath', 'url']) {
    if (forbiddenKey in candidate) {
      errors.push(
        `Forbidden raw path property '${forbiddenKey}' in PhysicsMaterial; use 'physicsMaterialAssetId'.`
      );
    }
  }

  const name =
    typeof candidate.name === 'string' && candidate.name.trim().length > 0
      ? candidate.name.trim()
      : 'PhysicsMaterial';

  const secCheck = isForbiddenPhysicsInputString(name);
  if (secCheck.forbidden) {
    errors.push(secCheck.reason!);
  }

  const materialId: PhysicsMaterialId =
    candidate.materialId !== undefined
      ? (candidate.materialId as PhysicsMaterialId)
      : createPhysicsId('pmat', name);

  if (!isValidPhysicsMaterialId(materialId)) {
    errors.push(
      `Invalid PhysicsMaterial.materialId '${String(materialId)}'; expected 'pmat_<16-hex>'.`
    );
  }

  if (!isFinitePhysicsNumber(candidate.friction) || candidate.friction < 0) {
    errors.push(
      `PhysicsMaterial.friction must be a finite number >= 0 (received ${String(candidate.friction)}).`
    );
  }

  if (
    !isFinitePhysicsNumber(candidate.restitution) ||
    candidate.restitution < 0 ||
    candidate.restitution > 1
  ) {
    errors.push(
      `PhysicsMaterial.restitution must be a finite number in [0, 1] (received ${String(candidate.restitution)}).`
    );
  }

  let physicsMaterialAssetId: string | undefined;
  if (candidate.physicsMaterialAssetId !== undefined) {
    if (!isValidAssetId(candidate.physicsMaterialAssetId)) {
      errors.push(
        `Invalid physicsMaterialAssetId '${String(candidate.physicsMaterialAssetId)}'; expected 'asset_<16-hex>'.`
      );
    } else {
      physicsMaterialAssetId = candidate.physicsMaterialAssetId;
    }
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      materialId,
      name,
      friction: (candidate.friction as number) === 0 ? 0 : (candidate.friction as number),
      restitution:
        (candidate.restitution as number) === 0 ? 0 : (candidate.restitution as number),
      ...(physicsMaterialAssetId ? { physicsMaterialAssetId } : {}),
    }),
    errors: [],
  };
}

/**
 * Deterministically combines two PhysicsMaterials for contact resolution:
 * - combinedFriction = geometric mean sqrt(fA * fB)
 * - combinedRestitution = max(rA, rB)
 */
export function combinePhysicsMaterials(
  a: PhysicsMaterialDescriptor,
  b: PhysicsMaterialDescriptor
): { readonly friction: number; readonly restitution: number } {
  return Object.freeze({
    friction: Math.sqrt(Math.max(0, a.friction) * Math.max(0, b.friction)),
    restitution: Math.max(a.restitution, b.restitution),
  });
}
