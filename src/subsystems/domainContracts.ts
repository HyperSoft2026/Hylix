import { SubsystemId, TargetPlatformId } from '../core/engineIdentity';

/**
 * Hylix V1.0.0 — Subsystem Architectural Boundary Contracts
 *
 * Defines strict, decoupled interfaces between Engine Core, Editor, Rendering,
 * Scene, ECS, Assets, Scripting, Input, Audio, Physics, and Build System.
 * Note: Concrete runtime implementations belong to subsequent milestones;
 * this file defines the foundational contracts only.
 */

export type SubsystemLifecycleState =
  | 'UNINITIALIZED'
  | 'INITIALIZED'
  | 'FAULTED'
  | 'SHUTDOWN';

export interface SubsystemBoundaryContract {
  readonly subsystemId: SubsystemId;
  readonly contractVersion: string;
  readonly state: SubsystemLifecycleState;
}

export interface EditorSubsystemContract extends SubsystemBoundaryContract {
  readonly subsystemId: SubsystemId.EDITOR;
  readonly supportsDirectBuildToolExecution: false;
  readonly requiresCloudAccount: false;
}

export interface RenderingSubsystemContract extends SubsystemBoundaryContract {
  readonly subsystemId: SubsystemId.RENDERING;
  readonly supportedDimensions: readonly ('2D' | '3D')[];
}

export interface SceneSubsystemContract extends SubsystemBoundaryContract {
  readonly subsystemId: SubsystemId.SCENE_SYSTEM;
  readonly deterministicSerialization: true;
}

export interface EcsSubsystemContract extends SubsystemBoundaryContract {
  readonly subsystemId: SubsystemId.ECS;
  readonly dataOrientedArchetypes: true;
}

export interface AssetSubsystemContract extends SubsystemBoundaryContract {
  readonly subsystemId: SubsystemId.ASSET_SYSTEM;
  readonly requiresIntegrityHashVerification: true;
}

export interface ScriptingSubsystemContract extends SubsystemBoundaryContract {
  readonly subsystemId: SubsystemId.SCRIPTING;
  readonly sandboxedHostBoundary: true;
  readonly allowsDirectFilesystemEscape: false;
}

export interface InputSubsystemContract extends SubsystemBoundaryContract {
  readonly subsystemId: SubsystemId.INPUT;
  readonly primaryTouchAndGestureSupport: true;
}

export interface AudioSubsystemContract extends SubsystemBoundaryContract {
  readonly subsystemId: SubsystemId.AUDIO;
  readonly localAssetDecodingOnly: true;
}

export interface PhysicsSubsystemContract extends SubsystemBoundaryContract {
  readonly subsystemId: SubsystemId.PHYSICS;
  readonly deterministicFixedTimestepHz: number;
}

export interface BuildSubsystemContract extends SubsystemBoundaryContract {
  readonly subsystemId: SubsystemId.BUILD_SYSTEM;
  readonly targetPlatform: TargetPlatformId.ANDROID;
  readonly usesIsolatedBuildWorkspace: true;
  readonly guaranteedPostBuildCleanup: true;
  readonly allowsUntrustedShellExecution: false;
}
