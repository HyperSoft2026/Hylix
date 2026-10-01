import {
  HylixAssetRegistry,
  isValidAssetId,
} from '../assets/assetRegistry';
import {
  ResourceHandle,
  ResourceManager,
} from '../assets/resourceManager';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  createDeterministicRenderId,
  RenderValidationResult,
} from './renderTypes';

/**
 * Hylix V1.0.0 — Phase 05: Texture Resource Integration (STEP 16 & STEP 21 & STEP 22)
 *
 * Bridges Hylix Rendering directly with Phase 04 `ResourceManager` and `HylixAssetRegistry`.
 * - Never creates a duplicate texture file loader.
 * - Uses `AssetId` and `ResourceHandle` managed by `ResourceManager`.
 * - Automatically detects `contentHash` changes and invalidates stale texture bindings.
 * - Enforces project isolation (`projectId`) and prevents double destroy / use-after-release / use-after-invalidate.
 */

export interface TextureRenderBinding {
  readonly bindingId: string;
  readonly projectId: string;
  readonly textureAssetId: string;
  readonly resourceHandle: ResourceHandle;
  readonly boundContentHash: string;
  readonly generation: number;
  readonly state: 'active' | 'invalidated' | 'released' | 'destroyed';
}

export class TextureRenderResourceBridge {
  private readonly projectId: string;
  private readonly registry: HylixAssetRegistry;
  private readonly resourceManager: ResourceManager;
  private readonly logger?: RedactedDiagnosticLogger;
  private readonly bindingsById = new Map<string, TextureRenderBinding>();
  private readonly activeBindingIdByAssetId = new Map<string, string>();
  private generationCounter = 0;

  constructor(options: {
    readonly projectId: string;
    readonly registry: HylixAssetRegistry;
    readonly resourceManager: ResourceManager;
    readonly logger?: RedactedDiagnosticLogger;
  }) {
    this.projectId = options.projectId;
    this.registry = options.registry;
    this.resourceManager = options.resourceManager;
    this.logger = options.logger;
  }

  public getProjectId(): string {
    return this.projectId;
  }

  /**
   * Acquires a texture rendering binding backed by `ResourceManager.load(textureAssetId)`.
   */
  public acquireTexture(
    textureAssetId: string,
    callerProjectId = this.projectId
  ): RenderValidationResult<TextureRenderBinding> {
    if (callerProjectId !== this.projectId) {
      const msg = `Cross-Project Texture Access Denied: caller project '${callerProjectId}' cannot acquire texture from project '${this.projectId}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    if (!isValidAssetId(textureAssetId)) {
      const msg = `Invalid textureAssetId '${String(textureAssetId)}'; expected 'asset_<16-hex>'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    const assetMeta = this.registry.getAsset(textureAssetId);
    if (!assetMeta) {
      const msg = `Texture asset '${textureAssetId}' is not registered in project '${this.projectId}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    if (assetMeta.type !== 'texture' && assetMeta.type !== 'sprite') {
      const msg = `Resource Type Mismatch: Asset '${textureAssetId}' has type '${assetMeta.type}', expected 'texture' or 'sprite'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    const loadRes = this.resourceManager.load(textureAssetId);
    if (!loadRes.success || !loadRes.resource) {
      const msg = `Failed to load texture resource '${textureAssetId}': ${loadRes.errors.join('; ')}`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    this.generationCounter += 1;
    const bindingId = createDeterministicRenderId(
      'texbind',
      `${this.projectId}::${textureAssetId}::${this.generationCounter}`
    );

    const binding: TextureRenderBinding = Object.freeze({
      bindingId,
      projectId: this.projectId,
      textureAssetId,
      resourceHandle: loadRes.resource,
      boundContentHash: loadRes.resource.loadedContentHash,
      generation: this.generationCounter,
      state: 'active',
    });

    this.bindingsById.set(bindingId, binding);
    this.activeBindingIdByAssetId.set(textureAssetId, bindingId);

    this.logger?.record(
      'rendering',
      'INFO',
      `render_resource_created: id=${bindingId} assetId=${textureAssetId} generation=${binding.generation}`
    );

    return { valid: true, value: binding, errors: [] };
  }

  /**
   * Validates that a `TextureRenderBinding` is still active, belongs to the current project,
   * has not been released or destroyed, and its underlying `contentHash` has not changed.
   */
  public verifyTextureUsable(
    bindingOrId: string | TextureRenderBinding,
    callerProjectId = this.projectId
  ): RenderValidationResult<TextureRenderBinding> {
    const bindingId =
      typeof bindingOrId === 'string' ? bindingOrId : bindingOrId?.bindingId;
    const existing = bindingId ? this.bindingsById.get(bindingId) : undefined;

    if (!existing) {
      const msg = `Invalid or unknown TextureRenderBinding '${String(bindingId)}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    if (
      callerProjectId !== this.projectId ||
      (typeof bindingOrId === 'object' &&
        bindingOrId !== null &&
        bindingOrId.projectId !== this.projectId)
    ) {
      const msg = `Cross-Project Texture Usage Blocked: binding '${existing.bindingId}' belongs to '${existing.projectId}', cannot be used by '${callerProjectId}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    if (existing.state === 'destroyed') {
      const msg = `Use-After-Destroy Blocked: texture binding '${existing.bindingId}' has already been destroyed.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    if (existing.state === 'released') {
      const msg = `Use-After-Release Blocked: texture binding '${existing.bindingId}' has been released.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    // Check current state in ResourceManager & AssetRegistry for hash changes / invalidation
    const currentAsset = this.registry.getAsset(existing.textureAssetId);
    const currentHandle = this.resourceManager.get(existing.textureAssetId);

    if (
      existing.state === 'invalidated' ||
      !currentAsset ||
      currentAsset.contentHash !== existing.boundContentHash ||
      !currentHandle ||
      currentHandle.state === 'invalidated'
    ) {
      const invalidatedBinding: TextureRenderBinding = Object.freeze({
        ...existing,
        state: 'invalidated',
      });
      this.bindingsById.set(existing.bindingId, invalidatedBinding);
      const msg = `Use-After-Invalidate Blocked: texture '${existing.textureAssetId}' contentHash changed or resource was invalidated.`;
      this.logger?.record(
        'rendering',
        'WARN',
        `render_resource_invalidated: id=${existing.bindingId} assetId=${existing.textureAssetId}`
      );
      return { valid: false, value: invalidatedBinding, errors: [msg] };
    }

    if (currentHandle.referenceCount <= 0 || currentHandle.state !== 'loaded') {
      const releasedBinding: TextureRenderBinding = Object.freeze({
        ...existing,
        state: 'released',
      });
      this.bindingsById.set(existing.bindingId, releasedBinding);
      const msg = `Use-After-Release Blocked: underlying ResourceHandle for '${existing.textureAssetId}' has referenceCount=${currentHandle.referenceCount}.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: releasedBinding, errors: [msg] };
    }

    return { valid: true, value: existing, errors: [] };
  }

  /**
   * Releases and destroys a TextureRenderBinding, delegating reference decrement to `ResourceManager`.
   * Prevents double destroy.
   */
  public destroyTextureBinding(
    bindingId: string
  ): RenderValidationResult<TextureRenderBinding> {
    const existing = this.bindingsById.get(bindingId);
    if (!existing) {
      const msg = `Cannot destroy unknown texture binding '${bindingId}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: null, errors: [msg] };
    }

    if (existing.state === 'destroyed') {
      const msg = `Double-Destroy Blocked: texture binding '${bindingId}' is already destroyed.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${msg}`);
      return { valid: false, value: existing, errors: [msg] };
    }

    this.resourceManager.release(existing.textureAssetId);
    const destroyed: TextureRenderBinding = Object.freeze({
      ...existing,
      state: 'destroyed',
    });
    this.bindingsById.set(bindingId, destroyed);
    if (this.activeBindingIdByAssetId.get(existing.textureAssetId) === bindingId) {
      this.activeBindingIdByAssetId.delete(existing.textureAssetId);
    }

    this.logger?.record(
      'rendering',
      'INFO',
      `render_resource_destroyed: id=${bindingId} assetId=${existing.textureAssetId}`
    );

    return { valid: true, value: destroyed, errors: [] };
  }
}
