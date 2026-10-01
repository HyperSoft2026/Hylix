import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import { isValidScriptId, ScriptId } from './scriptIdentity';
import { ScriptManifest, validateScriptManifest } from './scriptManifest';
import { createValidatedScriptSource, ScriptSource } from './scriptSource';
import {
  createScriptError,
  MAX_SCRIPTS_PER_PROJECT,
  ScriptDiagnosticError,
  ScriptValidationResult,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Project-Isolated ScriptRegistry
 *
 * Responsibilities:
 * - Register, unregister, find, list, and validate scripts
 * - Detect and reject duplicate `scriptId` or duplicate `entryPoint` (never silently overwrites)
 * - Detect circular script dependencies (`A -> B -> A`)
 * - Enforce `projectId` isolation and `MAX_SCRIPTS_PER_PROJECT`
 */

export interface RegisteredScriptEntry {
  readonly manifest: ScriptManifest;
  readonly source: ScriptSource | null;
}

export class ScriptRegistry {
  private readonly projectId: string;
  private readonly maxScripts: number;
  private readonly logger?: RedactedDiagnosticLogger;

  private readonly scriptsById = new Map<ScriptId, RegisteredScriptEntry>();
  private readonly scriptIdByEntryPoint = new Map<string, ScriptId>();

  constructor(options: {
    readonly projectId: string;
    readonly maxScripts?: number;
    readonly logger?: RedactedDiagnosticLogger;
  }) {
    this.projectId = options.projectId.trim();
    this.maxScripts = Math.max(
      1,
      Math.min(
        MAX_SCRIPTS_PER_PROJECT,
        Math.floor(options.maxScripts ?? MAX_SCRIPTS_PER_PROJECT)
      )
    );
    this.logger = options.logger;
  }

  public getProjectId(): string {
    return this.projectId;
  }

  public getMaxScripts(): number {
    return this.maxScripts;
  }

  public size(): number {
    return this.scriptsById.size;
  }

  public validateScript(
    manifestCandidate: unknown,
    sourceCandidate?: unknown
  ): ScriptValidationResult<RegisteredScriptEntry> {
    const manifestCheck = validateScriptManifest(manifestCandidate);
    if (!manifestCheck.valid || !manifestCheck.value) {
      return {
        valid: false,
        value: null,
        errors: manifestCheck.errors,
      };
    }

    const manifest = manifestCheck.value;
    if (manifest.projectId !== this.projectId) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_PROJECT_ISOLATION_ERROR',
            `Cannot register script from project '${manifest.projectId}' in ScriptRegistry for project '${this.projectId}'.`
          ),
        ],
      };
    }

    let validatedSource: ScriptSource | null = null;
    if (sourceCandidate !== undefined) {
      const srcCheck = createValidatedScriptSource(sourceCandidate);
      if (!srcCheck.valid || !srcCheck.value) {
        return {
          valid: false,
          value: null,
          errors: srcCheck.errors,
        };
      }
      if (srcCheck.value.projectId !== this.projectId) {
        return {
          valid: false,
          value: null,
          errors: [
            createScriptError(
              'SCRIPT_PROJECT_ISOLATION_ERROR',
              `ScriptSource projectId '${srcCheck.value.projectId}' does not match ScriptRegistry project '${this.projectId}'.`
            ),
          ],
        };
      }
      if (srcCheck.value.scriptId !== manifest.scriptId) {
        return {
          valid: false,
          value: null,
          errors: [
            createScriptError(
              'SCRIPT_VALIDATION_ERROR',
              `ScriptSource.scriptId '${srcCheck.value.scriptId}' does not match ScriptManifest.scriptId '${manifest.scriptId}'.`
            ),
          ],
        };
      }
      if (srcCheck.value.relativeSourcePath !== manifest.entryPoint) {
        return {
          valid: false,
          value: null,
          errors: [
            createScriptError(
              'SCRIPT_VALIDATION_ERROR',
              `ScriptSource.relativeSourcePath '${srcCheck.value.relativeSourcePath}' does not match ScriptManifest.entryPoint '${manifest.entryPoint}'.`
            ),
          ],
        };
      }
      validatedSource = srcCheck.value;
    }

    return {
      valid: true,
      value: Object.freeze({
        manifest,
        source: validatedSource,
      }),
      errors: [],
    };
  }

  /**
   * Registers a script in the registry.
   * Never silently overwrites an existing `scriptId` or `entryPoint`.
   */
  public registerScript(
    manifestCandidate: unknown,
    sourceCandidate?: unknown
  ): ScriptValidationResult<RegisteredScriptEntry> {
    const val = this.validateScript(manifestCandidate, sourceCandidate);
    if (!val.valid || !val.value) {
      this.logger?.record(
        'scripting',
        'ERROR',
        `script_validation_failed: ${val.errors.map((e) => e.message).join('; ')}`
      );
      return val;
    }

    const { manifest } = val.value;

    if (this.scriptsById.has(manifest.scriptId)) {
      const err = createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        `Duplicate ScriptId '${manifest.scriptId}' cannot be registered without explicit unregister.`
      );
      this.logger?.record(
        'scripting',
        'ERROR',
        `script_validation_failed: ${err.message}`
      );
      return { valid: false, value: null, errors: [err] };
    }

    if (this.scriptIdByEntryPoint.has(manifest.entryPoint)) {
      const existingId = this.scriptIdByEntryPoint.get(manifest.entryPoint)!;
      const err = createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        `Duplicate entryPoint '${manifest.entryPoint}' is already registered under scriptId '${existingId}'.`
      );
      this.logger?.record(
        'scripting',
        'ERROR',
        `script_validation_failed: ${err.message}`
      );
      return { valid: false, value: null, errors: [err] };
    }

    if (this.scriptsById.size >= this.maxScripts) {
      const err = createScriptError(
        'SCRIPT_BUDGET_EXCEEDED_ERROR',
        `ScriptRegistry limit (${this.maxScripts}) reached for project '${this.projectId}'.`
      );
      return { valid: false, value: null, errors: [err] };
    }

    // Check for dependency cycles if dependencies are already registered
    const cycleCheck = this.detectDependencyCycleForCandidate(manifest);
    if (cycleCheck) {
      const err = createScriptError('SCRIPT_VALIDATION_ERROR', cycleCheck);
      return { valid: false, value: null, errors: [err] };
    }

    this.scriptsById.set(manifest.scriptId, val.value);
    this.scriptIdByEntryPoint.set(manifest.entryPoint, manifest.scriptId);

    this.logger?.record(
      'scripting',
      'INFO',
      `script_registered: scriptId=${manifest.scriptId} name=${manifest.name} entryPoint=${manifest.entryPoint}`
    );

    return val;
  }

  private detectDependencyCycleForCandidate(
    candidateManifest: ScriptManifest
  ): string | null {
    const visited = new Set<ScriptId>();
    const stack = new Set<ScriptId>([candidateManifest.scriptId]);

    const dfs = (currentId: ScriptId, deps: readonly ScriptId[]): boolean => {
      for (const depId of deps) {
        if (stack.has(depId)) {
          return true;
        }
        if (visited.has(depId)) {
          continue;
        }
        visited.add(depId);
        const depEntry = this.scriptsById.get(depId);
        if (depEntry) {
          stack.add(depId);
          if (dfs(depId, depEntry.manifest.dependencies)) {
            return true;
          }
          stack.delete(depId);
        }
      }
      return false;
    };

    if (dfs(candidateManifest.scriptId, candidateManifest.dependencies)) {
      return `Circular script dependency detected involving '${candidateManifest.scriptId}'.`;
    }
    return null;
  }

  public unregisterScript(scriptId: ScriptId): {
    readonly success: boolean;
    readonly errors: readonly ScriptDiagnosticError[];
  } {
    if (!isValidScriptId(scriptId)) {
      return {
        success: false,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `Invalid ScriptId '${String(scriptId)}'.`
          ),
        ],
      };
    }

    const normId = scriptId.toLowerCase() as ScriptId;
    const existing = this.scriptsById.get(normId);
    if (!existing) {
      return {
        success: false,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `Script '${normId}' is not registered in project '${this.projectId}'.`
          ),
        ],
      };
    }

    this.scriptsById.delete(normId);
    this.scriptIdByEntryPoint.delete(existing.manifest.entryPoint);

    this.logger?.record(
      'scripting',
      'INFO',
      `script_unregistered: scriptId=${normId}`
    );

    return { success: true, errors: [] };
  }

  public findScript(scriptId: string): RegisteredScriptEntry | undefined {
    if (!isValidScriptId(scriptId)) return undefined;
    return this.scriptsById.get(scriptId.toLowerCase() as ScriptId);
  }

  public findScriptByEntryPoint(
    entryPoint: string
  ): RegisteredScriptEntry | undefined {
    const norm = entryPoint.trim().replace(/\\/g, '/');
    const id = this.scriptIdByEntryPoint.get(norm);
    return id ? this.scriptsById.get(id) : undefined;
  }

  /**
   * Lists all registered scripts sorted deterministically by `scriptId ASC`.
   */
  public listScripts(): readonly RegisteredScriptEntry[] {
    return Object.freeze(
      Array.from(this.scriptsById.values()).sort((a, b) =>
        a.manifest.scriptId.localeCompare(b.manifest.scriptId)
      )
    );
  }

  public clear(): void {
    this.scriptsById.clear();
    this.scriptIdByEntryPoint.clear();
  }
}
