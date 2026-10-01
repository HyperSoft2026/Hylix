import React, { useState, useMemo } from 'react';
import {
  HYLIX_IDENTITY,
  PLATFORM_ROADMAP_MATRIX,
} from './core/engineIdentity';
import {
  ArchitecturalLayer,
  HYLIX_MODULE_BOUNDARIES,
  verifyModuleBoundaries,
} from './core/moduleRegistry';
import {
  createAndroidPlatformFoundation,
  verifyAndroidPlatformInvariants,
} from './platform/platformAbstraction';
import {
  evaluateAndroidSigningPolicy,
  redactSensitiveData,
  validateWorkspaceRelativePath,
} from './security/securityFoundation';
import { LocalFirstAtomicStore } from './storage/atomicStorage';
import {
  HylixProjectManager,
  HylixProjectManifest,
  WorkspaceValidationReport,
} from './project/projectSystem';
import { migrateProjectManifestInStorage } from './project/schemaMigration';
import { runArchitectureVerificationSuite } from './testing/foundationVerification';

type InspectorSection =
  | 'verification'
  | 'project_lifecycle'
  | 'modules'
  | 'security_signing'
  | 'storage_safety';

const LAYER_NAMES: Record<ArchitecturalLayer, string> = {
  [ArchitecturalLayer.LAYER_0_FOUNDATION]: 'Layer 0 · Foundation',
  [ArchitecturalLayer.LAYER_1_PLATFORM_STORAGE]: 'Layer 1 · Platform & Storage',
  [ArchitecturalLayer.LAYER_2_ENGINE_CORE]: 'Layer 2 · Engine Core & Data',
  [ArchitecturalLayer.LAYER_3_RUNTIME_DOMAINS]: 'Layer 3 · Runtime Domains',
  [ArchitecturalLayer.LAYER_4_TOOLING_EDITOR]: 'Layer 4 · Authoring & Build Tooling',
};

export function App() {
  const [activeSection, setActiveSection] = useState<InspectorSection>('verification');
  const [suiteRunCount, setSuiteRunCount] = useState<number>(1);
  const [selectedLayerFilter, setSelectedLayerFilter] = useState<number | 'all'>('all');

  // Interactive Project System Diagnostic state
  const [projectManager] = useState(() => new HylixProjectManager(new LocalFirstAtomicStore()));
  const [projectFolderInput, setProjectFolderInput] = useState<string>('DesertOdyssey');
  const [projectNameInput, setProjectNameInput] = useState<string>('Desert Odyssey');
  const [packageIdInput, setPackageIdInput] = useState<string>('com.hypersoft.desertodyssey');
  const [sessionIdInput, setSessionIdInput] = useState<string>('session_local_dev_01');
  const [activeManifest, setActiveManifest] = useState<HylixProjectManifest | null>(null);
  const [validationReport, setValidationReport] = useState<WorkspaceValidationReport | null>(null);
  const [projectOpsLog, setProjectOpsLog] = useState<string[]>([
    'Project System ready. Use the controls to test Create, Open, Validate, Repair, Migrate, and Close.',
  ]);

  // Interactive Security & Path Guard Tester state
  const [testPathInput, setTestPathInput] = useState<string>('scenes/level_01.scene.json');
  const [testLogInput, setTestLogInput] = useState<string>(
    'Signing release APK with storePassword=MySecretKeystorePass99 and HYLIX_RELEASE_KEY_PASSWORD=PrivateKeyPass42'
  );

  // Interactive Signing Continuity Tester state
  const [signingVariant, setSigningVariant] = useState<'debug' | 'release'>('release');
  const [autoGenToggle, setAutoGenToggle] = useState<boolean>(false);
  const [gitStoredToggle, setGitStoredToggle] = useState<boolean>(false);
  const [externalKeyConfigured, setExternalKeyConfigured] = useState<boolean>(false);
  const [expectedSha1Input, setExpectedSha1Input] = useState<string>('');
  const [activeSha1Input, setActiveSha1Input] = useState<string>('');

  // Interactive Atomic Write Tester state
  const [atomicFilePath, setAtomicFilePath] = useState<string>('project.hylix.json');
  const [atomicPayload, setAtomicPayload] = useState<string>(
    '{\n  "schemaVersion": 1,\n  "engineVersion": "1.0.0",\n  "projectId": "prj_demo0001",\n  "projectName": "Starter",\n  "packageId": "com.hypersoft.starter",\n  "defaultScene": "scenes/main.scene.hylix.json",\n  "supportedTargets": ["android"]\n}'
  );
  const [simulateCrash, setSimulateCrash] = useState<boolean>(false);
  const [storageAuditLog, setStorageAuditLog] = useState<string[]>([
    'Atomic store initialized in local-first sandbox mode.',
  ]);

  const [atomicStore] = useState(() => new LocalFirstAtomicStore());

  const verificationReport = useMemo(() => {
    void suiteRunCount;
    return runArchitectureVerificationSuite();
  }, [suiteRunCount]);

  const dagValidation = useMemo(
    () => verifyModuleBoundaries(HYLIX_MODULE_BOUNDARIES),
    []
  );

  const androidContract = useMemo(() => createAndroidPlatformFoundation(), []);
  const androidCheck = useMemo(
    () => verifyAndroidPlatformInvariants(androidContract),
    [androidContract]
  );

  const pathCheckResult = useMemo(
    () => validateWorkspaceRelativePath(testPathInput),
    [testPathInput]
  );

  const redactedLogPreview = useMemo(
    () => redactSensitiveData(testLogInput),
    [testLogInput]
  );

  const signingEval = useMemo(
    () =>
      evaluateAndroidSigningPolicy({
        applicationId: HYLIX_IDENTITY.androidApplicationId,
        buildVariant: signingVariant,
        autoGenerateKeystoreOnBuild: autoGenToggle,
        keystoreStoredInGitRepo: gitStoredToggle,
        keystoreBundledInApk: false,
        externalKeystoreConfigured: externalKeyConfigured,
        expectedCertificateSha1: expectedSha1Input.trim() || undefined,
        activeCertificateSha1: activeSha1Input.trim() || undefined,
      }),
    [
      signingVariant,
      autoGenToggle,
      gitStoredToggle,
      externalKeyConfigured,
      expectedSha1Input,
      activeSha1Input,
    ]
  );

  const filteredModules = useMemo(() => {
    if (selectedLayerFilter === 'all') return HYLIX_MODULE_BOUNDARIES;
    return HYLIX_MODULE_BOUNDARIES.filter((m) => m.layer === selectedLayerFilter);
  }, [selectedLayerFilter]);

  // Project Lifecycle Diagnostic Handlers
  const handleCreateProject = () => {
    const res = projectManager.createProject({
      projectFolder: projectFolderInput,
      projectName: projectNameInput,
      packageId: packageIdInput,
    });
    if (res.success && res.manifest) {
      setActiveManifest(res.manifest);
      setValidationReport(
        projectManager.validateProjectWorkspace(res.projectRoot, sessionIdInput)
      );
      setProjectOpsLog((prev) => [
        `[CREATE SUCCESS] Created '${res.projectRoot}/' with projectId=${res.manifest?.projectId} (${res.createdDirectories.length} dirs, ${res.createdFiles.length} files).`,
        ...prev,
      ]);
    } else {
      setProjectOpsLog((prev) => [
        `[CREATE REJECTED] ${res.errors.join(' | ')}`,
        ...prev,
      ]);
    }
  };

  const handleOpenProject = () => {
    const res = projectManager.openProject(projectFolderInput, sessionIdInput);
    if (res.success && res.manifest) {
      setActiveManifest(res.manifest);
      setValidationReport(
        projectManager.validateProjectWorkspace(res.projectRoot, sessionIdInput)
      );
      setProjectOpsLog((prev) => [
        `[OPENED] '${res.projectRoot}' locked by '${sessionIdInput}' · projectId=${res.manifest?.projectId} · Assets=${res.assetRegistry?.listAssets().length ?? 0} · StaleLockRecovered=${res.recoveredFromStaleLock}`,
        ...prev,
      ]);
    } else {
      setProjectOpsLog((prev) => [
        `[OPEN FAILED: ${res.status}] ${res.errors.join(' | ')}`,
        ...prev,
      ]);
    }
  };

  const handleValidateProject = () => {
    const report = projectManager.validateProjectWorkspace(
      projectFolderInput,
      sessionIdInput
    );
    setValidationReport(report);
    setProjectOpsLog((prev) => [
      `[VALIDATE] '${report.projectRoot}' · Valid=${report.valid} · Lock=${report.lockState} · Issues=${report.issues.length}`,
      ...prev,
    ]);
  };

  const handleSimulateProjectCorruption = () => {
    const store = projectManager.getStore();
    store.removeDirectoryMarkerForTesting(`${projectFolderInput}/assets/models`);
    store.injectRawCorruptedPayloadForTesting(
      `${projectFolderInput}/project.hylix.json`,
      '{corrupted_manifest_payload'
    );
    const report = projectManager.validateProjectWorkspace(
      projectFolderInput,
      sessionIdInput
    );
    setValidationReport(report);
    setProjectOpsLog((prev) => [
      `[FAULT INJECTED] Corrupted '${projectFolderInput}/project.hylix.json' and removed 'assets/models'. Run Repair Project to restore from .bak.`,
      ...prev,
    ]);
  };

  const handleRepairProject = () => {
    const rep = projectManager.repairProjectWorkspace(
      projectFolderInput,
      sessionIdInput
    );
    const val = projectManager.validateProjectWorkspace(
      projectFolderInput,
      sessionIdInput
    );
    setValidationReport(val);
    setProjectOpsLog((prev) => [
      `[REPAIR ${rep.repaired ? 'COMPLETE' : 'PARTIAL'}] Actions taken: ${rep.actionsTaken
        .map((a) => `${a.action} (${a.targetPath})`)
        .join(', ') || 'None needed'}`,
      ...prev,
    ]);
  };

  const handleMigrateProjectSchema = () => {
    const mig = migrateProjectManifestInStorage(
      projectManager.getStore(),
      projectFolderInput,
      3,
      false
    );
    if (mig.success && mig.migratedManifest) {
      setActiveManifest(mig.migratedManifest);
      setValidationReport(
        projectManager.validateProjectWorkspace(projectFolderInput, sessionIdInput)
      );
      setProjectOpsLog((prev) => [
        `[MIGRATED] Schema v${mig.fromSchemaVersion} -> v${mig.toSchemaVersion} (${mig.stepsExecuted.join(', ')})`,
        ...prev,
      ]);
    } else {
      setProjectOpsLog((prev) => [
        `[MIGRATION FAILED / ROLLED BACK] ${mig.error}`,
        ...prev,
      ]);
    }
  };

  const handleCloseProject = () => {
    const res = projectManager.closeProject(projectFolderInput, sessionIdInput);
    if (res.closed) {
      setValidationReport(
        projectManager.validateProjectWorkspace(projectFolderInput, sessionIdInput)
      );
      setProjectOpsLog((prev) => [
        `[CLOSED] Released workspace lock on '${projectFolderInput}' for session '${sessionIdInput}' · FlushedMetadata=${Boolean(res.flushedAssetMetadata)} · ReleasedResources=${res.releasedResourceCount ?? 0}.`,
        ...prev,
      ]);
    } else {
      setProjectOpsLog((prev) => [
        `[CLOSE REJECTED] ${res.error}`,
        ...prev,
      ]);
    }
  };

  // Atomic Store Diagnostic Handlers
  const handleExecuteAtomicWrite = () => {
    const report = atomicStore.writeFileAtomically(
      atomicFilePath,
      atomicPayload,
      simulateCrash
    );
    if (report.success) {
      setStorageAuditLog((prev) => [
        `[COMMITTED] ${report.targetPath} · Checksum: ${report.checksumHex} · Backup (.bak): ${
          report.backupCreated ? 'Updated' : 'Initial'
        } · Residual .tmp files: ${atomicStore.getStagingFileCount()}`,
        ...prev,
      ]);
    } else {
      setStorageAuditLog((prev) => [
        `[ABORTED & ROLLED BACK] ${report.targetPath} · Reason: ${report.error} · Residual .tmp files: ${atomicStore.getStagingFileCount()}`,
        ...prev,
      ]);
    }
  };

  const handleSimulateCorruptionAndRecover = () => {
    atomicStore.injectRawCorruptedPayloadForTesting(
      atomicFilePath,
      '{"corrupted_payload_bit_rot'
    );
    const readResult = atomicStore.readVerifiedFile(atomicFilePath);
    if (readResult.valid && readResult.recoveredFromBackup && readResult.record) {
      setStorageAuditLog((prev) => [
        `[RECOVERED FROM .BAK] Corruption detected in ${atomicFilePath}; restored verified checksum ${readResult.record?.checksumHex}.`,
        ...prev,
      ]);
    } else {
      setStorageAuditLog((prev) => [
        `[RECOVERY STATUS] ${
          readResult.error ||
          'Write at least two revisions first so a .bak snapshot exists before injecting corruption.'
        }`,
        ...prev,
      ]);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#F1F5F9] flex flex-col">
      {/* Top Bar Contract: 1 Row, 3 Zones */}
      <header className="h-16 border-b border-white/10 bg-[#111827] px-6 flex items-center justify-between">
        {/* Zone 1: Single text element Brand Wordmark */}
        <a
          href="#foundation"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('verification');
          }}
          className="font-display text-xl font-bold tracking-tight text-slate-100"
        >
          Hylix
        </a>

        {/* Zone 2: 5 Clean Single-Line Navigation Links */}
        <nav className="flex items-center gap-6 text-sm font-medium">
          {[
            { id: 'verification' as const, label: 'Verification Suite' },
            { id: 'project_lifecycle' as const, label: 'Project System' },
            { id: 'modules' as const, label: 'Module Boundaries' },
            { id: 'security_signing' as const, label: 'Security & Signing' },
            { id: 'storage_safety' as const, label: 'Atomic Storage' },
          ].map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveSection(item.id);
              }}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeSection === item.id
                  ? 'text-slate-100 border-[#06B6D4]'
                  : 'text-slate-400 border-transparent hover:text-slate-100'
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSuiteRunCount((n) => n + 1)}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-[#06B6D4] hover:bg-[#22D3EE] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Run All Checks
          </button>
        </div>
      </header>

      {/* Main Content Container (1440px Desktop Baseline) */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-8">
        {/* Official Identity & Architecture Foundation Header */}
        <section className="border border-white/10 bg-[#111827] rounded-lg p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-start sm:items-center gap-5">
            <div className="w-16 h-16 rounded-lg bg-[#0B0F17] border border-white/10 p-2.5 shrink-0 flex items-center justify-center">
              <img
                src="/branding/logo/hylix-logo.png"
                alt="Official Hylix Logo"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-1 font-mono tabular-nums">
                <span>{HYLIX_IDENTITY.organization}</span>
                <span aria-hidden="true">·</span>
                <span>Version {HYLIX_IDENTITY.version}</span>
                <span aria-hidden="true">·</span>
                <span>App ID: {HYLIX_IDENTITY.androidApplicationId}</span>
                <span aria-hidden="true">·</span>
                <span>License: {HYLIX_IDENTITY.license}</span>
              </div>
              <h1 className="font-display text-2xl font-bold text-slate-100">
                Hylix Architecture, Scene/ECS &amp; Asset System Diagnostic Console
              </h1>
              <p className="text-sm text-slate-400 mt-1 max-w-2xl">
                Phase 1–4 Foundation: 17 decoupled subsystems, Local-First Project Lifecycle, Scene System &amp; ECS Core, Central Asset Registry (SHA-256), Resource Manager &amp; Bounded Cache, and Atomic Storage.
              </p>
            </div>
          </div>

          <div className="text-left md:text-right shrink-0 border-t md:border-t-0 pt-4 md:pt-0 border-white/10 w-full md:w-auto">
            <div className="text-xs text-slate-400 mb-1">Automated Suite Status</div>
            <div className="font-mono tabular-nums text-lg font-bold text-emerald-400">
              {verificationReport.passedChecks} / {verificationReport.totalChecks} Checks Passing
            </div>
            <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
              DAG Modules: {HYLIX_MODULE_BOUNDARIES.length} · Violations: {dagValidation.violations.length}
            </div>
          </div>
        </section>

        {/* SECTION 1: Verification Suite & Platform Roadmap */}
        {activeSection === 'verification' && (
          <div className="space-y-8">
            <section className="border border-white/10 bg-[#111827] rounded-lg p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-100">
                    01. Automated Architecture, Project, Scene/ECS &amp; Asset System Assertions
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Live execution results from Phase 1 Foundation + Phase 2 Project + Phase 3 Scene/ECS + Phase 4 Asset System (Run #{suiteRunCount})
                  </p>
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-400">
                  Android Policy: {androidCheck.valid ? 'Compliant' : 'Violation'} · Logo: {HYLIX_IDENTITY.officialLogoRelativePath}
                </div>
              </div>

              <div className="divide-y divide-white/10 border-t border-white/10">
                {verificationReport.results.map((item, idx) => (
                  <div
                    key={item.id}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="font-mono tabular-nums">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{item.category}</span>
                      </div>
                      <div className="text-sm font-semibold text-slate-100">
                        {item.title}
                      </div>
                      <p className="text-xs text-slate-400">{item.details}</p>
                    </div>

                    <div className="shrink-0 font-mono tabular-nums text-xs font-semibold">
                      {item.passed ? (
                        <span className="text-emerald-400">PASSED</span>
                      ) : (
                        <span className="text-red-400">FAILED</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Android-First & Cross-Platform Strategy Matrix */}
            <section className="border border-white/10 bg-[#111827] rounded-lg p-6">
              <div className="mb-4">
                <h2 className="font-display text-lg font-bold text-slate-100">
                  02. Android-First Target &amp; Future Platform Abstraction Matrix
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Hylix V1.0.0 targets Android exclusively while isolating OS specifics behind PlatformAbstractionContract.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400">
                      <th className="py-2.5 pr-4 font-medium">Platform</th>
                      <th className="py-2.5 px-4 font-medium">V1.0.0 Release State</th>
                      <th className="py-2.5 px-4 font-medium">Packaging Contract</th>
                      <th className="py-2.5 pl-4 font-medium text-right">Architectural Boundary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-mono tabular-nums">
                    {PLATFORM_ROADMAP_MATRIX.map((plat) => (
                      <tr key={plat.id} className="hover:bg-white/5">
                        <td className="py-3 pr-4 font-sans font-semibold text-slate-100">
                          {plat.displayName}
                        </td>
                        <td className="py-3 px-4">
                          {plat.activeInV1 ? (
                            <span className="text-emerald-400 font-semibold">
                              Active Target (V1.0.0)
                            </span>
                          ) : (
                            <span className="text-slate-400">
                              Disabled in V1.0.0
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          {plat.packagingFormat}
                        </td>
                        <td className="py-3 pl-4 text-right text-slate-400 font-sans">
                          {plat.architecturalStatus}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* SECTION 2: Project System Diagnostic Harness */}
        {activeSection === 'project_lifecycle' && (
          <section className="border border-white/10 bg-[#111827] rounded-lg p-6 space-y-6">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-100">
                Project System &amp; Workspace Lifecycle Diagnostic Harness
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Test Create Project, Open Project, Validate Project, Conservative Repair, Schema Migration, and Close Project.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Workspace Folder Name
                    </label>
                    <input
                      type="text"
                      value={projectFolderInput}
                      onChange={(e) => setProjectFolderInput(e.target.value)}
                      className="w-full bg-[#0B0F17] border border-white/10 rounded px-3 py-1.5 text-xs font-mono text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Project Display Name
                    </label>
                    <input
                      type="text"
                      value={projectNameInput}
                      onChange={(e) => setProjectNameInput(e.target.value)}
                      className="w-full bg-[#0B0F17] border border-white/10 rounded px-3 py-1.5 text-xs text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Android Package ID
                    </label>
                    <input
                      type="text"
                      value={packageIdInput}
                      onChange={(e) => setPackageIdInput(e.target.value)}
                      className="w-full bg-[#0B0F17] border border-white/10 rounded px-3 py-1.5 text-xs font-mono text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Active Session ID (Lock Holder)
                    </label>
                    <input
                      type="text"
                      value={sessionIdInput}
                      onChange={(e) => setSessionIdInput(e.target.value)}
                      className="w-full bg-[#0B0F17] border border-white/10 rounded px-3 py-1.5 text-xs font-mono text-slate-100"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleCreateProject}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-[#06B6D4] hover:bg-[#22D3EE] rounded-md transition-colors whitespace-nowrap"
                  >
                    Create Project
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenProject}
                    className="px-3 py-1.5 text-xs font-medium text-slate-100 bg-white/10 hover:bg-white/15 rounded-md transition-colors whitespace-nowrap"
                  >
                    Open Project
                  </button>
                  <button
                    type="button"
                    onClick={handleValidateProject}
                    className="px-3 py-1.5 text-xs font-medium text-slate-100 bg-white/10 hover:bg-white/15 rounded-md transition-colors whitespace-nowrap"
                  >
                    Validate Project
                  </button>
                  <button
                    type="button"
                    onClick={handleRepairProject}
                    className="px-3 py-1.5 text-xs font-medium text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/10 rounded-md transition-colors whitespace-nowrap"
                  >
                    Repair Project
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseProject}
                    className="px-3 py-1.5 text-xs font-medium text-slate-300 border border-white/15 hover:bg-white/5 rounded-md transition-colors whitespace-nowrap"
                  >
                    Close Project
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleMigrateProjectSchema}
                    className="px-3 py-1 text-xs text-slate-300 border border-white/10 hover:bg-white/5 rounded transition-colors whitespace-nowrap"
                  >
                    Migrate Schema (v1 &rarr; v3)
                  </button>
                  <button
                    type="button"
                    onClick={handleSimulateProjectCorruption}
                    className="px-3 py-1 text-xs text-amber-300 border border-amber-500/30 hover:bg-amber-500/10 rounded transition-colors whitespace-nowrap"
                  >
                    Inject Fault (Test Repair)
                  </button>
                </div>

                {activeManifest && (
                  <div className="mt-4 p-3 rounded bg-[#0B0F17] border border-white/10 space-y-1 font-mono text-xs">
                    <div className="text-slate-400">
                      Active Manifest (project.hylix.json)
                    </div>
                    <div className="text-slate-200">
                      projectId: {activeManifest.projectId} · schemaVersion: {activeManifest.schemaVersion}
                    </div>
                    <div className="text-slate-400">
                      packageId: {activeManifest.packageId} · defaultScene: {activeManifest.defaultScene}
                    </div>
                  </div>
                )}
              </div>

              <div className="border border-white/10 bg-[#0B0F17] rounded-lg p-4 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span>Project Lifecycle Audit Log</span>
                    {validationReport && (
                      <span className="font-mono tabular-nums">
                        Lock: {validationReport.lockState} · Valid: {String(validationReport.valid)}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto font-mono text-xs text-slate-300">
                    {projectOpsLog.map((line, i) => (
                      <div
                        key={i}
                        className="p-2 rounded bg-[#111827] border border-white/5"
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* SECTION 3: 17 Module Boundaries & DAG Layer Explorer */}
        {activeSection === 'modules' && (
          <section className="border border-white/10 bg-[#111827] rounded-lg p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-100">
                  17 Decoupled Subsystems &amp; Layer Hierarchy
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Modules in Layer N may only depend on modules in Layer &le; N. Circular dependencies and Editor-to-Core couplings are strictly prohibited.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] border border-white/10 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSelectedLayerFilter('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    selectedLayerFilter === 'all'
                      ? 'bg-[#06B6D4] text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  All 17 Modules
                </button>
                {[0, 1, 2, 3, 4].map((layerNum) => (
                  <button
                    key={layerNum}
                    type="button"
                    onClick={() => setSelectedLayerFilter(layerNum)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap font-mono tabular-nums ${
                      selectedLayerFilter === layerNum
                        ? 'bg-[#06B6D4] text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    Layer {layerNum}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredModules.map((mod) => (
                <div
                  key={mod.id}
                  className="border border-white/10 bg-[#0B0F17] rounded-lg p-4 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1 font-mono tabular-nums">
                      <span>{LAYER_NAMES[mod.layer]}</span>
                      <span>{mod.id}</span>
                    </div>
                    <h3 className="font-display text-base font-bold text-slate-100 mb-1.5">
                      {mod.displayName}
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {mod.responsibility}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/5 text-xs text-slate-400">
                    <span className="text-slate-500">Allowed Dependencies: </span>
                    <span className="font-mono text-slate-300">
                      {mod.allowedDependencies.length === 0
                        ? 'None (Zero-Dependency Root)'
                        : mod.allowedDependencies.join(', ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* SECTION 4: Security & Android Signing Policy Validator */}
        {activeSection === 'security_signing' && (
          <div className="space-y-6">
            <section className="border border-white/10 bg-[#111827] rounded-lg p-6 space-y-5">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-100">
                  01. Android Signing Identity &amp; Certificate Continuity Guard
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Interactive verifier for evaluateAndroidSigningPolicy(). Guarantees that production keys are created once externally, never stored in Git, and never replaced across updates.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Build Variant
                    </label>
                    <div className="flex items-center gap-2">
                      {(['release', 'debug'] as const).map((variant) => (
                        <button
                          key={variant}
                          type="button"
                          onClick={() => setSigningVariant(variant)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors uppercase font-mono ${
                            signingVariant === variant
                              ? 'border-[#06B6D4] bg-[#06B6D4]/15 text-white'
                              : 'border-white/10 bg-[#0B0F17] text-slate-400'
                          }`}
                        >
                          {variant}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={externalKeyConfigured}
                        onChange={(e) => setExternalKeyConfigured(e.target.checked)}
                        className="accent-[#06B6D4]"
                      />
                      <span>External Production Keystore Configured (Outside Git)</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoGenToggle}
                        onChange={(e) => setAutoGenToggle(e.target.checked)}
                        className="accent-[#06B6D4]"
                      />
                      <span>Simulate Prohibited Auto-Generate Keystore on Build</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={gitStoredToggle}
                        onChange={(e) => setGitStoredToggle(e.target.checked)}
                        className="accent-[#06B6D4]"
                      />
                      <span>Simulate Prohibited Keystore Committed in Git Repo</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-3 pt-1">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Expected Production Certificate SHA-1 (Leave empty if not yet generated)
                      </label>
                      <input
                        type="text"
                        value={expectedSha1Input}
                        onChange={(e) => setExpectedSha1Input(e.target.value)}
                        placeholder="e.g. 3A:7F:12:9C:4B:8E:01:23:45:67:89:AB:CD:EF:10:20:30:40:50:60"
                        className="w-full bg-[#0B0F17] border border-white/10 rounded px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#06B6D4]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Active Keystore Certificate SHA-1
                      </label>
                      <input
                        type="text"
                        value={activeSha1Input}
                        onChange={(e) => setActiveSha1Input(e.target.value)}
                        placeholder="Must match Expected SHA-1 during release signing"
                        className="w-full bg-[#0B0F17] border border-white/10 rounded px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#06B6D4]"
                      />
                    </div>
                  </div>
                </div>

                <div className="border border-white/10 bg-[#0B0F17] rounded-lg p-4 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="text-xs text-slate-400">Policy Evaluation Result</div>
                    <div
                      className={`font-mono text-sm font-bold ${
                        signingEval.valid ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      Status: {signingEval.status}
                    </div>
                    <div className="text-xs text-slate-400 font-mono">
                      Locked Application ID: {HYLIX_IDENTITY.androidApplicationId}
                    </div>

                    {signingEval.errors.length > 0 ? (
                      <ul className="mt-3 space-y-1.5 text-xs text-red-400 list-disc list-inside">
                        {signingEval.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-xs text-slate-300 leading-relaxed">
                        {signingEval.status === 'AWAITING_INITIAL_PRODUCTION_CERTIFICATE'
                          ? 'Repository signing structure is valid and awaiting initial external production certificate provisioning. No fabricated SHA-1 placeholder is used.'
                          : 'Signing configuration satisfies all Hylix security and continuity requirements.'}
                      </p>
                    )}
                  </div>

                  <div className="pt-4 border-t border-white/5 text-[11px] text-slate-400 font-mono">
                    Guard Source: android/app/build.gradle.kts &amp; src/security/securityFoundation.ts
                  </div>
                </div>
              </div>
            </section>

            {/* Path Confinement & Log Redaction Tester */}
            <section className="border border-white/10 bg-[#111827] rounded-lg p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h3 className="font-display text-base font-bold text-slate-100">
                  02. Sandbox Path Traversal Guard
                </h3>
                <p className="text-xs text-slate-400">
                  Test relative workspace paths against traversal (..), /system, /etc, /data, C:\, and keystore file access.
                </p>
                <input
                  type="text"
                  value={testPathInput}
                  onChange={(e) => setTestPathInput(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/10 rounded px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#06B6D4]"
                />
                <div className="p-3 rounded bg-[#0B0F17] border border-white/10 text-xs font-mono">
                  {pathCheckResult.safe ? (
                    <span className="text-emerald-400">
                      SAFE · Normalized: &ldquo;{pathCheckResult.normalizedPath}&rdquo;
                    </span>
                  ) : (
                    <span className="text-red-400">
                      BLOCKED · {pathCheckResult.reason}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-display text-base font-bold text-slate-100">
                  03. Diagnostic Secret Redaction Engine
                </h3>
                <p className="text-xs text-slate-400">
                  Verify that passwords, tokens, and keystore secrets are scrubbed before logging.
                </p>
                <input
                  type="text"
                  value={testLogInput}
                  onChange={(e) => setTestLogInput(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/10 rounded px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#06B6D4]"
                />
                <div className="p-3 rounded bg-[#0B0F17] border border-white/10 text-xs font-mono text-slate-300 break-all">
                  {redactedLogPreview}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* SECTION 5: Local-First Atomic Storage & Recovery */}
        {activeSection === 'storage_safety' && (
          <section className="border border-white/10 bg-[#111827] rounded-lg p-6 space-y-6">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-100">
                Local-First Atomic File Write &amp; Corruption Recovery Engine
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Tests staging to .tmp, flush/close verification, 64-bit deterministic checksums, .bak backup rotation, and automatic corruption recovery.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Sandbox Relative File Path
                  </label>
                  <input
                    type="text"
                    value={atomicFilePath}
                    onChange={(e) => setAtomicFilePath(e.target.value)}
                    className="w-full bg-[#0B0F17] border border-white/10 rounded px-3 py-1.5 text-xs font-mono text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Project File Payload
                  </label>
                  <textarea
                    rows={6}
                    value={atomicPayload}
                    onChange={(e) => setAtomicPayload(e.target.value)}
                    className="w-full bg-[#0B0F17] border border-white/10 rounded p-3 text-xs font-mono text-slate-200"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simulateCrash}
                    onChange={(e) => setSimulateCrash(e.target.checked)}
                    className="accent-[#06B6D4]"
                  />
                  <span>Simulate Crash / Interruption During .tmp Staging</span>
                </label>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleExecuteAtomicWrite}
                    className="px-4 py-2 text-xs font-semibold text-slate-950 bg-[#06B6D4] hover:bg-[#22D3EE] rounded-md transition-colors whitespace-nowrap"
                  >
                    Commit Atomic Write
                  </button>
                  <button
                    type="button"
                    onClick={handleSimulateCorruptionAndRecover}
                    className="px-4 py-2 text-xs font-medium text-slate-200 border border-white/15 hover:bg-white/5 rounded-md transition-colors whitespace-nowrap"
                  >
                    Simulate Corruption &amp; Test .bak Recovery
                  </button>
                </div>
              </div>

              <div className="border border-white/10 bg-[#0B0F17] rounded-lg p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
                    <span>Transaction Audit Log</span>
                    <span className="font-mono tabular-nums">
                      Active .tmp Staging Files: {atomicStore.getStagingFileCount()}
                    </span>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto font-mono text-xs text-slate-300">
                    {storageAuditLog.map((entry, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded bg-[#111827] border border-white/5"
                      >
                        {entry}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
