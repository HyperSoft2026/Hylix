# Hylix V1.0.0 — Project System & Local Storage Specification

**Milestone**: Phase 2 (Project System + Local Storage Layer)  
**Target Platform**: Android First (`com.hypersoft.hylix`)  
**Operating Model**: 100% Local-First within the Android Application Sandbox

---

## 1. Canonical Project Workspace Structure

When a user creates a project via `HylixProjectManager.createProject()`, Hylix deterministically initializes the following versionable hierarchy:

```text
<ProjectName>/
├── project.hylix.json               # Canonical Project Manifest (Source of Truth)
├── scenes/
│   └── main.scene.hylix.json        # Default entry scene
├── assets/
│   ├── textures/                    # 2D textures & sprite sheets
│   ├── models/                      # 3D mesh assets
│   ├── audio/                       # Sound effects & music streams
│   ├── materials/                   # Surface material definitions
│   └── fonts/                       # Typography assets
├── scripts/                         # Gameplay behavior scripts
├── plugins/                         # Local project extensions
├── build/                           # Dedicated to temporary/final build outputs
├── cache/                           # Disposable, regenerable derived cache files
└── .hylix/
    ├── asset-registry.hylix.json    # Deterministic Asset Registry
    ├── repair-audit.log.json        # Conservative repair history log
    └── workspace.lock               # Ephemeral session lock with lease heartbeat
```

### Separation of Project Data, Cache, and Build Directory

1. **Project Data (`project.hylix.json`, `scenes/`, `assets/`, `scripts/`, `plugins/`, `.hylix/asset-registry.hylix.json`)**:
   - Represents the authoritative source of truth.
   - Protected by atomic `.tmp` staging and `.bak` recovery snapshots.
   - Never deleted automatically.
2. **Disposable Cache (`cache/`)**:
   - Stores derived, regenerable artifacts (thumbnails, shader pre-caches, index tables).
   - Never treated as a source of truth.
   - Calling `store.purgeProjectCacheOnly(projectRoot)` deletes only files under `<projectRoot>/cache/` without affecting Project Data or `build/`.
3. **Build Directory (`build/`)**:
   - Reserved exclusively for intermediate or final packaging outputs (`resources.ap_`, `classes.dex`, `.apk`).
   - Strictly isolated from `cache/` and `assets/`.

---

## 2. Project Manifest (`project.hylix.json`)

```json
{
  "schemaVersion": 1,
  "engineVersion": "1.0.0",
  "projectId": "prj_a1b2c3d4e5f60718",
  "projectName": "Star Runner 2D",
  "packageId": "com.hypersoft.starrunner",
  "defaultScene": "scenes/main.scene.hylix.json",
  "supportedTargets": ["android"],
  "projectSettings": {
    "targetFps": 60,
    "orientation": "landscape",
    "localFirst": true
  }
}
```

### Manifest Invariants & Validation Rules

- **Immutable `projectId`**: Generated once during `createProject()` (`generateImmutableProjectId`) and preserved across all future opens, saves, and schema migrations. Attempts to mutate `projectId` during `saveProjectManifest()` are rejected.
- **Zero Trust on JSON Input**: `validateProjectManifest()` and `validateProjectManifestJsonString()` reject:
  - Malformed JSON syntax
  - Empty or whitespace-only `projectName`
  - Invalid Android `packageId` (must match `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/`)
  - Unsupported `schemaVersion` (outside supported range `1..3`)
  - Unsafe relative paths (`../`, `/system`, `/etc`, `C:\`, etc.)
  - `defaultScene` pointing outside `scenes/` or to a missing scene file in the workspace
  - Unknown or unexpected properties at the root or inside `projectSettings`

---

## 3. Safe Atomic Storage Pipeline (`LocalFirstAtomicStore`)

Every critical write (`writeFileAtomically`) executes the following sequence:

```text
Validate Path & Payload
  -> Write Temporary File (.hylix-staging/<path>.tmp)
  -> Flush & Close Handle
  -> Verify 64-bit Deterministic Checksum
  -> Rotate Previous Verified File to Backup (<path>.bak)
  -> Atomic Commit to Primary Path
  -> Guaranteed Cleanup of Temporary File (.tmp)
```

- **No Premature Overwrite**: If an error or crash occurs before staging verification completes, the primary file remains untouched and `.tmp` is cleaned up in `finally`.
- **Dual Corruption Detection**: If both the primary file and `.bak` fail checksum verification, `readVerifiedFile()` returns `valid: false, recoveredFromBackup: false` rather than fabricating data.

---

## 4. Workspace Lock & Crash Recovery (`src/project/workspaceLock.ts`)

- **Lock Creation**: Opening a project writes `<projectRoot>/.hylix/workspace.lock` containing `projectId`, `sessionId`, `acquiredAtEpochMs`, `lastHeartbeatEpochMs`, and `leaseTimeoutMs` (default `30,000ms`).
- **Active Contention Protection**: If another session holds a non-stale lock (`now - lastHeartbeatEpochMs <= leaseTimeoutMs`), `openProject()` refuses concurrent access (`LOCKED_BY_OTHER_SESSION`).
- **Stale Lock Detection & Crash Recovery**: If the application previously crashed without releasing `.hylix/workspace.lock` and the lease has expired (`ageMs > leaseTimeoutMs`), `acquireWorkspaceLock()` detects `STALE_LOCK_DETECTED`, safely supersedes the stale lock with a new session lock, and sets `recoveredFromStaleLock = true`.
- **Safe Release**: `closeProject()` verifies that the caller owns `sessionId` before removing `.hylix/workspace.lock`.

---

## 5. 9-Step Project Open & Conservative Repair (`src/project/projectSystem.ts`)

### Project Open Sequence
1. Validate relative project path via `validateWorkspaceRelativePath()`.
2. Verify workspace root directory exists.
3. Read and verify `project.hylix.json` checksum and JSON syntax.
4. Validate `schemaVersion` and manifest fields.
5. Verify checksums of core files (`defaultScene` and `.hylix/asset-registry.hylix.json`).
6. Check existence of all 12 canonical directories.
7. Recreate missing canonical directories if and only if the manifest and core files are intact.
8. Acquire Workspace Lock (performing stale crash recovery if needed).
9. Return the opened project handle.

If any core file is corrupted, `openProject()` returns `status: 'CORRUPTED_NEEDS_REPAIR'` without deleting any user files.

### Conservative Project Repair (`repairProjectWorkspace`)
- **Zero User File Deletion**: Unknown or custom user files inside the workspace are never deleted.
- **Directory Restoration**: Recreates any missing standard folders (`scenes/`, `assets/*`, `scripts/`, `plugins/`, `build/`, `cache/`, `.hylix/`).
- **Verified Backup Restoration**: Restores corrupted `project.hylix.json`, `defaultScene`, or `.hylix/asset-registry.hylix.json` from `.bak` **only** after verifying the `.bak` checksum.
- **Audit Logging**: Appends a timestamped record of every repair action to `.hylix/repair-audit.log.json`.

---

## 6. Transactional Schema Migration (`src/project/schemaMigration.ts`)

Supports multi-version manifest upgrades (`Schema 1 -> Schema 2 -> Schema 3`):

```text
Detect Version -> Backup (.hylix/manifest.pre-migration.bak.json) ->
Validate Source -> Migrate Step-by-Step -> Validate Target -> Atomic Commit
```

- **Guaranteed Rollback**: If any migration step or post-migration validation fails, `migrateProjectManifestInStorage()` immediately restores the pre-migration manifest snapshot so the project is never left in a half-migrated state.

---

## 7. Asset Registry Foundation (`src/assets/assetRegistry.ts`)

Stores asset metadata in `<projectRoot>/.hylix/asset-registry.hylix.json`:

- **Fields**: `assetId` (`ast_<16-hex>`), `path` (project-relative), `type` (`Texture | Sprite | Model | Audio | Font | Material | Shader | Script | Scene`), `size` (bytes), `checksum` (64-bit hex digest), `importState` (`verified | pending_import | corrupted | missing_source`).
- **Boundary Enforcement**: Refuses to register files located inside `cache/` or `build/`.
