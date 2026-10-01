import { validateWorkspaceRelativePath } from '../security/securityFoundation';

/**
 * Hylix Storage & Project Safety Foundation
 *
 * Implements Local-First persistence primitives:
 * - Deterministic 64-bit FNV-1a checksum computation for corruption detection
 * - Atomic File Writes:
 *   Validate -> Temporary File (.tmp) -> Write -> Flush/Close -> Verify Checksum ->
 *   Recovery Backup (.bak) -> Atomic Commit -> Cleanup .tmp
 * - Automatic rollback recovery from .bak if primary corruption is detected
 * - Strict User Data Safety: Zero general delete APIs for user projects, scenes, or assets.
 *   Only .hylix/workspace.lock release and disposable cache/ regeneration are permitted.
 */

export interface StoredFileRecord {
  readonly relativePath: string;
  readonly content: string;
  readonly checksumHex: string;
  readonly byteLength: number;
  readonly flushedAndClosed: boolean;
  readonly updatedAtIso: string;
}

export interface AtomicWriteReport {
  readonly success: boolean;
  readonly targetPath: string;
  readonly stagingTempPath: string;
  readonly backupCreated: boolean;
  readonly checksumHex: string;
  readonly error?: string;
}

/**
 * Deterministic 64-bit FNV-1a hex digest for fast, zero-dependency synchronous integrity verification.
 */
export function computeDeterministicChecksum(payload: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;

  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code ^ (i & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }

  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}`;
}

export class LocalFirstAtomicStore {
  private readonly directories = new Set<string>();
  private readonly committedFiles = new Map<string, StoredFileRecord>();
  private readonly backupFiles = new Map<string, StoredFileRecord>();
  private readonly stagingTempFiles = new Map<string, StoredFileRecord>();

  public ensureDirectory(relativeDirPath: string): {
    success: boolean;
    normalizedPath: string;
    createdNow: boolean;
    error?: string;
  } {
    const check = validateWorkspaceRelativePath(relativeDirPath);
    if (!check.safe) {
      return {
        success: false,
        normalizedPath: '',
        createdNow: false,
        error: check.reason,
      };
    }

    const parts = check.normalizedPath.split('/');
    let current = '';
    let createdNow = false;
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.directories.has(current)) {
        this.directories.add(current);
        createdNow = true;
      }
    }

    return {
      success: true,
      normalizedPath: check.normalizedPath,
      createdNow,
    };
  }

  public directoryExists(relativeDirPath: string): boolean {
    const check = validateWorkspaceRelativePath(relativeDirPath);
    if (!check.safe) return false;
    return this.directories.has(check.normalizedPath);
  }

  public fileExists(relativePath: string): boolean {
    const check = validateWorkspaceRelativePath(relativePath);
    if (!check.safe) return false;
    return this.committedFiles.has(check.normalizedPath);
  }

  public hasValidBackup(relativePath: string): boolean {
    const check = validateWorkspaceRelativePath(relativePath);
    if (!check.safe) return false;
    const bak = this.backupFiles.get(`${check.normalizedPath}.bak`);
    if (!bak) return false;
    return computeDeterministicChecksum(bak.content) === bak.checksumHex;
  }

  /**
   * Executes the strict Atomic Write pipeline:
   * 1. Validate Path & Payload
   * 2. Create Temporary Staging File (.tmp)
   * 3. Write & Flush/Close descriptor
   * 4. Verify staged checksum & byte length
   * 5. Rotate previous committed version to Recovery Backup (.bak)
   * 6. Atomic Commit to primary path
   * 7. Guaranteed cleanup of .tmp staging file
   */
  public writeFileAtomically(
    relativePath: string,
    content: string,
    simulateInterruptedWrite = false
  ): AtomicWriteReport {
    const pathCheck = validateWorkspaceRelativePath(relativePath);
    if (!pathCheck.safe) {
      return {
        success: false,
        targetPath: relativePath,
        stagingTempPath: '',
        backupCreated: false,
        checksumHex: '',
        error: pathCheck.reason,
      };
    }

    if (typeof content !== 'string') {
      return {
        success: false,
        targetPath: relativePath,
        stagingTempPath: '',
        backupCreated: false,
        checksumHex: '',
        error: 'Payload content must be a string.',
      };
    }

    const normalized = pathCheck.normalizedPath;
    const parentSegments = normalized.split('/');
    parentSegments.pop();
    if (parentSegments.length > 0) {
      this.ensureDirectory(parentSegments.join('/'));
    }

    const stagingTempPath = `.hylix-staging/${normalized}.tmp`;
    const checksumHex = computeDeterministicChecksum(content);
    const byteLength = new TextEncoder().encode(content).byteLength;

    // Step 1: Write to isolated temporary staging file (unflushed initially)
    const initialStaged: StoredFileRecord = Object.freeze({
      relativePath: normalized,
      content,
      checksumHex,
      byteLength,
      flushedAndClosed: false,
      updatedAtIso: new Date().toISOString(),
    });
    this.stagingTempFiles.set(stagingTempPath, initialStaged);

    try {
      // Step 2: Simulate fault / crash interruption before flush & commit if requested
      if (simulateInterruptedWrite) {
        throw new Error('Simulated I/O interruption during staging before atomic rename.');
      }

      // Step 3: Explicit Flush & Close of temporary file handle
      const flushedRecord: StoredFileRecord = Object.freeze({
        ...initialStaged,
        flushedAndClosed: true,
      });
      this.stagingTempFiles.set(stagingTempPath, flushedRecord);

      // Step 4: Verify staged file integrity before touching primary file
      const staged = this.stagingTempFiles.get(stagingTempPath);
      if (
        !staged ||
        !staged.flushedAndClosed ||
        computeDeterministicChecksum(staged.content) !== checksumHex
      ) {
        throw new Error('Staging integrity verification failed prior to atomic commit.');
      }

      // Step 5: Preserve previous valid committed file in .bak recovery slot
      const existing = this.committedFiles.get(normalized);
      let backupCreated = false;
      if (existing && computeDeterministicChecksum(existing.content) === existing.checksumHex) {
        this.backupFiles.set(`${normalized}.bak`, existing);
        backupCreated = true;
      }

      // Step 6: Atomic commit replacement
      this.committedFiles.set(normalized, staged);

      return {
        success: true,
        targetPath: normalized,
        stagingTempPath,
        backupCreated,
        checksumHex,
      };
    } catch (err) {
      return {
        success: false,
        targetPath: normalized,
        stagingTempPath,
        backupCreated: false,
        checksumHex: '',
        error: err instanceof Error ? err.message : 'Atomic write failed.',
      };
    } finally {
      // Step 7: Guaranteed cleanup of temporary staging file
      this.stagingTempFiles.delete(stagingTempPath);
    }
  }

  /**
   * Reads a file and verifies its checksum.
   * When `autoRecoverFromBackup` is true (default), automatically restores from `.bak`
   * if primary corruption is detected and `.bak` is verified intact.
   */
  public readVerifiedFile(
    relativePath: string,
    autoRecoverFromBackup = true
  ): {
    valid: boolean;
    recoveredFromBackup: boolean;
    corruptedPrimaryDetected: boolean;
    record: StoredFileRecord | null;
    error?: string;
  } {
    const pathCheck = validateWorkspaceRelativePath(relativePath);
    if (!pathCheck.safe) {
      return {
        valid: false,
        recoveredFromBackup: false,
        corruptedPrimaryDetected: false,
        record: null,
        error: pathCheck.reason,
      };
    }

    const normalized = pathCheck.normalizedPath;
    const current = this.committedFiles.get(normalized);
    if (!current) {
      return {
        valid: false,
        recoveredFromBackup: false,
        corruptedPrimaryDetected: false,
        record: null,
        error: `File '${normalized}' not found.`,
      };
    }

    const actualChecksum = computeDeterministicChecksum(current.content);
    if (actualChecksum === current.checksumHex) {
      return {
        valid: true,
        recoveredFromBackup: false,
        corruptedPrimaryDetected: false,
        record: current,
      };
    }

    // Primary file corruption detected!
    if (!autoRecoverFromBackup) {
      return {
        valid: false,
        recoveredFromBackup: false,
        corruptedPrimaryDetected: true,
        record: null,
        error: `Checksum mismatch (corruption) detected in primary file '${normalized}'.`,
      };
    }

    // Attempt conservative recovery from .bak snapshot
    const backup = this.backupFiles.get(`${normalized}.bak`);
    if (backup && computeDeterministicChecksum(backup.content) === backup.checksumHex) {
      this.committedFiles.set(normalized, backup);
      return {
        valid: true,
        recoveredFromBackup: true,
        corruptedPrimaryDetected: true,
        record: backup,
      };
    }

    return {
      valid: false,
      recoveredFromBackup: false,
      corruptedPrimaryDetected: true,
      record: null,
      error: `Corruption detected in '${normalized}' and backup snapshot (.bak) is missing or also corrupted.`,
    };
  }

  /**
   * Restores a specific file from its `.bak` backup only after verifying the backup checksum.
   */
  public restoreFileFromVerifiedBackup(relativePath: string): {
    restored: boolean;
    checksumHex: string;
    error?: string;
  } {
    const pathCheck = validateWorkspaceRelativePath(relativePath);
    if (!pathCheck.safe) {
      return { restored: false, checksumHex: '', error: pathCheck.reason };
    }
    const normalized = pathCheck.normalizedPath;
    const backup = this.backupFiles.get(`${normalized}.bak`);
    if (!backup) {
      return {
        restored: false,
        checksumHex: '',
        error: `No backup (.bak) exists for '${normalized}'.`,
      };
    }
    if (computeDeterministicChecksum(backup.content) !== backup.checksumHex) {
      return {
        restored: false,
        checksumHex: '',
        error: `Backup (.bak) for '${normalized}' failed checksum verification and cannot be trusted.`,
      };
    }

    this.committedFiles.set(normalized, backup);
    return {
      restored: true,
      checksumHex: backup.checksumHex,
    };
  }

  /**
   * Strictly removes ONLY `.hylix/workspace.lock` upon verified lock release.
   * Refuses to delete any user data file, scene, asset, or manifest.
   */
  public releaseLockFileOnly(lockRelativePath: string): boolean {
    const check = validateWorkspaceRelativePath(lockRelativePath);
    if (!check.safe) return false;
    if (!check.normalizedPath.endsWith('/.hylix/workspace.lock')) {
      throw new Error(
        'User Data Safety Violation: releaseLockFileOnly may only remove .hylix/workspace.lock.'
      );
    }
    return this.committedFiles.delete(check.normalizedPath);
  }

  /**
   * Clears ONLY generated files inside `<projectRoot>/cache/`.
   * Never touches Project Data (`project.hylix.json`, `scenes/`, `assets/`, `scripts/`, `.hylix/`)
   * and never touches `build/`.
   */
  public purgeProjectCacheOnly(projectRoot: string): {
    purgedFileCount: number;
    error?: string;
  } {
    const rootCheck = validateWorkspaceRelativePath(projectRoot);
    if (!rootCheck.safe || rootCheck.normalizedPath.includes('/')) {
      return { purgedFileCount: 0, error: 'Invalid projectRoot for cache purge.' };
    }

    const cachePrefix = `${rootCheck.normalizedPath}/cache/`;
    let purgedFileCount = 0;

    for (const key of Array.from(this.committedFiles.keys())) {
      if (key.startsWith(cachePrefix)) {
        this.committedFiles.delete(key);
        this.backupFiles.delete(`${key}.bak`);
        purgedFileCount++;
      }
    }

    return { purgedFileCount };
  }

  public listProjectFiles(projectRoot: string): readonly string[] {
    const rootCheck = validateWorkspaceRelativePath(projectRoot);
    if (!rootCheck.safe) return [];
    const prefix = `${rootCheck.normalizedPath}/`;
    const matches: string[] = [];
    for (const key of this.committedFiles.keys()) {
      if (key.startsWith(prefix)) {
        matches.push(key);
      }
    }
    return matches.sort();
  }

  public listProjectDirectories(projectRoot: string): readonly string[] {
    const rootCheck = validateWorkspaceRelativePath(projectRoot);
    if (!rootCheck.safe) return [];
    const prefix = `${rootCheck.normalizedPath}/`;
    const matches: string[] = [];
    for (const dir of this.directories.values()) {
      if (dir === rootCheck.normalizedPath || dir.startsWith(prefix)) {
        matches.push(dir);
      }
    }
    return matches.sort();
  }

  /**
   * Fault-injection helper for testing primary file corruption.
   */
  public injectRawCorruptedPayloadForTesting(
    relativePath: string,
    corruptedContent: string
  ): void {
    const check = validateWorkspaceRelativePath(relativePath);
    if (!check.safe) return;
    const existing = this.committedFiles.get(check.normalizedPath);
    if (existing) {
      this.committedFiles.set(check.normalizedPath, {
        ...existing,
        content: corruptedContent,
      });
    }
  }

  /**
   * Fault-injection helper for testing simultaneous backup (.bak) corruption.
   */
  public injectCorruptedBackupForTesting(
    relativePath: string,
    corruptedBackupContent: string
  ): void {
    const check = validateWorkspaceRelativePath(relativePath);
    if (!check.safe) return;
    const bakKey = `${check.normalizedPath}.bak`;
    const existingBak = this.backupFiles.get(bakKey);
    if (existingBak) {
      this.backupFiles.set(bakKey, {
        ...existingBak,
        content: corruptedBackupContent,
      });
    }
  }

  /**
   * Removes a non-essential directory ONLY inside fault-injection unit tests
   * to verify that Project Open / Repair safely recreates missing directories.
   */
  public removeDirectoryMarkerForTesting(relativeDirPath: string): void {
    const check = validateWorkspaceRelativePath(relativeDirPath);
    if (check.safe) {
      this.directories.delete(check.normalizedPath);
    }
  }

  public getStagingFileCount(): number {
    return this.stagingTempFiles.size;
  }
}

/**
 * Safe Build Workspace
 * Guarantees isolation of temporary build outputs and deterministic post-build cleanup.
 */
export class SafeBuildWorkspaceSession {
  public readonly workspaceId: string;
  private activeArtifacts = new Set<string>();
  private cleanedUp = false;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  public registerTemporaryArtifact(relativeArtifactPath: string): boolean {
    if (this.cleanedUp) {
      throw new Error('Cannot register artifact on a disposed build workspace.');
    }
    const check = validateWorkspaceRelativePath(relativeArtifactPath);
    if (!check.safe) {
      throw new Error(`Unsafe build artifact path: ${check.reason}`);
    }
    this.activeArtifacts.add(check.normalizedPath);
    return true;
  }

  public cleanupWorkspace(): { cleanedArtifactCount: number; isClean: boolean } {
    const count = this.activeArtifacts.size;
    this.activeArtifacts.clear();
    this.cleanedUp = true;
    return {
      cleanedArtifactCount: count,
      isClean: this.activeArtifacts.size === 0 && this.cleanedUp,
    };
  }

  public getRemainingArtifactCount(): number {
    return this.activeArtifacts.size;
  }
}
