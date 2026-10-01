import { TargetPlatformId } from '../core/engineIdentity';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  CapabilityStatusMarker,
  CapabilityValue,
  isFiniteNumber,
  isPlainRenderObject,
  RenderBackendLifecycleState,
  RenderCapabilities,
  RenderValidationResult,
} from './renderTypes';
import { createViewport, validateViewport, Viewport } from './viewport';

/**
 * Hylix V1.0.0 — Phase 05: Graphics Backend Contract & Render Capabilities (STEP 3, STEP 5, STEP 6)
 *
 * Isolates Hylix Rendering Core from platform graphics APIs (Vulkan, OpenGL ES, Metal, DirectX).
 * Enforces strict lifecycle transitions:
 *   uninitialized -> initializing -> ready -> rendering -> ready -> shutdown
 * and honest capability reporting (`unknown` / `unsupported` / `notInitialized` when no real GPU is bound).
 */

const VALID_CAPABILITY_MARKERS: ReadonlySet<CapabilityStatusMarker> =
  new Set<CapabilityStatusMarker>(['unknown', 'unsupported', 'notInitialized']);

function isValidCapabilityBoolean(val: unknown): val is CapabilityValue<boolean> {
  return (
    typeof val === 'boolean' ||
    (typeof val === 'string' &&
      VALID_CAPABILITY_MARKERS.has(val as CapabilityStatusMarker))
  );
}

function isValidCapabilityPositiveInt(val: unknown): val is CapabilityValue<number> {
  return (
    (typeof val === 'number' && Number.isInteger(val) && val > 0) ||
    (typeof val === 'string' &&
      VALID_CAPABILITY_MARKERS.has(val as CapabilityStatusMarker))
  );
}

/**
 * Returns honest `notInitialized` / `unknown` / `unsupported` capabilities when
 * no physical GPU backend is bound, rather than fabricating fake hardware limits.
 */
export function createUnboundRenderCapabilities(
  targetPlatform: TargetPlatformId = TargetPlatformId.ANDROID,
  backendInitialized = false
): RenderCapabilities {
  const status: CapabilityStatusMarker = backendInitialized
    ? 'unknown'
    : 'notInitialized';
  return Object.freeze({
    backendInitialized,
    targetPlatform,
    maxTextureSize: status,
    supports2D: backendInitialized ? true : 'notInitialized',
    supports3D: backendInitialized ? true : 'notInitialized',
    supportsInstancing: status,
    supportsDepthBuffer: status,
    supportsMultisampling: status,
    supportsCompute: 'unsupported',
    supportsHDR: status,
    maxUniformBufferSize: status,
    maxVertexAttributes: status,
  });
}

export function validateRenderCapabilities(
  candidate: unknown
): RenderValidationResult<RenderCapabilities> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['RenderCapabilities must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  if (typeof candidate.backendInitialized !== 'boolean') {
    errors.push('RenderCapabilities.backendInitialized must be a boolean.');
  }

  if (!isValidCapabilityPositiveInt(candidate.maxTextureSize)) {
    errors.push(
      `Invalid RenderCapabilities.maxTextureSize '${String(candidate.maxTextureSize)}'.`
    );
  }
  if (!isValidCapabilityBoolean(candidate.supports2D)) {
    errors.push(`Invalid RenderCapabilities.supports2D '${String(candidate.supports2D)}'.`);
  }
  if (!isValidCapabilityBoolean(candidate.supports3D)) {
    errors.push(`Invalid RenderCapabilities.supports3D '${String(candidate.supports3D)}'.`);
  }
  if (!isValidCapabilityBoolean(candidate.supportsInstancing)) {
    errors.push('Invalid RenderCapabilities.supportsInstancing.');
  }
  if (!isValidCapabilityBoolean(candidate.supportsDepthBuffer)) {
    errors.push('Invalid RenderCapabilities.supportsDepthBuffer.');
  }
  if (!isValidCapabilityBoolean(candidate.supportsMultisampling)) {
    errors.push('Invalid RenderCapabilities.supportsMultisampling.');
  }
  if (!isValidCapabilityBoolean(candidate.supportsCompute)) {
    errors.push('Invalid RenderCapabilities.supportsCompute.');
  }
  if (!isValidCapabilityBoolean(candidate.supportsHDR)) {
    errors.push('Invalid RenderCapabilities.supportsHDR.');
  }
  if (!isValidCapabilityPositiveInt(candidate.maxUniformBufferSize)) {
    errors.push('Invalid RenderCapabilities.maxUniformBufferSize.');
  }
  if (!isValidCapabilityPositiveInt(candidate.maxVertexAttributes)) {
    errors.push('Invalid RenderCapabilities.maxVertexAttributes.');
  }

  // Guard against fabricated hardware numbers when backendInitialized === false
  if (
    candidate.backendInitialized === false &&
    (isFiniteNumber(candidate.maxTextureSize) ||
      isFiniteNumber(candidate.maxUniformBufferSize) ||
      isFiniteNumber(candidate.maxVertexAttributes))
  ) {
    errors.push(
      'Uninitialized RenderBackend must not report fabricated numeric GPU hardware limits; use notInitialized or unknown.'
    );
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      backendInitialized: candidate.backendInitialized as boolean,
      targetPlatform:
        (candidate.targetPlatform as TargetPlatformId) ?? TargetPlatformId.ANDROID,
      maxTextureSize: candidate.maxTextureSize as CapabilityValue<number>,
      supports2D: candidate.supports2D as CapabilityValue<boolean>,
      supports3D: candidate.supports3D as CapabilityValue<boolean>,
      supportsInstancing: candidate.supportsInstancing as CapabilityValue<boolean>,
      supportsDepthBuffer: candidate.supportsDepthBuffer as CapabilityValue<boolean>,
      supportsMultisampling: candidate.supportsMultisampling as CapabilityValue<boolean>,
      supportsCompute: candidate.supportsCompute as CapabilityValue<boolean>,
      supportsHDR: candidate.supportsHDR as CapabilityValue<boolean>,
      maxUniformBufferSize: candidate.maxUniformBufferSize as CapabilityValue<number>,
      maxVertexAttributes: candidate.maxVertexAttributes as CapabilityValue<number>,
    }),
    errors: [],
  };
}

const VALID_BACKEND_TRANSITIONS: Readonly<
  Record<RenderBackendLifecycleState, ReadonlySet<RenderBackendLifecycleState>>
> = Object.freeze({
  uninitialized: new Set<RenderBackendLifecycleState>(['initializing']),
  initializing: new Set<RenderBackendLifecycleState>(['ready', 'shutdown']),
  ready: new Set<RenderBackendLifecycleState>(['rendering', 'shutdown']),
  rendering: new Set<RenderBackendLifecycleState>(['ready']),
  shutdown: new Set<RenderBackendLifecycleState>(['initializing']),
});

export function isValidRenderBackendStateTransition(
  fromState: RenderBackendLifecycleState,
  toState: RenderBackendLifecycleState
): boolean {
  const allowed = VALID_BACKEND_TRANSITIONS[fromState];
  return Boolean(allowed && allowed.has(toState));
}

export interface RenderBackend {
  getBackendId(): string;
  getTargetPlatform(): TargetPlatformId;
  getState(): RenderBackendLifecycleState;
  getViewport(): Viewport;
  initialize(viewport?: Viewport): {
    readonly success: boolean;
    readonly state: RenderBackendLifecycleState;
    readonly error?: string;
  };
  shutdown(): {
    readonly success: boolean;
    readonly state: RenderBackendLifecycleState;
    readonly error?: string;
  };
  beginFrame(frameNumber?: number): {
    readonly success: boolean;
    readonly state: RenderBackendLifecycleState;
    readonly error?: string;
  };
  endFrame(frameNumber?: number): {
    readonly success: boolean;
    readonly state: RenderBackendLifecycleState;
    readonly error?: string;
  };
  resize(viewport: Viewport): {
    readonly success: boolean;
    readonly viewport: Viewport | null;
    readonly error?: string;
  };
  getCapabilities(): RenderCapabilities;
}

/**
 * Platform-Independent Contract RenderBackend for Phase 05 Foundation.
 * Enforces strict state machine transitions and honest capability reporting without
 * coupling Core to Vulkan, OpenGL ES, Metal, or DirectX.
 */
export class NullContractRenderBackend implements RenderBackend {
  private readonly backendId: string;
  private readonly targetPlatform: TargetPlatformId;
  private readonly logger?: RedactedDiagnosticLogger;
  private state: RenderBackendLifecycleState = 'uninitialized';
  private activeViewport: Viewport = createViewport(1280, 720, 0, 0).value!;
  private activeFrameNumber: number | null = null;

  constructor(options?: {
    readonly backendId?: string;
    readonly targetPlatform?: TargetPlatformId;
    readonly logger?: RedactedDiagnosticLogger;
  }) {
    this.backendId = options?.backendId ?? 'hylix_contract_backend_v1';
    this.targetPlatform = options?.targetPlatform ?? TargetPlatformId.ANDROID;
    this.logger = options?.logger;
  }

  public getBackendId(): string {
    return this.backendId;
  }

  public getTargetPlatform(): TargetPlatformId {
    return this.targetPlatform;
  }

  public getState(): RenderBackendLifecycleState {
    return this.state;
  }

  public getViewport(): Viewport {
    return this.activeViewport;
  }

  private transitionTo(
    targetState: RenderBackendLifecycleState
  ): { success: boolean; error?: string } {
    if (!isValidRenderBackendStateTransition(this.state, targetState)) {
      const err = `Illegal RenderBackend transition '${this.state}' -> '${targetState}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${err}`);
      return { success: false, error: err };
    }
    this.state = targetState;
    return { success: true };
  }

  public initialize(viewport?: Viewport): {
    readonly success: boolean;
    readonly state: RenderBackendLifecycleState;
    readonly error?: string;
  } {
    if (viewport !== undefined) {
      const vpCheck = validateViewport(viewport);
      if (!vpCheck.valid || !vpCheck.value) {
        const err = `Cannot initialize RenderBackend with invalid viewport: ${vpCheck.errors.join('; ')}`;
        this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${err}`);
        return { success: false, state: this.state, error: err };
      }
      this.activeViewport = vpCheck.value;
    }

    const toInit = this.transitionTo('initializing');
    if (!toInit.success) {
      return { success: false, state: this.state, error: toInit.error };
    }

    const toReady = this.transitionTo('ready');
    if (!toReady.success) {
      return { success: false, state: this.state, error: toReady.error };
    }

    this.logger?.record(
      'rendering',
      'INFO',
      `render_backend_initialized: backend=${this.backendId} platform=${this.targetPlatform} viewport=${this.activeViewport.width}x${this.activeViewport.height}`
    );

    return { success: true, state: this.state };
  }

  public beginFrame(frameNumber = 1): {
    readonly success: boolean;
    readonly state: RenderBackendLifecycleState;
    readonly error?: string;
  } {
    const tr = this.transitionTo('rendering');
    if (!tr.success) {
      return { success: false, state: this.state, error: tr.error };
    }
    this.activeFrameNumber = frameNumber;
    return { success: true, state: this.state };
  }

  public endFrame(frameNumber?: number): {
    readonly success: boolean;
    readonly state: RenderBackendLifecycleState;
    readonly error?: string;
  } {
    if (
      frameNumber !== undefined &&
      this.activeFrameNumber !== null &&
      frameNumber !== this.activeFrameNumber
    ) {
      const err = `Frame number mismatch in RenderBackend.endFrame: expected ${this.activeFrameNumber}, received ${frameNumber}.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${err}`);
      return { success: false, state: this.state, error: err };
    }

    const tr = this.transitionTo('ready');
    if (!tr.success) {
      return { success: false, state: this.state, error: tr.error };
    }
    this.activeFrameNumber = null;
    return { success: true, state: this.state };
  }

  public resize(viewport: Viewport): {
    readonly success: boolean;
    readonly viewport: Viewport | null;
    readonly error?: string;
  } {
    if (this.state !== 'ready') {
      const err = `Cannot resize RenderBackend while in state '${this.state}'; must be 'ready'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${err}`);
      return { success: false, viewport: null, error: err };
    }

    const vpCheck = validateViewport(viewport);
    if (!vpCheck.valid || !vpCheck.value) {
      const err = vpCheck.errors.join('; ');
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${err}`);
      return { success: false, viewport: null, error: err };
    }

    this.activeViewport = vpCheck.value;
    return { success: true, viewport: this.activeViewport };
  }

  public shutdown(): {
    readonly success: boolean;
    readonly state: RenderBackendLifecycleState;
    readonly error?: string;
  } {
    const tr = this.transitionTo('shutdown');
    if (!tr.success) {
      return { success: false, state: this.state, error: tr.error };
    }
    this.activeFrameNumber = null;
    this.logger?.record(
      'rendering',
      'INFO',
      `render_backend_shutdown: backend=${this.backendId}`
    );
    return { success: true, state: this.state };
  }

  public getCapabilities(): RenderCapabilities {
    const isInit = this.state === 'ready' || this.state === 'rendering';
    return createUnboundRenderCapabilities(this.targetPlatform, isInit);
  }
}
