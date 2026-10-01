import { HYLIX_IDENTITY, TargetPlatformId } from '../core/engineIdentity';
import { LocalFirstAtomicStore } from '../storage/atomicStorage';
import { validateProjectScopedPath } from '../security/securityFoundation';
import {
  HylixProjectManifest,
  validateProjectManifest,
} from './projectSystem';

/**
 * Hylix Safe Schema Migration Engine
 *
 * Executes deterministic, transactional manifest upgrades across schema versions:
 * Detect Version -> Backup -> Validate Source -> Migrate Step-by-Step ->
 * Validate Target -> Atomic Commit (or Automatic Rollback on failure).
 */

export const MIN_SUPPORTED_MANIFEST_SCHEMA = 1;
export const MAX_SUPPORTED_MANIFEST_SCHEMA = 3;

export interface SchemaMigrationReport {
  readonly success: boolean;
  readonly fromSchemaVersion: number;
  readonly toSchemaVersion: number;
  readonly rolledBack: boolean;
  readonly migratedManifest: HylixProjectManifest | null;
  readonly stepsExecuted: readonly string[];
  readonly error?: string;
}

/**
 * Pure step transformer: Schema 1 -> Schema 2
 * Ensures `projectSettings.graphicsApi` and `projectSettings.physicsTickHz` are populated.
 */
function migrateSchemaV1ToV2(
  raw: Record<string, unknown>
): Record<string, unknown> {
  const existingSettings =
    typeof raw.projectSettings === 'object' && raw.projectSettings !== null
      ? (raw.projectSettings as Record<string, unknown>)
      : {};

  // Normalize legacy entrySceneRelativePath -> defaultScene if migrating a Phase-1 manifest
  const defaultScene =
    typeof raw.defaultScene === 'string'
      ? raw.defaultScene
      : typeof raw.entrySceneRelativePath === 'string'
      ? raw.entrySceneRelativePath
      : 'scenes/main.scene.hylix.json';

  const packageId =
    typeof raw.packageId === 'string'
      ? raw.packageId
      : 'com.hypersoft.hylix.userproject';

  const supportedTargets = Array.isArray(raw.supportedTargets)
    ? raw.supportedTargets
    : [TargetPlatformId.ANDROID];

  const clone: Record<string, unknown> = {
    schemaVersion: 2,
    engineVersion: HYLIX_IDENTITY.version,
    projectId: raw.projectId,
    projectName: raw.projectName,
    packageId,
    defaultScene,
    supportedTargets,
    projectSettings: {
      targetFps:
        typeof existingSettings.targetFps === 'number'
          ? existingSettings.targetFps
          : 60,
      orientation:
        existingSettings.orientation === 'portrait' ||
        existingSettings.orientation === 'landscape'
          ? existingSettings.orientation
          : 'landscape',
      localFirst: true,
      physicsTickHz:
        typeof existingSettings.physicsTickHz === 'number'
          ? existingSettings.physicsTickHz
          : 60,
    },
  };

  return clone;
}

/**
 * Pure step transformer: Schema 2 -> Schema 3
 * Adds deterministic buildProfile ("debug_sandbox" | "release_unsigned") inside projectSettings.
 */
function migrateSchemaV2ToV3(
  raw: Record<string, unknown>
): Record<string, unknown> {
  const existingSettings =
    typeof raw.projectSettings === 'object' && raw.projectSettings !== null
      ? (raw.projectSettings as Record<string, unknown>)
      : {};

  return {
    ...raw,
    schemaVersion: 3,
    projectSettings: {
      ...existingSettings,
      targetFps:
        typeof existingSettings.targetFps === 'number'
          ? existingSettings.targetFps
          : 60,
      orientation:
        existingSettings.orientation === 'portrait' ||
        existingSettings.orientation === 'landscape'
          ? existingSettings.orientation
          : 'landscape',
      localFirst: true,
      physicsTickHz:
        typeof existingSettings.physicsTickHz === 'number'
          ? existingSettings.physicsTickHz
          : 60,
      buildProfile: 'debug_sandbox',
    },
  };
}

export function migrateManifestPayloadInMemory(
  rawManifestJson: string,
  targetSchemaVersion: number,
  simulateMigrationFault = false
): SchemaMigrationReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifestJson);
  } catch {
    return {
      success: false,
      fromSchemaVersion: -1,
      toSchemaVersion: targetSchemaVersion,
      rolledBack: false,
      migratedManifest: null,
      stepsExecuted: [],
      error: 'Manifest is not valid JSON.',
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      success: false,
      fromSchemaVersion: -1,
      toSchemaVersion: targetSchemaVersion,
      rolledBack: false,
      migratedManifest: null,
      stepsExecuted: [],
      error: 'Manifest root must be a JSON object.',
    };
  }

  const sourceObj = parsed as Record<string, unknown>;
  const fromVersion =
    typeof sourceObj.schemaVersion === 'number' ? sourceObj.schemaVersion : -1;

  if (
    !Number.isInteger(fromVersion) ||
    fromVersion < MIN_SUPPORTED_MANIFEST_SCHEMA ||
    fromVersion > MAX_SUPPORTED_MANIFEST_SCHEMA
  ) {
    return {
      success: false,
      fromSchemaVersion: fromVersion,
      toSchemaVersion: targetSchemaVersion,
      rolledBack: false,
      migratedManifest: null,
      stepsExecuted: [],
      error: `Source schemaVersion '${String(sourceObj.schemaVersion)}' is outside supported migration range (${MIN_SUPPORTED_MANIFEST_SCHEMA}..${MAX_SUPPORTED_MANIFEST_SCHEMA}).`,
    };
  }

  if (
    !Number.isInteger(targetSchemaVersion) ||
    targetSchemaVersion < fromVersion ||
    targetSchemaVersion > MAX_SUPPORTED_MANIFEST_SCHEMA
  ) {
    return {
      success: false,
      fromSchemaVersion: fromVersion,
      toSchemaVersion: targetSchemaVersion,
      rolledBack: false,
      migratedManifest: null,
      stepsExecuted: [],
      error: `Invalid targetSchemaVersion '${targetSchemaVersion}' for source schema '${fromVersion}'.`,
    };
  }

  // Validate source manifest before attempting migration
  const sourceValidation = validateProjectManifest(sourceObj);
  if (!sourceValidation.valid) {
    return {
      success: false,
      fromSchemaVersion: fromVersion,
      toSchemaVersion: targetSchemaVersion,
      rolledBack: false,
      migratedManifest: null,
      stepsExecuted: [],
      error: `Source manifest failed pre-migration validation: ${sourceValidation.errors.join('; ')}`,
    };
  }

  let currentObj: Record<string, unknown> = { ...sourceObj };
  let currentVer = fromVersion;
  const stepsExecuted: string[] = [];

  try {
    while (currentVer < targetSchemaVersion) {
      if (currentVer === 1) {
        currentObj = migrateSchemaV1ToV2(currentObj);
        stepsExecuted.push('Schema 1 -> Schema 2');
        currentVer = 2;
      } else if (currentVer === 2) {
        if (simulateMigrationFault) {
          throw new Error('Simulated migration fault during Schema 2 -> Schema 3 step.');
        }
        currentObj = migrateSchemaV2ToV3(currentObj);
        stepsExecuted.push('Schema 2 -> Schema 3');
        currentVer = 3;
      } else {
        throw new Error(`No migration step registered from version ${currentVer}.`);
      }
    }

    if (simulateMigrationFault) {
      // Corrupt migrated object to test post-migration validation failure & rollback
      currentObj = { ...currentObj, packageId: 'INVALID_PACKAGE_ID_AFTER_MIGRATION' };
    }

    // Validate again after migration
    const targetValidation = validateProjectManifest(currentObj);
    if (!targetValidation.valid) {
      throw new Error(
        `Post-migration validation failed: ${targetValidation.errors.join('; ')}`
      );
    }

    return {
      success: true,
      fromSchemaVersion: fromVersion,
      toSchemaVersion: targetSchemaVersion,
      rolledBack: false,
      migratedManifest: currentObj as unknown as HylixProjectManifest,
      stepsExecuted,
    };
  } catch (err) {
    return {
      success: false,
      fromSchemaVersion: fromVersion,
      toSchemaVersion: targetSchemaVersion,
      rolledBack: true,
      migratedManifest: null,
      stepsExecuted,
      error: err instanceof Error ? err.message : 'Migration failed.',
    };
  }
}

/**
 * Performs an atomic, rollback-safe manifest schema migration on a project in storage:
 * Detect Version -> Backup -> Validate -> Migrate -> Validate Again -> Atomic Commit.
 * If any step fails, guarantees the original manifest in storage remains untouched or restored.
 */
export function migrateProjectManifestInStorage(
  store: LocalFirstAtomicStore,
  projectRoot: string,
  targetSchemaVersion: number,
  simulateMigrationFault = false
): SchemaMigrationReport {
  const manifestPathCheck = validateProjectScopedPath(
    projectRoot,
    'project.hylix.json'
  );
  const preMigrationBackupPathCheck = validateProjectScopedPath(
    projectRoot,
    '.hylix/manifest.pre-migration.bak.json'
  );

  if (!manifestPathCheck.safe || !preMigrationBackupPathCheck.safe) {
    return {
      success: false,
      fromSchemaVersion: -1,
      toSchemaVersion: targetSchemaVersion,
      rolledBack: false,
      migratedManifest: null,
      stepsExecuted: [],
      error: manifestPathCheck.reason || 'Invalid project root path.',
    };
  }

  const readRes = store.readVerifiedFile(manifestPathCheck.normalizedPath);
  if (!readRes.valid || !readRes.record) {
    return {
      success: false,
      fromSchemaVersion: -1,
      toSchemaVersion: targetSchemaVersion,
      rolledBack: false,
      migratedManifest: null,
      stepsExecuted: [],
      error: readRes.error || 'Could not read project.hylix.json for migration.',
    };
  }

  const originalContent = readRes.record.content;

  // Step 1: Write dedicated pre-migration backup snapshot atomically
  const backupWrite = store.writeFileAtomically(
    preMigrationBackupPathCheck.normalizedPath,
    originalContent
  );
  if (!backupWrite.success) {
    return {
      success: false,
      fromSchemaVersion: -1,
      toSchemaVersion: targetSchemaVersion,
      rolledBack: false,
      migratedManifest: null,
      stepsExecuted: [],
      error: 'Failed to create pre-migration backup snapshot.',
    };
  }

  // Step 2: Run Validate -> Migrate -> Validate Again
  const inMemoryReport = migrateManifestPayloadInMemory(
    originalContent,
    targetSchemaVersion,
    simulateMigrationFault
  );

  if (!inMemoryReport.success || !inMemoryReport.migratedManifest) {
    // Rollback: guarantee original content is preserved in project.hylix.json
    store.writeFileAtomically(manifestPathCheck.normalizedPath, originalContent);
    return {
      ...inMemoryReport,
      rolledBack: true,
    };
  }

  // Step 3: Atomic Commit of migrated manifest
  const serializedMigrated = JSON.stringify(
    inMemoryReport.migratedManifest,
    null,
    2
  );
  const commitWrite = store.writeFileAtomically(
    manifestPathCheck.normalizedPath,
    serializedMigrated
  );

  if (!commitWrite.success) {
    store.writeFileAtomically(manifestPathCheck.normalizedPath, originalContent);
    return {
      success: false,
      fromSchemaVersion: inMemoryReport.fromSchemaVersion,
      toSchemaVersion: targetSchemaVersion,
      rolledBack: true,
      migratedManifest: null,
      stepsExecuted: inMemoryReport.stepsExecuted,
      error: commitWrite.error || 'Atomic commit of migrated manifest failed; rolled back.',
    };
  }

  return inMemoryReport;
}
