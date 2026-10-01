import { LocalFirstAtomicStore } from '../storage/atomicStorage';
import { validateWorkspaceRelativePath } from '../security/securityFoundation';
import {
  AssetMetadataRecord,
  CanonicalAssetType,
  HylixAssetRegistry,
  validateSafeAssetPath,
} from './assetRegistry';

/**
 * Hylix V1.0.0 — Asset Discovery & Extension Classification (`src/assets/assetScanner.ts`)
 *
 * Implements:
 * - Safe, extensible Extension-to-AssetType mapping
 * - Local-First `AssetScanner` for scanning project workspaces (`Project Workspace -> Scan -> Detect -> Classify -> Register`)
 * - Automatic exclusion of disposable `cache/`, `build/`, `.hylix/`, and root `project.hylix.json`
 */

export const EXTENSION_ASSET_TYPE_MAP: Readonly<Record<string, CanonicalAssetType>> =
  Object.freeze({
    '.png': 'texture',
    '.jpg': 'texture',
    '.jpeg': 'texture',
    '.webp': 'texture',
    '.wav': 'audio',
    '.ogg': 'audio',
    '.mp3': 'audio',
    '.gltf': 'model',
    '.glb': 'model',
    '.obj': 'model',
    '.ttf': 'font',
    '.otf': 'font',
    '.woff2': 'font',
    '.vert': 'shader',
    '.frag': 'shader',
    '.glsl': 'shader',
    '.wgsl': 'shader',
    '.shader': 'shader',
    '.ts': 'script',
    '.js': 'script',
  });

/**
 * Classifies a project-relative path into a `CanonicalAssetType` based on compound
 * extensions (`.scene.hylix.json`, `.prefab.hylix.json`, `.sprite.json`, `.mat.json`, `.anim.json`),
 * standard extensions, and directory context.
 */
export function classifyAssetTypeByPath(relativePath: string): CanonicalAssetType {
  const safeCheck = validateSafeAssetPath(relativePath);
  const clean = (safeCheck.safe ? safeCheck.normalizedPath : relativePath)
    .trim()
    .toLowerCase();

  // Compound Hylix JSON extensions
  if (clean.endsWith('.scene.hylix.json') || clean.endsWith('.scene.json')) {
    return 'scene';
  }
  if (clean.endsWith('.prefab.hylix.json') || clean.endsWith('.prefab.json')) {
    return 'prefab';
  }
  if (clean.endsWith('.sprite.json') || clean.endsWith('.sprite.hylix.json')) {
    return 'sprite';
  }
  if (
    clean.endsWith('.mat.json') ||
    clean.endsWith('.material.json') ||
    clean.endsWith('.material.hylix.json')
  ) {
    return 'material';
  }
  if (clean.endsWith('.anim.json') || clean.endsWith('.animation.hylix.json')) {
    return 'animation';
  }
  if (clean.endsWith('.hylix.json')) {
    return clean.startsWith('scenes/') ? 'scene' : 'data';
  }

  const lastSlash = clean.lastIndexOf('/');
  const fileName = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean;
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot < 0) {
    return 'unknown';
  }

  const ext = fileName.slice(lastDot);
  if (ext in EXTENSION_ASSET_TYPE_MAP) {
    return EXTENSION_ASSET_TYPE_MAP[ext];
  }

  if (ext === '.json' || ext === '.txt' || ext === '.csv') {
    return 'data';
  }

  return 'unknown';
}

export interface DiscoveredAssetCandidate {
  readonly path: string;
  readonly name: string;
  readonly extension: string;
  readonly classifiedType: CanonicalAssetType;
  readonly sizeBytes: number;
  readonly contentHash: string;
}

export interface AssetScanReport {
  readonly success: boolean;
  readonly projectRoot: string;
  readonly discoveredCandidates: readonly DiscoveredAssetCandidate[];
  readonly newlyRegisteredAssets: readonly AssetMetadataRecord[];
  readonly updatedExistingAssets: readonly AssetMetadataRecord[];
  readonly skippedNonAssetPaths: readonly string[];
  readonly errors: readonly string[];
}

/**
 * Local-First Project Workspace Asset Scanner.
 */
export class AssetScanner {
  private readonly store: LocalFirstAtomicStore;

  constructor(store: LocalFirstAtomicStore) {
    this.store = store;
  }

  /**
   * Scans `<projectRoot>` inside `LocalFirstAtomicStore`, discovers eligible project files,
   * computes or reuses cached SHA-256 content hashes, classifies asset types, and optionally
   * registers/updates them in `registry`.
   */
  public scanProjectWorkspace(
    projectRoot: string,
    registry: HylixAssetRegistry,
    autoRegister = true
  ): AssetScanReport {
    const rootCheck = validateWorkspaceRelativePath(projectRoot);
    if (!rootCheck.safe || rootCheck.normalizedPath.includes('/')) {
      return {
        success: false,
        projectRoot,
        discoveredCandidates: [],
        newlyRegisteredAssets: [],
        updatedExistingAssets: [],
        skippedNonAssetPaths: [],
        errors: [rootCheck.reason || 'Invalid projectRoot for AssetScanner.'],
      };
    }

    const root = rootCheck.normalizedPath;
    const prefix = `${root}/`;
    const allProjectFiles = this.store.listProjectFiles(root);

    const discoveredCandidates: DiscoveredAssetCandidate[] = [];
    const newlyRegisteredAssets: AssetMetadataRecord[] = [];
    const updatedExistingAssets: AssetMetadataRecord[] = [];
    const skippedNonAssetPaths: string[] = [];
    const errors: string[] = [];

    for (const fullPath of allProjectFiles) {
      if (!fullPath.startsWith(prefix)) continue;
      const relPath = fullPath.slice(prefix.length);

      // Skip root project manifest and internal/disposable directories
      if (
        relPath === 'project.hylix.json' ||
        relPath.startsWith('.hylix/') ||
        relPath.startsWith('cache/') ||
        relPath.startsWith('build/')
      ) {
        skippedNonAssetPaths.push(relPath);
        continue;
      }

      const safeCheck = validateSafeAssetPath(relPath);
      if (!safeCheck.safe) {
        skippedNonAssetPaths.push(relPath);
        continue;
      }

      const fileRead = this.store.readVerifiedFile(fullPath, false);
      if (!fileRead.valid || !fileRead.record) {
        errors.push(
          `Corrupted or unreadable workspace file '${relPath}': ${fileRead.error ?? 'Checksum mismatch'}`
        );
        continue;
      }

      const hashInfo = registry.computeOrGetCachedContentHash(
        safeCheck.normalizedPath,
        fileRead.record.content,
        fileRead.record.checksumHex
      );

      const classifiedType = classifyAssetTypeByPath(safeCheck.normalizedPath);
      const lastDot = safeCheck.fileName.lastIndexOf('.');
      const extension = lastDot >= 0 ? safeCheck.fileName.slice(lastDot).toLowerCase() : '';

      const candidate: DiscoveredAssetCandidate = Object.freeze({
        path: safeCheck.normalizedPath,
        name: safeCheck.fileName,
        extension,
        classifiedType,
        sizeBytes: hashInfo.sizeBytes,
        contentHash: hashInfo.contentHash,
      });
      discoveredCandidates.push(candidate);

      if (autoRegister) {
        const existing = registry.findByPath(safeCheck.normalizedPath);
        if (!existing) {
          const regRes = registry.registerAsset({
            type: classifiedType,
            path: safeCheck.normalizedPath,
            name: safeCheck.fileName,
            sizeBytes: hashInfo.sizeBytes,
            contentHash: hashInfo.contentHash,
            importState: 'verified',
          });
          if (regRes.success && regRes.asset) {
            newlyRegisteredAssets.push(regRes.asset);
          } else {
            errors.push(...regRes.errors);
          }
        } else if (
          existing.contentHash !== hashInfo.contentHash ||
          existing.sizeBytes !== hashInfo.sizeBytes
        ) {
          const updRes = registry.updateAssetMetadata(existing.assetId, {
            sizeBytes: hashInfo.sizeBytes,
            contentHash: hashInfo.contentHash,
            importState: 'verified',
          });
          if (updRes.success && updRes.asset) {
            updatedExistingAssets.push(updRes.asset);
          } else {
            errors.push(...updRes.errors);
          }
        }
      }
    }

    return {
      success: errors.length === 0,
      projectRoot: root,
      discoveredCandidates,
      newlyRegisteredAssets,
      updatedExistingAssets,
      skippedNonAssetPaths,
      errors,
    };
  }
}
