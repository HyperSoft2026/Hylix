import { HylixAssetRegistry } from '../assets/assetRegistry';
import { computeAssetContentHash } from '../assets/contentHash';
import {
  AndroidScriptBridgeContract,
  createAndroidScriptBridgeContract,
  NullContractScriptRuntimeBackend,
  PlatformScriptBackendLifecycleState,
  PlatformScriptExecutionEnvelope,
  PlatformScriptRuntimeBackendContract,
} from '../platform/platformAbstraction';
import {
  createDeterministicScriptId,
  ScriptId,
} from './scriptIdentity';
import { ScriptManifest } from './scriptManifest';
import { RegisteredScriptEntry } from './scriptRegistry';
import { ScriptRuntime } from './scriptRuntime';
import {
  createValidatedScriptSource,
  ScriptSource,
} from './scriptSource';
import {
  createScriptError,
  ScriptCategory,
  ScriptLanguage,
  ScriptValidationResult,
} from './scriptTypes';
import { ScriptCapability } from './scriptCapabilities';

/**
 * Hylix V1.0.0 — Phase 09: Scripting Integration with Asset System, Project Lifecycle & Platform Contracts
 */

export {
  createAndroidScriptBridgeContract,
  NullContractScriptRuntimeBackend,
};
export type {
  AndroidScriptBridgeContract,
  PlatformScriptBackendLifecycleState,
  PlatformScriptExecutionEnvelope,
  PlatformScriptRuntimeBackendContract,
};

export interface RegisterProjectScriptAssetOptions {
  readonly runtime: ScriptRuntime;
  readonly assetRegistry: HylixAssetRegistry;
  readonly name: string;
  readonly relativeSourcePath: string;
  readonly language: ScriptLanguage;
  readonly category?: ScriptCategory;
  readonly capabilities?: readonly ScriptCapability[];
  readonly dependencies?: readonly ScriptId[];
  readonly version?: string;
  readonly sourceContentForHashingOnly: string;
}

/**
 * Registers a script asset in `HylixAssetRegistry` (`type: 'script'`) and simultaneously
 * registers its `ScriptManifest` and `ScriptSource` in `ScriptRuntime` with strict project isolation.
 * Does NOT execute `sourceContentForHashingOnly`.
 */
export function registerProjectScriptAsset(
  options: RegisterProjectScriptAssetOptions
): ScriptValidationResult<{
  readonly assetId: string;
  readonly scriptEntry: RegisteredScriptEntry;
}> {
  const projectId = options.runtime.getProjectId();
  if (options.assetRegistry.getProjectId() !== projectId) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_PROJECT_ISOLATION_ERROR',
          `Cannot register script asset across projects: AssetRegistry belongs to '${options.assetRegistry.getProjectId()}', ScriptRuntime belongs to '${projectId}'.`
        ),
      ],
    };
  }

  const contentHash = computeAssetContentHash(
    options.sourceContentForHashingOnly
  );
  const scriptId = createDeterministicScriptId(
    projectId,
    options.relativeSourcePath
  );

  const sourceRes = createValidatedScriptSource({
    scriptId,
    projectId,
    relativeSourcePath: options.relativeSourcePath,
    language: options.language,
    sourceHash: contentHash,
    version: options.version ?? '1.0.0',
  });
  if (!sourceRes.valid || !sourceRes.value) {
    return { valid: false, value: null, errors: sourceRes.errors };
  }

  const assetRegRes = options.assetRegistry.registerAsset({
    name: options.name,
    type: 'script',
    path: sourceRes.value.relativeSourcePath,
    sizeBytes: new TextEncoder().encode(options.sourceContentForHashingOnly)
      .byteLength,
    contentHash,
  });

  if (!assetRegRes.success || !assetRegRes.asset) {
    return {
      valid: false,
      value: null,
      errors: assetRegRes.errors.map((m) =>
        createScriptError('SCRIPT_VALIDATION_ERROR', m)
      ),
    };
  }

  const manifestCandidate: Partial<ScriptManifest> = {
    scriptId,
    projectId,
    name: options.name,
    category: options.category ?? 'Gameplay',
    language: options.language,
    entryPoint: sourceRes.value.relativeSourcePath,
    capabilities: options.capabilities,
    dependencies: options.dependencies ?? [],
    version: options.version ?? '1.0.0',
  };

  const regScriptRes = options.runtime.registerScript(
    manifestCandidate,
    sourceRes.value
  );
  if (!regScriptRes.valid || !regScriptRes.value) {
    return { valid: false, value: null, errors: regScriptRes.errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      assetId: assetRegRes.asset.assetId,
      scriptEntry: regScriptRes.value,
    }),
    errors: [],
  };
}

/**
 * Cleans up a `ScriptRuntime` completely when a project closes, ensuring
 * zero leaked script instances, pending events, or cross-project state.
 */
export function cleanupScriptRuntimeForProjectClose(
  runtime: ScriptRuntime
): {
  readonly cleanedUp: true;
  readonly projectId: string;
  readonly activeInstancesRemaining: number;
  readonly registeredScriptsRemaining: number;
} {
  const projectId = runtime.getProjectId();
  runtime.resetForProjectClose();
  return Object.freeze({
    cleanedUp: true,
    projectId,
    activeInstancesRemaining: runtime.listInstances().length,
    registeredScriptsRemaining: runtime.getRegistry().size(),
  });
}

export type { ScriptSource };
