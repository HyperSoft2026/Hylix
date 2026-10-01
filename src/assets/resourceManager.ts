import {
  computeDeterministicChecksum,
  LocalFirstAtomicStore,
} from '../storage/atomicStorage';
import { validateProjectScopedPath } from '../security/securityFoundation';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  AssetMetadataRecord,
  CanonicalAssetType,
  HylixAssetRegistry,
  isValidAssetId,
} from './assetRegistry';
import { computeAssetContentHash } from './contentHash';

/**
 * Hylix V1.0.0 — Resource Identity, Reference Counting & Bounded Cache (`src/assets/resourceManager.ts`)
 *
 * Strictly separates:
 * - `Asset`: Project file & metadata stored in the workspace (`HylixAssetRegistry`).
 * - `Resource`: In-memory runtime/editor representation managed by `ResourceManager`.
 */

export type ResourceState =
  | 'unloaded'
  | 'loading'
  | 'loaded'
  | 'failed'
  | 'invalidated';

export type ResourceKind =
  | 'TextureResource'
  | 'SpriteResource'
  | 'ModelResource'
  | 'MaterialResource'
  | 'ShaderResource'
  | 'AudioResource'
  | 'FontResource'
  | 'AnimationResource'
  | 'SceneResource'
  | 'PrefabResource'
  | 'ScriptResource'
  | 'DataResource'
  | 'UnknownResource';

export interface ResourceHandle {
  readonly resourceId: string;
  readonly assetId: string;
  readonly resourceKind: ResourceKind;
  readonly assetType: CanonicalAssetType;
  readonly assetPath: string;
  readonly state: ResourceState;
  readonly referenceCount: number;
  readonly eligibleForUnload: boolean;
  readonly loadedContentHash: string;
  readonly sizeBytes: number;
  readonly loadedAtOrder: number;
  readonly lastAccessedOrder: number;
  readonly errorReason?: string;
}

export interface ResourceStatistics {
  readonly totalResources: number;
  readonly loadedResources: number;
  readonly loadingResources: number;
  readonly failedResources: number;
  readonly referencedResources: number;
  readonly cacheEntries: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
}

export const DEFAULT_MAX_RESOURCE_ENTRIES = 64;
export const MIN_SAFE_RESOURCE_ENTRIES = 1;
export const MAX_SAFE_RESOURCE_ENTRIES = 4096;

export function mapAssetTypeToResourceKind(type: CanonicalAssetType): ResourceKind {
  switch (type) {
    case 'texture':
      return 'TextureResource';
    case 'sprite':
      return 'SpriteResource';
    case 'model':
      return 'ModelResource';
    case 'material':
      return 'MaterialResource';
    case 'shader':
      return 'ShaderResource';
    case 'audio':
      return 'AudioResource';
    case 'font':
      return 'FontResource';
    case 'animation':
      return 'AnimationResource';
    case 'scene':
      return 'SceneResource';
    case 'prefab':
      return 'PrefabResource';
    case 'script':
      return 'ScriptResource';
    case 'data':
      return 'DataResource';
    default:
      return 'UnknownResource';
  }
}

const VALID_STATE_TRANSITIONS: Readonly<Record<ResourceState, ReadonlySet<ResourceState>>> =
  Object.freeze({
    unloaded: new Set<ResourceState>(['loading']),
    loading: new Set<ResourceState>(['loaded', 'failed']),
    loaded: new Set<ResourceState>(['invalidated', 'unloaded']),
    failed: new Set<ResourceState>(['loading', 'unloaded']),
    invalidated: new Set<ResourceState>(['loading', 'unloaded']),
  });

/**
 * Enforces deterministic Resource state machine transitions.
 * Specifically blocks illegal transitions such as `failed -> loaded` or `unloaded -> loaded`
 * without passing through a verified `loading` phase.
 */
export function isValidResourceStateTransition(
  fromState: ResourceState,
  toState: ResourceState
): boolean {
  const allowed = VALID_STATE_TRANSITIONS[fromState];
  return Boolean(allowed && allowed.has(toState));
}

export interface ResourceManagerOptions {
  readonly projectRoot: string;
  readonly store: LocalFirstAtomicStore;
  readonly registry: HylixAssetRegistry;
  readonly maxCacheEntries?: number;
  readonly logger?: RedactedDiagnosticLogger;
}

export class ResourceManager {
  private readonly projectRoot: string;
  private readonly store: LocalFirstAtomicStore;
  private readonly registry: HylixAssetRegistry;
  private readonly maxCacheEntries: number;
  private readonly logger?: RedactedDiagnosticLogger;

  // Bounded in-memory resource map (assetId -> ResourceHandle)
  private readonly resourcesByAssetId = new Map<string, ResourceHandle>();
  private accessCounter = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(options: ResourceManagerOptions) {
    this.projectRoot = options.projectRoot.trim();
    this.store = options.store;
    this.registry = options.registry;
    this.logger = options.logger;

    const requestedMax = options.maxCacheEntries ?? DEFAULT_MAX_RESOURCE_ENTRIES;
    this.maxCacheEntries = Math.max(
      MIN_SAFE_RESOURCE_ENTRIES,
      Math.min(MAX_SAFE_RESOURCE_ENTRIES, Math.floor(requestedMax))
    );

    // Automatically invalidate cached Resource when Registry detects an Asset hash change
    this.registry.setOnAssetInvalidatedListener((assetId) => {
      this.invalidate(assetId);
    });
  }

  public getMaxCacheEntries(): number {
    return this.maxCacheEntries;
  }

  private transitionHandleState(
    handle: ResourceHandle,
    nextState: ResourceState,
    extra?: Partial<ResourceHandle>
  ): { success: boolean; handle: ResourceHandle; error?: string } {
    if (!isValidResourceStateTransition(handle.state, nextState)) {
      return {
        success: false,
        handle,
        error: `Illegal Resource state transition: '${handle.state}' -> '${nextState}' for asset '${handle.assetId}'.`,
      };
    }

    const updated: ResourceHandle = Object.freeze({
      ...handle,
      ...extra,
      state: nextState,
    });
    this.resourcesByAssetId.set(handle.assetId, updated);
    return {
      success: true,
      handle: updated,
    };
  }

  /**
   * Attempts to transition a resource state directly (used to verify state machine guards).
   */
  public attemptStateTransition(
    assetId: string,
    targetState: ResourceState
  ): { success: boolean; handle: ResourceHandle | null; error?: string } {
    const existing = this.resourcesByAssetId.get(assetId);
    if (!existing) {
      return {
        success: false,
        handle: null,
        error: `No resource record exists for asset '${assetId}'.`,
      };
    }

    if (targetState === 'unloaded' && existing.referenceCount > 0) {
      return {
        success: false,
        handle: existing,
        error: `Cannot transition resource '${assetId}' to 'unloaded' while referenceCount is ${existing.referenceCount}.`,
      };
    }

    const res = this.transitionHandleState(existing, targetState);
    return {
      success: res.success,
      handle: res.handle,
      error: res.error,
    };
  }

  /**
   * Evicts a single unreferenced (`referenceCount === 0`) resource in deterministic LRU order
   * to free space in the bounded cache. Never evicts an actively referenced resource.
   */
  private evictOneUnreferencedIfNeeded(excludeAssetId?: string): boolean {
    const activeCachedCount = this.getCachedEntryCount();
    if (activeCachedCount < this.maxCacheEntries) {
      return true;
    }

    let candidateToEvict: ResourceHandle | null = null;
    for (const handle of this.resourcesByAssetId.values()) {
      if (handle.assetId === excludeAssetId) continue;
      if (handle.state === 'unloaded') continue;
      if (handle.referenceCount === 0) {
        if (
          !candidateToEvict ||
          handle.lastAccessedOrder < candidateToEvict.lastAccessedOrder
        ) {
          candidateToEvict = handle;
        }
      }
    }

    if (!candidateToEvict) {
      return false;
    }

    this.resourcesByAssetId.delete(candidateToEvict.assetId);
    this.registry.updateAssetMetadata(candidateToEvict.assetId, {
      lifecycleState: 'unloaded',
    });
    return true;
  }

  private getCachedEntryCount(): number {
    let count = 0;
    for (const h of this.resourcesByAssetId.values()) {
      if (h.state === 'loaded' || h.state === 'invalidated') {
        count++;
      }
    }
    return count;
  }

  /**
   * Loads an Asset into an in-memory Resource handle:
   * - If already `loaded` and its `loadedContentHash` matches the Asset's current `contentHash`,
   *   increments `cacheHits`, increments `referenceCount`, and returns the cached handle.
   * - If `invalidated` or `unloaded` or `failed`, executes `-> loading -> loaded` (or `-> failed`)
   *   after verifying workspace confinement and SHA-256 integrity.
   */
  public load(assetId: string): {
    success: boolean;
    resource: ResourceHandle | null;
    fromCache: boolean;
    errors: readonly string[];
  } {
    if (!isValidAssetId(assetId)) {
      this.cacheMisses += 1;
      const err = `Invalid assetId '${String(assetId)}'.`;
      this.logger?.record('asset_system', 'ERROR', `resource_load_failed: ${err}`);
      return {
        success: false,
        resource: null,
        fromCache: false,
        errors: [err],
      };
    }

    const assetMeta: AssetMetadataRecord | undefined = this.registry.getAsset(assetId);
    if (!assetMeta) {
      this.cacheMisses += 1;
      const err = `Cannot load resource: Asset '${assetId}' is not registered.`;
      this.logger?.record('asset_system', 'ERROR', `resource_load_failed: ${err}`);
      return {
        success: false,
        resource: null,
        fromCache: false,
        errors: [err],
      };
    }

    const existing = this.resourcesByAssetId.get(assetId);

    // Check if an existing loaded resource is still valid or if the underlying Asset hash changed
    if (existing && existing.state === 'loaded') {
      if (existing.loadedContentHash === assetMeta.contentHash && !assetMeta.dirty) {
        this.cacheHits += 1;
        this.accessCounter += 1;
        const nextRefs = existing.referenceCount + 1;
        const updated: ResourceHandle = Object.freeze({
          ...existing,
          referenceCount: nextRefs,
          eligibleForUnload: false,
          lastAccessedOrder: this.accessCounter,
        });
        this.resourcesByAssetId.set(assetId, updated);
        this.registry.updateAssetMetadata(assetId, {
          lifecycleState: 'referenced',
        });
        return {
          success: true,
          resource: updated,
          fromCache: true,
          errors: [],
        };
      } else {
        // Underlying asset contentHash changed -> invalidate old resource before reloading
        this.invalidate(assetId);
      }
    }

    this.cacheMisses += 1;

    // Ensure bounded cache capacity before loading a new entry
    const currentHandle = this.resourcesByAssetId.get(assetId);
    if (!currentHandle || currentHandle.state === 'unloaded' || currentHandle.state === 'failed') {
      const hasSpace = this.evictOneUnreferencedIfNeeded(assetId);
      if (!hasSpace) {
        const capErr = `Resource cache limit (${this.maxCacheEntries}) reached and all cached resources are actively referenced (referenceCount > 0). Release unused resources first.`;
        this.logger?.record('asset_system', 'WARN', `resource_load_failed: ${capErr}`);
        return {
          success: false,
          resource: null,
          fromCache: false,
          errors: [capErr],
        };
      }
    }

    this.accessCounter += 1;
    const baseHandle: ResourceHandle =
      this.resourcesByAssetId.get(assetId) ??
      Object.freeze({
        resourceId: `res_${computeDeterministicChecksum(`${this.projectRoot}::${assetId}`)}`,
        assetId,
        resourceKind: mapAssetTypeToResourceKind(assetMeta.type),
        assetType: assetMeta.type,
        assetPath: assetMeta.path,
        state: 'unloaded' as ResourceState,
        referenceCount: 0,
        eligibleForUnload: true,
        loadedContentHash: '',
        sizeBytes: assetMeta.sizeBytes,
        loadedAtOrder: this.accessCounter,
        lastAccessedOrder: this.accessCounter,
      });

    // Transition -> loading
    const toLoading = this.transitionHandleState(baseHandle, 'loading', {
      errorReason: undefined,
    });
    if (!toLoading.success) {
      return {
        success: false,
        resource: baseHandle,
        fromCache: false,
        errors: [toLoading.error || 'Could not transition resource to loading.'],
      };
    }

    this.logger?.record(
      'asset_system',
      'INFO',
      `resource_load_started: assetId=${assetId} path=${assetMeta.path}`
    );

    // Verify project-scoped path confinement and file integrity in LocalFirstAtomicStore
    const scopedPath = validateProjectScopedPath(this.projectRoot, assetMeta.path);
    if (!scopedPath.safe) {
      const err = scopedPath.reason || 'Unsafe asset path outside project workspace.';
      const failed = this.transitionHandleState(toLoading.handle, 'failed', {
        errorReason: err,
      });
      this.registry.updateAssetMetadata(assetId, { lifecycleState: 'failed' });
      this.logger?.record('asset_system', 'ERROR', `resource_load_failed: ${err}`);
      return {
        success: false,
        resource: failed.handle,
        fromCache: false,
        errors: [err],
      };
    }

    if (!this.store.fileExists(scopedPath.normalizedPath)) {
      const err = `Missing asset source file '${assetMeta.path}' in workspace '${this.projectRoot}'.`;
      const failed = this.transitionHandleState(toLoading.handle, 'failed', {
        errorReason: err,
      });
      this.registry.updateAssetMetadata(assetId, {
        importState: 'missing_source',
        lifecycleState: 'missing',
      });
      this.logger?.record('asset_system', 'ERROR', `resource_load_failed: ${err}`);
      return {
        success: false,
        resource: failed.handle,
        fromCache: false,
        errors: [err],
      };
    }

    const fileRead = this.store.readVerifiedFile(scopedPath.normalizedPath, false);
    if (!fileRead.valid || !fileRead.record) {
      const err =
        fileRead.error ||
        `Corrupted asset file '${assetMeta.path}' failed storage checksum verification.`;
      const failed = this.transitionHandleState(toLoading.handle, 'failed', {
        errorReason: err,
      });
      this.registry.updateAssetMetadata(assetId, {
        importState: 'corrupted',
        lifecycleState: 'corrupted',
      });
      this.logger?.record('asset_system', 'ERROR', `resource_load_failed: ${err}`);
      return {
        success: false,
        resource: failed.handle,
        fromCache: false,
        errors: [err],
      };
    }

    const actualContentHash = computeAssetContentHash(fileRead.record.content);
    if (actualContentHash !== assetMeta.contentHash) {
      const err = `Corrupted asset '${assetMeta.path}': expected hash ${assetMeta.contentHash}, actual ${actualContentHash}.`;
      const failed = this.transitionHandleState(toLoading.handle, 'failed', {
        errorReason: err,
      });
      this.registry.updateAssetMetadata(assetId, {
        importState: 'corrupted',
        lifecycleState: 'corrupted',
      });
      this.logger?.record('asset_system', 'ERROR', `resource_load_failed: ${err}`);
      return {
        success: false,
        resource: failed.handle,
        fromCache: false,
        errors: [err],
      };
    }

    // Transition loading -> loaded
    this.accessCounter += 1;
    const nextRefCount =
      toLoading.handle.referenceCount > 0 ? toLoading.handle.referenceCount : 1;

    const toLoaded = this.transitionHandleState(toLoading.handle, 'loaded', {
      referenceCount: nextRefCount,
      eligibleForUnload: false,
      loadedContentHash: actualContentHash,
      sizeBytes: fileRead.record.byteLength,
      loadedAtOrder: this.accessCounter,
      lastAccessedOrder: this.accessCounter,
      errorReason: undefined,
    });

    this.registry.updateAssetMetadata(assetId, {
      importState: 'verified',
      lifecycleState: nextRefCount > 0 ? 'referenced' : 'loaded',
      dirty: false,
    });

    this.logger?.record(
      'asset_system',
      'INFO',
      `resource_load_succeeded: resourceId=${toLoaded.handle.resourceId} assetId=${assetId} refs=${toLoaded.handle.referenceCount}`
    );

    return {
      success: true,
      resource: toLoaded.handle,
      fromCache: false,
      errors: [],
    };
  }

  /**
   * Retrieves a resource handle if present, checking for content hash invalidation.
   */
  public get(assetId: string): ResourceHandle | undefined {
    const existing = this.resourcesByAssetId.get(assetId);
    if (!existing) {
      this.cacheMisses += 1;
      return undefined;
    }

    const assetMeta = this.registry.getAsset(assetId);
    if (
      existing.state === 'loaded' &&
      assetMeta &&
      assetMeta.contentHash !== existing.loadedContentHash
    ) {
      this.invalidate(assetId);
      this.cacheMisses += 1;
      return this.resourcesByAssetId.get(assetId);
    }

    if (existing.state === 'loaded') {
      this.cacheHits += 1;
      this.accessCounter += 1;
      const touched: ResourceHandle = Object.freeze({
        ...existing,
        lastAccessedOrder: this.accessCounter,
      });
      this.resourcesByAssetId.set(assetId, touched);
      return touched;
    }

    this.cacheMisses += 1;
    return existing;
  }

  public has(assetId: string): boolean {
    const existing = this.resourcesByAssetId.get(assetId);
    return Boolean(existing && existing.state === 'loaded');
  }

  /**
   * Increments reference count (`references += 1`) on a loaded Resource.
   */
  public retain(assetId: string): {
    success: boolean;
    referenceCount: number;
    resource: ResourceHandle | null;
    error?: string;
  } {
    const existing = this.resourcesByAssetId.get(assetId);
    if (!existing || (existing.state !== 'loaded' && existing.state !== 'invalidated')) {
      return {
        success: false,
        referenceCount: 0,
        resource: existing ?? null,
        error: `Cannot retain resource '${assetId}': resource is not loaded.`,
      };
    }

    this.accessCounter += 1;
    const nextCount = existing.referenceCount + 1;
    const updated: ResourceHandle = Object.freeze({
      ...existing,
      referenceCount: nextCount,
      eligibleForUnload: false,
      lastAccessedOrder: this.accessCounter,
    });
    this.resourcesByAssetId.set(assetId, updated);
    this.registry.updateAssetMetadata(assetId, {
      lifecycleState: 'referenced',
    });

    return {
      success: true,
      referenceCount: nextCount,
      resource: updated,
    };
  }

  /**
   * Decrements reference count (`references -= 1`).
   * When referenceCount reaches 0, marks the Resource as `eligibleForUnload: true`
   * without force-deleting active resources.
   */
  public release(assetId: string): {
    success: boolean;
    referenceCount: number;
    eligibleForUnload: boolean;
    resource: ResourceHandle | null;
    error?: string;
  } {
    const existing = this.resourcesByAssetId.get(assetId);
    if (!existing) {
      return {
        success: false,
        referenceCount: 0,
        eligibleForUnload: false,
        resource: null,
        error: `Cannot release resource '${assetId}': resource is not tracked.`,
      };
    }

    if (existing.referenceCount <= 0) {
      return {
        success: false,
        referenceCount: 0,
        eligibleForUnload: true,
        resource: existing,
        error: `Resource '${assetId}' already has referenceCount = 0.`,
      };
    }

    const nextCount = existing.referenceCount - 1;
    const eligible = nextCount === 0;

    const updated: ResourceHandle = Object.freeze({
      ...existing,
      referenceCount: nextCount,
      eligibleForUnload: eligible,
    });
    this.resourcesByAssetId.set(assetId, updated);

    if (eligible) {
      this.registry.updateAssetMetadata(assetId, {
        lifecycleState: 'released',
      });
    }

    this.logger?.record(
      'asset_system',
      'INFO',
      `resource_released: assetId=${assetId} remainingRefs=${nextCount} eligibleForUnload=${eligible}`
    );

    return {
      success: true,
      referenceCount: nextCount,
      eligibleForUnload: eligible,
      resource: updated,
    };
  }

  /**
   * Unloads and clears from cache ONLY unused resources (`referenceCount === 0`).
   * Never unloads any resource with `referenceCount > 0`.
   */
  public clearUnused(): {
    clearedCount: number;
    retainedActiveCount: number;
    clearedAssetIds: readonly string[];
  } {
    const clearedAssetIds: string[] = [];
    let retainedActiveCount = 0;

    for (const [assetId, handle] of Array.from(this.resourcesByAssetId.entries())) {
      if (handle.referenceCount === 0) {
        if (handle.state !== 'unloaded') {
          this.transitionHandleState(handle, 'unloaded');
        }
        this.resourcesByAssetId.delete(assetId);
        this.registry.updateAssetMetadata(assetId, {
          lifecycleState: 'unloaded',
        });
        clearedAssetIds.push(assetId);
      } else {
        retainedActiveCount += 1;
      }
    }

    this.logger?.record(
      'asset_system',
      'INFO',
      `resource_cache_cleared: clearedUnused=${clearedAssetIds.length} retainedActive=${retainedActiveCount}`
    );

    return {
      clearedCount: clearedAssetIds.length,
      retainedActiveCount,
      clearedAssetIds,
    };
  }

  /**
   * Invalidates a loaded resource when its underlying Asset changes (`loaded -> invalidated`).
   */
  public invalidate(assetId: string): {
    invalidated: boolean;
    resource: ResourceHandle | null;
  } {
    const existing = this.resourcesByAssetId.get(assetId);
    if (!existing || existing.state !== 'loaded') {
      return {
        invalidated: false,
        resource: existing ?? null,
      };
    }

    const res = this.transitionHandleState(existing, 'invalidated');
    this.logger?.record(
      'asset_system',
      'INFO',
      `asset_invalidated: resourceId=${existing.resourceId} assetId=${assetId}`
    );
    return {
      invalidated: res.success,
      resource: res.handle,
    };
  }

  /**
   * Alias for `invalidate(assetId)` per Prompt 04 Cache Invalidation contract.
   */
  public invalidateAsset(assetId: string): {
    invalidated: boolean;
    resource: ResourceHandle | null;
  } {
    return this.invalidate(assetId);
  }

  /**
   * Phase 07 Audio Resource Management integration:
   * Loads an Audio asset (`type === 'audio'`), verifying `AudioResource` kind and logging audio diagnostics.
   */
  public loadAudio(assetId: string): {
    success: boolean;
    resource: ResourceHandle | null;
    fromCache: boolean;
    errors: readonly string[];
  } {
    this.logger?.record(
      'audio',
      'INFO',
      `audio_resource_load_started: assetId=${String(assetId)}`
    );

    const assetMeta = this.registry.getAsset(assetId);
    if (assetMeta && assetMeta.type !== 'audio') {
      const msg = `Resource Type Mismatch: Asset '${assetId}' has type '${assetMeta.type}', expected 'audio'.`;
      this.logger?.record('audio', 'ERROR', `audio_resource_load_failed: ${msg}`);
      return {
        success: false,
        resource: null,
        fromCache: false,
        errors: [msg],
      };
    }

    const res = this.load(assetId);
    if (!res.success || !res.resource) {
      this.logger?.record(
        'audio',
        'ERROR',
        `audio_resource_load_failed: assetId=${String(assetId)} (${res.errors.join('; ')})`
      );
      return res;
    }

    this.logger?.record(
      'audio',
      'INFO',
      `audio_resource_load_succeeded: resourceId=${res.resource.resourceId} assetId=${assetId} refs=${res.resource.referenceCount}`
    );
    return res;
  }

  public retainAudio(assetId: string): {
    success: boolean;
    referenceCount: number;
    resource: ResourceHandle | null;
    error?: string;
  } {
    const existing = this.resourcesByAssetId.get(assetId);
    if (existing && existing.resourceKind !== 'AudioResource') {
      return {
        success: false,
        referenceCount: existing.referenceCount,
        resource: existing,
        error: `Resource '${assetId}' is '${existing.resourceKind}', expected 'AudioResource'.`,
      };
    }
    return this.retain(assetId);
  }

  public releaseAudio(assetId: string): {
    success: boolean;
    referenceCount: number;
    eligibleForUnload: boolean;
    resource: ResourceHandle | null;
    error?: string;
  } {
    const existing = this.resourcesByAssetId.get(assetId);
    if (existing && existing.resourceKind !== 'AudioResource') {
      return {
        success: false,
        referenceCount: existing.referenceCount,
        eligibleForUnload: existing.eligibleForUnload,
        resource: existing,
        error: `Resource '${assetId}' is '${existing.resourceKind}', expected 'AudioResource'.`,
      };
    }
    return this.release(assetId);
  }

  public invalidateAudio(assetId: string): {
    invalidated: boolean;
    resource: ResourceHandle | null;
  } {
    const res = this.invalidate(assetId);
    if (res.invalidated && res.resource) {
      this.logger?.record(
        'audio',
        'INFO',
        `audio_resource_invalidated: resourceId=${res.resource.resourceId} assetId=${assetId}`
      );
    }
    return res;
  }

  /**
   * Safely releases all references and unloads all resources when closing a project.
   */
  public releaseAllForProjectClose(): { releasedResourceCount: number } {
    let count = 0;
    for (const [assetId, handle] of Array.from(this.resourcesByAssetId.entries())) {
      const zeroed: ResourceHandle = Object.freeze({
        ...handle,
        referenceCount: 0,
        eligibleForUnload: true,
        state: 'unloaded',
      });
      this.resourcesByAssetId.set(assetId, zeroed);
      this.resourcesByAssetId.delete(assetId);
      this.registry.updateAssetMetadata(assetId, {
        lifecycleState: 'unloaded',
      });
      count += 1;
    }

    this.logger?.record(
      'asset_system',
      'INFO',
      `resource_cache_cleared: projectCloseReleased=${count}`
    );
    return { releasedResourceCount: count };
  }

  public listResources(): readonly ResourceHandle[] {
    return Array.from(this.resourcesByAssetId.values());
  }

  /**
   * Returns sanitized Resource Manager statistics (zero sensitive data).
   */
  public getStats(): ResourceStatistics {
    let loadedResources = 0;
    let loadingResources = 0;
    let failedResources = 0;
    let referencedResources = 0;
    let cacheEntries = 0;

    for (const handle of this.resourcesByAssetId.values()) {
      if (handle.state === 'loaded') {
        loadedResources += 1;
        cacheEntries += 1;
      } else if (handle.state === 'invalidated') {
        cacheEntries += 1;
      } else if (handle.state === 'loading') {
        loadingResources += 1;
      } else if (handle.state === 'failed') {
        failedResources += 1;
      }

      if (handle.referenceCount > 0) {
        referencedResources += 1;
      }
    }

    return Object.freeze({
      totalResources: this.resourcesByAssetId.size,
      loadedResources,
      loadingResources,
      failedResources,
      referencedResources,
      cacheEntries,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    });
  }
}
