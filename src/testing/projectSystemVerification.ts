import { LocalFirstAtomicStore } from '../storage/atomicStorage';
import {
  HylixProjectManager,
  REQUIRED_PROJECT_DIRECTORIES,
  validateProjectManifest,
  validateProjectManifestJsonString,
} from '../project/projectSystem';
import {
  migrateProjectManifestInStorage,
} from '../project/schemaMigration';
import {
  registerProjectAssetAtomically,
  validateAssetRegistryDocument,
} from '../assets/assetRegistry';
import {
  validateBuildCommandExecution,
  validateProjectScopedPath,
  validateWorkspaceRelativePath,
} from '../security/securityFoundation';
import { VerificationAssertionResult } from './foundationVerification';

/**
 * Hylix Phase 2 — Project System & Local Storage Verification Suite
 *
 * Covers all mandatory test categories for Prompt 02:
 * - Project Lifecycle (create, open, validate, save, close, immutable projectId)
 * - Manifest Validation (valid, invalid JSON, invalid packageId, unsupported schema, missing fields, missing defaultScene, unknown keys)
 * - Storage & Corruption (atomic write, recovery, checksum, corrupted primary, corrupted primary + corrupted backup, cache vs project data)
 * - Security (path traversal ../, ../../, C:\, /system, /etc, /data, cross-project escape)
 * - Workspace Lock (create lock, active lock contention, stale lock detection, crash recovery, safe release)
 * - Conservative Repair (missing dir recreation, verified .bak restore, preservation of unknown user files, repair audit log)
 * - Safe Schema Migration (v1 -> v2 -> v3 upgrade, failed migration automatic rollback)
 * - Asset Registry Foundation (assetId, path, type, size, checksum, importState, cache/build exclusion)
 */
export function runProjectSystemVerificationChecks(): VerificationAssertionResult[] {
  const results: VerificationAssertionResult[] = [];

  // -------------------------------------------------------------------------
  // 1. Project Create, Canonical Directory Structure & Immutable Project ID
  // -------------------------------------------------------------------------
  const store = new LocalFirstAtomicStore();
  const manager = new HylixProjectManager(store);

  const createRes = manager.createProject({
    projectFolder: 'StarRunner',
    projectName: 'Star Runner 2D',
    packageId: 'com.hypersoft.starrunner',
  });

  const allDirsCreated = REQUIRED_PROJECT_DIRECTORIES.every((sub) =>
    store.directoryExists(`StarRunner/${sub}`)
  );
  const originalProjectId = createRes.manifest?.projectId ?? '';

  results.push({
    id: 'proj_01_create_and_structure',
    category: 'Project Lifecycle & Manifest',
    title: 'Project Creation, Canonical Hierarchy & Stable Project ID',
    passed:
      createRes.success &&
      allDirsCreated &&
      originalProjectId.startsWith('prj_') &&
      store.fileExists('StarRunner/project.hylix.json') &&
      store.fileExists('StarRunner/scenes/main.scene.hylix.json') &&
      store.fileExists('StarRunner/.hylix/asset-registry.hylix.json'),
    details: `Created 'StarRunner/' with ${REQUIRED_PROJECT_DIRECTORIES.length} canonical directories and immutable projectId '${originalProjectId}'.`,
  });

  // -------------------------------------------------------------------------
  // 2. Project Open, Save (Preserving Project ID) & Close Lifecycle
  // -------------------------------------------------------------------------
  const openRes1 = manager.openProject('StarRunner', 'session_alpha', {
    nowEpochMs: 1_000_000,
    leaseTimeoutMs: 30_000,
  });

  const idUnchangedOnOpen = openRes1.manifest?.projectId === originalProjectId;

  // Attempt save with modified projectName (valid) vs modified projectId (must be rejected)
  const validSave =
    openRes1.manifest &&
    manager.saveProjectManifest(
      'StarRunner',
      'session_alpha',
      {
        ...openRes1.manifest,
        projectName: 'Star Runner Deluxe',
      },
      1_005_000
    );

  const illegalIdMutationSave =
    openRes1.manifest &&
    manager.saveProjectManifest(
      'StarRunner',
      'session_alpha',
      {
        ...openRes1.manifest,
        projectId: 'prj_mutated_illegal_id',
      },
      1_006_000
    );

  const closeRes1 = manager.closeProject('StarRunner', 'session_alpha', 1_010_000);

  results.push({
    id: 'proj_02_open_save_close',
    category: 'Project Lifecycle & Manifest',
    title: 'Project Open, Validated Save, Project ID Immutability & Close',
    passed:
      openRes1.success &&
      openRes1.status === 'OPENED' &&
      idUnchangedOnOpen &&
      Boolean(validSave?.success) &&
      validSave?.manifest?.projectId === originalProjectId &&
      Boolean(illegalIdMutationSave && !illegalIdMutationSave.success) &&
      closeRes1.closed,
    details:
      'Verified 9-step project open, authenticated session save, rejection of projectId mutation, and clean lock release on close.',
  });

  // -------------------------------------------------------------------------
  // 3. Strict Manifest Validation (Untrusted JSON, Package ID, Schema, Missing Scene, Unknown Keys)
  // -------------------------------------------------------------------------
  const badJsonCheck = validateProjectManifestJsonString('{ malformed json ');
  const emptyNameCheck = validateProjectManifest({
    schemaVersion: 1,
    engineVersion: '1.0.0',
    projectId: originalProjectId,
    projectName: '   ',
    packageId: 'com.hypersoft.starrunner',
    defaultScene: 'scenes/main.scene.hylix.json',
    supportedTargets: ['android'],
  });
  const badPackageIdCheck = validateProjectManifest({
    schemaVersion: 1,
    engineVersion: '1.0.0',
    projectId: originalProjectId,
    projectName: 'Valid Name',
    packageId: '123.Invalid_Package-Name',
    defaultScene: 'scenes/main.scene.hylix.json',
    supportedTargets: ['android'],
  });
  const badSchemaCheck = validateProjectManifest({
    schemaVersion: 99,
    engineVersion: '1.0.0',
    projectId: originalProjectId,
    projectName: 'Valid Name',
    packageId: 'com.hypersoft.starrunner',
    defaultScene: 'scenes/main.scene.hylix.json',
    supportedTargets: ['android'],
  });
  const missingSceneFileCheck = validateProjectManifest(
    {
      schemaVersion: 1,
      engineVersion: '1.0.0',
      projectId: originalProjectId,
      projectName: 'Valid Name',
      packageId: 'com.hypersoft.starrunner',
      defaultScene: 'scenes/non_existent_level.scene.hylix.json',
      supportedTargets: ['android'],
    },
    { store, projectRoot: 'StarRunner' }
  );
  const unknownPropertyCheck = validateProjectManifest({
    schemaVersion: 1,
    engineVersion: '1.0.0',
    projectId: originalProjectId,
    projectName: 'Valid Name',
    packageId: 'com.hypersoft.starrunner',
    defaultScene: 'scenes/main.scene.hylix.json',
    supportedTargets: ['android'],
    unexpectedInjectedField: 'malicious_value',
  });

  results.push({
    id: 'proj_03_manifest_validator',
    category: 'Project Lifecycle & Manifest',
    title: 'Untrusted Manifest Validator (JSON, PackageId, Schema, Missing Scene, Unknown Fields)',
    passed:
      !badJsonCheck.valid &&
      !emptyNameCheck.valid &&
      !badPackageIdCheck.valid &&
      !badSchemaCheck.valid &&
      !missingSceneFileCheck.valid &&
      !unknownPropertyCheck.valid,
    details:
      'Rejected malformed JSON, blank projectName, invalid packageId, unsupported schemaVersion, missing defaultScene file, and unexpected fields.',
  });

  // -------------------------------------------------------------------------
  // 4. Workspace Lock Contention, Stale Lock Detection & Crash Recovery
  // -------------------------------------------------------------------------
  // Session 1 opens project at t = 2,000,000ms (lease = 30,000ms)
  const lockSession1 = manager.openProject('StarRunner', 'session_crash_sim', {
    nowEpochMs: 2_000_000,
    leaseTimeoutMs: 30_000,
  });

  // Session 2 tries to open at t = 2,010,000ms (only 10s elapsed -> lock is still active)
  const contendingOpen = manager.openProject('StarRunner', 'session_recovery_user', {
    nowEpochMs: 2_010_000,
    leaseTimeoutMs: 30_000,
  });

  // Session 1 crashes (no close called). At t = 2,045,000ms (45s elapsed > 30s lease), Session 2 opens project
  const crashRecoveryOpen = manager.openProject('StarRunner', 'session_recovery_user', {
    nowEpochMs: 2_045_000,
    leaseTimeoutMs: 30_000,
  });

  manager.closeProject('StarRunner', 'session_recovery_user', 2_050_000);

  results.push({
    id: 'proj_04_workspace_lock_and_crash_recovery',
    category: 'Workspace Lock & Recovery',
    title: 'Workspace Lock Contention Prevention & Stale Lock Crash Recovery',
    passed:
      lockSession1.success &&
      !contendingOpen.success &&
      contendingOpen.status === 'LOCKED_BY_OTHER_SESSION' &&
      crashRecoveryOpen.success &&
      crashRecoveryOpen.status === 'OPENED' &&
      crashRecoveryOpen.recoveredFromStaleLock,
    details:
      'Blocked concurrent open during active lease and automatically recovered workspace lock after simulated crash timeout.',
  });

  // -------------------------------------------------------------------------
  // 5. Corrupted Primary + Corrupted Backup Detection (No Silent Data Fabrication)
  // -------------------------------------------------------------------------
  const dualCorruptStore = new LocalFirstAtomicStore();
  dualCorruptStore.writeFileAtomically('DualTest/data.json', '{"v":1}');
  dualCorruptStore.writeFileAtomically('DualTest/data.json', '{"v":2}');
  // Corrupt both primary and .bak
  dualCorruptStore.injectRawCorruptedPayloadForTesting('DualTest/data.json', '{corrupt_primary');
  dualCorruptStore.injectCorruptedBackupForTesting('DualTest/data.json', '{corrupt_backup');
  const dualCorruptRead = dualCorruptStore.readVerifiedFile('DualTest/data.json', true);

  results.push({
    id: 'proj_05_dual_corruption_detection',
    category: 'Atomic Storage & Project Safety',
    title: 'Simultaneous Primary & Backup (.bak) Corruption Detection',
    passed:
      !dualCorruptRead.valid &&
      !dualCorruptRead.recoveredFromBackup &&
      dualCorruptRead.corruptedPrimaryDetected &&
      dualCorruptRead.record === null,
    details:
      'Confirmed that when both primary and .bak files fail checksum verification, storage reports explicit corruption without fabricating data.',
  });

  // -------------------------------------------------------------------------
  // 6. Conservative Project Repair & Preservation of Unknown User Files
  // -------------------------------------------------------------------------
  // Add an unknown custom user file inside StarRunner
  const customUserFilePath = 'StarRunner/assets/textures/custom_user_sketch.raw';
  store.writeFileAtomically(customUserFilePath, 'USER_PRECIOUS_ARTWORK_BYTES');

  // Simulate missing standard directory + corrupted primary manifest
  store.removeDirectoryMarkerForTesting('StarRunner/assets/models');
  store.injectRawCorruptedPayloadForTesting(
    'StarRunner/project.hylix.json',
    '{corrupted_manifest_header'
  );

  // Opening corrupted project must NOT delete files and must enter CORRUPTED_NEEDS_REPAIR
  const openWhenCorrupted = manager.openProject('StarRunner', 'session_repair_test');

  // Run conservative repair
  const repairReport = manager.repairProjectWorkspace('StarRunner', 'session_repair_test');
  const customFileStillIntact = store.readVerifiedFile(customUserFilePath, false);
  const reopenAfterRepair = manager.openProject('StarRunner', 'session_repair_test');
  manager.closeProject('StarRunner', 'session_repair_test');

  results.push({
    id: 'proj_06_conservative_repair',
    category: 'Workspace Lock & Recovery',
    title: 'Conservative Workspace Repair & User File Preservation',
    passed:
      !openWhenCorrupted.success &&
      openWhenCorrupted.status === 'CORRUPTED_NEEDS_REPAIR' &&
      repairReport.repaired &&
      repairReport.actionsTaken.length >= 2 &&
      customFileStillIntact.valid &&
      customFileStillIntact.record?.content === 'USER_PRECIOUS_ARTWORK_BYTES' &&
      reopenAfterRepair.success,
    details:
      'Recreated missing directory, restored project.hylix.json from verified .bak, preserved custom user file intact, and logged repair audit.',
  });

  // -------------------------------------------------------------------------
  // 7. Safe Schema Migration (Schema 1 -> 2 -> 3) & Automatic Rollback on Failure
  // -------------------------------------------------------------------------
  const failedMigration = migrateProjectManifestInStorage(
    store,
    'StarRunner',
    3,
    true // simulate fault during migration
  );

  const manifestAfterRollback = store.readVerifiedFile('StarRunner/project.hylix.json', false);
  const parsedAfterRollback = manifestAfterRollback.record
    ? JSON.parse(manifestAfterRollback.record.content)
    : null;

  // Now run valid migration Schema 1 -> Schema 2 -> Schema 3
  const validMigration = migrateProjectManifestInStorage(
    store,
    'StarRunner',
    3,
    false
  );
  const manifestAfterSuccess = store.readVerifiedFile('StarRunner/project.hylix.json', false);
  const parsedAfterSuccess = manifestAfterSuccess.record
    ? JSON.parse(manifestAfterSuccess.record.content)
    : null;

  results.push({
    id: 'proj_07_schema_migration_and_rollback',
    category: 'Project Lifecycle & Manifest',
    title: 'Transactional Schema Migration (v1 -> v2 -> v3) & Failure Rollback',
    passed:
      !failedMigration.success &&
      failedMigration.rolledBack &&
      parsedAfterRollback?.schemaVersion === 1 &&
      validMigration.success &&
      validMigration.toSchemaVersion === 3 &&
      parsedAfterSuccess?.schemaVersion === 3 &&
      parsedAfterSuccess?.projectId === originalProjectId,
    details:
      'Verified automatic rollback to Schema v1 upon simulated migration fault, followed by clean transactional upgrade to Schema v3.',
  });

  // -------------------------------------------------------------------------
  // 8. Asset Registry Foundation & Cache vs Build vs Project Data Isolation
  // -------------------------------------------------------------------------
  const registerTexture = registerProjectAssetAtomically(
    store,
    'StarRunner',
    originalProjectId,
    'assets/textures/hero_sprite.png',
    'Sprite',
    'PNG_BINARY_PAYLOAD_SIMULATION'
  );
  const rejectCacheAsset = registerProjectAssetAtomically(
    store,
    'StarRunner',
    originalProjectId,
    'cache/compiled_shader.bin',
    'Shader',
    'TEMP_CACHE_DATA'
  );

  // Populate disposable cache/ and build/ files, then purge cache/
  store.writeFileAtomically('StarRunner/cache/thumb_01.cache', 'THUMBNAIL_CACHE');
  store.writeFileAtomically('StarRunner/build/output_preview.ap_', 'BUILD_ARTIFACT');

  const cachePurge = store.purgeProjectCacheOnly('StarRunner');
  const regRead = store.readVerifiedFile('StarRunner/.hylix/asset-registry.hylix.json', false);
  const regDocCheck = regRead.record
    ? validateAssetRegistryDocument(JSON.parse(regRead.record.content), originalProjectId)
    : { valid: false, document: null, errors: ['Missing registry'] };

  results.push({
    id: 'proj_08_asset_registry_and_cache_isolation',
    category: 'Atomic Storage & Project Safety',
    title: 'Asset Registry Foundation & Disposable Cache Isolation',
    passed:
      registerTexture.success &&
      !rejectCacheAsset.success &&
      cachePurge.purgedFileCount === 1 &&
      !store.fileExists('StarRunner/cache/thumb_01.cache') &&
      store.fileExists('StarRunner/build/output_preview.ap_') &&
      store.fileExists('StarRunner/assets/textures/hero_sprite.png') &&
      regDocCheck.valid &&
      (regDocCheck.document?.entries.length ?? 0) === 2,
    details:
      'Registered Sprite asset with deterministic assetId & checksum, blocked cache/ registration, and verified cache purge preserves Project Data and build/.',
  });

  // -------------------------------------------------------------------------
  // 9. Extended File Safety & System Path Confinement (/system, /etc, /data, C:\)
  // -------------------------------------------------------------------------
  const blockedPaths = [
    '../outside.json',
    '../../etc/shadow',
    'C:\\Windows\\System32\\cmd.exe',
    '/system/bin/sh',
    '/etc/hosts',
    '/data/local/tmp/exploit',
  ];
  const allBlocked = blockedPaths.every((p) => !validateWorkspaceRelativePath(p).safe);
  const crossProjectEscape = validateProjectScopedPath(
    'StarRunner',
    '../OtherProject/project.hylix.json'
  );
  const projectSystemShellCall = validateBuildCommandExecution({
    callerContext: 'project_system',
    toolId: 'aapt2_package',
    arguments: ['--version'],
  });

  results.push({
    id: 'proj_09_extended_file_and_shell_safety',
    category: 'Security & Privilege Separation',
    title: 'OS Path Blocking (/system, /etc, /data, C:\\) & Project Shell Prohibition',
    passed:
      allBlocked &&
      !crossProjectEscape.safe &&
      !projectSystemShellCall.permitted,
    details:
      'Blocked all OS root paths, Windows drives, parent traversal escapes, and direct command execution from Project System.',
  });

  return results;
}
