import { isValidAssetId } from '../assets/assetRegistry';
import {
  createDeterministicRenderId,
  isFiniteNumber,
  isPlainRenderObject,
  RenderValidationResult,
} from './renderTypes';
import {
  ColorRGBA,
  validateColorRGBA,
  validateVector2,
  validateVector3,
  validateVector4,
  Vector2,
  Vector3,
  Vector4,
} from './matrices';

/**
 * Hylix V1.0.0 — Phase 05: Strongly-Typed Material Contract (STEP 14)
 *
 * References `materialAssetId` and enforces discriminated typed parameters:
 * - float
 * - vector2
 * - vector3
 * - vector4
 * - color
 * - texture (via textureAssetId, never a raw path!)
 *
 * Strictly rejects untyped/arbitrary objects in Material parameters.
 */

export type MaterialParameterValue =
  | { readonly kind: 'float'; readonly value: number }
  | { readonly kind: 'vector2'; readonly value: Vector2 }
  | { readonly kind: 'vector3'; readonly value: Vector3 }
  | { readonly kind: 'vector4'; readonly value: Vector4 }
  | { readonly kind: 'color'; readonly value: ColorRGBA }
  | { readonly kind: 'texture'; readonly textureAssetId: string };

export interface MaterialDescriptor {
  readonly materialId: string;
  readonly materialAssetId: string;
  readonly shaderAssetId?: string;
  readonly name: string;
  readonly parameters: Readonly<Record<string, MaterialParameterValue>>;
}

const VALID_PARAM_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function validateMaterialParameter(
  paramName: string,
  candidate: unknown
): RenderValidationResult<MaterialParameterValue> {
  if (!VALID_PARAM_NAME_REGEX.test(paramName)) {
    return {
      valid: false,
      value: null,
      errors: [`Invalid material parameter name '${paramName}'.`],
    };
  }

  if (!isPlainRenderObject(candidate) || typeof candidate.kind !== 'string') {
    return {
      valid: false,
      value: null,
      errors: [
        `Material parameter '${paramName}' must be a typed descriptor with 'kind' in {float, vector2, vector3, vector4, color, texture}. Arbitrary objects are forbidden.`,
      ],
    };
  }

  const kind = candidate.kind;
  const keys = Object.keys(candidate);

  if (kind === 'texture') {
    if (keys.length !== 2 || !('textureAssetId' in candidate)) {
      return {
        valid: false,
        value: null,
        errors: [
          `Texture material parameter '${paramName}' must contain only { kind: 'texture', textureAssetId: 'asset_...' }. Raw paths are forbidden.`,
        ],
      };
    }
    if (!isValidAssetId(candidate.textureAssetId)) {
      return {
        valid: false,
        value: null,
        errors: [
          `Texture material parameter '${paramName}' has invalid textureAssetId '${String(candidate.textureAssetId)}'.`,
        ],
      };
    }
    return {
      valid: true,
      value: Object.freeze({
        kind: 'texture',
        textureAssetId: candidate.textureAssetId,
      }),
      errors: [],
    };
  }

  if (keys.length !== 2 || !('value' in candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        `Material parameter '${paramName}' of kind '${kind}' must contain only { kind, value }.`,
      ],
    };
  }

  switch (kind) {
    case 'float': {
      if (!isFiniteNumber(candidate.value)) {
        return {
          valid: false,
          value: null,
          errors: [`Material float parameter '${paramName}' must be a finite number.`],
        };
      }
      return {
        valid: true,
        value: Object.freeze({ kind: 'float', value: candidate.value }),
        errors: [],
      };
    }
    case 'vector2': {
      const v2 = validateVector2(candidate.value, `Material.${paramName}`);
      if (!v2.valid || !v2.value) {
        return { valid: false, value: null, errors: v2.errors };
      }
      return {
        valid: true,
        value: Object.freeze({ kind: 'vector2', value: v2.value }),
        errors: [],
      };
    }
    case 'vector3': {
      const v3 = validateVector3(candidate.value, `Material.${paramName}`);
      if (!v3.valid || !v3.value) {
        return { valid: false, value: null, errors: v3.errors };
      }
      return {
        valid: true,
        value: Object.freeze({ kind: 'vector3', value: v3.value }),
        errors: [],
      };
    }
    case 'vector4': {
      const v4 = validateVector4(candidate.value, `Material.${paramName}`);
      if (!v4.valid || !v4.value) {
        return { valid: false, value: null, errors: v4.errors };
      }
      return {
        valid: true,
        value: Object.freeze({ kind: 'vector4', value: v4.value }),
        errors: [],
      };
    }
    case 'color': {
      const col = validateColorRGBA(candidate.value, `Material.${paramName}`);
      if (!col.valid || !col.value) {
        return { valid: false, value: null, errors: col.errors };
      }
      return {
        valid: true,
        value: Object.freeze({ kind: 'color', value: col.value }),
        errors: [],
      };
    }
    default:
      return {
        valid: false,
        value: null,
        errors: [`Unsupported material parameter kind '${kind}' on '${paramName}'.`],
      };
  }
}

export function validateMaterialDescriptor(
  candidate: unknown
): RenderValidationResult<MaterialDescriptor> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['Material descriptor must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  if ('materialPath' in candidate || 'filePath' in candidate || 'texturePath' in candidate) {
    errors.push(
      'Raw filesystem paths (materialPath / filePath / texturePath) are forbidden in MaterialDescriptor; use materialAssetId.'
    );
  }

  if (!isValidAssetId(candidate.materialAssetId)) {
    errors.push(
      `Invalid materialAssetId '${String(candidate.materialAssetId)}'; expected deterministic 'asset_<16-hex>'.`
    );
  }

  let shaderAssetId: string | undefined;
  if (candidate.shaderAssetId !== undefined) {
    if (!isValidAssetId(candidate.shaderAssetId)) {
      errors.push(
        `Invalid shaderAssetId '${String(candidate.shaderAssetId)}'; expected deterministic 'asset_<16-hex>'.`
      );
    } else {
      shaderAssetId = candidate.shaderAssetId;
    }
  }

  const name =
    typeof candidate.name === 'string' && candidate.name.trim().length > 0
      ? candidate.name.trim()
      : 'StandardMaterial';

  const normalizedParams: Record<string, MaterialParameterValue> = {};
  if (candidate.parameters !== undefined) {
    if (!isPlainRenderObject(candidate.parameters)) {
      errors.push('Material.parameters must be a non-null object map.');
    } else {
      for (const [paramName, paramVal] of Object.entries(candidate.parameters)) {
        const paramCheck = validateMaterialParameter(paramName, paramVal);
        if (!paramCheck.valid || !paramCheck.value) {
          errors.push(...paramCheck.errors);
        } else {
          normalizedParams[paramName] = paramCheck.value;
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  const materialId =
    typeof candidate.materialId === 'string' && candidate.materialId.trim().length > 0
      ? candidate.materialId.trim()
      : createDeterministicRenderId('mat', candidate.materialAssetId as string);

  const descriptor: MaterialDescriptor = Object.freeze({
    materialId,
    materialAssetId: candidate.materialAssetId as string,
    ...(shaderAssetId ? { shaderAssetId } : {}),
    name,
    parameters: Object.freeze(normalizedParams),
  });

  return { valid: true, value: descriptor, errors: [] };
}
