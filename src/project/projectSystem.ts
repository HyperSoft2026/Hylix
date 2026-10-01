import { HYLIX_IDENTITY, TargetPlatformId } from '../core/engineIdentity';
import {
  validateProjectScopedPath,
  validateWorkspaceRelativePath,
} from '../security/securityFoundation';
import {
  computeDeterministicChecksum,
  LocalFirstAtomicStore,
} from '../storage/atomicStorage';
import {
  AssetRegistryDocument,
  createDeterministicAssetId,
  validateAssetRegistryDocument,
} from '../assets/assetRegistry';
import {
  acquireWorkspaceLock,
  inspectWorkspaceLock,
  releaseWorkspaceLock,
  WorkspaceLockRecord,
} from './workspaceLock';

/**
 * Hylix Project System & Local Workspace Lifecycle
 *
 * Implements:
 * - Deterministic Project Creation with canonical directory layout
 * - Strict Manifest Schema Validation (zero trust on user JSON)
 * - 9-Step Safe Project Open with Lock & Stale Crash Recovery
 * - Conservative Project Validation & Repair (zero deletion of user files)
 * - Strict separation between Project Data, Disposable Cache (`cache/`), and Build Outputs (`build/`)
 */

export const CURRENT_PROJECT_SCHEMA_VERSION = 1;
export const MAX_SUPPORTED_PROJECT_SCHEMA_VERSION = 3;

export const REQUIRED_PROJECT_DIRECTORIES: readonly string[] = Object.freeze([
  'scenes',
  'assets',
  'assets/textures',
  'assets/models',
  'assets/audio',
  'assets/materials',
  'assets/fonts',
  'scripts',
  'plugins',
  'build',
  'cache',
  '.hylix',
]);

export interface HylixProjectSettings {
  readonly targetFps: number;
  readonly orientation: 'landscape' | 'portrait' | 'sensor';
  readonly localFirst: true;
  readonly physicsTickHz?: number;
  readonly buildProfile?: 'debug_sandbox' | 'release_unsigned';
}

export interface HylixProjectManifest {
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly packageId: string;
  readonly defaultScene: string;
  readonly supportedTargets: readonly TargetPlatformId[];
  readonly projectSettings: HylixProjectSettings;
}

export interface ProjectValidationResult {
  readonly valid: boolean;
  readonly manifest: HylixProjectManifest | null;
  readonly errors: readonly string[];
}

const VALID_PACKAGE_ID_REGEX = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const VALID_PROJECT_ID_REGEX = /^[a-z0-9_-]{4,64}$/i;

const ALLOWED_MANIFEST_TOP_KEYS = new Set([
  'schemaVersion',
  'engineVersion',
  'projectId',
  'projectName',
  'packageId',
  'defaultScene',
  'supportedTargets',
  'projectSettings',
  // Legacy Phase-1 compatibility fields
  'targetPlatform',
  'entrySceneRelativePath',
  'localFirstMode',
]);

const ALLOWED_PROJECT_SETTINGS_KEYS = new Set([
  'targetFps',
  'orientation',
  'localFirst',
  'physicsTickHz',
  'buildProfile',
]);

export function generateImmutableProjectId(
  projectFolder: string,
  packageId: string
): string {
  const digest = computeDeterministicChecksum(
    `hylix_project_id::${projectFolder.trim()}::${packageId.trim()}`
  );
  return `prj_${digest}`;
}

export function isValidAndroidPackageId(packageId: string): boolean {
  if (typeof packageId !== 'string') return false;
  if (packageId.length < 5 || packageId.length > 128) return false;
  return VALID_PACKAGE_ID_REGEX.test(packageId);
}

/**
 * Validates a parsed manifest object or untrusted payload.
 * Optionally verifies that `defaultScene` exists inside `store` under `projectRoot`.
 */
export function validateProjectManifest(
  candidate: unknown,
  workspaceContext?: {
    store: LocalFirstAtomicStore;
    projectRoot: string;
  }
): ProjectValidationResult {
  const errors: string[] = [];

  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return {
      valid: false,
      manifest: null,
      errors: ['Project manifest must be a non-null JSON object.'],
    };
  }

  const obj = candidate as Record<string, unknown>;

  // 1. Reject unexpected top-level keys
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_MANIFEST_TOP_KEYS.has(key)) {
      errors.push(`Unexpected property '${key}' in project manifest.`);
    }
  }

  // 2. Validate schemaVersion (1..3 supported)
  if (
    typeof obj.schemaVersion !== 'number' ||
    !Number.isInteger(obj.schemaVersion) ||
    obj.schemaVersion < CURRENT_PROJECT_SCHEMA_VERSION ||
    obj.schemaVersion > MAX_SUPPORTED_PROJECT_SCHEMA_VERSION
  ) {
    errors.push(
      `Unsupported project schemaVersion '${String(obj.schemaVersion)}'. Supported versions: ${CURRENT_PROJECT_SCHEMA_VERSION}..${MAX_SUPPORTED_PROJECT_SCHEMA_VERSION}.`
    );
  }

  // 3. Validate engineVersion
  if (obj.engineVersion !== HYLIX_IDENTITY.version) {
    errors.push(
      `Engine version mismatch: manifest requires '${String(obj.engineVersion)}', active engine is '${HYLIX_IDENTITY.version}'.`
    );
  }

  // 4. Validate projectId
  if (
    typeof obj.projectId !== 'string' ||
    !VALID_PROJECT_ID_REGEX.test(obj.projectId)
  ) {
    errors.push(
      'projectId must be a valid 4-64 character alphanumeric identifier (created once and never randomized).'
    );
  }

  // 5. Validate projectName
  if (typeof obj.projectName !== 'string' || obj.projectName.trim().length === 0) {
    errors.push('projectName must be a non-empty string.');
  }

  // Check if this is the Phase-1 legacy format or Phase-2 full manifest format
  const isPhase1LegacyShape =
    'entrySceneRelativePath' in obj && !('packageId' in obj);

  let resolvedPackageId = 'com.hypersoft.hylix.project';
  let resolvedDefaultScene = '';
  let resolvedTargets: TargetPlatformId[] = [TargetPlatformId.ANDROID];
  let resolvedSettings: HylixProjectSettings = {
    targetFps: 60,
    orientation: 'landscape',
    localFirst: true,
  };

  if (isPhase1LegacyShape) {
    if (obj.targetPlatform !== TargetPlatformId.ANDROID) {
      errors.push(
        `Hylix V1.0.0 only supports '${TargetPlatformId.ANDROID}' as an active project targetPlatform.`
      );
    }
    if (typeof obj.entrySceneRelativePath !== 'string') {
      errors.push('entrySceneRelativePath must be a string.');
    } else {
      const pathCheck = validateWorkspaceRelativePath(obj.entrySceneRelativePath);
      if (!pathCheck.safe) {
        errors.push(`Invalid entrySceneRelativePath: ${pathCheck.reason}`);
      } else {
        resolvedDefaultScene = pathCheck.normalizedPath;
      }
    }
    if (obj.localFirstMode !== true) {
      errors.push('Hylix projects must operate in localFirstMode (true).');
    }
  } else {
    // Full Phase-2 Manifest Validation
    if (typeof obj.packageId !== 'string' || !isValidAndroidPackageId(obj.packageId)) {
      errors.push(
        `Invalid packageId '${String(obj.packageId)}'. Must be a valid lowercase reverse-domain Android package identifier (e.g. com.company.game).`
      );
    } else {
      resolvedPackageId = obj.packageId;
    }

    if (typeof obj.defaultScene !== 'string' || obj.defaultScene.trim().length === 0) {
      errors.push('defaultScene must be a non-empty relative path string.');
    } else {
      const scenePathCheck = validateWorkspaceRelativePath(obj.defaultScene);
      if (!scenePathCheck.safe) {
        errors.push(`Unsafe defaultScene path: ${scenePathCheck.reason}`);
      } else if (!scenePathCheck.normalizedPath.startsWith('scenes/')) {
        errors.push(`defaultScene '${obj.defaultScene}' must reside inside 'scenes/'.`);
      } else {
        resolvedDefaultScene = scenePathCheck.normalizedPath;
        if (workspaceContext) {
          const scopedScene = validateProjectScopedPath(
            workspaceContext.projectRoot,
            resolvedDefaultScene
          );
          if (
            !scopedScene.safe ||
            !workspaceContext.store.fileExists(scopedScene.normalizedPath)
          ) {
            errors.push(
              `defaultScene file '${resolvedDefaultScene}' does not exist in project workspace '${workspaceContext.projectRoot}'.`
            );
          }
        }
      }
    }

    if (!Array.isArray(obj.supportedTargets) || obj.supportedTargets.length === 0) {
      errors.push('supportedTargets must be a non-empty array containing ["android"].');
    } else {
      for (const target of obj.supportedTargets) {
        if (target !== TargetPlatformId.ANDROID) {
          errors.push(
            `Unsupported target '${String(target)}' in supportedTargets; Hylix V1.0.0 supports only 'android'.`
          );
        }
      }
      resolvedTargets = [TargetPlatformId.ANDROID];
    }

    if (obj.projectSettings !== undefined) {
      if (
        typeof obj.projectSettings !== 'object' ||
        obj.projectSettings === null ||
        Array.isArray(obj.projectSettings)
      ) {
        errors.push('projectSettings must be a valid object.');
      } else {
        const settingsObj = obj.projectSettings as Record<string, unknown>;
        for (const k of Object.keys(settingsObj)) {
          if (!ALLOWED_PROJECT_SETTINGS_KEYS.has(k)) {
            errors.push(`Unexpected property '${k}' in projectSettings.`);
          }
        }
        const fps = settingsObj.targetFps ?? 60;
        if (typeof fps !== 'number' || (fps !== 30 && fps !== 60 && fps !== 120)) {
          errors.push('projectSettings.targetFps must be 30, 60, or 120.');
        }
        const orient = settingsObj.orientation ?? 'landscape';
        if (orient !== 'landscape' && orient !== 'portrait' && orient !== 'sensor') {
          errors.push(
            "projectSettings.orientation must be 'landscape', 'portrait', or 'sensor'."
          );
        }
        if (settingsObj.localFirst !== undefined && settingsObj.localFirst !== true) {
          errors.push('projectSettings.localFirst must be true.');
        }
        resolvedSettings = {
          targetFps: typeof fps === 'number' ? fps : 60,
          orientation:
            orient === 'landscape' || orient === 'portrait' || orient === 'sensor'
              ? orient
              : 'landscape',
          localFirst: true,
        };
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      manifest: null,
      errors,
    };
  }

  const normalizedManifest: HylixProjectManifest = Object.freeze({
    schemaVersion: obj.schemaVersion as number,
    engineVersion: HYLIX_IDENTITY.version,
    projectId: obj.projectId as string,
    projectName: (obj.projectName as string).trim(),
    packageId: resolvedPackageId,
    defaultScene: resolvedDefaultScene,
    supportedTargets: Object.freeze(resolvedTargets),
    projectSettings: Object.freeze(resolvedSettings),
  });

  return {
    valid: true,
    manifest: normalizedManifest,
    errors: [],
  };
}

export function validateProjectManifestJsonString(
  rawJson: string,
  workspaceContext?: {
    store: LocalFirstAtomicStore;
    projectRoot: string;
  }
): ProjectValidationResult {
  if (typeof rawJson !== 'string' || rawJson.trim().length === 0) {
    return {
      valid: false,
      manifest: null,
      errors: ['Manifest JSON string is empty.'],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return {
      valid: false,
      manifest: null,
      errors: ['Malformed JSON syntax in project.hylix.json.'],
    };
  }

  return validateProjectManifest(parsed, workspaceContext);
}

export interface CreateProjectInput {
  readonly projectFolder: string;
  readonly projectName: string;
  readonly packageId: string;
  readonly defaultScene?: string;
}

export interface CreateProjectResult {
  readonly success: boolean;
  readonly projectRoot: string;
  readonly manifest: HylixProjectManifest | null;
  readonly createdDirectories: readonly string[];
  readonly createdFiles: readonly string[];
  readonly errors: readonly string[];
}

export interface OpenProjectResult {
  readonly success: boolean;
  readonly status:
    | 'OPENED'
    | 'LOCKED_BY_OTHER_SESSION'
    | 'CORRUPTED_NEEDS_REPAIR'
    | 'INVALID_PATH_OR_MISSING';
  readonly projectRoot: string;
  readonly manifest: HylixProjectManifest | null;
  readonly lockRecord: WorkspaceLockRecord | null;
  readonly recoveredFromStaleLock: boolean;
  readonly recreatedMissingDirectories: readonly string[];
  readonly errors: readonly string[];
}

export interface WorkspaceValidationReport {
  readonly valid: boolean;
  readonly projectRoot: string;
  readonly manifestValid: boolean;
  readonly defaultSceneValid: boolean;
  readonly assetRegistryValid: boolean;
  readonly missingDirectories: readonly string[];
  readonly corruptedFiles: readonly string[];
  readonly recoverableFromBackupFiles: readonly string[];
  readonly lockState: string;
  readonly issues: readonly string[];
}

export interface RepairLogEntry {
  readonly timestampIso: string;
  readonly action: string;
  readonly targetPath: string;
}

export interface ProjectRepairReport {
  readonly repaired: boolean;
  readonly projectRoot: string;
  readonly actionsTaken: readonly RepairLogEntry[];
  readonly remainingIssues: readonly string[];
}

export class HylixProjectManager {
  private readonly store: LocalFirstAtomicStore;

  constructor(store: LocalFirstAtomicStore) {
    this.store = store;
  }

  public getStore(): LocalFirstAtomicStore {
    return this.store;
  }

  /**
   * Creates a new Hylix project with the canonical folder hierarchy and atomic initial files.
   */
  public createProject(input: CreateProjectInput): CreateProjectResult {
    const folderCheck = validateWorkspaceRelativePath(input.projectFolder);
    if (!folderCheck.safe || folderCheck.normalizedPath.includes('/')) {
      return {
        success: false,
        projectRoot: input.projectFolder,
        manifest: null,
        createdDirectories: [],
        createdFiles: [],
        errors: [
          folderCheck.reason ||
            'projectFolder must be a single safe top-level folder name.',
        ],
      };
    }

    const projectRoot = folderCheck.normalizedPath;
    if (this.store.directoryExists(projectRoot)) {
      return {
        success: false,
        projectRoot,
        manifest: null,
        createdDirectories: [],
        createdFiles: [],
        errors: [`Project directory '${projectRoot}' already exists.`],
      };
    }

    const defaultScene = input.defaultScene ?? 'scenes/main.scene.hylix.json';
    const projectId = generateImmutableProjectId(projectRoot, input.packageId);

    const candidateManifest: HylixProjectManifest = {
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      engineVersion: HYLIX_IDENTITY.version,
      projectId,
      projectName: input.projectName,
      packageId: input.packageId,
      defaultScene,
      supportedTargets: [TargetPlatformId.ANDROID],
      projectSettings: {
        targetFps: 60,
        orientation: 'landscape',
        localFirst: true,
      },
    };

    // Pre-validate manifest shape before creating files
    const preCheck = validateProjectManifest(candidateManifest);
    if (!preCheck.valid || !preCheck.manifest) {
      return {
        success: false,
        projectRoot,
        manifest: null,
        createdDirectories: [],
        createdFiles: [],
        errors: preCheck.errors,
      };
    }

    // 1. Create project root and all canonical directories
    const createdDirectories: string[] = [];
    this.store.ensureDirectory(projectRoot);
    createdDirectories.push(projectRoot);

    for (const subDir of REQUIRED_PROJECT_DIRECTORIES) {
      const fullDir = `${projectRoot}/${subDir}`;
      this.store.ensureDirectory(fullDir);
      createdDirectories.push(fullDir);
    }

    const createdFiles: string[] = [];

    // 2. Write default scene file atomically (with two writes so a valid .bak baseline exists)
    const scenePath = `${projectRoot}/${preCheck.manifest.defaultScene}`;
    const deterministicMainSceneId = `scene_${computeDeterministicChecksum(
      `hylix_main_scene::${preCheck.manifest.projectId}`
    )}`;
    const nowIso = new Date().toISOString();
    const defaultSceneContent = JSON.stringify(
      {
        schemaVersion: 1,
        sceneId: deterministicMainSceneId,
        sceneName: 'Main Scene',
        metadata: {
          description: 'Default project entry scene',
          createdAtIso: nowIso,
          updatedAtIso: nowIso,
        },
        entities: [],
      },
      null,
      2
    );
    const sceneWrite1 = this.store.writeFileAtomically(scenePath, defaultSceneContent);
    this.store.writeFileAtomically(scenePath, defaultSceneContent);
    createdFiles.push(scenePath);

    // 3. Write initial Asset Registry in .hylix/asset-registry.hylix.json
    const assetRegistryPath = `${projectRoot}/.hylix/asset-registry.hylix.json`;
    const initialRegistry: AssetRegistryDocument = {
      schemaVersion: 1,
      projectId: preCheck.manifest.projectId,
      updatedAtIso: new Date().toISOString(),
      entries: [
        {
          assetId: createDeterministicAssetId(
            preCheck.manifest.projectId,
            preCheck.manifest.defaultScene
          ),
          path: preCheck.manifest.defaultScene,
          type: 'Scene',
          size: new TextEncoder().encode(defaultSceneContent).byteLength,
          checksum: sceneWrite1.checksumHex,
          importState: 'verified',
        },
      ],
    };
    const regContent = JSON.stringify(initialRegistry, null, 2);
    this.store.writeFileAtomically(assetRegistryPath, regContent);
    this.store.writeFileAtomically(assetRegistryPath, regContent);
    createdFiles.push(assetRegistryPath);

    // 4. Write initial repair audit log
    const repairLogPath = `${projectRoot}/.hylix/repair-audit.log.json`;
    const initialAudit = JSON.stringify({ entries: [] }, null, 2);
    this.store.writeFileAtomically(repairLogPath, initialAudit);
    this.store.writeFileAtomically(repairLogPath, initialAudit);
    createdFiles.push(repairLogPath);

    // 5. Write project.hylix.json atomically (twice so initial .bak recovery baseline is established)
    const manifestPath = `${projectRoot}/project.hylix.json`;
    const manifestJson = JSON.stringify(preCheck.manifest, null, 2);
    this.store.writeFileAtomically(manifestPath, manifestJson);
    this.store.writeFileAtomically(manifestPath, manifestJson);
    createdFiles.push(manifestPath);

    return {
      success: true,
      projectRoot,
      manifest: preCheck.manifest,
      createdDirectories,
      createdFiles,
      errors: [],
    };
  }

  /**
   * 9-Step Safe Project Open Flow:
   * 1. Validate path
   * 2. Verify workspace exists
   * 3. Read & verify Manifest (without deleting corrupted files)
   * 4. Verify schemaVersion
   * 5. Verify integrity of core files (defaultScene & asset registry)
   * 6. Check required directories
   * 7. Recreate missing standard directories if safe
   * 8. Acquire Workspace Lock (with stale lock crash recovery)
   * 9. Return opened project handle
   */
  public openProject(
    projectRoot: string,
    sessionId: string,
    options?: {
      nowEpochMs?: number;
      leaseTimeoutMs?: number;
    }
  ): OpenProjectResult {
    // Step 1: Validate path
    const rootCheck = validateWorkspaceRelativePath(projectRoot);
    if (!rootCheck.safe || rootCheck.normalizedPath.includes('/')) {
      return {
        success: false,
        status: 'INVALID_PATH_OR_MISSING',
        projectRoot,
        manifest: null,
        lockRecord: null,
        recoveredFromStaleLock: false,
        recreatedMissingDirectories: [],
        errors: [rootCheck.reason || 'Invalid project root path.'],
      };
    }

    const normalizedRoot = rootCheck.normalizedPath;

    // Step 2: Check workspace existence
    if (!this.store.directoryExists(normalizedRoot)) {
      return {
        success: false,
        status: 'INVALID_PATH_OR_MISSING',
        projectRoot: normalizedRoot,
        manifest: null,
        lockRecord: null,
        recoveredFromStaleLock: false,
        recreatedMissingDirectories: [],
        errors: [`Workspace '${normalizedRoot}' does not exist.`],
      };
    }

    // Step 3 & 4: Read & verify Manifest without auto-recovering silently so corruption enters explicit Repair flow
    const manifestPath = `${normalizedRoot}/project.hylix.json`;
    const manifestRead = this.store.readVerifiedFile(manifestPath, false);
    if (!manifestRead.valid || !manifestRead.record) {
      return {
        success: false,
        status: 'CORRUPTED_NEEDS_REPAIR',
        projectRoot: normalizedRoot,
        manifest: null,
        lockRecord: null,
        recoveredFromStaleLock: false,
        recreatedMissingDirectories: [],
        errors: [
          manifestRead.error ||
            'Primary project.hylix.json is missing or corrupted. Run Repair Project.',
        ],
      };
    }

    const manifestVal = validateProjectManifestJsonString(
      manifestRead.record.content,
      { store: this.store, projectRoot: normalizedRoot }
    );
    if (!manifestVal.valid || !manifestVal.manifest) {
      return {
        success: false,
        status: 'CORRUPTED_NEEDS_REPAIR',
        projectRoot: normalizedRoot,
        manifest: null,
        lockRecord: null,
        recoveredFromStaleLock: false,
        recreatedMissingDirectories: [],
        errors: manifestVal.errors,
      };
    }

    // Step 5: Verify integrity of core files (defaultScene & asset-registry)
    const scenePath = `${normalizedRoot}/${manifestVal.manifest.defaultScene}`;
    const sceneRead = this.store.readVerifiedFile(scenePath, false);
    if (!sceneRead.valid) {
      return {
        success: false,
        status: 'CORRUPTED_NEEDS_REPAIR',
        projectRoot: normalizedRoot,
        manifest: null,
        lockRecord: null,
        recoveredFromStaleLock: false,
        recreatedMissingDirectories: [],
        errors: [
          sceneRead.error ||
            `Default scene '${manifestVal.manifest.defaultScene}' is corrupted.`,
        ],
      };
    }

    const registryPath = `${normalizedRoot}/.hylix/asset-registry.hylix.json`;
    const registryRead = this.store.readVerifiedFile(registryPath, false);
    if (!registryRead.valid || !registryRead.record) {
      return {
        success: false,
        status: 'CORRUPTED_NEEDS_REPAIR',
        projectRoot: normalizedRoot,
        manifest: null,
        lockRecord: null,
        recoveredFromStaleLock: false,
        recreatedMissingDirectories: [],
        errors: [
          registryRead.error || 'Asset registry file is missing or corrupted.',
        ],
      };
    }

    // Step 6 & 7: Check required directories and safely recreate any missing standard directory
    const recreatedMissingDirectories: string[] = [];
    for (const reqDir of REQUIRED_PROJECT_DIRECTORIES) {
      const fullDir = `${normalizedRoot}/${reqDir}`;
      if (!this.store.directoryExists(fullDir)) {
        this.store.ensureDirectory(fullDir);
        recreatedMissingDirectories.push(fullDir);
      }
    }

    // Step 8: Acquire Workspace Lock (detecting active lock or recovering from stale crash lock)
    const lockRes = acquireWorkspaceLock(
      this.store,
      normalizedRoot,
      manifestVal.manifest.projectId,
      sessionId,
      options
    );
    if (!lockRes.acquired || !lockRes.lockRecord) {
      return {
        success: false,
        status: 'LOCKED_BY_OTHER_SESSION',
        projectRoot: normalizedRoot,
        manifest: null,
        lockRecord: null,
        recoveredFromStaleLock: false,
        recreatedMissingDirectories,
        errors: [lockRes.error || 'Project is locked by another active session.'],
      };
    }

    // Step 9: Return opened project handle
    return {
      success: true,
      status: 'OPENED',
      projectRoot: normalizedRoot,
      manifest: manifestVal.manifest,
      lockRecord: lockRes.lockRecord,
      recoveredFromStaleLock: lockRes.recoveredFromCrashOrStaleLock,
      recreatedMissingDirectories,
      errors: [],
    };
  }

  /**
   * Saves project manifest updates atomically while enforcing:
   * - Active workspace lock ownership by `sessionId`
   * - Immutable `projectId` (never changes after creation)
   * - Full schema validation prior to atomic commit
   */
  public saveProjectManifest(
    projectRoot: string,
    sessionId: string,
    updatedManifest: HylixProjectManifest,
    nowEpochMs: number = Date.now()
  ): {
    success: boolean;
    manifest: HylixProjectManifest | null;
    checksumHex: string;
    errors: readonly string[];
  } {
    const rootCheck = validateWorkspaceRelativePath(projectRoot);
    if (!rootCheck.safe || rootCheck.normalizedPath.includes('/')) {
      return {
        success: false,
        manifest: null,
        checksumHex: '',
        errors: [rootCheck.reason || 'Invalid project root path.'],
      };
    }

    const normalizedRoot = rootCheck.normalizedPath;
    const lockCheck = inspectWorkspaceLock(
      this.store,
      normalizedRoot,
      sessionId,
      nowEpochMs
    );
    if (lockCheck.state !== 'LOCKED_BY_CURRENT_SESSION') {
      return {
        success: false,
        manifest: null,
        checksumHex: '',
        errors: [
          `Cannot save project: session '${sessionId}' does not hold the active workspace lock (state: ${lockCheck.state}).`,
        ],
      };
    }

    // Verify projectId has not been altered from the lock/existing project identity
    if (
      lockCheck.record &&
      updatedManifest.projectId !== lockCheck.record.projectId
    ) {
      return {
        success: false,
        manifest: null,
        checksumHex: '',
        errors: [
          `Project ID Invariant Violation: projectId '${updatedManifest.projectId}' cannot be changed from original '${lockCheck.record.projectId}'.`,
        ],
      };
    }

    const validation = validateProjectManifest(updatedManifest, {
      store: this.store,
      projectRoot: normalizedRoot,
    });
    if (!validation.valid || !validation.manifest) {
      return {
        success: false,
        manifest: null,
        checksumHex: '',
        errors: validation.errors,
      };
    }

    const manifestPath = `${normalizedRoot}/project.hylix.json`;
    const writeRes = this.store.writeFileAtomically(
      manifestPath,
      JSON.stringify(validation.manifest, null, 2)
    );
    if (!writeRes.success) {
      return {
        success: false,
        manifest: null,
        checksumHex: '',
        errors: [writeRes.error || 'Atomic write of project.hylix.json failed.'],
      };
    }

    return {
      success: true,
      manifest: validation.manifest,
      checksumHex: writeRes.checksumHex,
      errors: [],
    };
  }

  public closeProject(
    projectRoot: string,
    sessionId: string,
    nowEpochMs: number = Date.now()
  ): { closed: boolean; error?: string } {
    const res = releaseWorkspaceLock(
      this.store,
      projectRoot,
      sessionId,
      nowEpochMs
    );
    return {
      closed: res.released,
      error: res.error,
    };
  }

  /**
   * Non-destructive validation of an entire project workspace.
   */
  public validateProjectWorkspace(
    projectRoot: string,
    sessionId = 'inspector_probe',
    nowEpochMs: number = Date.now()
  ): WorkspaceValidationReport {
    const rootCheck = validateWorkspaceRelativePath(projectRoot);
    if (!rootCheck.safe || rootCheck.normalizedPath.includes('/')) {
      return {
        valid: false,
        projectRoot,
        manifestValid: false,
        defaultSceneValid: false,
        assetRegistryValid: false,
        missingDirectories: [],
        corruptedFiles: [],
        recoverableFromBackupFiles: [],
        lockState: 'INVALID_PATH',
        issues: [rootCheck.reason || 'Invalid project root path.'],
      };
    }

    const normalizedRoot = rootCheck.normalizedPath;
    const issues: string[] = [];
    const missingDirectories: string[] = [];
    const corruptedFiles: string[] = [];
    const recoverableFromBackupFiles: string[] = [];

    if (!this.store.directoryExists(normalizedRoot)) {
      return {
        valid: false,
        projectRoot: normalizedRoot,
        manifestValid: false,
        defaultSceneValid: false,
        assetRegistryValid: false,
        missingDirectories: [normalizedRoot],
        corruptedFiles: [],
        recoverableFromBackupFiles: [],
        lockState: 'MISSING_WORKSPACE',
        issues: [`Workspace directory '${normalizedRoot}' does not exist.`],
      };
    }

    for (const reqDir of REQUIRED_PROJECT_DIRECTORIES) {
      const fullDir = `${normalizedRoot}/${reqDir}`;
      if (!this.store.directoryExists(fullDir)) {
        missingDirectories.push(fullDir);
        issues.push(`Missing standard directory: '${fullDir}'.`);
      }
    }

    const manifestPath = `${normalizedRoot}/project.hylix.json`;
    const manifestRead = this.store.readVerifiedFile(manifestPath, false);
    let manifestValid = false;
    let defaultScenePath = `${normalizedRoot}/scenes/main.scene.hylix.json`;
    let expectedProjectId: string | undefined;

    if (!manifestRead.valid || !manifestRead.record) {
      corruptedFiles.push(manifestPath);
      if (this.store.hasValidBackup(manifestPath)) {
        recoverableFromBackupFiles.push(manifestPath);
      }
      issues.push(manifestRead.error || `Corrupted or missing '${manifestPath}'.`);
    } else {
      const val = validateProjectManifestJsonString(
        manifestRead.record.content,
        { store: this.store, projectRoot: normalizedRoot }
      );
      if (!val.valid || !val.manifest) {
        corruptedFiles.push(manifestPath);
        if (this.store.hasValidBackup(manifestPath)) {
          recoverableFromBackupFiles.push(manifestPath);
        }
        issues.push(...val.errors);
      } else {
        manifestValid = true;
        defaultScenePath = `${normalizedRoot}/${val.manifest.defaultScene}`;
        expectedProjectId = val.manifest.projectId;
      }
    }

    const sceneRead = this.store.readVerifiedFile(defaultScenePath, false);
    let defaultSceneValid = false;
    if (!sceneRead.valid) {
      corruptedFiles.push(defaultScenePath);
      if (this.store.hasValidBackup(defaultScenePath)) {
        recoverableFromBackupFiles.push(defaultScenePath);
      }
      issues.push(sceneRead.error || `Corrupted or missing '${defaultScenePath}'.`);
    } else {
      defaultSceneValid = true;
    }

    const registryPath = `${normalizedRoot}/.hylix/asset-registry.hylix.json`;
    const registryRead = this.store.readVerifiedFile(registryPath, false);
    let assetRegistryValid = false;
    if (!registryRead.valid || !registryRead.record) {
      corruptedFiles.push(registryPath);
      if (this.store.hasValidBackup(registryPath)) {
        recoverableFromBackupFiles.push(registryPath);
      }
      issues.push(
        registryRead.error || `Corrupted or missing '${registryPath}'.`
      );
    } else {
      try {
        const parsedReg = JSON.parse(registryRead.record.content);
        const regVal = validateAssetRegistryDocument(parsedReg, expectedProjectId);
        if (!regVal.valid) {
          corruptedFiles.push(registryPath);
          if (this.store.hasValidBackup(registryPath)) {
            recoverableFromBackupFiles.push(registryPath);
          }
          issues.push(...regVal.errors);
        } else {
          assetRegistryValid = true;
        }
      } catch {
        corruptedFiles.push(registryPath);
        if (this.store.hasValidBackup(registryPath)) {
          recoverableFromBackupFiles.push(registryPath);
        }
        issues.push(`Invalid JSON in '${registryPath}'.`);
      }
    }

    const lockInspect = inspectWorkspaceLock(
      this.store,
      normalizedRoot,
      sessionId,
      nowEpochMs
    );

    return {
      valid:
        manifestValid &&
        defaultSceneValid &&
        assetRegistryValid &&
        missingDirectories.length === 0 &&
        corruptedFiles.length === 0,
      projectRoot: normalizedRoot,
      manifestValid,
      defaultSceneValid,
      assetRegistryValid,
      missingDirectories,
      corruptedFiles,
      recoverableFromBackupFiles,
      lockState: lockInspect.state,
      issues,
    };
  }

  /**
   * Conservative Project Repair Flow:
   * - Never deletes unknown user files
   * - Recreates missing standard directories (`scenes/`, `assets/*`, `scripts/`, `plugins/`, `build/`, `cache/`, `.hylix/`)
   * - Restores corrupted core files from `.bak` ONLY after verifying `.bak` checksum & schema validity
   * - Releases stale or corrupted `.hylix/workspace.lock`
   * - Appends every action to `.hylix/repair-audit.log.json`
   */
  public repairProjectWorkspace(
    projectRoot: string,
    sessionId: string,
    nowEpochMs: number = Date.now()
  ): ProjectRepairReport {
    const beforeValidation = this.validateProjectWorkspace(
      projectRoot,
      sessionId,
      nowEpochMs
    );
    const actionsTaken: RepairLogEntry[] = [];

    const rootCheck = validateWorkspaceRelativePath(projectRoot);
    if (!rootCheck.safe || !this.store.directoryExists(rootCheck.normalizedPath)) {
      return {
        repaired: false,
        projectRoot,
        actionsTaken: [],
        remainingIssues: beforeValidation.issues,
      };
    }

    const normalizedRoot = rootCheck.normalizedPath;

    // 1. Recreate missing standard directories conservatively
    for (const missingDir of beforeValidation.missingDirectories) {
      const res = this.store.ensureDirectory(missingDir);
      if (res.success && res.createdNow) {
        actionsTaken.push({
          timestampIso: new Date(nowEpochMs).toISOString(),
          action: 'RECREATED_MISSING_DIRECTORY',
          targetPath: missingDir,
        });
      }
    }

    // 2. Restore corrupted files from verified .bak snapshots
    for (const corruptedPath of beforeValidation.corruptedFiles) {
      const restoreRes = this.store.restoreFileFromVerifiedBackup(corruptedPath);
      if (restoreRes.restored) {
        actionsTaken.push({
          timestampIso: new Date(nowEpochMs).toISOString(),
          action: `RESTORED_FROM_VERIFIED_BACKUP (checksum=${restoreRes.checksumHex})`,
          targetPath: corruptedPath,
        });
      }
    }

    // 3. Recover stale or corrupted workspace lock
    const lockInspect = inspectWorkspaceLock(
      this.store,
      normalizedRoot,
      sessionId,
      nowEpochMs
    );
    if (
      lockInspect.state === 'STALE_LOCK_DETECTED' ||
      lockInspect.state === 'CORRUPTED_LOCK_DETECTED'
    ) {
      releaseWorkspaceLock(this.store, normalizedRoot, sessionId, nowEpochMs);
      actionsTaken.push({
        timestampIso: new Date(nowEpochMs).toISOString(),
        action: `CLEARED_${lockInspect.state}`,
        targetPath: `${normalizedRoot}/.hylix/workspace.lock`,
      });
    }

    // 4. Record all repair operations in .hylix/repair-audit.log.json
    const auditLogPath = `${normalizedRoot}/.hylix/repair-audit.log.json`;
    const existingAuditRead = this.store.readVerifiedFile(auditLogPath, true);
    let previousEntries: RepairLogEntry[] = [];
    if (existingAuditRead.valid && existingAuditRead.record) {
      try {
        const parsed = JSON.parse(existingAuditRead.record.content);
        if (Array.isArray(parsed.entries)) {
          previousEntries = parsed.entries;
        }
      } catch {
        previousEntries = [];
      }
    }

    const updatedAuditPayload = JSON.stringify(
      {
        entries: [...previousEntries, ...actionsTaken],
      },
      null,
      2
    );
    this.store.writeFileAtomically(auditLogPath, updatedAuditPayload);

    const afterValidation = this.validateProjectWorkspace(
      normalizedRoot,
      sessionId,
      nowEpochMs
    );

    return {
      repaired: afterValidation.valid,
      projectRoot: normalizedRoot,
      actionsTaken,
      remainingIssues: afterValidation.issues,
    };
  }
}
