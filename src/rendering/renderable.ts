import { isValidAssetId } from '../assets/assetRegistry';
import { isValidEntityId } from '../ecs/ecsCore';
import {
  createDeterministicRenderId,
  isFiniteNumber,
  isForbiddenRenderInputString,
  isPlainRenderObject,
  RenderValidationResult,
} from './renderTypes';
import {
  ColorRGBA,
  createDefaultColorRGBA,
  createDefaultRenderTransform,
  createDefaultVector2,
  createDefaultVector3,
  RenderTransform,
  validateColorRGBA,
  validateRenderTransform,
  validateVector2,
  validateVector3,
  Vector2,
  Vector3,
} from './matrices';

/**
 * Hylix V1.0.0 — Phase 05: 2D Sprite & 3D Renderable Contracts (STEP 11 & STEP 12)
 *
 * Strictly enforces:
 * - Sprite and Renderable reference assets by `AssetId` (`textureAssetId`, `meshAssetId`, `materialAssetId`).
 * - Raw paths (`texturePath`, `/sdcard/...`, `C:\...`, `http://...`) are strictly rejected.
 */

export interface SpriteTransform {
  readonly position: Vector3;
  readonly rotation: number;
  readonly scale: Vector2;
  readonly origin: Vector2;
}

export interface SpriteRegion {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export type SpriteColor = ColorRGBA;

export interface SpriteLayer {
  readonly layerName: string;
  readonly sortingLayer: number;
  readonly orderInLayer: number;
  readonly depth: number;
}

export interface SpriteDescriptor {
  readonly spriteId: string;
  readonly entityId: string;
  readonly textureAssetId: string;
  readonly materialAssetId?: string;
  readonly transform: SpriteTransform;
  readonly region: SpriteRegion;
  readonly color: SpriteColor;
  readonly layer: SpriteLayer;
}

export interface Renderable3DDescriptor {
  readonly renderableId: string;
  readonly entityId: string;
  readonly meshAssetId: string;
  readonly materialAssetId: string;
  readonly shaderAssetId?: string;
  readonly transform: RenderTransform;
  readonly layer: number;
  readonly depth: number;
}

export function createDefaultSpriteTransform(): SpriteTransform {
  return Object.freeze({
    position: createDefaultVector3(),
    rotation: 0,
    scale: Object.freeze({ x: 1, y: 1 }),
    origin: Object.freeze({ x: 0.5, y: 0.5 }),
  });
}

export function createDefaultSpriteRegion(): SpriteRegion {
  return Object.freeze({
    u0: 0,
    v0: 0,
    u1: 1,
    v1: 1,
  });
}

export function createDefaultSpriteLayer(): SpriteLayer {
  return Object.freeze({
    layerName: 'Default',
    sortingLayer: 0,
    orderInLayer: 0,
    depth: 0,
  });
}

export function validateSpriteTransform(
  candidate: unknown
): RenderValidationResult<SpriteTransform> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['SpriteTransform must be a non-null object.'],
    };
  }

  const errors: string[] = [];
  const posCheck = validateVector3(
    candidate.position ?? createDefaultVector3(),
    'SpriteTransform.position'
  );
  errors.push(...posCheck.errors);

  const rotation = candidate.rotation !== undefined ? candidate.rotation : 0;
  if (!isFiniteNumber(rotation)) {
    errors.push('SpriteTransform.rotation must be a finite number.');
  }

  const scaleCheck = validateVector2(
    candidate.scale ?? { x: 1, y: 1 },
    'SpriteTransform.scale'
  );
  errors.push(...scaleCheck.errors);

  const rawOrigin = candidate.origin ?? candidate.pivot ?? { x: 0.5, y: 0.5 };
  const originCheck = validateVector2(rawOrigin, 'SpriteTransform.origin');
  errors.push(...originCheck.errors);

  if (
    errors.length > 0 ||
    !posCheck.value ||
    !scaleCheck.value ||
    !originCheck.value
  ) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      position: posCheck.value,
      rotation: rotation as number,
      scale: scaleCheck.value,
      origin: originCheck.value,
    }),
    errors: [],
  };
}

export function validateSpriteRegion(
  candidate: unknown
): RenderValidationResult<SpriteRegion> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['SpriteRegion must be a non-null object with finite u0, v0, u1, v1.'],
    };
  }

  const errors: string[] = [];
  const { u0, v0, u1, v1 } = candidate;
  if (!isFiniteNumber(u0) || !isFiniteNumber(v0) || !isFiniteNumber(u1) || !isFiniteNumber(v1)) {
    errors.push('SpriteRegion u0, v0, u1, v1 must be finite numbers.');
  } else if (u0 >= u1 || v0 >= v1) {
    errors.push('SpriteRegion must satisfy u0 < u1 and v0 < v1.');
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      u0: u0 as number,
      v0: v0 as number,
      u1: u1 as number,
      v1: v1 as number,
    }),
    errors: [],
  };
}

export function validateSpriteLayer(
  candidate: unknown
): RenderValidationResult<SpriteLayer> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['SpriteLayer must be a non-null object.'],
    };
  }

  const errors: string[] = [];
  const layerName =
    typeof candidate.layerName === 'string' && candidate.layerName.trim().length > 0
      ? candidate.layerName.trim()
      : 'Default';

  const secCheck = isForbiddenRenderInputString(layerName);
  if (secCheck.forbidden) {
    errors.push(secCheck.reason!);
  }

  const sortingLayer =
    candidate.sortingLayer !== undefined ? candidate.sortingLayer : 0;
  const orderInLayer =
    candidate.orderInLayer !== undefined ? candidate.orderInLayer : 0;
  const depth = candidate.depth !== undefined ? candidate.depth : 0;

  if (!isFiniteNumber(sortingLayer) || !Number.isInteger(sortingLayer)) {
    errors.push('SpriteLayer.sortingLayer must be a finite integer.');
  }
  if (!isFiniteNumber(orderInLayer) || !Number.isInteger(orderInLayer)) {
    errors.push('SpriteLayer.orderInLayer must be a finite integer.');
  }
  if (!isFiniteNumber(depth)) {
    errors.push('SpriteLayer.depth must be a finite number.');
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      layerName,
      sortingLayer: sortingLayer as number,
      orderInLayer: orderInLayer as number,
      depth: depth as number,
    }),
    errors: [],
  };
}

export function validateSpriteDescriptor(
  candidate: unknown
): RenderValidationResult<SpriteDescriptor> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['Sprite descriptor must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  // Block any raw texture path or URL
  for (const forbiddenKey of [
    'texturePath',
    'spritePath',
    'filePath',
    'path',
    'imageUrl',
    'url',
  ]) {
    if (forbiddenKey in candidate) {
      errors.push(
        `Forbidden property '${forbiddenKey}' in SpriteDescriptor: raw filesystem paths and URLs are prohibited; use 'textureAssetId'.`
      );
    }
  }

  const entityId =
    candidate.entityId !== undefined
      ? candidate.entityId
      : 'ent_0000000000000001';
  if (!isValidEntityId(entityId)) {
    errors.push(`Invalid Sprite.entityId '${String(entityId)}'.`);
  }

  if (!isValidAssetId(candidate.textureAssetId)) {
    errors.push(
      `Invalid Sprite.textureAssetId '${String(candidate.textureAssetId)}'; expected deterministic 'asset_<16-hex>'.`
    );
  }

  let materialAssetId: string | undefined;
  if (candidate.materialAssetId !== undefined) {
    if (!isValidAssetId(candidate.materialAssetId)) {
      errors.push(
        `Invalid Sprite.materialAssetId '${String(candidate.materialAssetId)}'.`
      );
    } else {
      materialAssetId = candidate.materialAssetId;
    }
  }

  const transformCheck = validateSpriteTransform(
    candidate.transform ?? createDefaultSpriteTransform()
  );
  const regionCheck = validateSpriteRegion(
    candidate.region ?? createDefaultSpriteRegion()
  );
  const colorCheck = validateColorRGBA(
    candidate.color ?? createDefaultColorRGBA(),
    'Sprite.color'
  );
  const layerCheck = validateSpriteLayer(
    candidate.layer ?? createDefaultSpriteLayer()
  );

  errors.push(
    ...transformCheck.errors,
    ...regionCheck.errors,
    ...colorCheck.errors,
    ...layerCheck.errors
  );

  if (
    errors.length > 0 ||
    !transformCheck.value ||
    !regionCheck.value ||
    !colorCheck.value ||
    !layerCheck.value
  ) {
    return { valid: false, value: null, errors };
  }

  const spriteId =
    typeof candidate.spriteId === 'string' && candidate.spriteId.trim().length > 0
      ? candidate.spriteId.trim()
      : createDeterministicRenderId(
          'spr',
          `${entityId}::${candidate.textureAssetId}`
        );

  const sprite: SpriteDescriptor = Object.freeze({
    spriteId,
    entityId: entityId as string,
    textureAssetId: candidate.textureAssetId as string,
    ...(materialAssetId ? { materialAssetId } : {}),
    transform: transformCheck.value,
    region: regionCheck.value,
    color: colorCheck.value,
    layer: layerCheck.value,
  });

  return { valid: true, value: sprite, errors: [] };
}

export function validateRenderable3DDescriptor(
  candidate: unknown
): RenderValidationResult<Renderable3DDescriptor> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['Renderable3D descriptor must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  for (const forbiddenKey of [
    'meshPath',
    'materialPath',
    'shaderPath',
    'texturePath',
    'filePath',
    'path',
    'url',
  ]) {
    if (forbiddenKey in candidate) {
      errors.push(
        `Forbidden property '${forbiddenKey}' in Renderable3DDescriptor: raw filesystem paths and URLs are prohibited; use *AssetId.`
      );
    }
  }

  if (!isValidEntityId(candidate.entityId)) {
    errors.push(
      `Invalid Renderable3D.entityId '${String(candidate.entityId)}'; expected 'ent_<16-hex>'.`
    );
  }

  if (!isValidAssetId(candidate.meshAssetId)) {
    errors.push(
      `Invalid Renderable3D.meshAssetId '${String(candidate.meshAssetId)}'; expected 'asset_<16-hex>'.`
    );
  }

  if (!isValidAssetId(candidate.materialAssetId)) {
    errors.push(
      `Invalid Renderable3D.materialAssetId '${String(candidate.materialAssetId)}'; expected 'asset_<16-hex>'.`
    );
  }

  let shaderAssetId: string | undefined;
  if (candidate.shaderAssetId !== undefined) {
    if (!isValidAssetId(candidate.shaderAssetId)) {
      errors.push(
        `Invalid Renderable3D.shaderAssetId '${String(candidate.shaderAssetId)}'.`
      );
    } else {
      shaderAssetId = candidate.shaderAssetId;
    }
  }

  const transformCheck = validateRenderTransform(
    candidate.transform ?? createDefaultRenderTransform(),
    'Renderable3D.transform'
  );
  errors.push(...transformCheck.errors);

  const layer = candidate.layer !== undefined ? candidate.layer : 0;
  const depth =
    candidate.depth !== undefined
      ? candidate.depth
      : transformCheck.value?.position.z ?? 0;

  if (!isFiniteNumber(layer) || !Number.isInteger(layer)) {
    errors.push('Renderable3D.layer must be a finite integer.');
  }
  if (!isFiniteNumber(depth)) {
    errors.push('Renderable3D.depth must be a finite number.');
  }

  if (errors.length > 0 || !transformCheck.value) {
    return { valid: false, value: null, errors };
  }

  const renderableId =
    typeof candidate.renderableId === 'string' &&
    candidate.renderableId.trim().length > 0
      ? candidate.renderableId.trim()
      : createDeterministicRenderId(
          'rnd3d',
          `${candidate.entityId}::${candidate.meshAssetId}`
        );

  return {
    valid: true,
    value: Object.freeze({
      renderableId,
      entityId: candidate.entityId as string,
      meshAssetId: candidate.meshAssetId as string,
      materialAssetId: candidate.materialAssetId as string,
      ...(shaderAssetId ? { shaderAssetId } : {}),
      transform: transformCheck.value,
      layer: layer as number,
      depth: depth as number,
    }),
    errors: [],
  };
}
