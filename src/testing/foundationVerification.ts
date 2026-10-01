import {
  HYLIX_IDENTITY,
  PLATFORM_ROADMAP_MATRIX,
  SubsystemId,
  TargetPlatformId,
} from '../core/engineIdentity';
import {
  ArchitecturalLayer,
  HYLIX_MODULE_BOUNDARIES,
  ModuleBoundaryDescriptor,
  verifyModuleBoundaries,
} from '../core/moduleRegistry';
import {
  createAndroidPlatformFoundation,
  verifyAndroidPlatformInvariants,
} from '../platform/platformAbstraction';
import {
  evaluateAndroidSigningPolicy,
  redactSensitiveData,
  validateBuildCommandExecution,
  validateWorkspaceRelativePath,
} from '../security/securityFoundation';
import {
  LocalFirstAtomicStore,
  SafeBuildWorkspaceSession,
} from '../storage/atomicStorage';
import { validateProjectManifest } from '../project/projectSystem';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import { runProjectSystemVerificationChecks } from './projectSystemVerification';
import { runSceneAndEcsVerificationChecks } from './sceneEcsVerification';
import { runAssetSystemVerificationChecks } from './assetSystemVerification';
import { runRenderingVerificationChecks } from './renderingVerification';
import { runPhysicsVerificationChecks } from './physicsVerification';
import { runAudioVerificationChecks } from './audioVerification';
import { runInputVerificationChecks } from './inputVerification';
import { runScriptingVerificationChecks } from './scriptingVerification';

export interface VerificationAssertionResult {
  readonly id: string;
  readonly category:
    | 'Architecture & Boundaries'
    | 'Android Identity & Platform'
    | 'Signing & Certificate Continuity'
    | 'Security & Privilege Separation'
    | 'Atomic Storage & Project Safety'
    | 'Project Lifecycle & Manifest'
    | 'Workspace Lock & Recovery'
    | 'Scene System & ECS Core'
    | 'Asset System & Resource Management'
    | 'Rendering Foundation & 2D/3D Abstraction'
    | 'Physics Foundation & Spatial Queries'
    | 'Audio System & Sound Resource Management'
    | 'Input System & Device Abstraction'
    | 'Input System'
    | 'Scripting System & Runtime Sandbox';
  readonly title: string;
  readonly passed: boolean;
  readonly details: string;
}

export interface ArchitectureVerificationSuiteReport {
  readonly allPassed: boolean;
  readonly totalChecks: number;
  readonly passedChecks: number;
  readonly failedChecks: number;
  readonly results: readonly VerificationAssertionResult[];
}

export function runArchitectureVerificationSuite(): ArchitectureVerificationSuiteReport {
  const results: VerificationAssertionResult[] = [];

  // 1. Verify all 17 separated architectural domains are defined and acyclic
  const boundaryCheck = verifyModuleBoundaries(HYLIX_MODULE_BOUNDARIES);
  results.push({
    id: 'arch_01_dag_boundaries',
    category: 'Architecture & Boundaries',
    title: '17 Subsystem Boundaries & Directed Acyclic Graph (DAG)',
    passed: boundaryCheck.valid && HYLIX_MODULE_BOUNDARIES.length === 17,
    details: boundaryCheck.valid
      ? `Verified ${HYLIX_MODULE_BOUNDARIES.length} decoupled modules across 5 architectural layers with zero circular dependencies.`
      : `Boundary violations: ${boundaryCheck.violations.join('; ')}`,
  });

  // 2. Verify cyclic / upward dependency rejection works
  const invalidModules: ModuleBoundaryDescriptor[] = [
    ...HYLIX_MODULE_BOUNDARIES,
    {
      id: SubsystemId.ENGINE_CORE,
      displayName: 'Invalid Core Depending on Editor',
      layer: ArchitecturalLayer.LAYER_2_ENGINE_CORE,
      responsibility: 'Test fault injection',
      allowedDependencies: [SubsystemId.EDITOR],
      isolatedFromEditorUi: true,
    },
  ];
  const faultBoundaryCheck = verifyModuleBoundaries(invalidModules);
  results.push({
    id: 'arch_02_layer_violation_guard',
    category: 'Architecture & Boundaries',
    title: 'Upward Layer Dependency Rejection Guard',
    passed: !faultBoundaryCheck.valid && faultBoundaryCheck.violations.length > 0,
    details:
      'Confirmed that lower-layer modules attempting to depend on Editor/higher layers are automatically rejected.',
  });

  // 3. Verify Android-First V1.0.0 Strategy & Future Platform Reservation
  const activePlatforms = PLATFORM_ROADMAP_MATRIX.filter((p) => p.activeInV1);
  const futurePlatforms = PLATFORM_ROADMAP_MATRIX.filter((p) => !p.activeInV1);
  const androidOnlyInV1 =
    activePlatforms.length === 1 &&
    activePlatforms[0].id === TargetPlatformId.ANDROID &&
    futurePlatforms.length === 4;

  results.push({
    id: 'platform_01_android_first',
    category: 'Android Identity & Platform',
    title: 'Android-First V1.0.0 Target & Future Cross-Platform Abstraction',
    passed: androidOnlyInV1,
    details:
      'Active V1.0.0 target is strictly Android; Windows, Linux, macOS, and iOS are reserved in the Platform Abstraction Layer without premature implementation.',
  });

  // 4. Verify Immutable Android Application ID ("com.hypersoft.hylix") & Least Privilege Sandbox
  const androidFoundation = createAndroidPlatformFoundation();
  const androidCheck = verifyAndroidPlatformInvariants(androidFoundation);
  results.push({
    id: 'platform_02_immutable_app_id',
    category: 'Android Identity & Platform',
    title: 'Immutable Application ID ("com.hypersoft.hylix") & Zero Dangerous Permissions',
    passed:
      androidCheck.valid &&
      HYLIX_IDENTITY.androidApplicationId === 'com.hypersoft.hylix' &&
      HYLIX_IDENTITY.officialLogoRelativePath === 'branding/logo/hylix-logo.png',
    details: androidCheck.valid
      ? 'Application ID fixed to com.hypersoft.hylix, allowBackup=false, zero dangerous permissions, official logo bound to branding/logo/hylix-logo.png.'
      : androidCheck.errors.join('; '),
  });

  // 5. Verify Android Signing Policy blocks auto-generated keystores, Git-stored keys, and fake SHA-1s
  const rejectAutoGenSigning = evaluateAndroidSigningPolicy({
    applicationId: 'com.hypersoft.hylix',
    buildVariant: 'release',
    autoGenerateKeystoreOnBuild: true,
    keystoreStoredInGitRepo: true,
    keystoreBundledInApk: false,
    externalKeystoreConfigured: false,
    expectedCertificateSha1: '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00',
  });

  const rejectMismatchedSha1 = evaluateAndroidSigningPolicy({
    applicationId: 'com.hypersoft.hylix',
    buildVariant: 'release',
    autoGenerateKeystoreOnBuild: false,
    keystoreStoredInGitRepo: false,
    keystoreBundledInApk: false,
    externalKeystoreConfigured: true,
    expectedCertificateSha1: '3A:7F:12:9C:4B:8E:01:23:45:67:89:AB:CD:EF:10:20:30:40:50:60',
    activeCertificateSha1: '99:88:77:66:55:44:33:22:11:00:AA:BB:CC:DD:EE:FF:10:20:30:40',
  });

  const acceptAwaitingInitialCert = evaluateAndroidSigningPolicy({
    applicationId: 'com.hypersoft.hylix',
    buildVariant: 'release',
    autoGenerateKeystoreOnBuild: false,
    keystoreStoredInGitRepo: false,
    keystoreBundledInApk: false,
    externalKeystoreConfigured: false,
  });

  results.push({
    id: 'signing_01_continuity_guard',
    category: 'Signing & Certificate Continuity',
    title: 'Single Production Key & SHA-1 Continuity Enforcement',
    passed:
      !rejectAutoGenSigning.valid &&
      rejectAutoGenSigning.errors.length >= 3 &&
      !rejectMismatchedSha1.valid &&
      acceptAwaitingInitialCert.valid &&
      acceptAwaitingInitialCert.status === 'AWAITING_INITIAL_PRODUCTION_CERTIFICATE',
    details:
      'Blocked auto-generated keystores, Git-tracked private keys, placeholder SHA-1 fingerprints, and accidental certificate replacement.',
  });

  // 6. Verify Path Traversal & Protected File Access Prevention
  const safePath = validateWorkspaceRelativePath('scenes/main_level.hylix.json');
  const traversalAttack = validateWorkspaceRelativePath('../../etc/passwd');
  const absolutePathAttack = validateWorkspaceRelativePath('/Users/dev/secret.txt');
  const keystoreAccessAttack = validateWorkspaceRelativePath('keys/release.jks');

  results.push({
    id: 'sec_01_path_traversal_guard',
    category: 'Security & Privilege Separation',
    title: 'Sandbox Path Traversal & Keystore File Protection',
    passed:
      safePath.safe &&
      !traversalAttack.safe &&
      !absolutePathAttack.safe &&
      !keystoreAccessAttack.safe,
    details:
      'Permitted valid sandbox-relative path while blocking "../", absolute developer paths, and .jks/.keystore file access.',
  });

  // 7. Verify Editor vs Build Privilege Separation & Command Injection Prevention
  const editorDirectCall = validateBuildCommandExecution({
    callerContext: 'editor_ui',
    toolId: 'aapt2_package',
    arguments: ['--output', 'build/resources.ap_'],
  });
  const shellInjectionAttempt = validateBuildCommandExecution({
    callerContext: 'isolated_build_worker',
    toolId: 'aapt2_package',
    arguments: ['--output', 'out.ap_; rm -rf /'],
  });
  const validWorkerCall = validateBuildCommandExecution({
    callerContext: 'isolated_build_worker',
    toolId: 'aapt2_package',
    arguments: ['--output', 'build/resources.ap_'],
  });

  results.push({
    id: 'sec_02_privilege_separation',
    category: 'Security & Privilege Separation',
    title: 'Editor vs Build Tooling Isolation & Shell Injection Guard',
    passed:
      !editorDirectCall.permitted &&
      !shellInjectionAttempt.permitted &&
      validWorkerCall.permitted,
    details:
      'Denied direct build execution from Editor UI context and blocked shell metacharacter injection.',
  });

  // 8. Verify Secret Redaction in Diagnostic Logger
  const logger = new RedactedDiagnosticLogger();
  const entry = logger.record(
    'build_system',
    'ERROR',
    'Failed signing with storePassword=MySuperSecretPass123 and HYLIX_RELEASE_KEY_PASSWORD=KeySecret999'
  );
  const rawLeakPresent =
    entry.redactedMessage.includes('MySuperSecretPass123') ||
    entry.redactedMessage.includes('KeySecret999');

  results.push({
    id: 'sec_03_log_redaction',
    category: 'Security & Privilege Separation',
    title: 'Diagnostic Log Secret & Password Redaction',
    passed:
      !rawLeakPresent &&
      entry.redactedMessage.includes('[REDACTED_SECRET]') &&
      entry.redactedMessage.includes('[REDACTED_ENV_SECRET]') &&
      redactSensitiveData('token: abc123xyz').includes('[REDACTED_SECRET]'),
    details: `Redacted sensitive credentials from diagnostic log output: "${entry.redactedMessage}"`,
  });

  // 9. Verify Atomic File Writes, Interrupted Write Rollback & Corruption Recovery
  const store = new LocalFirstAtomicStore();
  const v1Write = store.writeFileAtomically('project.hylix.json', '{"version":1,"state":"clean"}');
  const v2Write = store.writeFileAtomically('project.hylix.json', '{"version":2,"state":"updated"}');
  const interruptedWrite = store.writeFileAtomically(
    'project.hylix.json',
    '{"version":3,"state":"partial"}',
    true
  );

  const readAfterInterrupt = store.readVerifiedFile('project.hylix.json');
  store.injectRawCorruptedPayloadForTesting('project.hylix.json', '{"version":2,"corrupted');
  const readAfterCorruption = store.readVerifiedFile('project.hylix.json');

  results.push({
    id: 'storage_01_atomic_write_and_recovery',
    category: 'Atomic Storage & Project Safety',
    title: 'Atomic Write Staging, Interrupted Write Safety & Backup Recovery',
    passed:
      v1Write.success &&
      v2Write.success &&
      v2Write.backupCreated &&
      !interruptedWrite.success &&
      store.getStagingFileCount() === 0 &&
      readAfterInterrupt.valid &&
      readAfterInterrupt.record?.content === '{"version":2,"state":"updated"}' &&
      readAfterCorruption.valid &&
      readAfterCorruption.recoveredFromBackup &&
      readAfterCorruption.record?.content === '{"version":1,"state":"clean"}',
    details:
      'Verified .tmp staging cleanup on interruption, checksum corruption detection, and automatic rollback recovery from .bak snapshot.',
  });

  // 10. Verify Safe Build Workspace Cleanup & Local-First Project Manifest Validation
  const workspace = new SafeBuildWorkspaceSession('build_job_001');
  workspace.registerTemporaryArtifact('intermediate/classes.dex');
  workspace.registerTemporaryArtifact('intermediate/resources.ap_');
  const cleanupResult = workspace.cleanupWorkspace();

  const manifestValidation = validateProjectManifest({
    schemaVersion: 1,
    engineVersion: '1.0.0',
    projectId: 'demo_android_game',
    projectName: 'Demo Android Game',
    targetPlatform: TargetPlatformId.ANDROID,
    entrySceneRelativePath: 'scenes/entry.scene.json',
    localFirstMode: true,
  });

  results.push({
    id: 'storage_02_build_cleanup_and_manifest',
    category: 'Atomic Storage & Project Safety',
    title: 'Safe Build Workspace Cleanup & Local-First Manifest Validation',
    passed:
      cleanupResult.isClean &&
      cleanupResult.cleanedArtifactCount === 2 &&
      workspace.getRemainingArtifactCount() === 0 &&
      manifestValidation.valid,
    details:
      'Verified deterministic post-build workspace cleanup (0 residual files) and strict local-first project manifest validation.',
  });

  // 11..19: Run Phase 2 Project System & Local Storage Layer Verification Suite
  const phase2Checks = runProjectSystemVerificationChecks();
  results.push(...phase2Checks);

  // 20..41: Run Phase 3 Scene System & ECS Core Verification Suite (22 assertions)
  const phase3Checks = runSceneAndEcsVerificationChecks();
  results.push(...phase3Checks);

  // 42..76: Run Phase 4 Asset System & Resource Management Verification Suite (35 assertions)
  const phase4Checks = runAssetSystemVerificationChecks();
  results.push(...phase4Checks);

  // 77..108: Run Phase 5 Rendering Foundation & 2D/3D Render Abstraction Verification Suite (32 assertions)
  const phase5Checks = runRenderingVerificationChecks();
  results.push(...phase5Checks);

  // 109..147: Run Phase 6 Physics Foundation & Spatial Queries Verification Suite (39 assertions)
  const phase6Checks = runPhysicsVerificationChecks();
  results.push(...phase6Checks);

  // 148..183: Run Phase 7 Audio System & Sound Resource Management Verification Suite (36 assertions)
  const phase7Checks = runAudioVerificationChecks();
  results.push(...phase7Checks);

  // 184..223: Run Phase 8 Input System & Device Abstraction Verification Suite (40 assertions)
  const phase8Checks = runInputVerificationChecks();
  results.push(...phase8Checks);

  // 224..263: Run Phase 9 Scripting System & Runtime Sandbox Verification Suite (40 assertions)
  const phase9Checks = runScriptingVerificationChecks();
  results.push(...phase9Checks);

  const passedChecks = results.filter((r) => r.passed).length;
  const failedChecks = results.length - passedChecks;

  return {
    allPassed: failedChecks === 0,
    totalChecks: results.length,
    passedChecks,
    failedChecks,
    results,
  };
}
