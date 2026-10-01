import { isValidAssetId } from '../assets/assetRegistry';
import {
  createDeterministicRenderId,
  isForbiddenRenderInputString,
  isPlainRenderObject,
  RenderValidationResult,
} from './renderTypes';

/**
 * Hylix V1.0.0 — Phase 05: Shader Contract (STEP 15)
 *
 * Defines Shader abstractions (`vertex`, `fragment`, `compute`) referenced by
 * `shaderAssetId` without implementing a full GPU shader compiler in Phase 05.
 */

export type ShaderStageType = 'vertex' | 'fragment' | 'compute';

export const SUPPORTED_SHADER_STAGE_TYPES: ReadonlySet<ShaderStageType> =
  new Set<ShaderStageType>(['vertex', 'fragment', 'compute']);

export interface ShaderMetadata {
  readonly uniformNames: readonly string[];
  readonly attributeNames: readonly string[];
  readonly requiresComputeCapability: boolean;
  readonly stageVersion: string;
}

export interface ShaderDescriptor {
  readonly shaderId: string;
  readonly shaderAssetId: string;
  readonly shaderType: ShaderStageType;
  readonly entryPoint: string;
  readonly executionSupportedInCurrentPhase: boolean;
  readonly shaderMetadata: ShaderMetadata;
}

const VALID_IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function validateShaderDescriptor(
  candidate: unknown
): RenderValidationResult<ShaderDescriptor> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['Shader descriptor must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  if ('shaderPath' in candidate || 'filePath' in candidate || 'sourceUrl' in candidate) {
    errors.push(
      'Raw shader paths or remote URLs (shaderPath / filePath / sourceUrl) are forbidden; use shaderAssetId.'
    );
  }

  if (!isValidAssetId(candidate.shaderAssetId)) {
    errors.push(
      `Invalid shaderAssetId '${String(candidate.shaderAssetId)}'; expected deterministic 'asset_<16-hex>'.`
    );
  }

  const shaderType = candidate.shaderType;
  if (
    typeof shaderType !== 'string' ||
    !SUPPORTED_SHADER_STAGE_TYPES.has(shaderType as ShaderStageType)
  ) {
    errors.push(
      `Unsupported shaderType '${String(shaderType)}'; expected 'vertex', 'fragment', or 'compute'.`
    );
  }

  const entryPoint =
    typeof candidate.entryPoint === 'string' && candidate.entryPoint.trim().length > 0
      ? candidate.entryPoint.trim()
      : 'main';

  if (!VALID_IDENTIFIER_REGEX.test(entryPoint)) {
    errors.push(`Invalid Shader.entryPoint '${entryPoint}'.`);
  }

  const secCheck = isForbiddenRenderInputString(entryPoint);
  if (secCheck.forbidden) {
    errors.push(secCheck.reason!);
  }

  const rawMeta = isPlainRenderObject(candidate.shaderMetadata)
    ? candidate.shaderMetadata
    : {};

  const uniformNames: string[] = [];
  if (rawMeta.uniformNames !== undefined) {
    if (!Array.isArray(rawMeta.uniformNames)) {
      errors.push('Shader.shaderMetadata.uniformNames must be an array of strings.');
    } else {
      for (const u of rawMeta.uniformNames) {
        if (typeof u !== 'string' || !VALID_IDENTIFIER_REGEX.test(u)) {
          errors.push(`Invalid shader uniform identifier '${String(u)}'.`);
        } else {
          uniformNames.push(u);
        }
      }
    }
  }

  const attributeNames: string[] = [];
  if (rawMeta.attributeNames !== undefined) {
    if (!Array.isArray(rawMeta.attributeNames)) {
      errors.push('Shader.shaderMetadata.attributeNames must be an array of strings.');
    } else {
      for (const a of rawMeta.attributeNames) {
        if (typeof a !== 'string' || !VALID_IDENTIFIER_REGEX.test(a)) {
          errors.push(`Invalid shader attribute identifier '${String(a)}'.`);
        } else {
          attributeNames.push(a);
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  const typedStage = shaderType as ShaderStageType;
  const shaderId =
    typeof candidate.shaderId === 'string' && candidate.shaderId.trim().length > 0
      ? candidate.shaderId.trim()
      : createDeterministicRenderId(
          'shd',
          `${candidate.shaderAssetId}::${typedStage}`
        );

  const descriptor: ShaderDescriptor = Object.freeze({
    shaderId,
    shaderAssetId: candidate.shaderAssetId as string,
    shaderType: typedStage,
    entryPoint,
    // Compute shader contract is reserved for future backend execution (STEP 15)
    executionSupportedInCurrentPhase: typedStage !== 'compute',
    shaderMetadata: Object.freeze({
      uniformNames: Object.freeze(uniformNames),
      attributeNames: Object.freeze(attributeNames),
      requiresComputeCapability: typedStage === 'compute',
      stageVersion:
        typeof rawMeta.stageVersion === 'string' && rawMeta.stageVersion.trim().length > 0
          ? rawMeta.stageVersion.trim()
          : '1.0.0',
    }),
  });

  return { valid: true, value: descriptor, errors: [] };
}
