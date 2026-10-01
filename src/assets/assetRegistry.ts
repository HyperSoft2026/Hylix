import {
  computeDeterministicChecksum,
  LocalFirstAtomicStore,
} from '../storage/atomicStorage';
import {
  validateProjectScopedPath,
  validateWorkspaceRelativePath,
} from '../security/securityFoundation';

/**
 * Hylix Asset Registry Foundation
 *
 * Tracks local project assets with deterministic IDs, content checksums,
 * byte sizes, and import states without implementing full asset decoders yet.
 * Stored inside `<projectRoot>/.hylix/asset-registry.hylix.json` (Project Data, never Cache).
 */

export type AssetType =
  | 'Texture'
  | 'Sprite'
  | 'Model'
  | 'Audio'
  | 'Font'
  | 'Material'
  | 'Shader'
  | 'Script'
  | 'Scene';

export type AssetImportState =
  | 'verified'
  | 'pending_import'
  | 'corrupted'
  | 'missing_source';

export const SUPPORTED_ASSET_TYPES: ReadonlySet<AssetType> = new Set<AssetType>([
  'Texture',
  'Sprite',
  'Model',
  'Audio',
  'Font',
  'Material',
  'Shader',
  'Script',
  'Scene',
]);

export interface AssetRegistryEntry {
  readonly assetId: string;
  readonly path: string;
  readonly type: AssetType;
  readonly size: number;
  readonly checksum: string;
  readonly importState: AssetImportState;
}

export interface AssetRegistryDocument {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly updatedAtIso: string;
  readonly entries: readonly AssetRegistryEntry[];
}

export function createDeterministicAssetId(
  projectId: string,
  projectRelativePath: string
): string {
  const pathCheck = validateWorkspaceRelativePath(projectRelativePath);
  const cleanPath = pathCheck.safe ? pathCheck.normalizedPath : projectRelativePath;
  const digest = computeDeterministicChecksum(`${projectId}::asset::${cleanPath}`);
  return `ast_${digest}`;
}

export function validateAssetRegistryEntry(
  candidate: unknown
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { valid: false, errors: ['Asset entry must be a JSON object.'] };
  }

  const obj = candidate as Record<string, unknown>;
  const allowedKeys = new Set(['assetId', 'path', 'type', 'size', 'checksum', 'importState']);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unexpected property '${key}' in AssetRegistryEntry.`);
    }
  }

  if (typeof obj.assetId !== 'string' || !/^ast_[a-f0-9]{16}$/i.test(obj.assetId)) {
    errors.push('Invalid assetId format; expected deterministic ast_<16-hex-chars>.');
  }

  if (typeof obj.path !== 'string') {
    errors.push('Asset path must be a string.');
  } else {
    const pathCheck = validateWorkspaceRelativePath(obj.path);
    if (!pathCheck.safe) {
      errors.push(`Unsafe asset path '${obj.path}': ${pathCheck.reason}`);
    } else if (
      pathCheck.normalizedPath.startsWith('cache/') ||
      pathCheck.normalizedPath.startsWith('build/')
    ) {
      errors.push(
        `Asset path '${obj.path}' cannot reside inside disposable 'cache/' or 'build/' directories.`
      );
    }
  }

  if (
    typeof obj.type !== 'string' ||
    !SUPPORTED_ASSET_TYPES.has(obj.type as AssetType)
  ) {
    errors.push(`Unsupported asset type '${String(obj.type)}'.`);
  }

  if (typeof obj.size !== 'number' || !Number.isInteger(obj.size) || obj.size < 0) {
    errors.push('Asset size must be a non-negative integer byte count.');
  }

  if (typeof obj.checksum !== 'string' || !/^[a-f0-9]{16}$/i.test(obj.checksum)) {
    errors.push('Asset checksum must be a 16-character hexadecimal digest.');
  }

  const validStates = new Set(['verified', 'pending_import', 'corrupted', 'missing_source']);
  if (typeof obj.importState !== 'string' || !validStates.has(obj.importState)) {
    errors.push(`Invalid asset importState '${String(obj.importState)}'.`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateAssetRegistryDocument(
  candidate: unknown,
  expectedProjectId?: string
): { valid: boolean; document: AssetRegistryDocument | null; errors: string[] } {
  const errors: string[] = [];
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return {
      valid: false,
      document: null,
      errors: ['Asset registry must be a non-null JSON object.'],
    };
  }

  const obj = candidate as Record<string, unknown>;
  if (obj.schemaVersion !== 1) {
    errors.push(`Unsupported AssetRegistry schemaVersion '${String(obj.schemaVersion)}'.`);
  }

  if (typeof obj.projectId !== 'string' || obj.projectId.trim().length === 0) {
    errors.push('AssetRegistry projectId must be a non-empty string.');
  } else if (expectedProjectId && obj.projectId !== expectedProjectId) {
    errors.push(
      `AssetRegistry projectId '${obj.projectId}' does not match project manifest ID '${expectedProjectId}'.`
    );
  }

  if (!Array.isArray(obj.entries)) {
    errors.push('AssetRegistry entries must be an array.');
  } else {
    const seenIds = new Set<string>();
    const seenPaths = new Set<string>();
    for (let i = 0; i < obj.entries.length; i++) {
      const itemCheck = validateAssetRegistryEntry(obj.entries[i]);
      if (!itemCheck.valid) {
        errors.push(`Entry [${i}]: ${itemCheck.errors.join('; ')}`);
      } else {
        const entry = obj.entries[i] as AssetRegistryEntry;
        if (seenIds.has(entry.assetId)) {
          errors.push(`Duplicate assetId '${entry.assetId}' in AssetRegistry.`);
        }
        if (seenPaths.has(entry.path)) {
          errors.push(`Duplicate asset path '${entry.path}' in AssetRegistry.`);
        }
        seenIds.add(entry.assetId);
        seenPaths.add(entry.path);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, document: null, errors };
  }

  return {
    valid: true,
    document: obj as unknown as AssetRegistryDocument,
    errors: [],
  };
}

export function registerProjectAssetAtomically(
  store: LocalFirstAtomicStore,
  projectRoot: string,
  projectId: string,
  assetRelativePath: string,
  assetType: AssetType,
  assetContent: string
): {
  success: boolean;
  entry: AssetRegistryEntry | null;
  error?: string;
} {
  const pathCheck = validateWorkspaceRelativePath(assetRelativePath);
  if (!pathCheck.safe) {
    return { success: false, entry: null, error: pathCheck.reason };
  }
  if (
    pathCheck.normalizedPath.startsWith('cache/') ||
    pathCheck.normalizedPath.startsWith('build/')
  ) {
    return {
      success: false,
      entry: null,
      error: 'Assets cannot be registered inside disposable cache/ or build/ directories.',
    };
  }

  const scopedAssetPath = validateProjectScopedPath(projectRoot, pathCheck.normalizedPath);
  if (!scopedAssetPath.safe) {
    return { success: false, entry: null, error: scopedAssetPath.reason };
  }

  // Write the asset file atomically first
  const writeAsset = store.writeFileAtomically(scopedAssetPath.normalizedPath, assetContent);
  if (!writeAsset.success) {
    return { success: false, entry: null, error: writeAsset.error };
  }

  const registryScoped = validateProjectScopedPath(
    projectRoot,
    '.hylix/asset-registry.hylix.json'
  );
  if (!registryScoped.safe) {
    return { success: false, entry: null, error: registryScoped.reason };
  }

  const existingRead = store.readVerifiedFile(registryScoped.normalizedPath);
  let existingEntries: AssetRegistryEntry[] = [];
  if (existingRead.valid && existingRead.record) {
    try {
      const parsed = JSON.parse(existingRead.record.content);
      const val = validateAssetRegistryDocument(parsed, projectId);
      if (val.valid && val.document) {
        existingEntries = [...val.document.entries];
      }
    } catch {
      // Will rebuild/update registry if unreadable
    }
  }

  const byteSize = new TextEncoder().encode(assetContent).byteLength;
  const newEntry: AssetRegistryEntry = Object.freeze({
    assetId: createDeterministicAssetId(projectId, pathCheck.normalizedPath),
    path: pathCheck.normalizedPath,
    type: assetType,
    size: byteSize,
    checksum: writeAsset.checksumHex,
    importState: 'verified',
  });

  const filtered = existingEntries.filter(
    (e) => e.path !== newEntry.path && e.assetId !== newEntry.assetId
  );
  filtered.push(newEntry);

  const updatedDoc: AssetRegistryDocument = {
    schemaVersion: 1,
    projectId,
    updatedAtIso: new Date().toISOString(),
    entries: filtered,
  };

  const writeReg = store.writeFileAtomically(
    registryScoped.normalizedPath,
    JSON.stringify(updatedDoc, null, 2)
  );
  if (!writeReg.success) {
    return { success: false, entry: null, error: writeReg.error };
  }

  return {
    success: true,
    entry: newEntry,
  };
}
