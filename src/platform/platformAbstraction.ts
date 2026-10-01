import { HYLIX_IDENTITY, TargetPlatformId } from '../core/engineIdentity';

/**
 * Platform Abstraction Layer (PAL)
 *
 * Isolates OS-specific filesystem, lifecycle, and permission mechanics from
 * Engine Core and Editor modules. V1.0.0 implements the Android Sandbox adapter
 * while keeping future platform integration clean and non-intrusive.
 */

export interface SandboxedDirectoryLayout {
  readonly appInternalFilesRoot: string;
  readonly noBackupWorkspaceRoot: string;
  readonly atomicStagingRoot: string;
  readonly ephemeralBuildCacheRoot: string;
}

export interface AndroidAppSandboxPolicy {
  readonly applicationId: string;
  readonly minSdk: number;
  readonly targetSdk: number;
  readonly allowCloudAutoBackup: boolean;
  readonly requestedDangerousPermissions: readonly string[];
  readonly usesScopedAppStorageOnly: boolean;
}

export interface PlatformAbstractionContract {
  readonly platformId: TargetPlatformId;
  readonly isSupportedInCurrentRelease: boolean;
  readonly sandboxLayout: SandboxedDirectoryLayout;
  readonly androidPolicy: AndroidAppSandboxPolicy;
}

export function createAndroidPlatformFoundation(): PlatformAbstractionContract {
  return Object.freeze({
    platformId: TargetPlatformId.ANDROID,
    isSupportedInCurrentRelease: true,
    sandboxLayout: Object.freeze({
      appInternalFilesRoot: '/data/user/0/com.hypersoft.hylix/files',
      noBackupWorkspaceRoot: '/data/user/0/com.hypersoft.hylix/no_backup/hylix_projects',
      atomicStagingRoot: '/data/user/0/com.hypersoft.hylix/cache/hylix_atomic_staging',
      ephemeralBuildCacheRoot: '/data/user/0/com.hypersoft.hylix/cache/hylix_build_workspace',
    }),
    androidPolicy: Object.freeze({
      applicationId: HYLIX_IDENTITY.androidApplicationId,
      minSdk: 26,
      targetSdk: 35,
      allowCloudAutoBackup: false,
      requestedDangerousPermissions: Object.freeze([]),
      usesScopedAppStorageOnly: true,
    }),
  });
}

export function verifyAndroidPlatformInvariants(
  contract: PlatformAbstractionContract
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (contract.platformId !== TargetPlatformId.ANDROID) {
    errors.push('Hylix V1.0.0 active platform contract must target Android.');
  }
  if (contract.androidPolicy.applicationId !== 'com.hypersoft.hylix') {
    errors.push(
      `Invalid Application ID '${contract.androidPolicy.applicationId}'. Must be 'com.hypersoft.hylix'.`
    );
  }
  if (contract.androidPolicy.requestedDangerousPermissions.length > 0) {
    errors.push(
      `Least-Privilege Violation: Unexpected dangerous permissions requested: ${contract.androidPolicy.requestedDangerousPermissions.join(', ')}`
    );
  }
  if (contract.androidPolicy.allowCloudAutoBackup) {
    errors.push(
      'Sandbox Policy Violation: allowCloudAutoBackup must be false to protect local project workspaces.'
    );
  }
  if (!contract.androidPolicy.usesScopedAppStorageOnly) {
    errors.push('Sandbox Policy Violation: Must use scoped Android app-private storage.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface AndroidRenderSurfaceBridgeContract {
  readonly platformId: TargetPlatformId.ANDROID;
  readonly applicationId: 'com.hypersoft.hylix';
  readonly surfaceProvider: 'AndroidNativeWindowSurfaceContract';
  readonly requiresExtraAndroidPermissions: false;
  readonly allowsDirectSystemOrSdcardPaths: false;
  readonly futureGraphicsApiTargets: readonly ('Vulkan_1_1' | 'OpenGL_ES_3_0')[];
}

export function createAndroidRenderSurfaceBridgeContract(): AndroidRenderSurfaceBridgeContract {
  return Object.freeze({
    platformId: TargetPlatformId.ANDROID,
    applicationId: 'com.hypersoft.hylix',
    surfaceProvider: 'AndroidNativeWindowSurfaceContract',
    requiresExtraAndroidPermissions: false,
    allowsDirectSystemOrSdcardPaths: false,
    futureGraphicsApiTargets: Object.freeze(['Vulkan_1_1', 'OpenGL_ES_3_0'] as const),
  });
}

/**
 * Phase 07 Platform Audio Backend Contract (Requirement 23 & 24).
 *
 * Replaceable across Android, iOS, Windows, Linux, and macOS without coupling
 * Hylix Audio Core to native OS APIs or requesting extra Android permissions.
 */
export type PlatformAudioBackendLifecycleState =
  | 'uninitialized'
  | 'ready'
  | 'shutdown';

export interface PlatformAudioBackendVoiceState {
  readonly voiceId: string;
  readonly assetId: string;
  readonly status: 'stopped' | 'playing' | 'paused';
  readonly volume: number;
  readonly pitch: number;
  readonly pan: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
}

export interface PlatformAudioBackendContract {
  readonly backendName: string;
  readonly targetPlatform: TargetPlatformId;
  getState(): PlatformAudioBackendLifecycleState;
  initialize(): { readonly success: boolean; readonly error?: string };
  shutdown(): { readonly success: boolean; readonly error?: string };
  createVoice(
    voiceId: string,
    assetId: string
  ): { readonly success: boolean; readonly error?: string };
  destroyVoice(
    voiceId: string
  ): { readonly success: boolean; readonly error?: string };
  startVoice(
    voiceId: string
  ): { readonly success: boolean; readonly error?: string };
  pauseVoice(
    voiceId: string
  ): { readonly success: boolean; readonly error?: string };
  resumeVoice(
    voiceId: string
  ): { readonly success: boolean; readonly error?: string };
  stopVoice(
    voiceId: string
  ): { readonly success: boolean; readonly error?: string };
  setVolume(
    voiceId: string,
    volume: number
  ): { readonly success: boolean; readonly error?: string };
  setPitch(
    voiceId: string,
    pitch: number
  ): { readonly success: boolean; readonly error?: string };
  setPan(
    voiceId: string,
    pan: number
  ): { readonly success: boolean; readonly error?: string };
  setPosition(
    voiceId: string,
    position: { readonly x: number; readonly y: number; readonly z: number }
  ): { readonly success: boolean; readonly error?: string };
  getVoiceState(voiceId: string): PlatformAudioBackendVoiceState | null;
}

export interface AndroidAudioOutputBridgeContract {
  readonly platformId: TargetPlatformId.ANDROID;
  readonly applicationId: 'com.hypersoft.hylix';
  readonly audioProvider: 'AndroidNativeAudioOutputContract';
  readonly requiresExtraAndroidPermissions: false;
  readonly allowsDirectSystemOrSdcardPaths: false;
  readonly futureAudioApiTargets: readonly ('AAudio' | 'OpenSL_ES')[];
}

export function createAndroidAudioOutputBridgeContract(): AndroidAudioOutputBridgeContract {
  return Object.freeze({
    platformId: TargetPlatformId.ANDROID,
    applicationId: 'com.hypersoft.hylix',
    audioProvider: 'AndroidNativeAudioOutputContract',
    requiresExtraAndroidPermissions: false,
    allowsDirectSystemOrSdcardPaths: false,
    futureAudioApiTargets: Object.freeze(['AAudio', 'OpenSL_ES'] as const),
  });
}

/**
 * Deterministic contract-only reference implementation of `PlatformAudioBackendContract`.
 * Enforces backend lifecycle (`uninitialized -> ready -> shutdown`) and voice command ordering
 * without invoking hardware/OS audio drivers in Phase 07.
 */
export class NullContractAudioBackend implements PlatformAudioBackendContract {
  public readonly backendName = 'HylixNullContractAudioBackend';
  public readonly targetPlatform: TargetPlatformId;
  private state: PlatformAudioBackendLifecycleState = 'uninitialized';
  private readonly voices = new Map<string, PlatformAudioBackendVoiceState>();

  constructor(targetPlatform: TargetPlatformId = TargetPlatformId.ANDROID) {
    this.targetPlatform = targetPlatform;
  }

  public getState(): PlatformAudioBackendLifecycleState {
    return this.state;
  }

  public initialize(): { readonly success: boolean; readonly error?: string } {
    if (this.state === 'shutdown') {
      return {
        success: false,
        error: 'Cannot initialize audio backend after shutdown.',
      };
    }
    this.state = 'ready';
    return { success: true };
  }

  public shutdown(): { readonly success: boolean; readonly error?: string } {
    if (this.state === 'shutdown') {
      return {
        success: false,
        error: 'Audio backend is already shut down.',
      };
    }
    this.voices.clear();
    this.state = 'shutdown';
    return { success: true };
  }

  private ensureReady(): { readonly success: boolean; readonly error?: string } {
    if (this.state !== 'ready') {
      return {
        success: false,
        error: `Audio backend is '${this.state}' (expected 'ready').`,
      };
    }
    return { success: true };
  }

  public createVoice(
    voiceId: string,
    assetId: string
  ): { readonly success: boolean; readonly error?: string } {
    const ready = this.ensureReady();
    if (!ready.success) return ready;
    if (this.voices.has(voiceId)) {
      return {
        success: false,
        error: `Backend voice '${voiceId}' already exists.`,
      };
    }
    this.voices.set(
      voiceId,
      Object.freeze({
        voiceId,
        assetId,
        status: 'stopped',
        volume: 1,
        pitch: 1,
        pan: 0,
        position: Object.freeze({ x: 0, y: 0, z: 0 }),
      })
    );
    return { success: true };
  }

  public destroyVoice(
    voiceId: string
  ): { readonly success: boolean; readonly error?: string } {
    const ready = this.ensureReady();
    if (!ready.success) return ready;
    if (!this.voices.has(voiceId)) {
      return {
        success: false,
        error: `Backend voice '${voiceId}' does not exist.`,
      };
    }
    this.voices.delete(voiceId);
    return { success: true };
  }

  public startVoice(
    voiceId: string
  ): { readonly success: boolean; readonly error?: string } {
    const ready = this.ensureReady();
    if (!ready.success) return ready;
    const v = this.voices.get(voiceId);
    if (!v) return { success: false, error: `Unknown voice '${voiceId}'.` };
    this.voices.set(voiceId, Object.freeze({ ...v, status: 'playing' }));
    return { success: true };
  }

  public pauseVoice(
    voiceId: string
  ): { readonly success: boolean; readonly error?: string } {
    const ready = this.ensureReady();
    if (!ready.success) return ready;
    const v = this.voices.get(voiceId);
    if (!v) return { success: false, error: `Unknown voice '${voiceId}'.` };
    if (v.status !== 'playing') {
      return {
        success: false,
        error: `Cannot pause voice '${voiceId}' in state '${v.status}'.`,
      };
    }
    this.voices.set(voiceId, Object.freeze({ ...v, status: 'paused' }));
    return { success: true };
  }

  public resumeVoice(
    voiceId: string
  ): { readonly success: boolean; readonly error?: string } {
    const ready = this.ensureReady();
    if (!ready.success) return ready;
    const v = this.voices.get(voiceId);
    if (!v) return { success: false, error: `Unknown voice '${voiceId}'.` };
    if (v.status !== 'paused') {
      return {
        success: false,
        error: `Cannot resume voice '${voiceId}' in state '${v.status}'.`,
      };
    }
    this.voices.set(voiceId, Object.freeze({ ...v, status: 'playing' }));
    return { success: true };
  }

  public stopVoice(
    voiceId: string
  ): { readonly success: boolean; readonly error?: string } {
    const ready = this.ensureReady();
    if (!ready.success) return ready;
    const v = this.voices.get(voiceId);
    if (!v) return { success: false, error: `Unknown voice '${voiceId}'.` };
    this.voices.set(voiceId, Object.freeze({ ...v, status: 'stopped' }));
    return { success: true };
  }

  public setVolume(
    voiceId: string,
    volume: number
  ): { readonly success: boolean; readonly error?: string } {
    const ready = this.ensureReady();
    if (!ready.success) return ready;
    const v = this.voices.get(voiceId);
    if (!v) return { success: false, error: `Unknown voice '${voiceId}'.` };
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0) {
      return { success: false, error: `Invalid volume '${String(volume)}'.` };
    }
    this.voices.set(voiceId, Object.freeze({ ...v, volume }));
    return { success: true };
  }

  public setPitch(
    voiceId: string,
    pitch: number
  ): { readonly success: boolean; readonly error?: string } {
    const ready = this.ensureReady();
    if (!ready.success) return ready;
    const v = this.voices.get(voiceId);
    if (!v) return { success: false, error: `Unknown voice '${voiceId}'.` };
    if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch <= 0) {
      return { success: false, error: `Invalid pitch '${String(pitch)}'.` };
    }
    this.voices.set(voiceId, Object.freeze({ ...v, pitch }));
    return { success: true };
  }

  public setPan(
    voiceId: string,
    pan: number
  ): { readonly success: boolean; readonly error?: string } {
    const ready = this.ensureReady();
    if (!ready.success) return ready;
    const v = this.voices.get(voiceId);
    if (!v) return { success: false, error: `Unknown voice '${voiceId}'.` };
    if (
      typeof pan !== 'number' ||
      !Number.isFinite(pan) ||
      pan < -1 ||
      pan > 1
    ) {
      return { success: false, error: `Invalid pan '${String(pan)}'.` };
    }
    this.voices.set(voiceId, Object.freeze({ ...v, pan }));
    return { success: true };
  }

  public setPosition(
    voiceId: string,
    position: { readonly x: number; readonly y: number; readonly z: number }
  ): { readonly success: boolean; readonly error?: string } {
    const ready = this.ensureReady();
    if (!ready.success) return ready;
    const v = this.voices.get(voiceId);
    if (!v) return { success: false, error: `Unknown voice '${voiceId}'.` };
    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z)
    ) {
      return { success: false, error: 'Invalid 3D position.' };
    }
    this.voices.set(
      voiceId,
      Object.freeze({
        ...v,
        position: Object.freeze({
          x: position.x,
          y: position.y,
          z: position.z,
        }),
      })
    );
    return { success: true };
  }

  public getVoiceState(voiceId: string): PlatformAudioBackendVoiceState | null {
    return this.voices.get(voiceId) ?? null;
  }
}

