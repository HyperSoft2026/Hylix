import {
  computeDeterministicChecksum,
  LocalFirstAtomicStore,
} from '../storage/atomicStorage';
import {
  validateProjectScopedPath,
  validateWorkspaceRelativePath,
} from '../security/securityFoundation';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  computeAssetContentHash,
  isValidContentHash,
} from './contentHash';

/**
 * Hylix V1.0.0 — Central Asset Registry & Metadata Management (`src/assets/assetRegistry.ts`)
 *
 * Implements:
 * - Path-independent, deterministic Asset Identity (`asset_<16-hex>` and legacy `ast_<16-hex>`)
 * - 13 Canonical Asset Types (`texture`, `sprite`, `model`, `material`, `shader`, `audio`,
 *   `font`, `animation`, `scene`, `prefab`, `script`, `data`, `unknown`) + Phase-2 aliases
 * - SHA-256 Content Hashing (`sha256:<64-hex>`) for change, corruption, and duplicate detection
 * - Dependency tracking & Circular Dependency (`A -> B -> C -> A`) detection
 * - Missing & Corrupted Asset state detection without deleting user files
 * - Atomic persistence to `<projectRoot>/.hylix/asset-registry.hylix.json` via `LocalFirstAtomicStore`
 */

export type CanonicalAssetType =
  | 'texture'
  | 'sprite'
  | 'model'
  | 'material'
  | 'shader'
  | 'audio'
  | 'font'
  | 'animation'
  | 'scene'
  | 'prefab'
  | 'script'
  | 'data'
  | 'unknown';

export type LegacyAssetType =
  | 'Texture'
  | 'Sprite'
  | 'Model'
  | 'Audio'
  | 'Font'
  | 'Material'
  | 'Shader'
  | 'Script'
  | 'Scene';

export type AssetType = CanonicalAssetType | LegacyAssetType;

export type AssetImportState =
  | 'not_imported'
  | 'verified'
  | 'pending_import'
  | 'corrupted'
  | 'missing_source';

export type AssetLifecycleState =
  | 'discovered'
  | 'registered'
  | 'validated'
  | 'available'
  | 'loaded'
  | 'referenced'
  | 'released'
  | 'unloaded'
  | 'invalid'
  | 'missing'
  | 'corrupted'
  | 'failed';

export const CANONICAL_ASSET_TYPES: ReadonlySet<CanonicalAssetType> =
  new Set<CanonicalAssetType>([
    'texture',
    'sprite',
    'model',
    'material',
    'shader',
    'audio',
    'font',
    'animation',
    'scene',
    'prefab',
    'script',
    'data',
    'unknown',
  ]);

export const SUPPORTED_ASSET_TYPES: ReadonlySet<AssetType> = new Set<AssetType>([
  ...Array.from(CANONICAL_ASSET_TYPES),
  'Texture',
  'Sprite',
  'Model',
  'Audio',
  'Font',
  'Material',
  'Shader',
  'Script',
  'Scene',
]);

export function normalizeAssetType(candidate: unknown): CanonicalAssetType | null {
  if (typeof candidate !== 'string') return null;
  const lower = candidate.trim().toLowerCase() as CanonicalAssetType;
  if (CANONICAL_ASSET_TYPES.has(lower)) {
    return lower;
  }
  return null;
}

function toLegacyPascalAssetType(type: CanonicalAssetType): AssetType {
  switch (type) {
    case 'texture':
      return 'Texture';
    case 'sprite':
      return 'Sprite';
    case 'model':
      return 'Model';
    case 'audio':
      return 'Audio';
    case 'font':
      return 'Font';
    case 'material':
      return 'Material';
    case 'shader':
      return 'Shader';
    case 'script':
      return 'Script';
    case 'scene':
      return 'Scene';
    default:
      return type;
  }
}

export interface AssetMetadataRecord {
  readonly assetId: string;
  readonly type: CanonicalAssetType;
  readonly path: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly contentHash: string;
  readonly schemaVersion: 1;
  readonly importState: AssetImportState;
  readonly dependencies: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly dirty?: boolean;
  readonly lifecycleState?: AssetLifecycleState;
  // Phase-2 backward-compatible properties
  readonly size?: number;
  readonly checksum?: string;
}

export interface AssetRegistryEntry {
  readonly assetId: string;
  readonly path: string;
  readonly type: AssetType;
  readonly size: number;
  readonly checksum: string;
  readonly importState: AssetImportState;
  readonly name?: string;
  readonly sizeBytes?: number;
  readonly contentHash?: string;
  readonly schemaVersion?: 1;
  readonly dependencies?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly dirty?: boolean;
  readonly lifecycleState?: AssetLifecycleState;
}

export interface AssetRegistryDocument {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly updatedAtIso: string;
  readonly assets?: readonly AssetMetadataRecord[];
  readonly entries: readonly AssetRegistryEntry[];
}

const VALID_ASSET_ID_REGEX = /^(asset|ast)_[a-f0-9]{16}$/i;
const NETWORK_OR_URI_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

let assetCreationCounter = 0;

/**
 * Generates a path-independent deterministic `asset_<16-hex>` identifier.
 */
export function createAssetId(seedHint?: string): string {
  assetCreationCounter += 1;
  const seed = seedHint ?? `hylix_asset_seed::${assetCreationCounter}`;
  const hex = computeDeterministicChecksum(`hylix_asset_id::${seed}`);
  return `asset_${hex}`;
}

/**
 * Phase-2 compatible deterministic asset ID generator.
 */
export function createDeterministicAssetId(
  projectId: string,
  projectRelativePath: string
): string {
  const pathCheck = validateWorkspaceRelativePath(projectRelativePath);
  const cleanPath = pathCheck.safe ? pathCheck.normalizedPath : projectRelativePath;
  const digest = computeDeterministicChecksum(`${projectId}::asset::${cleanPath}`);
  return `ast_${digest}`;
}

export function isValidAssetId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && VALID_ASSET_ID_REGEX.test(candidate);
}

/**
 * Validates that an asset path is strictly project-relative, local-only,
 * and outside disposable `cache/` or `build/` directories.
 */
export function validateSafeAssetPath(candidatePath: unknown): {
  safe: boolean;
  normalizedPath: string;
  fileName: string;
  reason?: string;
} {
  if (typeof candidatePath !== 'string') {
    return {
      safe: false,
      normalizedPath: '',
      fileName: '',
      reason: 'Asset path must be a string.',
    };
  }

  const trimmed = candidatePath.trim();
  if (NETWORK_OR_URI_SCHEME_REGEX.test(trimmed)) {
    return {
      safe: false,
      normalizedPath: '',
      fileName: '',
      reason: `Remote URLs and URI schemes are forbidden in local-first Asset System ('${trimmed}').`,
    };
  }

  const wsCheck = validateWorkspaceRelativePath(trimmed);
  if (!wsCheck.safe) {
    return {
      safe: false,
      normalizedPath: '',
      fileName: '',
      reason: wsCheck.reason,
    };
  }

  const normalized = wsCheck.normalizedPath;
  if (
    normalized === 'cache' ||
    normalized.startsWith('cache/') ||
    normalized === 'build' ||
    normalized.startsWith('build/') ||
    normalized === '.hylix' ||
    normalized.startsWith('.hylix/')
  ) {
    return {
      safe: false,
      normalizedPath: normalized,
      fileName: '',
      reason: `Asset path '${normalized}' cannot reside inside disposable 'cache/', 'build/', or internal '.hylix/' directories.`,
    };
  }

  const segments = normalized.split('/');
  const fileName = segments[segments.length - 1] || '';

  return {
    safe: true,
    normalizedPath: normalized,
    fileName,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ALLOWED_ASSET_ENTRY_KEYS = new Set([
  'assetId',
  'type',
  'path',
  'name',
  'size',
  'sizeBytes',
  'checksum',
  'contentHash',
  'schemaVersion',
  'importState',
  'dependencies',
  'metadata',
  'dirty',
  'lifecycleState',
]);

const VALID_IMPORT_STATES: ReadonlySet<AssetImportState> = new Set<AssetImportState>([
  'not_imported',
  'verified',
  'pending_import',
  'corrupted',
  'missing_source',
]);

const VALID_LIFECYCLE_STATES: ReadonlySet<AssetLifecycleState> =
  new Set<AssetLifecycleState>([
    'discovered',
    'registered',
    'validated',
    'available',
    'loaded',
    'referenced',
    'released',
    'unloaded',
    'invalid',
    'missing',
    'corrupted',
    'failed',
  ]);

/**
 * Validates an AssetMetadataRecord or Phase-2 AssetRegistryEntry.
 */
export function validateAssetRegistryEntry(
  candidate: unknown
): {
  valid: boolean;
  normalized: AssetMetadataRecord | null;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isPlainObject(candidate)) {
    return {
      valid: false,
      normalized: null,
      errors: ['Asset entry must be a JSON object.'],
    };
  }

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_ASSET_ENTRY_KEYS.has(key)) {
      errors.push(`Unexpected property '${key}' in AssetRegistryEntry.`);
    }
  }

  if (!isValidAssetId(candidate.assetId)) {
    errors.push(
      'Invalid assetId format; expected deterministic asset_<16-hex-chars> or ast_<16-hex-chars>.'
    );
  }

  const pathCheck = validateSafeAssetPath(candidate.path);
  if (!pathCheck.safe) {
    errors.push(`Unsafe asset path '${String(candidate.path)}': ${pathCheck.reason}`);
  }

  const normalizedType = normalizeAssetType(candidate.type);
  if (!normalizedType) {
    errors.push(`Unsupported asset type '${String(candidate.type)}'.`);
  }

  const rawSize =
    candidate.sizeBytes !== undefined ? candidate.sizeBytes : candidate.size;
  if (typeof rawSize !== 'number' || !Number.isInteger(rawSize) || rawSize < 0) {
    errors.push('Asset sizeBytes/size must be a non-negative integer byte count.');
  }

  // Validate contentHash (sha256:...) or Phase-2 checksum (16-hex)
  let resolvedContentHash = '';
  let resolvedChecksum = '';

  if (candidate.contentHash !== undefined) {
    if (!isValidContentHash(candidate.contentHash)) {
      errors.push(
        `Invalid contentHash '${String(candidate.contentHash)}'. Expected 'sha256:<64-lowercase-hex>'.`
      );
    } else {
      resolvedContentHash = candidate.contentHash;
      resolvedChecksum =
        typeof candidate.checksum === 'string' &&
        /^[a-f0-9]{16}$/i.test(candidate.checksum)
          ? candidate.checksum
          : candidate.contentHash.slice(7, 23);
    }
  } else if (candidate.checksum !== undefined) {
    if (
      typeof candidate.checksum !== 'string' ||
      !/^[a-f0-9]{16}$/i.test(candidate.checksum)
    ) {
      errors.push('Asset checksum must be a 16-character hexadecimal digest.');
    } else {
      resolvedChecksum = candidate.checksum.toLowerCase();
      resolvedContentHash = computeAssetContentHash(resolvedChecksum);
    }
  } else {
    errors.push('Asset entry must specify contentHash (sha256:...) or checksum.');
  }

  if (
    candidate.schemaVersion !== undefined &&
    candidate.schemaVersion !== 1
  ) {
    errors.push(
      `Unsupported asset metadata schemaVersion '${String(candidate.schemaVersion)}'. Expected 1.`
    );
  }

  const rawImportState =
    candidate.importState !== undefined ? candidate.importState : 'not_imported';
  if (
    typeof rawImportState !== 'string' ||
    !VALID_IMPORT_STATES.has(rawImportState as AssetImportState)
  ) {
    errors.push(`Invalid asset importState '${String(candidate.importState)}'.`);
  }

  let resolvedName = pathCheck.fileName;
  if (candidate.name !== undefined) {
    if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
      errors.push('Asset name must be a non-empty string.');
    } else {
      resolvedName = candidate.name.trim();
    }
  }

  const resolvedDependencies: string[] = [];
  if (candidate.dependencies !== undefined) {
    if (!Array.isArray(candidate.dependencies)) {
      errors.push('Asset dependencies must be an array of assetIds.');
    } else {
      const seenDeps = new Set<string>();
      for (const depId of candidate.dependencies) {
        if (!isValidAssetId(depId)) {
          errors.push(`Invalid dependency assetId '${String(depId)}'.`);
        } else if (depId === candidate.assetId) {
          errors.push(`Asset '${depId}' cannot depend on itself.`);
        } else if (!seenDeps.has(depId)) {
          seenDeps.add(depId);
          resolvedDependencies.push(depId);
        }
      }
    }
  }

  let resolvedMetadata: Record<string, unknown> = {};
  if (candidate.metadata !== undefined) {
    if (!isPlainObject(candidate.metadata)) {
      errors.push('Asset metadata must be a non-null plain object.');
    } else {
      resolvedMetadata = { ...candidate.metadata };
    }
  }

  let resolvedLifecycle: AssetLifecycleState = 'registered';
  if (candidate.lifecycleState !== undefined) {
    if (
      typeof candidate.lifecycleState !== 'string' ||
      !VALID_LIFECYCLE_STATES.has(candidate.lifecycleState as AssetLifecycleState)
    ) {
      errors.push(
        `Invalid asset lifecycleState '${String(candidate.lifecycleState)}'.`
      );
    } else {
      resolvedLifecycle = candidate.lifecycleState as AssetLifecycleState;
    }
  }

  if (errors.length > 0 || !normalizedType) {
    return {
      valid: false,
      normalized: null,
      errors,
    };
  }

  const sizeNum = rawSize as number;
  const normalizedRecord: AssetMetadataRecord = Object.freeze({
    assetId: candidate.assetId as string,
    type: normalizedType,
    path: pathCheck.normalizedPath,
    name: resolvedName,
    sizeBytes: sizeNum,
    contentHash: resolvedContentHash,
    schemaVersion: 1,
    importState: rawImportState as AssetImportState,
    dependencies: Object.freeze(resolvedDependencies),
    metadata: Object.freeze(resolvedMetadata),
    dirty: Boolean(candidate.dirty),
    lifecycleState: resolvedLifecycle,
    size: sizeNum,
    checksum: resolvedChecksum,
  });

  return {
    valid: true,
    normalized: normalizedRecord,
    errors: [],
  };
}

/**
 * Detects circular dependencies (`A -> B -> C -> A`) and missing dependency targets
 * across a collection of `AssetMetadataRecord` items.
 */
export function validateAssetDependencyGraph(
  assets: readonly AssetMetadataRecord[],
  requireTargetExistence = true
): {
  valid: boolean;
  cycles: readonly string[];
  missingDependencies: readonly string[];
  errors: readonly string[];
} {
  const byId = new Map<string, AssetMetadataRecord>();
  for (const asset of assets) {
    byId.set(asset.assetId, asset);
  }

  const cycles: string[] = [];
  const missingDependencies: string[] = [];
  const errors: string[] = [];

  for (const asset of assets) {
    for (const depId of asset.dependencies) {
      if (depId === asset.assetId) {
        const msg = `Self-dependency detected on '${asset.assetId}'.`;
        cycles.push(`${asset.assetId} -> ${asset.assetId}`);
        errors.push(msg);
      } else if (requireTargetExistence && !byId.has(depId)) {
        const msg = `Asset '${asset.assetId}' depends on missing assetId '${depId}'.`;
        missingDependencies.push(depId);
        errors.push(msg);
      }
    }
  }

  // DFS cycle detection (0 = unvisited, 1 = visiting, 2 = visited)
  const state = new Map<string, number>();
  const visit = (currentId: string, trail: string[]) => {
    state.set(currentId, 1);
    const current = byId.get(currentId);
    if (current) {
      for (const depId of current.dependencies) {
        if (!byId.has(depId)) continue;
        const depState = state.get(depId) ?? 0;
        if (depState === 1) {
          const cycleStartIdx = trail.indexOf(depId);
          const cycleChain =
            cycleStartIdx >= 0
              ? [...trail.slice(cycleStartIdx), currentId, depId].join(' -> ')
              : [...trail, currentId, depId].join(' -> ');
          cycles.push(cycleChain);
          errors.push(`Circular asset dependency detected: ${cycleChain}`);
        } else if (depState === 0) {
          visit(depId, [...trail, currentId]);
        }
      }
    }
    state.set(currentId, 2);
  };

  for (const asset of assets) {
    if ((state.get(asset.assetId) ?? 0) === 0) {
      visit(asset.assetId, []);
    }
  }

  return {
    valid: errors.length === 0,
    cycles,
    missingDependencies,
    errors,
  };
}

export function validateAssetRegistryDocument(
  candidate: unknown,
  expectedProjectId?: string
): { valid: boolean; document: AssetRegistryDocument | null; errors: string[] } {
  const errors: string[] = [];
  if (!isPlainObject(candidate)) {
    return {
      valid: false,
      document: null,
      errors: ['Asset registry must be a non-null JSON object.'],
    };
  }

  if (candidate.schemaVersion !== 1) {
    errors.push(
      `Unsupported AssetRegistry schemaVersion '${String(candidate.schemaVersion)}'.`
    );
  }

  const projectId =
    typeof candidate.projectId === 'string' && candidate.projectId.trim().length > 0
      ? candidate.projectId.trim()
      : expectedProjectId ?? 'prj_default';

  if (
    candidate.projectId !== undefined &&
    (typeof candidate.projectId !== 'string' || candidate.projectId.trim().length === 0)
  ) {
    errors.push('AssetRegistry projectId must be a non-empty string.');
  } else if (
    expectedProjectId &&
    typeof candidate.projectId === 'string' &&
    candidate.projectId !== expectedProjectId
  ) {
    errors.push(
      `AssetRegistry projectId '${candidate.projectId}' does not match project manifest ID '${expectedProjectId}'.`
    );
  }

  const rawList = Array.isArray(candidate.assets)
    ? candidate.assets
    : Array.isArray(candidate.entries)
      ? candidate.entries
      : null;

  const normalizedAssets: AssetMetadataRecord[] = [];
  const legacyEntries: AssetRegistryEntry[] = [];

  if (!rawList) {
    errors.push('AssetRegistry must contain an assets or entries array.');
  } else {
    const seenIds = new Set<string>();
    const seenPaths = new Set<string>();

    for (let i = 0; i < rawList.length; i++) {
      const itemCheck = validateAssetRegistryEntry(rawList[i]);
      if (!itemCheck.valid || !itemCheck.normalized) {
        errors.push(`Entry [${i}]: ${itemCheck.errors.join('; ')}`);
      } else {
        const rec = itemCheck.normalized;
        if (seenIds.has(rec.assetId)) {
          errors.push(`Duplicate assetId '${rec.assetId}' in AssetRegistry.`);
        }
        if (seenPaths.has(rec.path)) {
          errors.push(`Duplicate asset path '${rec.path}' in AssetRegistry.`);
        }
        seenIds.add(rec.assetId);
        seenPaths.add(rec.path);
        normalizedAssets.push(rec);
        legacyEntries.push(
          Object.freeze({
            assetId: rec.assetId,
            path: rec.path,
            name: rec.name,
            type: toLegacyPascalAssetType(rec.type),
            size: rec.sizeBytes,
            sizeBytes: rec.sizeBytes,
            checksum: rec.checksum ?? rec.contentHash.slice(7, 23),
            contentHash: rec.contentHash,
            schemaVersion: 1,
            importState: rec.importState,
            dependencies: rec.dependencies,
            metadata: rec.metadata,
            dirty: rec.dirty,
            lifecycleState: rec.lifecycleState,
          })
        );
      }
    }

    if (normalizedAssets.length > 0) {
      const depCheck = validateAssetDependencyGraph(normalizedAssets, false);
      if (!depCheck.valid) {
        errors.push(...depCheck.errors);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, document: null, errors };
  }

  const doc: AssetRegistryDocument = Object.freeze({
    schemaVersion: 1,
    projectId,
    updatedAtIso:
      typeof candidate.updatedAtIso === 'string'
        ? candidate.updatedAtIso
        : new Date().toISOString(),
    assets: Object.freeze(normalizedAssets),
    entries: Object.freeze(legacyEntries),
  });

  return {
    valid: true,
    document: doc,
    errors: [],
  };
}

export interface DuplicateAssetGroup {
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly assetIds: readonly string[];
  readonly paths: readonly string[];
}

export interface AssetReferenceResolution {
  readonly assetId: string;
  readonly status: 'available' | 'missing' | 'corrupted' | 'invalid';
  readonly asset: AssetMetadataRecord | null;
  readonly reason?: string;
}

export interface RegisterAssetInput {
  readonly assetId?: string;
  readonly type: AssetType | string;
  readonly path: string;
  readonly name?: string;
  readonly sizeBytes?: number;
  readonly contentHash?: string;
  readonly contentPayload?: string | Uint8Array;
  readonly importState?: AssetImportState;
  readonly dependencies?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Central HylixAssetRegistry class (Prompt 04).
 */
export class HylixAssetRegistry {
  private readonly projectId: string;
  private readonly assetsById = new Map<string, AssetMetadataRecord>();
  private readonly assetIdByPath = new Map<string, string>();
  private readonly hashCacheByPathMarker = new Map<
    string,
    { sizeBytes: number; storageChecksum: string; contentHash: string }
  >();
  private readonly logger?: RedactedDiagnosticLogger;
  private onAssetInvalidatedCallback?: (assetId: string, newHash: string) => void;

  constructor(
    projectId = 'prj_default',
    logger?: RedactedDiagnosticLogger
  ) {
    this.projectId = projectId;
    this.logger = logger;
  }

  public setOnAssetInvalidatedListener(
    listener: (assetId: string, newHash: string) => void
  ): void {
    this.onAssetInvalidatedCallback = listener;
  }

  public getProjectId(): string {
    return this.projectId;
  }

  /**
   * Computes or reuses cached SHA-256 contentHash if size + storageChecksum marker has not changed.
   */
  public computeOrGetCachedContentHash(
    normalizedPath: string,
    payload: string | Uint8Array,
    storageChecksum?: string
  ): { contentHash: string; sizeBytes: number; recomputed: boolean } {
    const sizeBytes =
      typeof payload === 'string'
        ? new TextEncoder().encode(payload).byteLength
        : payload.byteLength;
    const marker =
      storageChecksum ??
      (typeof payload === 'string'
        ? computeDeterministicChecksum(payload)
        : '');

    if (marker) {
      const cached = this.hashCacheByPathMarker.get(normalizedPath);
      if (
        cached &&
        cached.sizeBytes === sizeBytes &&
        cached.storageChecksum === marker
      ) {
        return {
          contentHash: cached.contentHash,
          sizeBytes,
          recomputed: false,
        };
      }
    }

    const contentHash = computeAssetContentHash(payload);
    if (marker) {
      this.hashCacheByPathMarker.set(normalizedPath, {
        sizeBytes,
        storageChecksum: marker,
        contentHash,
      });
    }

    return {
      contentHash,
      sizeBytes,
      recomputed: true,
    };
  }

  public registerAsset(input: RegisterAssetInput): {
    success: boolean;
    asset: AssetMetadataRecord | null;
    errors: readonly string[];
  } {
    const pathCheck = validateSafeAssetPath(input.path);
    if (!pathCheck.safe) {
      const msg = `Unsafe asset path '${String(input.path)}': ${pathCheck.reason}`;
      this.logger?.record('asset_system', 'ERROR', `asset_validation_failed: ${msg}`);
      return { success: false, asset: null, errors: [msg] };
    }

    const normalizedPath = pathCheck.normalizedPath;
    if (this.assetIdByPath.has(normalizedPath)) {
      const msg = `Duplicate canonical asset path '${normalizedPath}' is already registered.`;
      this.logger?.record('asset_system', 'WARN', `asset_validation_failed: ${msg}`);
      return { success: false, asset: null, errors: [msg] };
    }

    const resolvedAssetId =
      input.assetId ?? createAssetId(`${this.projectId}::${normalizedPath}`);

    if (this.assetsById.has(resolvedAssetId)) {
      const msg = `Duplicate assetId '${resolvedAssetId}' is already registered.`;
      this.logger?.record('asset_system', 'WARN', `asset_validation_failed: ${msg}`);
      return { success: false, asset: null, errors: [msg] };
    }

    let resolvedHash = input.contentHash;
    let resolvedSize = input.sizeBytes;

    if (input.contentPayload !== undefined) {
      const computed = this.computeOrGetCachedContentHash(
        normalizedPath,
        input.contentPayload
      );
      resolvedHash = resolvedHash ?? computed.contentHash;
      resolvedSize = resolvedSize ?? computed.sizeBytes;
    }

    const candidateObj = {
      assetId: resolvedAssetId,
      type: input.type,
      path: normalizedPath,
      name: input.name ?? pathCheck.fileName,
      sizeBytes: resolvedSize ?? 0,
      contentHash: resolvedHash,
      schemaVersion: 1 as const,
      importState: input.importState ?? 'not_imported',
      dependencies: input.dependencies ?? [],
      metadata: input.metadata ?? {},
      dirty: false,
      lifecycleState: 'available' as AssetLifecycleState,
    };

    const validation = validateAssetRegistryEntry(candidateObj);
    if (!validation.valid || !validation.normalized) {
      this.logger?.record(
        'asset_system',
        'ERROR',
        `asset_validation_failed for '${normalizedPath}': ${validation.errors.join('; ')}`
      );
      return {
        success: false,
        asset: null,
        errors: validation.errors,
      };
    }

    // Check that all declared dependencies exist and do not introduce a cycle
    for (const depId of validation.normalized.dependencies) {
      if (!this.assetsById.has(depId)) {
        const err = `Dependency assetId '${depId}' is not registered in the Asset Registry.`;
        this.logger?.record('asset_system', 'ERROR', `asset_validation_failed: ${err}`);
        return { success: false, asset: null, errors: [err] };
      }
    }

    const candidateGraph = [
      ...Array.from(this.assetsById.values()),
      validation.normalized,
    ];
    const graphCheck = validateAssetDependencyGraph(candidateGraph, true);
    if (!graphCheck.valid) {
      this.logger?.record(
        'asset_system',
        'ERROR',
        `asset_validation_failed: ${graphCheck.errors.join('; ')}`
      );
      return {
        success: false,
        asset: null,
        errors: graphCheck.errors,
      };
    }

    this.assetsById.set(validation.normalized.assetId, validation.normalized);
    this.assetIdByPath.set(validation.normalized.path, validation.normalized.assetId);

    this.logger?.record(
      'asset_system',
      'INFO',
      `asset_registered: id=${validation.normalized.assetId} type=${validation.normalized.type} path=${validation.normalized.path}`
    );

    return {
      success: true,
      asset: validation.normalized,
      errors: [],
    };
  }

  /**
   * Unregisters an asset record from the registry without deleting any user file on disk.
   */
  public unregisterAsset(assetId: string): boolean {
    const existing = this.assetsById.get(assetId);
    if (!existing) return false;
    this.assetsById.delete(assetId);
    this.assetIdByPath.delete(existing.path);
    return true;
  }

  public getAsset(assetId: string): AssetMetadataRecord | undefined {
    return this.assetsById.get(assetId);
  }

  public hasAsset(assetId: string): boolean {
    return this.assetsById.has(assetId);
  }

  /**
   * Updates asset metadata (including moving/renaming `path` or updating `contentHash`)
   * while strictly preserving the immutable `assetId`.
   */
  public updateAssetMetadata(
    assetId: string,
    patch: {
      readonly path?: string;
      readonly name?: string;
      readonly type?: AssetType | string;
      readonly sizeBytes?: number;
      readonly contentHash?: string;
      readonly importState?: AssetImportState;
      readonly dependencies?: readonly string[];
      readonly metadata?: Readonly<Record<string, unknown>>;
      readonly lifecycleState?: AssetLifecycleState;
      readonly dirty?: boolean;
    }
  ): {
    success: boolean;
    asset: AssetMetadataRecord | null;
    hashChanged: boolean;
    errors: readonly string[];
  } {
    const existing = this.assetsById.get(assetId);
    if (!existing) {
      return {
        success: false,
        asset: null,
        hashChanged: false,
        errors: [`Asset '${assetId}' is not registered.`],
      };
    }

    let nextPath = existing.path;
    let nextName = patch.name ?? existing.name;
    if (patch.path !== undefined) {
      const pathCheck = validateSafeAssetPath(patch.path);
      if (!pathCheck.safe) {
        const msg = `Invalid updated path '${patch.path}': ${pathCheck.reason}`;
        this.logger?.record('asset_system', 'ERROR', `asset_validation_failed: ${msg}`);
        return {
          success: false,
          asset: null,
          hashChanged: false,
          errors: [msg],
        };
      }
      const conflictingId = this.assetIdByPath.get(pathCheck.normalizedPath);
      if (conflictingId && conflictingId !== assetId) {
        return {
          success: false,
          asset: null,
          hashChanged: false,
          errors: [
            `Path '${pathCheck.normalizedPath}' is already bound to another asset ('${conflictingId}').`,
          ],
        };
      }
      nextPath = pathCheck.normalizedPath;
      if (patch.name === undefined) {
        nextName = pathCheck.fileName;
      }
    }

    const hashChanged =
      patch.contentHash !== undefined && patch.contentHash !== existing.contentHash;

    const candidateObj = {
      assetId: existing.assetId, // Immutable identity!
      type: patch.type ?? existing.type,
      path: nextPath,
      name: nextName,
      sizeBytes: patch.sizeBytes ?? existing.sizeBytes,
      contentHash: patch.contentHash ?? existing.contentHash,
      schemaVersion: 1 as const,
      importState: patch.importState ?? existing.importState,
      dependencies: patch.dependencies ?? existing.dependencies,
      metadata: patch.metadata ?? existing.metadata,
      dirty: patch.dirty !== undefined ? patch.dirty : hashChanged || Boolean(existing.dirty),
      lifecycleState: patch.lifecycleState ?? existing.lifecycleState ?? 'available',
    };

    const val = validateAssetRegistryEntry(candidateObj);
    if (!val.valid || !val.normalized) {
      this.logger?.record(
        'asset_system',
        'ERROR',
        `asset_validation_failed for '${assetId}': ${val.errors.join('; ')}`
      );
      return {
        success: false,
        asset: null,
        hashChanged: false,
        errors: val.errors,
      };
    }

    // Check dependencies & circular references
    for (const depId of val.normalized.dependencies) {
      if (!this.assetsById.has(depId)) {
        const err = `Dependency assetId '${depId}' does not exist in Asset Registry.`;
        this.logger?.record('asset_system', 'ERROR', `asset_validation_failed: ${err}`);
        return {
          success: false,
          asset: null,
          hashChanged: false,
          errors: [err],
        };
      }
    }

    const simulatedAssets = Array.from(this.assetsById.values()).map((a) =>
      a.assetId === assetId ? val.normalized! : a
    );
    const graphCheck = validateAssetDependencyGraph(simulatedAssets, true);
    if (!graphCheck.valid) {
      this.logger?.record(
        'asset_system',
        'ERROR',
        `asset_validation_failed: ${graphCheck.errors.join('; ')}`
      );
      return {
        success: false,
        asset: null,
        hashChanged: false,
        errors: graphCheck.errors,
      };
    }

    if (existing.path !== val.normalized.path) {
      this.assetIdByPath.delete(existing.path);
      this.assetIdByPath.set(val.normalized.path, assetId);
    }
    this.assetsById.set(assetId, val.normalized);

    if (hashChanged) {
      this.logger?.record(
        'asset_system',
        'INFO',
        `asset_invalidated: id=${assetId} newHash=${val.normalized.contentHash}`
      );
      this.onAssetInvalidatedCallback?.(assetId, val.normalized.contentHash);
    }

    return {
      success: true,
      asset: val.normalized,
      hashChanged,
      errors: [],
    };
  }

  public findByPath(relativePath: string): AssetMetadataRecord | undefined {
    const pathCheck = validateSafeAssetPath(relativePath);
    if (!pathCheck.safe) return undefined;
    const id = this.assetIdByPath.get(pathCheck.normalizedPath);
    return id ? this.assetsById.get(id) : undefined;
  }

  public findByType(type: AssetType | string): readonly AssetMetadataRecord[] {
    const normalizedType = normalizeAssetType(type);
    if (!normalizedType) return [];
    return this.listAssets().filter((a) => a.type === normalizedType);
  }

  public findByHash(contentHash: string): readonly AssetMetadataRecord[] {
    return this.listAssets().filter((a) => a.contentHash === contentHash);
  }

  public listAssets(): readonly AssetMetadataRecord[] {
    return Array.from(this.assetsById.values()).sort((a, b) =>
      a.path.localeCompare(b.path)
    );
  }

  public markDirty(assetId: string): boolean {
    const res = this.updateAssetMetadata(assetId, { dirty: true });
    return res.success;
  }

  public markClean(assetId: string): boolean {
    const res = this.updateAssetMetadata(assetId, { dirty: false });
    return res.success;
  }

  /**
   * Validates an asset record and optionally verifies its underlying file in `LocalFirstAtomicStore`
   * to detect missing or corrupted files without deleting anything.
   */
  public validateAsset(
    assetOrId: string | unknown,
    workspaceContext?: { store: LocalFirstAtomicStore; projectRoot: string }
  ): {
    valid: boolean;
    status: 'available' | 'missing' | 'corrupted' | 'invalid';
    asset: AssetMetadataRecord | null;
    errors: readonly string[];
  } {
    const candidate =
      typeof assetOrId === 'string' ? this.assetsById.get(assetOrId) : assetOrId;

    if (!candidate) {
      return {
        valid: false,
        status: 'missing',
        asset: null,
        errors: [`Asset '${String(assetOrId)}' is not registered.`],
      };
    }

    const entryCheck = validateAssetRegistryEntry(candidate);
    if (!entryCheck.valid || !entryCheck.normalized) {
      return {
        valid: false,
        status: 'invalid',
        asset: null,
        errors: entryCheck.errors,
      };
    }

    const record = entryCheck.normalized;

    // Verify dependencies exist in registry if this asset is registered
    for (const depId of record.dependencies) {
      if (!this.assetsById.has(depId)) {
        return {
          valid: false,
          status: 'invalid',
          asset: record,
          errors: [`Asset '${record.assetId}' references missing dependency '${depId}'.`],
        };
      }
    }

    if (workspaceContext) {
      const scoped = validateProjectScopedPath(
        workspaceContext.projectRoot,
        record.path
      );
      if (!scoped.safe) {
        return {
          valid: false,
          status: 'invalid',
          asset: record,
          errors: [scoped.reason || 'Unsafe project scoped path.'],
        };
      }

      if (!workspaceContext.store.fileExists(scoped.normalizedPath)) {
        if (this.assetsById.has(record.assetId)) {
          this.updateAssetMetadata(record.assetId, {
            importState: 'missing_source',
            lifecycleState: 'missing',
          });
        }
        return {
          valid: false,
          status: 'missing',
          asset: this.assetsById.get(record.assetId) ?? record,
          errors: [`Source file '${record.path}' is missing from workspace.`],
        };
      }

      const fileRead = workspaceContext.store.readVerifiedFile(
        scoped.normalizedPath,
        false
      );
      if (!fileRead.valid || !fileRead.record) {
        if (this.assetsById.has(record.assetId)) {
          this.updateAssetMetadata(record.assetId, {
            importState: 'corrupted',
            lifecycleState: 'corrupted',
          });
        }
        return {
          valid: false,
          status: 'corrupted',
          asset: this.assetsById.get(record.assetId) ?? record,
          errors: [
            fileRead.error || `Source file '${record.path}' failed storage checksum.`,
          ],
        };
      }

      const actualSha256 = computeAssetContentHash(fileRead.record.content);
      if (actualSha256 !== record.contentHash) {
        if (this.assetsById.has(record.assetId)) {
          this.updateAssetMetadata(record.assetId, {
            importState: 'corrupted',
            lifecycleState: 'corrupted',
          });
        }
        return {
          valid: false,
          status: 'corrupted',
          asset: this.assetsById.get(record.assetId) ?? record,
          errors: [
            `Content hash mismatch for '${record.path}': expected ${record.contentHash}, found ${actualSha256}.`,
          ],
        };
      }
    }

    return {
      valid: true,
      status: 'available',
      asset: record,
      errors: [],
    };
  }

  /**
   * Resolves an Asset ID reference (e.g., from a Scene or ECS Component).
   * Never crashes on missing assets and never fabricates fake assets inside the Registry.
   */
  public resolveAssetReference(
    assetId: string,
    workspaceContext?: { store: LocalFirstAtomicStore; projectRoot: string }
  ): AssetReferenceResolution {
    if (!isValidAssetId(assetId)) {
      return {
        assetId: String(assetId),
        status: 'invalid',
        asset: null,
        reason: `Malformed assetId '${String(assetId)}'.`,
      };
    }

    const existing = this.assetsById.get(assetId);
    if (!existing) {
      return {
        assetId,
        status: 'missing',
        asset: null,
        reason: `Asset '${assetId}' was not found in the Asset Registry.`,
      };
    }

    if (
      existing.importState === 'corrupted' ||
      existing.lifecycleState === 'corrupted'
    ) {
      return {
        assetId,
        status: 'corrupted',
        asset: existing,
        reason: `Asset '${assetId}' is marked corrupted.`,
      };
    }

    if (
      existing.importState === 'missing_source' ||
      existing.lifecycleState === 'missing'
    ) {
      return {
        assetId,
        status: 'missing',
        asset: existing,
        reason: `Source file '${existing.path}' for asset '${assetId}' is missing.`,
      };
    }

    if (workspaceContext) {
      const check = this.validateAsset(assetId, workspaceContext);
      return {
        assetId,
        status: check.status,
        asset: check.asset,
        reason: check.errors[0],
      };
    }

    return {
      assetId,
      status: 'available',
      asset: existing,
    };
  }

  /**
   * Detects assets with identical SHA-256 `contentHash` without deleting or deduplicating files.
   */
  public detectDuplicateContentAssets(): readonly DuplicateAssetGroup[] {
    const groups = new Map<string, AssetMetadataRecord[]>();
    for (const asset of this.listAssets()) {
      const list = groups.get(asset.contentHash) ?? [];
      list.push(asset);
      groups.set(asset.contentHash, list);
    }

    const duplicates: DuplicateAssetGroup[] = [];
    for (const [contentHash, list] of groups.entries()) {
      if (list.length > 1) {
        duplicates.push(
          Object.freeze({
            contentHash,
            sizeBytes: list[0].sizeBytes,
            assetIds: Object.freeze(list.map((a) => a.assetId)),
            paths: Object.freeze(list.map((a) => a.path)),
          })
        );
      }
    }
    return duplicates;
  }

  public toDocument(): AssetRegistryDocument {
    const sorted = this.listAssets();
    const entries: AssetRegistryEntry[] = sorted.map((rec) =>
      Object.freeze({
        assetId: rec.assetId,
        path: rec.path,
        name: rec.name,
        type: toLegacyPascalAssetType(rec.type),
        size: rec.sizeBytes,
        sizeBytes: rec.sizeBytes,
        checksum: rec.checksum ?? rec.contentHash.slice(7, 23),
        contentHash: rec.contentHash,
        schemaVersion: 1 as const,
        importState: rec.importState,
        dependencies: rec.dependencies,
        metadata: rec.metadata,
        dirty: rec.dirty,
        lifecycleState: rec.lifecycleState,
      })
    );

    return Object.freeze({
      schemaVersion: 1,
      projectId: this.projectId,
      updatedAtIso: new Date().toISOString(),
      assets: Object.freeze(sorted),
      entries: Object.freeze(entries),
    });
  }

  public serializeToJson(): string {
    return JSON.stringify(this.toDocument(), null, 2);
  }

  public loadFromDocument(doc: unknown): {
    success: boolean;
    loadedCount: number;
    errors: readonly string[];
  } {
    const val = validateAssetRegistryDocument(doc, this.projectId);
    if (!val.valid || !val.document) {
      this.logger?.record(
        'asset_system',
        'ERROR',
        `asset_validation_failed on registry document: ${val.errors.join('; ')}`
      );
      return {
        success: false,
        loadedCount: 0,
        errors: val.errors,
      };
    }

    this.assetsById.clear();
    this.assetIdByPath.clear();

    for (const rec of val.document.assets ?? []) {
      this.assetsById.set(rec.assetId, rec);
      this.assetIdByPath.set(rec.path, rec.assetId);
    }

    return {
      success: true,
      loadedCount: this.assetsById.size,
      errors: [],
    };
  }

  /**
   * Saves the Asset Registry atomically to `<projectRoot>/.hylix/asset-registry.hylix.json`
   * using `LocalFirstAtomicStore` (Validate -> Serialize -> Atomic Write -> Verify -> Commit).
   */
  public saveToStore(
    store: LocalFirstAtomicStore,
    projectRoot: string
  ): {
    success: boolean;
    checksumHex: string;
    errors: readonly string[];
  } {
    const doc = this.toDocument();
    const val = validateAssetRegistryDocument(doc, this.projectId);
    if (!val.valid) {
      return {
        success: false,
        checksumHex: '',
        errors: val.errors,
      };
    }

    const scoped = validateProjectScopedPath(
      projectRoot,
      '.hylix/asset-registry.hylix.json'
    );
    if (!scoped.safe) {
      return {
        success: false,
        checksumHex: '',
        errors: [scoped.reason || 'Unsafe asset registry path.'],
      };
    }

    const writeRes = store.writeFileAtomically(
      scoped.normalizedPath,
      JSON.stringify(doc, null, 2)
    );
    if (!writeRes.success) {
      return {
        success: false,
        checksumHex: '',
        errors: [writeRes.error || 'Atomic write of asset registry failed.'],
      };
    }

    // Mark all assets clean after successful registry persistence
    for (const [id, rec] of this.assetsById.entries()) {
      if (rec.dirty) {
        this.assetsById.set(
          id,
          Object.freeze({
            ...rec,
            dirty: false,
          })
        );
      }
    }

    return {
      success: true,
      checksumHex: writeRes.checksumHex,
      errors: [],
    };
  }

  /**
   * Loads and validates `<projectRoot>/.hylix/asset-registry.hylix.json` from `LocalFirstAtomicStore`,
   * supporting automatic `.bak` backup recovery when `autoRecoverFromBackup` is enabled.
   */
  public loadFromStore(
    store: LocalFirstAtomicStore,
    projectRoot: string,
    autoRecoverFromBackup = true
  ): {
    success: boolean;
    recoveredFromBackup: boolean;
    loadedCount: number;
    errors: readonly string[];
  } {
    const scoped = validateProjectScopedPath(
      projectRoot,
      '.hylix/asset-registry.hylix.json'
    );
    if (!scoped.safe) {
      return {
        success: false,
        recoveredFromBackup: false,
        loadedCount: 0,
        errors: [scoped.reason || 'Invalid projectRoot for Asset Registry load.'],
      };
    }

    const readRes = store.readVerifiedFile(
      scoped.normalizedPath,
      autoRecoverFromBackup
    );
    if (!readRes.valid || !readRes.record) {
      return {
        success: false,
        recoveredFromBackup: false,
        loadedCount: 0,
        errors: [
          readRes.error || 'Failed to read .hylix/asset-registry.hylix.json.',
        ],
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readRes.record.content);
    } catch {
      if (autoRecoverFromBackup && store.hasValidBackup(scoped.normalizedPath)) {
        const restored = store.restoreFileFromVerifiedBackup(scoped.normalizedPath);
        if (restored.restored) {
          const retryRead = store.readVerifiedFile(scoped.normalizedPath, false);
          if (retryRead.valid && retryRead.record) {
            try {
              parsed = JSON.parse(retryRead.record.content);
              const loadBak = this.loadFromDocument(parsed);
              return {
                success: loadBak.success,
                recoveredFromBackup: true,
                loadedCount: loadBak.loadedCount,
                errors: loadBak.errors,
              };
            } catch {
              // fall through
            }
          }
        }
      }
      return {
        success: false,
        recoveredFromBackup: false,
        loadedCount: 0,
        errors: ['Malformed JSON in .hylix/asset-registry.hylix.json.'],
      };
    }

    const loadRes = this.loadFromDocument(parsed);
    return {
      success: loadRes.success,
      recoveredFromBackup: readRes.recoveredFromBackup,
      loadedCount: loadRes.loadedCount,
      errors: loadRes.errors,
    };
  }
}

/**
 * Phase-2 & Phase-3 atomic helper that writes an asset file and synchronizes
 * `<projectRoot>/.hylix/asset-registry.hylix.json`.
 */
export function registerProjectAssetAtomically(
  store: LocalFirstAtomicStore,
  projectRoot: string,
  projectId: string,
  assetRelativePath: string,
  assetType: AssetType,
  assetContent: string
): {
  success: boolean;
  entry: AssetRegistryEntry | null;
  error?: string;
} {
  const pathCheck = validateSafeAssetPath(assetRelativePath);
  if (!pathCheck.safe) {
    return { success: false, entry: null, error: pathCheck.reason };
  }

  const normalizedType = normalizeAssetType(assetType);
  if (!normalizedType) {
    return {
      success: false,
      entry: null,
      error: `Unsupported asset type '${String(assetType)}'.`,
    };
  }

  const scopedAssetPath = validateProjectScopedPath(
    projectRoot,
    pathCheck.normalizedPath
  );
  if (!scopedAssetPath.safe) {
    return { success: false, entry: null, error: scopedAssetPath.reason };
  }

  // Write the asset file atomically first
  const writeAsset = store.writeFileAtomically(
    scopedAssetPath.normalizedPath,
    assetContent
  );
  if (!writeAsset.success) {
    return { success: false, entry: null, error: writeAsset.error };
  }

  const registryScoped = validateProjectScopedPath(
    projectRoot,
    '.hylix/asset-registry.hylix.json'
  );
  if (!registryScoped.safe) {
    return { success: false, entry: null, error: registryScoped.reason };
  }

  const existingRead = store.readVerifiedFile(registryScoped.normalizedPath);
  let existingEntries: AssetRegistryEntry[] = [];
  if (existingRead.valid && existingRead.record) {
    try {
      const parsed = JSON.parse(existingRead.record.content);
      const val = validateAssetRegistryDocument(parsed, projectId);
      if (val.valid && val.document) {
        existingEntries = [...val.document.entries];
      }
    } catch {
      // Will rebuild/update registry if unreadable
    }
  }

  // Preserve existing assetId if this path was already registered
  const existingForPath = existingEntries.find(
    (e) => e.path === pathCheck.normalizedPath
  );
  const resolvedAssetId =
    existingForPath?.assetId ??
    createDeterministicAssetId(projectId, pathCheck.normalizedPath);

  const byteSize = new TextEncoder().encode(assetContent).byteLength;
  const contentHash = computeAssetContentHash(assetContent);

  const newEntry: AssetRegistryEntry = Object.freeze({
    assetId: resolvedAssetId,
    path: pathCheck.normalizedPath,
    name: pathCheck.fileName,
    type: toLegacyPascalAssetType(normalizedType),
    size: byteSize,
    sizeBytes: byteSize,
    checksum: writeAsset.checksumHex,
    contentHash,
    schemaVersion: 1,
    importState: 'verified',
    dependencies: existingForPath?.dependencies ?? [],
    metadata: existingForPath?.metadata ?? {},
    dirty: false,
    lifecycleState: 'available',
  });

  const filtered = existingEntries.filter(
    (e) => e.path !== newEntry.path && e.assetId !== newEntry.assetId
  );
  filtered.push(newEntry);

  const normalizedAssets: AssetMetadataRecord[] = filtered.map((e) => {
    const v = validateAssetRegistryEntry(e);
    return v.normalized!;
  });

  const updatedDoc: AssetRegistryDocument = {
    schemaVersion: 1,
    projectId,
    updatedAtIso: new Date().toISOString(),
    assets: normalizedAssets,
    entries: filtered,
  };

  const writeReg = store.writeFileAtomically(
    registryScoped.normalizedPath,
    JSON.stringify(updatedDoc, null, 2)
  );
  if (!writeReg.success) {
    return { success: false, entry: null, error: writeReg.error };
  }

  return {
    success: true,
    entry: newEntry,
  };
}
