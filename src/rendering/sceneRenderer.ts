import {
  HylixAssetRegistry,
  isValidAssetId,
} from '../assets/assetRegistry';
import {
  ComponentRegistry,
  ComponentSpecification,
  ComponentValidationResult,
  HylixEntity,
  TRANSFORM_COMPONENT_TYPE,
  validateTransformComponentData,
} from '../ecs/ecsCore';
import { SceneDefinition } from '../scene/sceneSystem';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  isFiniteNumber,
  isForbiddenRenderInputString,
  isPlainRenderObject,
} from './renderTypes';
import {
  CameraDescriptor,
  CameraProjectionType,
  validateCamera,
} from './camera';
import {
  ColorRGBA,
  createDefaultColorRGBA,
  createDefaultRenderTransform,
  RenderTransform,
  validateColorRGBA,
  validateVector2,
  Vector2,
} from './matrices';
import {
  createDefaultSpriteLayer,
  createDefaultSpriteRegion,
  Renderable3DDescriptor,
  SpriteDescriptor,
  SpriteLayer,
  SpriteRegion,
  validateRenderable3DDescriptor,
  validateSpriteDescriptor,
  validateSpriteLayer,
  validateSpriteRegion,
} from './renderable';
import { RenderItem, RenderQueue } from './renderQueue';

/**
 * Hylix V1.0.0 — Phase 05: Scene / ECS Render Integration & Read-Only Extraction (STEP 19 & STEP 20)
 *
 * Architecture:
 *   ECS / Scene (Read-Only)
 *     -> Scene Render Extraction (`extractSceneRenderData`)
 *     -> RenderQueue (Deterministically Sorted)
 *     -> RenderBackend
 *
 * Strictly guarantees:
 * - ECS never depends directly on GPU APIs.
 * - Scene extraction is 100% read-only (never mutates SceneDefinition or HylixEntity).
 * - Missing or corrupted assets do NOT crash the extraction or engine; they are
 *   logged via `RedactedDiagnosticLogger` and reported in `missingAssetDiagnostics`.
 */

export const SPRITE_2D_COMPONENT_TYPE = 'Sprite2D';
export const MESH_RENDERER_3D_COMPONENT_TYPE = 'MeshRenderer3D';
export const CAMERA_COMPONENT_TYPE = 'Camera';

export interface Sprite2DComponentData {
  readonly textureAssetId: string;
  readonly materialAssetId?: string;
  readonly color: ColorRGBA;
  readonly region: SpriteRegion;
  readonly origin: Vector2;
  readonly layer: SpriteLayer;
}

export interface MeshRenderer3DComponentData {
  readonly meshAssetId: string;
  readonly materialAssetId: string;
  readonly shaderAssetId?: string;
  readonly layer: number;
}

export interface CameraComponentData {
  readonly projection: CameraProjectionType;
  readonly nearPlane: number;
  readonly farPlane: number;
  readonly fieldOfView?: number;
  readonly left?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly top?: number;
  readonly aspectRatio: number;
  readonly isPrimary: boolean;
}

export function createDefaultSprite2DComponentData(): Sprite2DComponentData {
  return Object.freeze({
    textureAssetId: 'asset_0000000000000001',
    color: createDefaultColorRGBA(),
    region: createDefaultSpriteRegion(),
    origin: Object.freeze({ x: 0.5, y: 0.5 }),
    layer: createDefaultSpriteLayer(),
  });
}

export function validateSprite2DComponentData(
  candidate: unknown
): ComponentValidationResult<Sprite2DComponentData> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      data: null,
      errors: ['Sprite2D component must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  for (const forbiddenKey of ['texturePath', 'spritePath', 'filePath', 'path', 'url']) {
    if (forbiddenKey in candidate) {
      errors.push(
        `Forbidden property '${forbiddenKey}' in Sprite2D component; use 'textureAssetId'.`
      );
    }
  }

  if (!isValidAssetId(candidate.textureAssetId)) {
    errors.push(
      `Invalid Sprite2D.textureAssetId '${String(candidate.textureAssetId)}'; expected 'asset_<16-hex>'.`
    );
  }

  let materialAssetId: string | undefined;
  if (candidate.materialAssetId !== undefined) {
    if (!isValidAssetId(candidate.materialAssetId)) {
      errors.push(
        `Invalid Sprite2D.materialAssetId '${String(candidate.materialAssetId)}'.`
      );
    } else {
      materialAssetId = candidate.materialAssetId;
    }
  }

  const colorRes = validateColorRGBA(
    candidate.color ?? createDefaultColorRGBA(),
    'Sprite2D.color'
  );
  const regionRes = validateSpriteRegion(
    candidate.region ?? createDefaultSpriteRegion()
  );
  const originRes = validateVector2(
    candidate.origin ?? { x: 0.5, y: 0.5 },
    'Sprite2D.origin'
  );
  const layerRes = validateSpriteLayer(
    candidate.layer ?? createDefaultSpriteLayer()
  );

  errors.push(
    ...colorRes.errors,
    ...regionRes.errors,
    ...originRes.errors,
    ...layerRes.errors
  );

  if (
    errors.length > 0 ||
    !colorRes.value ||
    !regionRes.value ||
    !originRes.value ||
    !layerRes.value
  ) {
    return { valid: false, data: null, errors };
  }

  return {
    valid: true,
    data: Object.freeze({
      textureAssetId: candidate.textureAssetId as string,
      ...(materialAssetId ? { materialAssetId } : {}),
      color: colorRes.value,
      region: regionRes.value,
      origin: originRes.value,
      layer: layerRes.value,
    }),
    errors: [],
  };
}

export function createDefaultMeshRenderer3DComponentData(): MeshRenderer3DComponentData {
  return Object.freeze({
    meshAssetId: 'asset_0000000000000002',
    materialAssetId: 'asset_0000000000000003',
    layer: 0,
  });
}

export function validateMeshRenderer3DComponentData(
  candidate: unknown
): ComponentValidationResult<MeshRenderer3DComponentData> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      data: null,
      errors: ['MeshRenderer3D component must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  for (const forbiddenKey of [
    'meshPath',
    'materialPath',
    'shaderPath',
    'filePath',
    'path',
    'url',
  ]) {
    if (forbiddenKey in candidate) {
      errors.push(
        `Forbidden property '${forbiddenKey}' in MeshRenderer3D component; use *AssetId.`
      );
    }
  }

  if (!isValidAssetId(candidate.meshAssetId)) {
    errors.push(
      `Invalid MeshRenderer3D.meshAssetId '${String(candidate.meshAssetId)}'; expected 'asset_<16-hex>'.`
    );
  }
  if (!isValidAssetId(candidate.materialAssetId)) {
    errors.push(
      `Invalid MeshRenderer3D.materialAssetId '${String(candidate.materialAssetId)}'; expected 'asset_<16-hex>'.`
    );
  }

  let shaderAssetId: string | undefined;
  if (candidate.shaderAssetId !== undefined) {
    if (!isValidAssetId(candidate.shaderAssetId)) {
      errors.push(
        `Invalid MeshRenderer3D.shaderAssetId '${String(candidate.shaderAssetId)}'.`
      );
    } else {
      shaderAssetId = candidate.shaderAssetId;
    }
  }

  const layer = candidate.layer !== undefined ? candidate.layer : 0;
  if (!isFiniteNumber(layer) || !Number.isInteger(layer)) {
    errors.push('MeshRenderer3D.layer must be a finite integer.');
  }

  if (errors.length > 0) {
    return { valid: false, data: null, errors };
  }

  return {
    valid: true,
    data: Object.freeze({
      meshAssetId: candidate.meshAssetId as string,
      materialAssetId: candidate.materialAssetId as string,
      ...(shaderAssetId ? { shaderAssetId } : {}),
      layer: layer as number,
    }),
    errors: [],
  };
}

export function createDefaultCameraComponentData(): CameraComponentData {
  return Object.freeze({
    projection: 'perspective',
    nearPlane: 0.1,
    farPlane: 1000,
    fieldOfView: 60,
    aspectRatio: 16 / 9,
    isPrimary: true,
  });
}

export function validateCameraComponentData(
  candidate: unknown
): ComponentValidationResult<CameraComponentData> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      data: null,
      errors: ['Camera component must be a non-null object.'],
    };
  }

  const camCheck = validateCamera({
    name: 'EntityCamera',
    projection: candidate.projection ?? 'perspective',
    nearPlane: candidate.nearPlane ?? 0.1,
    farPlane: candidate.farPlane ?? 1000,
    fieldOfView: candidate.fieldOfView ?? 60,
    left: candidate.left ?? -10,
    right: candidate.right ?? 10,
    bottom: candidate.bottom ?? -10,
    top: candidate.top ?? 10,
    aspectRatio: candidate.aspectRatio ?? 16 / 9,
  });

  if (!camCheck.valid || !camCheck.value) {
    return { valid: false, data: null, errors: camCheck.errors };
  }

  const isPrimary =
    candidate.isPrimary !== undefined ? Boolean(candidate.isPrimary) : true;

  if (camCheck.value.projection === 'perspective') {
    return {
      valid: true,
      data: Object.freeze({
        projection: 'perspective',
        nearPlane: camCheck.value.nearPlane,
        farPlane: camCheck.value.farPlane,
        fieldOfView: camCheck.value.fieldOfView,
        aspectRatio: camCheck.value.aspectRatio,
        isPrimary,
      }),
      errors: [],
    };
  }

  return {
    valid: true,
    data: Object.freeze({
      projection: 'orthographic',
      nearPlane: camCheck.value.nearPlane,
      farPlane: camCheck.value.farPlane,
      left: camCheck.value.left,
      right: camCheck.value.right,
      bottom: camCheck.value.bottom,
      top: camCheck.value.top,
      aspectRatio: camCheck.value.aspectRatio,
      isPrimary,
    }),
    errors: [],
  };
}

export const OFFICIAL_SPRITE_2D_SPEC: ComponentSpecification<Sprite2DComponentData> =
  Object.freeze({
    type: SPRITE_2D_COMPONENT_TYPE,
    schemaVersion: 1,
    createDefault: createDefaultSprite2DComponentData,
    validate: validateSprite2DComponentData,
  });

export const OFFICIAL_MESH_RENDERER_3D_SPEC: ComponentSpecification<MeshRenderer3DComponentData> =
  Object.freeze({
    type: MESH_RENDERER_3D_COMPONENT_TYPE,
    schemaVersion: 1,
    createDefault: createDefaultMeshRenderer3DComponentData,
    validate: validateMeshRenderer3DComponentData,
  });

export const OFFICIAL_CAMERA_COMPONENT_SPEC: ComponentSpecification<CameraComponentData> =
  Object.freeze({
    type: CAMERA_COMPONENT_TYPE,
    schemaVersion: 1,
    createDefault: createDefaultCameraComponentData,
    validate: validateCameraComponentData,
  });

/**
 * Registers `Sprite2D`, `MeshRenderer3D`, and `Camera` component specifications
 * into an ECS `ComponentRegistry` without modifying ECS Core internals.
 */
export function registerRenderingEcsComponents(
  registry: ComponentRegistry
): ComponentRegistry {
  if (!registry.isRegistered(SPRITE_2D_COMPONENT_TYPE)) {
    registry.registerComponentType(OFFICIAL_SPRITE_2D_SPEC);
  }
  if (!registry.isRegistered(MESH_RENDERER_3D_COMPONENT_TYPE)) {
    registry.registerComponentType(OFFICIAL_MESH_RENDERER_3D_SPEC);
  }
  if (!registry.isRegistered(CAMERA_COMPONENT_TYPE)) {
    registry.registerComponentType(OFFICIAL_CAMERA_COMPONENT_SPEC);
  }
  return registry;
}

export interface MissingRenderAssetDiagnostic {
  readonly entityId: string;
  readonly entityName: string;
  readonly componentType: string;
  readonly assetId: string;
  readonly reason: string;
}

export interface SceneRenderExtractionResult {
  readonly sceneId: string;
  readonly readOnlyVerified: true;
  readonly extractedCameras: readonly CameraDescriptor[];
  readonly extractedSprites2D: readonly SpriteDescriptor[];
  readonly extractedRenderables3D: readonly Renderable3DDescriptor[];
  readonly sortedRenderQueue: readonly RenderItem[];
  readonly missingAssetDiagnostics: readonly MissingRenderAssetDiagnostic[];
  readonly validationErrors: readonly string[];
}

function extractEntityRenderTransform(entity: HylixEntity): RenderTransform {
  const rawTransform = entity.components[TRANSFORM_COMPONENT_TYPE];
  if (rawTransform) {
    const check = validateTransformComponentData(rawTransform);
    if (check.valid && check.data) {
      return Object.freeze({
        position: Object.freeze({ ...check.data.position }),
        rotation: Object.freeze({ ...check.data.rotation }),
        scale: Object.freeze({ ...check.data.scale }),
      });
    }
  }
  return createDefaultRenderTransform();
}

/**
 * Read-Only Scene Render Extraction Layer (STEP 19 & STEP 20).
 *
 * Reads `SceneDefinition` and optional `HylixAssetRegistry` to extract:
 * - Camera entities
 * - 2D Sprite entities
 * - 3D Renderable entities
 * - Deterministically sorted `RenderQueue` items
 *
 * Never mutates `SceneDefinition` and never crashes on missing/corrupted assets.
 */
export function extractSceneRenderData(
  scene: SceneDefinition,
  options?: {
    readonly assetRegistry?: HylixAssetRegistry;
    readonly logger?: RedactedDiagnosticLogger;
  }
): SceneRenderExtractionResult {
  const logger = options?.logger;
  const assetRegistry = options?.assetRegistry;

  const extractedCameras: CameraDescriptor[] = [];
  const extractedSprites2D: SpriteDescriptor[] = [];
  const extractedRenderables3D: Renderable3DDescriptor[] = [];
  const missingAssetDiagnostics: MissingRenderAssetDiagnostic[] = [];
  const validationErrors: string[] = [];
  const renderQueue = new RenderQueue(logger);

  // Iterate entities in deterministic order without mutating scene.entities
  const entitiesSnapshot = [...scene.entities];

  for (const entity of entitiesSnapshot) {
    if (!entity.enabled) continue;

    const secCheck = isForbiddenRenderInputString(entity.name);
    if (secCheck.forbidden) {
      validationErrors.push(secCheck.reason!);
      logger?.record('rendering', 'ERROR', `render_validation_failed: ${secCheck.reason}`);
      continue;
    }

    const transform = extractEntityRenderTransform(entity);

    // 1. Extract Camera Component if present
    if (CAMERA_COMPONENT_TYPE in entity.components) {
      const rawCam = entity.components[CAMERA_COMPONENT_TYPE];
      const camVal = validateCameraComponentData(rawCam);
      if (!camVal.valid || !camVal.data) {
        const msg = `Entity '${entity.entityId}' has invalid Camera component: ${camVal.errors.join('; ')}`;
        validationErrors.push(msg);
        logger?.record('rendering', 'ERROR', `camera_validation_failed: ${msg}`);
      } else {
        const camDescCheck = validateCamera(
          {
            name: entity.name,
            projection: camVal.data.projection,
            position: transform.position,
            rotation: transform.rotation,
            nearPlane: camVal.data.nearPlane,
            farPlane: camVal.data.farPlane,
            fieldOfView: camVal.data.fieldOfView,
            left: camVal.data.left,
            right: camVal.data.right,
            bottom: camVal.data.bottom,
            top: camVal.data.top,
            aspectRatio: camVal.data.aspectRatio,
          },
          logger
        );
        if (camDescCheck.valid && camDescCheck.value) {
          extractedCameras.push(camDescCheck.value);
        } else {
          validationErrors.push(...camDescCheck.errors);
        }
      }
    }

    // 2. Extract 2D Sprite Component if present
    if (SPRITE_2D_COMPONENT_TYPE in entity.components) {
      const rawSprite = entity.components[SPRITE_2D_COMPONENT_TYPE];
      const sprVal = validateSprite2DComponentData(rawSprite);
      if (!sprVal.valid || !sprVal.data) {
        const msg = `Entity '${entity.entityId}' has invalid Sprite2D component: ${sprVal.errors.join('; ')}`;
        validationErrors.push(msg);
        logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      } else {
        const texId = sprVal.data.textureAssetId;
        let assetAvailable = true;

        if (assetRegistry) {
          const resolved = assetRegistry.resolveAssetReference(texId);
          if (resolved.status !== 'available') {
            assetAvailable = false;
            const reason =
              resolved.reason ??
              `Sprite2D texture asset '${texId}' is ${resolved.status}.`;
            missingAssetDiagnostics.push(
              Object.freeze({
                entityId: entity.entityId,
                entityName: entity.name,
                componentType: SPRITE_2D_COMPONENT_TYPE,
                assetId: texId,
                reason,
              })
            );
            logger?.record(
              'rendering',
              'WARN',
              `render_validation_failed: missing/unavailable 2D texture asset '${texId}' on entity '${entity.entityId}' (${reason})`
            );
          }
        }

        if (assetAvailable) {
          const spriteCheck = validateSpriteDescriptor({
            entityId: entity.entityId,
            textureAssetId: texId,
            materialAssetId: sprVal.data.materialAssetId,
            transform: {
              position: transform.position,
              rotation: transform.rotation.z,
              scale: { x: transform.scale.x, y: transform.scale.y },
              origin: sprVal.data.origin,
            },
            region: sprVal.data.region,
            color: sprVal.data.color,
            layer: sprVal.data.layer,
          });

          if (spriteCheck.valid && spriteCheck.value) {
            extractedSprites2D.push(spriteCheck.value);
            renderQueue.enqueue({
              dimension: '2D',
              entityId: entity.entityId,
              transform,
              textureAssetId: texId,
              materialAssetId: sprVal.data.materialAssetId,
              layer: sprVal.data.layer.sortingLayer,
              orderInLayer: sprVal.data.layer.orderInLayer,
              depth: sprVal.data.layer.depth,
            });
          } else {
            validationErrors.push(...spriteCheck.errors);
          }
        }
      }
    }

    // 3. Extract 3D MeshRenderer Component if present
    if (MESH_RENDERER_3D_COMPONENT_TYPE in entity.components) {
      const rawMeshRenderer = entity.components[MESH_RENDERER_3D_COMPONENT_TYPE];
      const mrVal = validateMeshRenderer3DComponentData(rawMeshRenderer);
      if (!mrVal.valid || !mrVal.data) {
        const msg = `Entity '${entity.entityId}' has invalid MeshRenderer3D component: ${mrVal.errors.join('; ')}`;
        validationErrors.push(msg);
        logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      } else {
        const { meshAssetId, materialAssetId, shaderAssetId, layer } = mrVal.data;
        let assetsAvailable = true;

        if (assetRegistry) {
          const requiredIds = [meshAssetId, materialAssetId];
          if (shaderAssetId) requiredIds.push(shaderAssetId);

          for (const reqAssetId of requiredIds) {
            const resolved = assetRegistry.resolveAssetReference(reqAssetId);
            if (resolved.status !== 'available') {
              assetsAvailable = false;
              const reason =
                resolved.reason ??
                `3D render asset '${reqAssetId}' is ${resolved.status}.`;
              missingAssetDiagnostics.push(
                Object.freeze({
                  entityId: entity.entityId,
                  entityName: entity.name,
                  componentType: MESH_RENDERER_3D_COMPONENT_TYPE,
                  assetId: reqAssetId,
                  reason,
                })
              );
              logger?.record(
                'rendering',
                'WARN',
                `render_validation_failed: missing/unavailable 3D asset '${reqAssetId}' on entity '${entity.entityId}' (${reason})`
              );
            }
          }
        }

        if (assetsAvailable) {
          const rend3DCheck = validateRenderable3DDescriptor({
            entityId: entity.entityId,
            meshAssetId,
            materialAssetId,
            shaderAssetId,
            transform,
            layer,
            depth: transform.position.z,
          });

          if (rend3DCheck.valid && rend3DCheck.value) {
            extractedRenderables3D.push(rend3DCheck.value);
            renderQueue.enqueue({
              dimension: '3D',
              entityId: entity.entityId,
              transform,
              meshAssetId,
              materialAssetId,
              shaderAssetId,
              layer,
              orderInLayer: 0,
              depth: transform.position.z,
            });
          } else {
            validationErrors.push(...rend3DCheck.errors);
          }
        }
      }
    }
  }

  const sortedRenderQueue = renderQueue.buildSortedQueue();

  return Object.freeze({
    sceneId: scene.sceneId,
    readOnlyVerified: true,
    extractedCameras: Object.freeze(extractedCameras),
    extractedSprites2D: Object.freeze(extractedSprites2D),
    extractedRenderables3D: Object.freeze(extractedRenderables3D),
    sortedRenderQueue,
    missingAssetDiagnostics: Object.freeze(missingAssetDiagnostics),
    validationErrors: Object.freeze(validationErrors),
  });
}
