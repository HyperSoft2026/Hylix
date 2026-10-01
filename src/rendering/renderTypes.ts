import { computeDeterministicChecksum } from '../storage/atomicStorage';
import { TargetPlatformId } from '../core/engineIdentity';

/**
 * Hylix V1.0.0 — Phase 05: Rendering Foundation Common Types & Contracts
 *
 * Platform-independent, Local-First rendering types owned 100% by Hylix.
 * Zero dependency on Three.js, Babylon.js, PixiJS, Phaser, or any external engine.
 */

export type RenderDimensionMode = '2D' | '3D' | '2.5D';

export type RenderBackendLifecycleState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'rendering'
  | 'shutdown';

export type FrameLifecycleState =
  | 'FrameCreated'
  | 'FrameBegun'
  | 'CommandsRecorded'
  | 'FrameSubmitted'
  | 'FrameCompleted';

export type RenderDeviceSyncState =
  | 'uninitialized'
  | 'idle'
  | 'recording'
  | 'submitting'
  | 'synchronized'
  | 'shutdown';

export type CapabilityStatusMarker = 'unknown' | 'unsupported' | 'notInitialized';

export type CapabilityValue<T> = T | CapabilityStatusMarker;

/**
 * Hardware capability contract (STEP 6).
 * Never fabricates fake hardware numbers when a real GPU backend is not initialized.
 */
export interface RenderCapabilities {
  readonly backendInitialized: boolean;
  readonly targetPlatform: TargetPlatformId;
  readonly maxTextureSize: CapabilityValue<number>;
  readonly supports2D: CapabilityValue<boolean>;
  readonly supports3D: CapabilityValue<boolean>;
  readonly supportsInstancing: CapabilityValue<boolean>;
  readonly supportsDepthBuffer: CapabilityValue<boolean>;
  readonly supportsMultisampling: CapabilityValue<boolean>;
  readonly supportsCompute: CapabilityValue<boolean>;
  readonly supportsHDR: CapabilityValue<boolean>;
  readonly maxUniformBufferSize: CapabilityValue<number>;
  readonly maxVertexAttributes: CapabilityValue<number>;
}

export interface RenderValidationResult<T> {
  readonly valid: boolean;
  readonly value: T | null;
  readonly errors: readonly string[];
}

export type RenderDiagnosticEventType =
  | 'render_backend_initialized'
  | 'render_backend_shutdown'
  | 'frame_started'
  | 'frame_submitted'
  | 'frame_completed'
  | 'render_resource_created'
  | 'render_resource_destroyed'
  | 'render_resource_invalidated'
  | 'render_queue_built'
  | 'render_validation_failed'
  | 'camera_created'
  | 'camera_validation_failed';

let renderDeterministicCounter = 0;

/**
 * Generates a deterministic Hylix rendering identifier (`<prefix>_<16-hex>`).
 */
export function createDeterministicRenderId(
  prefix: string,
  seedHint?: string
): string {
  renderDeterministicCounter += 1;
  const cleanPrefix = prefix.replace(/[^a-z0-9_]/gi, '').toLowerCase() || 'rnd';
  const seed = seedHint ?? `hylix_render::${cleanPrefix}::${renderDeterministicCounter}`;
  const digest = computeDeterministicChecksum(`hylix_render_id::${cleanPrefix}::${seed}`);
  return `${cleanPrefix}_${digest}`;
}

export function isPlainRenderObject(
  candidate: unknown
): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}

export function isFiniteNumber(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isFinite(candidate);
}

const FORBIDDEN_RENDER_INPUT_PATTERNS: readonly RegExp[] = Object.freeze([
  /\0/,
  /(^|[\\/])\.\.([\\/]|$)/,
  /^[a-zA-Z]:([\\/]|$)/,
  /^\\\\/,
  /^\/(sdcard|system|data|proc|etc|dev|storage|mnt|root|var|tmp)(\/|$)/i,
  /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i, // Blocks http://, https://, file://, ftp://, etc.
  /\b(eval|Function|child_process|execSync|spawnSync)\b/,
]);

/**
 * Inspects a string to ensure it does not contain forbidden paths, remote URLs,
 * Android system paths (/sdcard, /system, /data, /proc), or dynamic code execution tokens.
 */
export function isForbiddenRenderInputString(candidate: string): {
  forbidden: boolean;
  reason?: string;
} {
  for (const pattern of FORBIDDEN_RENDER_INPUT_PATTERNS) {
    if (pattern.test(candidate)) {
      return {
        forbidden: true,
        reason: `String '${candidate}' violates Hylix Local-First Rendering Security Policy (${pattern.source}).`,
      };
    }
  }
  return { forbidden: false };
}
