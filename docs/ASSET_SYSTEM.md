# Hylix V1.0.0 — Asset System & Resource Management Specification

**Project**: Hylix  
**Organization**: HyperSoft  
**Phase**: Phase 4 — Asset System + Resource Management (`src/assets/`)

---

## 1. Architectural Separation: `Asset` vs. `Resource`

Hylix strictly separates persistent project assets from in-memory runtime/editor representations:

| Concept | Layer & Module | Responsibility |
| :--- | :--- | :--- |
| **`Asset`** (`AssetMetadataRecord`) | `src/assets/assetRegistry.ts` | Project file on disk and its validated metadata record persisted in `<projectRoot>/.hylix/asset-registry.hylix.json`. |
| **`Resource`** (`ResourceHandle`) | `src/assets/resourceManager.ts` | In-memory runtime/editor representation (`TextureResource`, `AudioResource`, `ModelResource`, `MaterialResource`, `ShaderResource`, `FontResource`, `SceneResource`, `PrefabResource`, `ScriptResource`, `DataResource`) managed with reference counting and a bounded cache. |

---

## 2. Asset Identity (`asset_<16-hex>`)

Every Asset possesses an immutable, deterministic, path-independent identifier:

```text
asset_a13f7c92e81d44ab
```

- **Path Independence**: Array indices, filenames, and relative paths are never used as the Asset identity.
- **Immutability**: Renaming or moving an asset inside the project workspace via `updateAssetMetadata(assetId, { path, name })` updates its `path` and `name` while preserving `assetId` so Scene and ECS references remain unbroken.
- **Backward Compatibility**: Legacy Phase-2 `ast_<16-hex>` identifiers remain valid alongside `asset_<16-hex>`.

---

## 3. Canonical Asset Types & Extension Classification

Hylix supports **13 canonical asset types** (`CANONICAL_ASSET_TYPES` in `src/assets/assetRegistry.ts`):

1. `texture` (`.png`, `.jpg`, `.jpeg`, `.webp`)
2. `sprite` (`.sprite.json`, `.sprite.hylix.json`)
3. `model` (`.gltf`, `.glb`, `.obj`)
4. `material` (`.mat.json`, `.material.json`, `.material.hylix.json`)
5. `shader` (`.vert`, `.frag`, `.glsl`, `.wgsl`, `.shader`)
6. `audio` (`.wav`, `.ogg`, `.mp3`)
7. `font` (`.ttf`, `.otf`, `.woff2`)
8. `animation` (`.anim.json`, `.animation.hylix.json`)
9. `scene` (`.scene.hylix.json`, `.scene.json`)
10. `prefab` (`.prefab.hylix.json`, `.prefab.json`)
11. `script` (`.ts`, `.js`)
12. `data` (`.json`, `.txt`, `.csv`)
13. `unknown` (fallback for unclassified extensions)

---

## 4. Asset Metadata Schema

Each asset entry in `HylixAssetRegistry` conforms to `AssetMetadataRecord` (`schemaVersion: 1`):

```json
{
  "assetId": "asset_0192bc7fe40182aa",
  "type": "texture",
  "path": "assets/textures/player.png",
  "name": "player.png",
  "sizeBytes": 18432,
  "contentHash": "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "schemaVersion": 1,
  "importState": "verified",
  "dependencies": [],
  "metadata": {}
}
```

### Mandatory Validation Rules (`validateAssetRegistryEntry`)
- Rejects non-JSON objects or unexpected schema keys.
- Rejects malformed `assetId` values or duplicate `assetId` / canonical `path` entries.
- Rejects negative or non-integer `sizeBytes`.
- Rejects malformed `contentHash` (must match `^sha256:[a-f0-9]{64}$`).
- Rejects unsupported `schemaVersion`.
- Rejects self-dependencies (`assetId` depending on itself), missing dependency targets, and circular dependency chains (`A -> B -> C -> A`).

---

## 5. Safe Asset Paths & Security Boundaries (`validateSafeAssetPath`)

All asset paths must be canonical project-relative POSIX paths (e.g., `assets/textures/player.png`). The validator strictly rejects:
- Parent traversal sequences (`../`, `../../`)
- Absolute POSIX/Android paths (`/etc/passwd`, `/system/...`, `/data/...`, `/proc/...`, `/sdcard/...`)
- Windows drive and UNC paths (`C:\...`, `\\server\share`)
- Remote network URLs (`http://`, `https://`, `ftp://`, `file://`)
- Disposable or internal directories (`cache/...`, `build/...`, `.hylix/...`)
- Keystore and signing files (`.jks`, `.keystore`, `.p12`, `.pem`, `signing.properties`)

---

## 6. Deterministic SHA-256 Content Hashing (`src/assets/contentHash.ts`)

- Implements standard FIPS 180-4 SHA-256 synchronously with zero external dependencies (`sha256:<64-lowercase-hex>`).
- **Hash Caching**: `HylixAssetRegistry.computeOrGetCachedContentHash` caches computed SHA-256 digests keyed by `(normalizedPath, sizeBytes, storageChecksum)` to avoid redundant hashing across workspace scans.
- **Non-Destructive Duplicate Content Detection**: `detectDuplicateContentAssets()` groups assets sharing an identical `contentHash` so the Editor or user can inspect duplicates without ever auto-deleting user files.

---

## 7. Asset Discovery (`AssetScanner` in `src/assets/assetScanner.ts`)

`AssetScanner.scanProjectWorkspace(projectRoot, registry, autoRegister)` executes the local discovery pipeline:

```text
Project Workspace -> Scan -> Detect -> Classify -> Register
```

- Automatically skips `project.hylix.json`, `.hylix/`, `cache/`, and `build/`.
- Registers newly discovered files and updates `contentHash` / `sizeBytes` for modified existing assets while preserving their `assetId`.

---

## 8. Resource Management & Bounded Cache (`src/assets/resourceManager.ts`)

### Resource State Machine
Every `ResourceHandle` transitions through a guarded state machine (`isValidResourceStateTransition`):
- `unloaded -> loading`
- `loading -> loaded | failed`
- `loaded -> invalidated | unloaded`
- `failed -> loading | unloaded`
- `invalidated -> loading | unloaded`

Illegal shortcuts such as `failed -> loaded` or `unloaded -> loaded` are rejected.

### Reference Counting (`retain` / `release`)
- `load(assetId)` loads and verifies the asset from `LocalFirstAtomicStore` (or returns the cached handle on a cache hit) and increments `referenceCount`.
- `retain(assetId)` increments `referenceCount`.
- `release(assetId)` decrements `referenceCount`. When `referenceCount === 0`, the resource is marked `eligibleForUnload: true`.
- Resources with `referenceCount > 0` cannot be forcefully unloaded or evicted.

### Bounded Cache & Automatic Cache Invalidation
- `ResourceManager` enforces `maxCacheEntries` (default `64`, configurable within safe bounds). When full, it evicts the least-recently-used unreferenced (`referenceCount === 0`) entry. If all cached entries are actively referenced, `load()` refuses to overflow memory.
- **Cache Invalidation**: Updating an asset's `contentHash` in `HylixAssetRegistry` automatically triggers `ResourceManager.invalidate(assetId)` (`Asset changed -> Hash changed -> Resource invalidated -> Reload on next load()`).

---

## 9. Scene/ECS Asset Reference Contract & Project Lifecycle Integration

- **ECS `AssetReference` Component**: Entities reference assets exclusively via deterministic `*AssetId` fields (`assetId`, `textureAssetId`, `materialAssetId`, `audioAssetId`, etc.). Raw file paths such as `texturePath: "/sdcard/game/player.png"` are rejected by `validateAssetReferenceComponentData`.
- **Scene Inspection (`inspectSceneAssetReferences`)**: Evaluates all entity/component asset references against `HylixAssetRegistry`, reporting `available`, `missing`, or `corrupted` assets without crashing the Scene or fabricating fake registry records.
- **Project Lifecycle (`HylixProjectManager`)**:
  - `createProject`: Initializes `.hylix/asset-registry.hylix.json` atomically with `schemaVersion: 1`.
  - `openProject`: Loads and validates `HylixAssetRegistry` (recovering from `.bak` during repair if needed) and initializes `ResourceManager`.
  - `closeProject`: Flushes dirty asset metadata atomically and calls `resourceManager.releaseAllForProjectClose()` before releasing the workspace lock.
