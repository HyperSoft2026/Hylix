import {
  CanonicalAssetType,
  HylixAssetRegistry,
  isValidAssetId,
} from '../assets/assetRegistry';
import { ResourceManager } from '../assets/resourceManager';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  createDeterministicRenderId,
  RenderCapabilities,
  RenderDeviceSyncState,
  RenderValidationResult,
} from './renderTypes';
import { RenderBackend } from './renderBackend';
import { RenderFrame } from './renderFrame';
import { Viewport } from './viewport';

/**
 * Hylix V1.0.0 — Phase 05: RenderDevice Abstraction & Resource Safety (STEP 4, STEP 21, STEP 22)
 *
 * Represents the logical graphics device without coupling to a specific GPU API.
 * Enforces:
 * - Device initialization & capabilities
 * - Resource creation & destruction with generation tracking
 * - Prevention of double destroy, use-after-release, use-after-invalidate,
 *   invalid resource handles, resource type mismatch, and cross-project resource usage
 * - Frame begin / end & synchronization state tracking
 */

export type RenderResourceKind = 'texture' | 'sprite' | 'mesh' | 'material' | 'shader';

export interface RenderDeviceResourceHandle {
  readonly deviceResourceId: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly resourceKind: RenderResourceKind;
  readonly underlyingResourceId: string;
  readonly boundContentHash: string;
  readonly generation: number;
  readonly state: 'active' | 'invalidated' | 'released' | 'destroyed';
}

function doesAssetTypeMatchRenderKind(
  assetType: CanonicalAssetType,
  expectedKind: RenderResourceKind
): boolean {
  switch (expectedKind) {
    case 'texture':
      return assetType === 'texture' || assetType === 'sprite';
    case 'sprite':
      return assetType === 'sprite' || assetType === 'texture';
    case 'mesh':
      return assetType === 'model';
    case 'material':
      return assetType === 'material';
    case 'shader':
      return assetType === 'shader';
    default:
      return false;
  }
}

export class RenderDevice {
  private readonly projectId: string;
  private readonly backend: RenderBackend;
  private readonly registry: HylixAssetRegistry;
  private readonly resourceManager: ResourceManager;
  private readonly logger?: RedactedDiagnosticLogger;

  private syncState: RenderDeviceSyncState = 'uninitialized';
  private frameCounter = 0;
  private activeFrame: RenderFrame | null = null;
  private resourceGenerationCounter = 0;
  private readonly deviceResources = new Map<string, RenderDeviceResourceHandle>();

  constructor(options: {
    readonly projectId: string;
    readonly backend: RenderBackend;
    readonly registry: HylixAssetRegistry;
    readonly resourceManager: ResourceManager;
    readonly logger?: RedactedDiagnosticLogger;
  }) {
    this.projectId = options.projectId;
    this.backend = options.backend;
    this.registry = options.registry;
    this.resourceManager = options.resourceManager;
    this.logger = options.logger;
  }

  public getProjectId(): string {
    return this.projectId;
  }

  public getSyncState(): RenderDeviceSyncState {
    return this.syncState;
  }

  public getBackend(): RenderBackend {
    return this.backend;
  }

  public getCapabilities(): RenderCapabilities {
    return this.backend.getCapabilities();
  }

  public initializeDevice(viewport?: Viewport): {
    readonly success: boolean;
    readonly syncState: RenderDeviceSyncState;
    readonly error?: string;
  } {
    const res = this.backend.initialize(viewport);
    if (!res.success) {
      return {
        success: false,
        syncState: this.syncState,
        error: res.error,
      };
    }
    this.syncState = 'idle';
    return {
      success: true,
      syncState: this.syncState,
    };
  }

  public shutdownDevice(): {
    readonly success: boolean;
    readonly syncState: RenderDeviceSyncState;
    readonly error?: string;
  } {
    if (this.activeFrame && !this.activeFrame.isCompleted()) {
      const err = 'Cannot shutdown RenderDevice while a RenderFrame is actively recording.';
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${err}`);
      return {
        success: false,
        syncState: this.syncState,
        error: err,
      };
    }

    const res = this.backend.shutdown();
    if (!res.success) {
      return {
        success: false,
        syncState: this.syncState,
        error: res.error,
      };
    }

    this.syncState = 'shutdown';
    return {
      success: true,
      syncState: this.syncState,
    };
  }

  /**
   * Creates a RenderDeviceResourceHandle backed by `ResourceManager` and `HylixAssetRegistry`.
   * Rejects cross-project access, missing assets, or asset type mismatches.
   */
  public createRenderResource(
    assetId: string,
    expectedKind: RenderResourceKind,
    callerProjectId = this.projectId
  ): RenderValidationResult<RenderDeviceResourceHandle> {
    if (this.syncState === 'uninitialized' || this.syncState === 'shutdown') {
      const msg = `Cannot create render resource while RenderDevice is '${this.syncState}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    if (callerProjectId !== this.projectId) {
      const msg = `Cross-Project Resource Creation Denied: project '${callerProjectId}' cannot create resources on RenderDevice owned by '${this.projectId}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    if (!isValidAssetId(assetId)) {
      const msg = `Invalid assetId '${String(assetId)}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    const assetMeta = this.registry.getAsset(assetId);
    if (!assetMeta) {
      const msg = `Asset '${assetId}' is not registered in project '${this.projectId}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    if (!doesAssetTypeMatchRenderKind(assetMeta.type, expectedKind)) {
      const msg = `Resource Type Mismatch: asset '${assetId}' is of type '${assetMeta.type}', which cannot be bound as RenderResourceKind '${expectedKind}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    const loadRes = this.resourceManager.load(assetId);
    if (!loadRes.success || !loadRes.resource) {
      const msg = `ResourceManager failed to load asset '${assetId}': ${loadRes.errors.join('; ')}`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    this.resourceGenerationCounter += 1;
    const deviceResourceId = createDeterministicRenderId(
      'rdevres',
      `${this.projectId}::${assetId}::${this.resourceGenerationCounter}`
    );

    const handle: RenderDeviceResourceHandle = Object.freeze({
      deviceResourceId,
      projectId: this.projectId,
      assetId,
      resourceKind: expectedKind,
      underlyingResourceId: loadRes.resource.resourceId,
      boundContentHash: loadRes.resource.loadedContentHash,
      generation: this.resourceGenerationCounter,
      state: 'active',
    });

    this.deviceResources.set(deviceResourceId, handle);
    this.logger?.record(
      'rendering',
      'INFO',
      `render_resource_created: deviceResourceId=${deviceResourceId} assetId=${assetId} kind=${expectedKind} generation=${handle.generation}`
    );

    return { valid: true, value: handle, errors: [] };
  }

  /**
   * Validates that a `RenderDeviceResourceHandle` is safe to use:
   * - Not unknown / forged
   * - Belongs to `this.projectId` (blocks cross-project usage)
   * - Matches `expectedKind` (blocks resource type mismatch)
   * - Not destroyed (blocks use-after-destroy)
   * - Not released in `ResourceManager` (blocks use-after-release)
   * - Not invalidated by an Asset `contentHash` update (blocks use-after-invalidate)
   */
  public validateResourceForUse(
    handleOrId: string | RenderDeviceResourceHandle,
    expectedKind: RenderResourceKind,
    callerProjectId = this.projectId
  ): RenderValidationResult<RenderDeviceResourceHandle> {
    if (
      typeof handleOrId === 'object' &&
      handleOrId !== null &&
      handleOrId.projectId !== this.projectId
    ) {
      const msg = `Cross-Project Resource Usage Blocked: handle from project '${handleOrId.projectId}' cannot be used in project '${this.projectId}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    if (callerProjectId !== this.projectId) {
      const msg = `Cross-Project Resource Usage Blocked: caller project '${callerProjectId}' does not match device project '${this.projectId}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    const id =
      typeof handleOrId === 'string' ? handleOrId : handleOrId?.deviceResourceId;
    const stored = id ? this.deviceResources.get(id) : undefined;

    if (!stored) {
      const msg = `Invalid RenderDeviceResourceHandle '${String(id)}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    if (stored.resourceKind !== expectedKind) {
      const msg = `Resource Type Mismatch: handle '${stored.deviceResourceId}' is '${stored.resourceKind}', expected '${expectedKind}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: stored, errors: [msg] };
    }

    if (stored.state === 'destroyed') {
      const msg = `Use-After-Destroy Blocked: render resource '${stored.deviceResourceId}' has been destroyed.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: stored, errors: [msg] };
    }

    if (stored.state === 'released') {
      const msg = `Use-After-Release Blocked: render resource '${stored.deviceResourceId}' has been released.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: stored, errors: [msg] };
    }

    const assetMeta = this.registry.getAsset(stored.assetId);
    const rmHandle = this.resourceManager.get(stored.assetId);

    if (
      stored.state === 'invalidated' ||
      !assetMeta ||
      assetMeta.contentHash !== stored.boundContentHash ||
      !rmHandle ||
      rmHandle.state === 'invalidated'
    ) {
      const updated: RenderDeviceResourceHandle = Object.freeze({
        ...stored,
        state: 'invalidated',
      });
      this.deviceResources.set(stored.deviceResourceId, updated);
      const msg = `Use-After-Invalidate Blocked: render resource '${stored.deviceResourceId}' for asset '${stored.assetId}' is invalidated due to contentHash change.`;
      this.logger?.record(
        'rendering',
        'WARN',
        `render_resource_invalidated: deviceResourceId=${stored.deviceResourceId} assetId=${stored.assetId}`
      );
      return { valid: false, value: updated, errors: [msg] };
    }

    if (rmHandle.referenceCount <= 0 || rmHandle.state !== 'loaded') {
      const updated: RenderDeviceResourceHandle = Object.freeze({
        ...stored,
        state: 'released',
      });
      this.deviceResources.set(stored.deviceResourceId, updated);
      const msg = `Use-After-Release Blocked: underlying ResourceHandle '${rmHandle.resourceId}' has referenceCount=${rmHandle.referenceCount}.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: updated, errors: [msg] };
    }

    return { valid: true, value: stored, errors: [] };
  }

  /**
   * Destroys a render device resource and decrements its reference in `ResourceManager`.
   * Strictly prevents double destroy.
   */
  public destroyRenderResource(
    deviceResourceId: string
  ): RenderValidationResult<RenderDeviceResourceHandle> {
    const stored = this.deviceResources.get(deviceResourceId);
    if (!stored) {
      const msg = `Cannot destroy unknown deviceResourceId '${deviceResourceId}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    if (stored.state === 'destroyed') {
      const msg = `Double-Destroy Blocked: deviceResourceId '${deviceResourceId}' was already destroyed.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: stored, errors: [msg] };
    }

    this.resourceManager.release(stored.assetId);
    const destroyed: RenderDeviceResourceHandle = Object.freeze({
      ...stored,
      state: 'destroyed',
    });
    this.deviceResources.set(deviceResourceId, destroyed);

    this.logger?.record(
      'rendering',
      'INFO',
      `render_resource_destroyed: deviceResourceId=${deviceResourceId} assetId=${stored.assetId}`
    );

    return { valid: true, value: destroyed, errors: [] };
  }

  public beginFrame(): RenderValidationResult<RenderFrame> {
    if (this.syncState !== 'idle' && this.syncState !== 'synchronized') {
      const msg = `Cannot beginFrame on RenderDevice in syncState '${this.syncState}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    const nextFrameNumber = this.frameCounter + 1;
    const backendBegin = this.backend.beginFrame(nextFrameNumber);
    if (!backendBegin.success) {
      return {
        valid: false,
        value: null,
        errors: [backendBegin.error || 'RenderBackend.beginFrame failed.'],
      };
    }

    this.frameCounter = nextFrameNumber;
    const frame = new RenderFrame(this.frameCounter, this.logger);
    const frameBegin = frame.beginFrame();
    if (!frameBegin.success) {
      return {
        valid: false,
        value: null,
        errors: [frameBegin.error || 'RenderFrame.beginFrame failed.'],
      };
    }

    this.activeFrame = frame;
    this.syncState = 'recording';
    return { valid: true, value: frame, errors: [] };
  }

  public endFrame(): {
    readonly success: boolean;
    readonly syncState: RenderDeviceSyncState;
    readonly completedFrame: RenderFrame | null;
    readonly error?: string;
  } {
    if (this.syncState !== 'recording' || !this.activeFrame) {
      const err = `Cannot endFrame on RenderDevice when syncState is '${this.syncState}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${err}`);
      return {
        success: false,
        syncState: this.syncState,
        completedFrame: null,
        error: err,
      };
    }

    this.syncState = 'submitting';
    const frameEnd = this.activeFrame.endFrame();
    if (!frameEnd.success) {
      return {
        success: false,
        syncState: this.syncState,
        completedFrame: this.activeFrame,
        error: frameEnd.error,
      };
    }

    const backendEnd = this.backend.endFrame(this.activeFrame.frameNumber);
    if (!backendEnd.success) {
      return {
        success: false,
        syncState: this.syncState,
        completedFrame: this.activeFrame,
        error: backendEnd.error,
      };
    }

    const completed = this.activeFrame;
    this.activeFrame = null;
    this.syncState = 'synchronized';

    return {
      success: true,
      syncState: this.syncState,
      completedFrame: completed,
    };
  }
}
