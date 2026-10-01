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

