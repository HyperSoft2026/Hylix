# Hylix V1.0.0 — Technical Architecture Specification

**Project**: Hylix  
**Organization**: HyperSoft  
**License**: MIT  
**Release Target (V1.0.0)**: Android (`com.hypersoft.hylix`)  
**Official Branding Asset**: `branding/logo/hylix-logo.png`

---

## 1. Hylix Architecture Overview

Hylix is a free, open-source game engine and integrated editor built from scratch by HyperSoft. It is **not** a fork, wrapper, or derivative of Unity, Unreal Engine, or Godot.

The architecture is designed as a **layered, modular, local-first system** governed by a strict Directed Acyclic Graph (DAG) of module dependencies. In Phase 1 (Architecture Foundation), only the structural boundaries, security invariants, atomic storage guarantees, Android platform sandbox contract, and signing continuity guards are established.

### Architectural Layer Hierarchy

| Layer | Name | Modules Included | Dependency Rule |
| :--- | :--- | :--- | :--- |
| **Layer 0** | Foundation | `security`, `debugging` | Zero upward dependencies; foundational guards and redacted logging. |
| **Layer 1** | Platform & Storage | `platform_android`, `storage` | May depend only on Layer 0 (`security`, `debugging`). |
| **Layer 2** | Engine Core & Data | `engine_core`, `project_system`, `asset_system`, `entity_component_system` | May depend only on Layers 0–1. |
| **Layer 3** | Runtime Domains | `scene_system`, `rendering`, `physics`, `audio`, `input`, `scripting` | May depend only on Layers 0–2. |
| **Layer 4** | Authoring & Tooling | `editor`, `build_system`, `testing` | Top-level consumers; `build_system` is strictly isolated from `editor` UI privileges. |

---

## 2. Module Boundaries & Separation of Concerns

Hylix separates responsibilities across **17 explicit subsystems** (`src/core/moduleRegistry.ts` and `src/subsystems/domainContracts.ts`):

1. **Editor (`editor`)**: Local-first visual authoring shell, inspector state, and undo/redo command stack. Forbidden from invoking raw build binaries directly.
2. **Engine Core (`engine_core`)**: Deterministic lifecycle state machine, subsystem registry, and DAG boundary validator.
3. **Rendering (`rendering`)**: Hardware-agnostic 2D/3D render command queue and surface lifecycle contracts.
4. **Scene System (`scene_system`)**: Deterministic scene graph hierarchy and spatial transform propagation contracts.
5. **Entity/Component System (`entity_component_system`)**: Data-oriented entity IDs, component archetypes, and query execution contracts.
6. **Asset System (`asset_system`)**: Content-addressed local asset registry with mandatory integrity hash verification.
7. **Project System (`project_system`)**: Project manifest schema (`HylixProjectManifest`), validation, and forward-safe migration hooks.
8. **Scripting (`scripting`)**: Capability-restricted, sandboxed gameplay script host boundary with zero direct filesystem escape.
9. **Input (`input`)**: Multi-touch gesture, virtual controller, sensor, and pointer action mapping abstraction.
10. **Audio (`audio`)**: Low-latency mixer bus and local audio asset decoding contracts.
11. **Physics (`physics`)**: Fixed-timestep 2D/3D collision and rigid-body simulation contracts.
12. **Build System (`build_system`)**: Isolated build pipeline orchestration, ephemeral build workspace management, and future on-device APK packaging.
13. **Android Platform Layer (`platform_android`)**: Android Application Sandbox paths (`filesDir`, `noBackupFilesDir`, `cacheDir`), activity lifecycle, and SAF bridges.
14. **Security (`security`)**: Least-privilege enforcement, path traversal prevention, command allowlisting, secret redaction, and Android signing continuity verification.
15. **Storage (`storage`)**: Local-first persistence, atomic file writes (`.tmp` staging -> checksum verification -> `.bak` backup -> atomic commit), and corruption recovery.
16. **Debugging (`debugging`)**: Structured, secret-redacted diagnostic logging and profiling hooks.
17. **Testing (`testing`)**: Deterministic architectural boundary verification, security policy assertions, and fault-injection suite.

---

## 3. Android-First Strategy (Hylix V1.0.0)

- **Target Scope**: Hylix V1.0.0 targets **Android exclusively** (`minSdk = 26`, `targetSdk = 35`, `compileSdk = 35`).
- **Immutable Application ID**: `"com.hypersoft.hylix"` is permanently locked in `android/app/build.gradle.kts` and `src/core/engineIdentity.ts`.
- **On-Device Authoring & Packaging Goal**: All core modules are structured to run within the constraints of an Android device without requiring a desktop host or cloud build server, preparing the foundation for future in-app APK generation.

---

## 4. Future Cross-Platform Strategy

While V1.0.0 implements only the Android target, OS-specific APIs are isolated behind `PlatformAbstractionContract` (`src/platform/platformAbstraction.ts`).

- Future targets (`windows`, `linux`, `macos`, `ios`) are registered in `PLATFORM_ROADMAP_MATRIX` with `activeInV1: false`.
- Engine Core, Project System, ECS, Scene System, and Editor interact exclusively with platform-neutral interfaces (`LocalFirstAtomicStore`, relative workspace paths, abstract input/render descriptors).
- Adding a future desktop or mobile platform will require implementing a new `PlatformAbstractionContract` adapter in Layer 1 without rewriting Layer 2–4 modules.

---

## 5. Security Model

Security is enforced at Layer 0 (`src/security/securityFoundation.ts`) and inside the Android configuration (`android/app/src/main/AndroidManifest.xml`):

1. **Least Privilege & Android Application Sandbox**:
   - `AndroidManifest.xml` requests **zero** dangerous runtime permissions (`READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `CAMERA`, `RECORD_AUDIO`, `ACCESS_FINE_LOCATION`, etc. are absent).
   - `android:allowBackup="false"` and `android:fullBackupContent="false"` prevent unencrypted cloud backups of active local workspaces.
2. **Path Traversal & Confinement Guard (`validateWorkspaceRelativePath`)**:
   - Rejects empty paths, absolute paths (`/`, `C:\`), parent directory traversal (`..`), null bytes (`\0`), `.git/` internals, and signing files (`*.jks`, `*.keystore`, `*.pem`, `signing.properties`).
3. **Privilege Separation (Editor vs. Build Tooling)**:
   - `validateBuildCommandExecution` blocks any build tool invocation originating directly from `editor_ui` context; requests must be executed by `isolated_build_worker`.
   - Rejects arbitrary shell execution and shell metacharacters (`;`, `&&`, `|`, `` ` ``, `$()`), permitting only allowlisted tool identifiers (`aapt2_package`, `d8_dex`, `zipalign_archive`, `apksigner_verify`).
4. **Secret Redaction in Diagnostics (`redactSensitiveData`)**:
   - `RedactedDiagnosticLogger` automatically scrubs passwords, keystore credentials, environment secrets, bearer tokens, and PEM private key blocks before storing or displaying any log entry.

---

## 6. Storage & Project Safety Model

Hylix operates on a strict **Local-First** model (`src/storage/atomicStorage.ts` and `src/project/projectSystem.ts`). For complete lifecycle details, see [`docs/PROJECT_SYSTEM.md`](./PROJECT_SYSTEM.md):

1. **Zero Cloud Dependency**: No remote server, login account, or network connection is required to create, edit, validate, repair, or build a project.
2. **Canonical Workspace Hierarchy**: Every project initializes `scenes/`, `assets/{textures,models,audio,materials,fonts}`, `scripts/`, `plugins/`, `build/`, `cache/`, and `.hylix/`.
3. **Project Data vs. Cache vs. Build Isolation**:
   - Project Data (`project.hylix.json`, `scenes/`, `assets/`, `scripts/`, `.hylix/asset-registry.hylix.json`) is the authoritative source of truth.
   - `cache/` contains disposable, regenerable data; purging `cache/` never affects Project Data.
   - `build/` is dedicated exclusively to temporary or final build outputs.
4. **Atomic File Writes (`LocalFirstAtomicStore.writeFileAtomically`)**:
   - Validates path and payload -> writes to `.hylix-staging/<path>.tmp` -> flushes & closes handle -> verifies 64-bit checksum -> rotates previous valid version to `<path>.bak` -> commits atomically -> cleans up `.tmp`.
5. **Workspace Lock & Crash Recovery (`src/project/workspaceLock.ts`)**:
   - Prevents concurrent conflicting opens via `.hylix/workspace.lock`, detects stale locks after crashes via lease timeouts, and recovers safely without permanent lockout.
6. **Conservative Repair & Transactional Schema Migration (`src/project/schemaMigration.ts`)**:
   - Repairs missing directories and restores corrupted core files from verified `.bak` snapshots without ever deleting user files.
   - Upgrades manifests (`Schema 1 -> Schema 2 -> Schema 3`) with automatic rollback on failure.
7. **Safe Build Workspace (`SafeBuildWorkspaceSession`)**:
   - Tracks all intermediate build artifacts (`classes.dex`, `resources.ap_`, etc.) inside an isolated workspace and guarantees zero residual files upon `cleanupWorkspace()`.

---

## 7. Repository & Project Structure

```text
/
├── LICENSE                                  # MIT License (Copyright 2026 HyperSoft)
├── README.md                                # Repository overview & developer quickstart
├── .gitignore                               # Blocks keystores, secrets, and build artifacts
├── .env.example                             # Template for external environment variables
├── branding/
│   └── logo/
│       └── hylix-logo.png                   # Single official source of truth for Hylix branding
├── docs/
│   ├── ARCHITECTURE.md                      # This technical architecture specification
│   └── SIGNING_POLICY.md                    # Android production signing & SHA-1 continuity policy
├── android/                                 # Android-First native Gradle foundation
│   ├── settings.gradle.kts
│   ├── build.gradle.kts
│   ├── signing/
│   │   └── signing.properties.example       # Untracked external signing configuration template
│   └── app/
│       ├── build.gradle.kts                 # Enforces com.hypersoft.hylix & release signing guards
│       ├── proguard-rules.pro
│       └── src/main/
│           ├── AndroidManifest.xml          # Zero-permission sandboxed manifest
│           └── kotlin/com/hypersoft/hylix/platform/android/
│               └── HylixMainActivity.kt     # Sandbox directory initializer
└── src/                                     # Modular Architecture Foundation & Verification
    ├── core/
    │   ├── engineIdentity.ts                # Immutable constants & platform matrix
    │   └── moduleRegistry.ts                # 16 module descriptors & DAG verifier
    ├── platform/
    │   └── platformAbstraction.ts           # Platform Abstraction Layer & Android sandbox checks
    ├── security/
    │   └── securityFoundation.ts            # Path guard, command guard, redaction, signing policy
    ├── storage/
    │   └── atomicStorage.ts                 # Atomic writes, checksums, backup recovery, build cleanup
    ├── project/
    │   └── projectSystem.ts                 # Local-first project manifest validator
    ├── subsystems/
    │   └── domainContracts.ts               # Boundary interfaces for all 16 subsystems
    ├── debugging/
    │   └── diagnosticLogger.ts              # Redacted structured logger
    ├── testing/
    │   ├── foundationVerification.ts        # Automated 10-point architecture verification suite
    │   └── cliRunner.ts                     # CLI test runner (`npm test`)
    ├── App.tsx                              # Interactive Architecture Foundation Inspector UI
    └── main.tsx                             # Web inspector entry point
```

---

## 8. Build Architecture

The `build_system` module is designed to support future on-device APK generation from inside Hylix while maintaining strict safety:

1. **Read-Only Project Snapshot**: Build jobs read validated project manifests and assets without mutating user source files.
2. **Isolated Ephemeral Workspace**: Intermediate compilation outputs are confined to `cache/hylix_build_workspace/<job_id>`.
3. **Structured Tool Pipeline**: Packaging stages (`aapt2_package` -> `d8_dex` -> `zipalign_archive` -> `apksigner_verify`) execute via structured argument arrays rather than shell interpolation.
4. **Deterministic Teardown**: Regardless of whether a build succeeds, fails, or is cancelled, `SafeBuildWorkspaceSession.cleanupWorkspace()` purges temporary artifacts.

---

## 9. Signing Strategy

 Android requires cryptographic signature continuity across all updates of `"com.hypersoft.hylix"`. See [`docs/SIGNING_POLICY.md`](./SIGNING_POLICY.md) for the complete operational runbook.

- **One-Time External Provisioning**: The production keystore is created once outside the repository and stored in secure offline/CI secret storage.
- **No Auto-Generation**: Neither Gradle (`android/app/build.gradle.kts`) nor the Hylix Build System ever auto-generates a release keystore or self-signed release certificate during a build.
- **Zero Repository / APK Leakage**: `.gitignore` blocks all key/certificate extensions, and `android/app/build.gradle.kts` aborts if the configured `storeFile` path resides inside the Git repository tree.
- **SHA-1 Continuity Guard**: Release builds require `HYLIX_EXPECTED_CERT_SHA1` and verify that the active signing certificate matches the pinned production SHA-1 fingerprint (while rejecting fabricated placeholder values such as `00:00:...`).

---

## 10. Testing Strategy

Every architectural invariant is verified by deterministic, zero-network automated checks in `src/testing/foundationVerification.ts`:

- **DAG & Layer Enforcement Test**: Verifies all 16 modules and injects an upward dependency fault (`EngineCore -> Editor`) to confirm automatic rejection.
- **Android Identity & Sandbox Test**: Verifies `"com.hypersoft.hylix"`, `allowBackup=false`, and zero dangerous permissions.
- **Signing Policy Continuity Test**: Verifies rejection of auto-generated keystores, Git-stored keys, dummy SHA-1s, and mismatched certificate fingerprints.
- **Security & Path Traversal Test**: Verifies blocking of `../`, absolute paths, `.jks` files, Editor-to-Build privilege escalation, and shell metacharacters.
- **Atomic Storage & Fault Recovery Test**: Simulates an interrupted `.tmp` write and bit-rot corruption to confirm automatic rollback recovery from `.bak`.

Run all checks via:
```bash
npm test
npm run lint
npm run build
```

---

## 11. Rules for Preventing Dangerous Changes (Architectural Invariants)

1. **Never modify `androidApplicationId`**: Must remain `"com.hypersoft.hylix"` permanently.
2. **Never commit signing keys or certificates**: Any `.jks`, `.keystore`, `.p12`, `.pem`, or `signing.properties` file in Git is a critical security failure.
3. **Never fabricate a production SHA-1**: Leave `HYLIX_EXPECTED_CERT_SHA1` empty until the single official production certificate is provisioned externally.
4. **Never replace or duplicate the official logo**: `branding/logo/hylix-logo.png` is the single canonical branding asset.
5. **Never bypass `LocalFirstAtomicStore`**: All project and scene saves must use atomic `.tmp` staging and checksum verification.
6. **Never introduce circular or upward layer dependencies**: `verifyModuleBoundaries()` must pass with zero violations before any merge.
