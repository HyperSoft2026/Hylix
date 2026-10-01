/**
 * Hylix V1.0.0 — Immutable Engine & Application Identity
 *
 * Defines the canonical constants for Hylix by HyperSoft.
 * Any modification to ANDROID_APPLICATION_ID or OFFICIAL_LOGO_PATH
 * is a critical architectural violation.
 */

export const HYLIX_IDENTITY = Object.freeze({
  projectName: 'Hylix',
  organization: 'HyperSoft',
  license: 'MIT',
  version: '1.0.0',
  repositoryUrl: 'https://github.com/HyperSoft2026/Hylix',
  androidApplicationId: 'com.hypersoft.hylix',
  officialLogoRelativePath: 'branding/logo/hylix-logo.png',
  localFirstOnly: true,
});

export enum TargetPlatformId {
  ANDROID = 'android',
  WINDOWS = 'windows',
  LINUX = 'linux',
  MACOS = 'macos',
  IOS = 'ios',
}

export interface PlatformSupportDescriptor {
  readonly id: TargetPlatformId;
  readonly displayName: string;
  readonly activeInV1: boolean;
  readonly packagingFormat: string;
  readonly architecturalStatus: 'Active Target (V1.0.0)' | 'Reserved Abstraction Contract (Future)';
}

export const PLATFORM_ROADMAP_MATRIX: readonly PlatformSupportDescriptor[] = Object.freeze([
  {
    id: TargetPlatformId.ANDROID,
    displayName: 'Android',
    activeInV1: true,
    packagingFormat: 'APK / AAB (com.hypersoft.hylix)',
    architecturalStatus: 'Active Target (V1.0.0)',
  },
  {
    id: TargetPlatformId.WINDOWS,
    displayName: 'Windows',
    activeInV1: false,
    packagingFormat: 'PE64 Native Bundle (Future)',
    architecturalStatus: 'Reserved Abstraction Contract (Future)',
  },
  {
    id: TargetPlatformId.LINUX,
    displayName: 'Linux',
    activeInV1: false,
    packagingFormat: 'ELF64 Native Bundle (Future)',
    architecturalStatus: 'Reserved Abstraction Contract (Future)',
  },
  {
    id: TargetPlatformId.MACOS,
    displayName: 'macOS',
    activeInV1: false,
    packagingFormat: 'Mach-O Universal App Bundle (Future)',
    architecturalStatus: 'Reserved Abstraction Contract (Future)',
  },
  {
    id: TargetPlatformId.IOS,
    displayName: 'iOS',
    activeInV1: false,
    packagingFormat: 'IPA Bundle (Future)',
    architecturalStatus: 'Reserved Abstraction Contract (Future)',
  },
]);

export enum SubsystemId {
  ENGINE_CORE = 'engine_core',
  PLATFORM_ANDROID = 'platform_android',
  SECURITY = 'security',
  STORAGE = 'storage',
  DEBUGGING = 'debugging',
  PROJECT_SYSTEM = 'project_system',
  ASSET_SYSTEM = 'asset_system',
  ECS = 'entity_component_system',
  SCENE_SYSTEM = 'scene_system',
  RENDERING = 'rendering',
  PHYSICS = 'physics',
  AUDIO = 'audio',
  INPUT = 'input',
  SCRIPTING = 'scripting',
  BUILD_SYSTEM = 'build_system',
  EDITOR = 'editor',
  TESTING = 'testing',
}
