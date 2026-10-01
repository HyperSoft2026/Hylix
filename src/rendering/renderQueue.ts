import { isValidAssetId } from '../assets/assetRegistry';
import { isValidEntityId } from '../ecs/ecsCore';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  createDeterministicRenderId,
  isFiniteNumber,
  isForbiddenRenderInputString,
  isPlainRenderObject,
  RenderValidationResult,
} from './renderTypes';
import {
  createDefaultRenderTransform,
  createModelMatrix4,
  Matrix4,
  RenderTransform,
  validateRenderTransform,
} from './matrices';

/**
 * Hylix V1.0.0 — Phase 05: RenderQueue & Deterministic Render Sorting (STEP 17 & STEP 18)
 *
 * Accepts validated `RenderItem` descriptors (2D & 3D) with zero filesystem path leakage
 * and sorts them with 100% deterministic ordering (never relying on randomness, memory addresses,
 * or unstable iteration).
 */

export interface RenderItem {
  readonly itemId: string;
  readonly dimension: '2D' | '3D';
  readonly entityId: string;
  readonly transform: RenderTransform;
  readonly modelMatrix: Matrix4;
  readonly meshAssetId?: string;
  readonly textureAssetId?: string;
  readonly materialAssetId?: string;
  readonly shaderAssetId?: string;
  readonly layer: number;
  readonly orderInLayer: number;
  readonly depth: number;
  readonly sortKey: string;
}

function padSignedIntForSort(val: number): string {
  const clamped = Math.max(-999999, Math.min(999999, Math.trunc(val)));
  const shifted = clamped + 1000000;
  return String(shifted).padStart(7, '0');
}

function padDepthForSort(depth: number): string {
  const scaled = Math.trunc((depth + 100000) * 1000);
  const clamped = Math.max(0, Math.min(999999999, scaled));
  return String(clamped).padStart(9, '0');
}

/**
 * Computes a deterministic string sort key for a RenderItem.
 */
export function computeDeterministicRenderSortKey(item: {
  readonly dimension: '2D' | '3D';
  readonly entityId: string;
  readonly layer: number;
  readonly orderInLayer: number;
  readonly depth: number;
  readonly shaderAssetId?: string;
  readonly materialAssetId?: string;
  readonly meshAssetId?: string;
  readonly textureAssetId?: string;
}): string {
  if (item.dimension === '2D') {
    return [
      '2D',
      padSignedIntForSort(item.layer),
      padSignedIntForSort(item.orderInLayer),
      padDepthForSort(item.depth),
      item.textureAssetId ?? 'none',
      item.entityId,
    ].join('|');
  }

  return [
    '3D',
    padSignedIntForSort(item.layer),
    item.shaderAssetId ?? 'shd_default',
    item.materialAssetId ?? 'mat_default',
    item.meshAssetId ?? 'mesh_default',
    padDepthForSort(item.depth),
    item.entityId,
  ].join('|');
}

export function validateRenderItem(
  candidate: unknown
): RenderValidationResult<RenderItem> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['RenderItem must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  // Strictly forbid any filesystem path or URL inside RenderQueue items (STEP 17)
  const forbiddenKeys = [
    'path',
    'filePath',
    'texturePath',
    'meshPath',
    'materialPath',
    'shaderPath',
    'sourcePath',
    'url',
  ];
  for (const key of forbiddenKeys) {
    if (key in candidate) {
      errors.push(
        `Forbidden property '${key}' in RenderItem: filesystem paths and URLs are prohibited in RenderQueue.`
      );
    }
  }

  // Also check all string values for forbidden path/URL patterns
  for (const [k, v] of Object.entries(candidate)) {
    if (typeof v === 'string') {
      const check = isForbiddenRenderInputString(v);
      if (check.forbidden) {
        errors.push(`RenderItem.${k}: ${check.reason}`);
      }
    }
  }

  const dimension = candidate.dimension === '2D' ? '2D' : candidate.dimension === '3D' ? '3D' : null;
  if (!dimension) {
    errors.push("RenderItem.dimension must be '2D' or '3D'.");
  }

  if (!isValidEntityId(candidate.entityId)) {
    errors.push(
      `Invalid RenderItem.entityId '${String(candidate.entityId)}'; expected 'ent_<16-hex>'.`
    );
  }

  const transformCheck = validateRenderTransform(
    candidate.transform ?? createDefaultRenderTransform(),
    'RenderItem.transform'
  );
  errors.push(...transformCheck.errors);

  let meshAssetId: string | undefined;
  if (candidate.meshAssetId !== undefined) {
    if (!isValidAssetId(candidate.meshAssetId)) {
      errors.push(`Invalid RenderItem.meshAssetId '${String(candidate.meshAssetId)}'.`);
    } else {
      meshAssetId = candidate.meshAssetId;
    }
  }

  let textureAssetId: string | undefined;
  if (candidate.textureAssetId !== undefined) {
    if (!isValidAssetId(candidate.textureAssetId)) {
      errors.push(
        `Invalid RenderItem.textureAssetId '${String(candidate.textureAssetId)}'.`
      );
    } else {
      textureAssetId = candidate.textureAssetId;
    }
  }

  let materialAssetId: string | undefined;
  if (candidate.materialAssetId !== undefined) {
    if (!isValidAssetId(candidate.materialAssetId)) {
      errors.push(
        `Invalid RenderItem.materialAssetId '${String(candidate.materialAssetId)}'.`
      );
    } else {
      materialAssetId = candidate.materialAssetId;
    }
  }

  let shaderAssetId: string | undefined;
  if (candidate.shaderAssetId !== undefined) {
    if (!isValidAssetId(candidate.shaderAssetId)) {
      errors.push(`Invalid RenderItem.shaderAssetId '${String(candidate.shaderAssetId)}'.`);
    } else {
      shaderAssetId = candidate.shaderAssetId;
    }
  }

  if (dimension === '2D' && !textureAssetId) {
    errors.push('2D RenderItem must specify a valid textureAssetId.');
  }

  if (dimension === '3D' && (!meshAssetId || !materialAssetId)) {
    errors.push('3D RenderItem must specify valid meshAssetId and materialAssetId.');
  }

  const layer = candidate.layer !== undefined ? candidate.layer : 0;
  const orderInLayer =
    candidate.orderInLayer !== undefined ? candidate.orderInLayer : 0;
  const depth =
    candidate.depth !== undefined
      ? candidate.depth
      : transformCheck.value?.position.z ?? 0;

  if (!isFiniteNumber(layer) || !Number.isInteger(layer)) {
    errors.push('RenderItem.layer must be a finite integer.');
  }
  if (!isFiniteNumber(orderInLayer) || !Number.isInteger(orderInLayer)) {
    errors.push('RenderItem.orderInLayer must be a finite integer.');
  }
  if (!isFiniteNumber(depth)) {
    errors.push('RenderItem.depth must be a finite number.');
  }

  if (errors.length > 0 || !dimension || !transformCheck.value) {
    return { valid: false, value: null, errors };
  }

  const entityId = candidate.entityId as string;
  const sortKey = computeDeterministicRenderSortKey({
    dimension,
    entityId,
    layer: layer as number,
    orderInLayer: orderInLayer as number,
    depth: depth as number,
    shaderAssetId,
    materialAssetId,
    meshAssetId,
    textureAssetId,
  });

  const itemId =
    typeof candidate.itemId === 'string' && candidate.itemId.trim().length > 0
      ? candidate.itemId.trim()
      : createDeterministicRenderId('ritem', `${entityId}::${sortKey}`);

  const item: RenderItem = Object.freeze({
    itemId,
    dimension,
    entityId,
    transform: transformCheck.value,
    modelMatrix: createModelMatrix4(transformCheck.value),
    ...(meshAssetId ? { meshAssetId } : {}),
    ...(textureAssetId ? { textureAssetId } : {}),
    ...(materialAssetId ? { materialAssetId } : {}),
    ...(shaderAssetId ? { shaderAssetId } : {}),
    layer: layer as number,
    orderInLayer: orderInLayer as number,
    depth: depth as number,
    sortKey,
  });

  return { valid: true, value: item, errors: [] };
}

/**
 * Deterministic comparator for RenderItems (STEP 18).
 *
 * - 3D items are ordered by: layer -> shaderAssetId -> materialAssetId -> meshAssetId -> depth -> entityId
 * - 2D items are ordered by: layer -> orderInLayer -> depth -> textureAssetId -> entityId
 */
export function compareRenderItemsDeterministically(
  a: RenderItem,
  b: RenderItem
): number {
  if (a.dimension !== b.dimension) {
    // Render 3D scene pass first, then 2D overlay/sprite pass
    return a.dimension === '3D' ? -1 : 1;
  }

  if (a.layer !== b.layer) {
    return a.layer - b.layer;
  }

  if (a.dimension === '2D' && b.dimension === '2D') {
    if (a.orderInLayer !== b.orderInLayer) {
      return a.orderInLayer - b.orderInLayer;
    }
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    const texA = a.textureAssetId ?? '';
    const texB = b.textureAssetId ?? '';
    if (texA !== texB) {
      return texA.localeCompare(texB);
    }
    return a.entityId.localeCompare(b.entityId);
  }

  // 3D deterministic sorting: material / shader / mesh / depth / stable entityId
  const shdA = a.shaderAssetId ?? '';
  const shdB = b.shaderAssetId ?? '';
  if (shdA !== shdB) {
    return shdA.localeCompare(shdB);
  }

  const matA = a.materialAssetId ?? '';
  const matB = b.materialAssetId ?? '';
  if (matA !== matB) {
    return matA.localeCompare(matB);
  }

  const meshA = a.meshAssetId ?? '';
  const meshB = b.meshAssetId ?? '';
  if (meshA !== meshB) {
    return meshA.localeCompare(meshB);
  }

  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }

  return a.entityId.localeCompare(b.entityId);
}

export class RenderQueue {
  private readonly items: RenderItem[] = [];
  private readonly logger?: RedactedDiagnosticLogger;

  constructor(logger?: RedactedDiagnosticLogger) {
    this.logger = logger;
  }

  public enqueue(candidate: unknown): RenderValidationResult<RenderItem> {
    const val = validateRenderItem(candidate);
    if (!val.valid || !val.value) {
      this.logger?.record(
        'rendering',
        'ERROR',
        `render_validation_failed: RenderQueue rejected item (${val.errors.join('; ')})`
      );
      return val;
    }

    this.items.push(val.value);
    return val;
  }

  public clear(): void {
    this.items.length = 0;
  }

  public size(): number {
    return this.items.length;
  }

  /**
   * Returns a deterministically sorted, immutable snapshot of all queued RenderItems
   * and logs `render_queue_built`.
   */
  public buildSortedQueue(): readonly RenderItem[] {
    const sorted = [...this.items].sort(compareRenderItemsDeterministically);
    this.logger?.record(
      'rendering',
      'INFO',
      `render_queue_built: totalItems=${sorted.length}`
    );
    return Object.freeze(sorted);
  }

  public getItems2D(): readonly RenderItem[] {
    return this.buildSortedQueue().filter((i) => i.dimension === '2D');
  }

  public getItems3D(): readonly RenderItem[] {
    return this.buildSortedQueue().filter((i) => i.dimension === '3D');
  }
}
