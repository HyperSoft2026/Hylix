import { isValidAssetId } from '../assets/assetRegistry';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  ComponentRegistry,
  ComponentSpecification,
  ComponentValidationResult,
} from '../ecs/ecsCore';
import {
  SceneDefinition,
  SceneScriptConfigurationContract,
} from '../scene/sceneSystem';
import {
  createDeterministicScriptId,
  createDeterministicScriptInstanceId,
  isValidScriptId,
  ScriptId,
} from './scriptIdentity';
import { ScriptInstanceDescriptor } from './scriptInstance';
import { ScriptRuntime } from './scriptRuntime';
import {
  createScriptError,
  estimateSerializedByteSize,
  isFiniteScriptNumber,
  isForbiddenScriptString,
  isPlainScriptObject,
  MAX_SCRIPT_METADATA_SIZE,
  ScriptValidationResult,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: ECS `ScriptBehavior` Component & One-Way Scene Extraction
 *
 * Strictly enforces:
 *   SceneDefinition -> ECS Entities -> extractSceneScriptingData -> ScriptRuntime
 * Never mutates `SceneDefinition` in-place.
 */

export const SCRIPT_BEHAVIOR_COMPONENT_TYPE = 'ScriptBehavior' as const;

export type ScriptBehaviorParameterValue = string | number | boolean;

export interface ScriptBehaviorComponentData {
  readonly enabled: boolean;
  readonly scriptId: ScriptId;
  readonly scriptAssetId?: string | null;
  readonly executionPriority: number;
  readonly autoStart: boolean;
  readonly parameters: Readonly<Record<string, ScriptBehaviorParameterValue>>;
}

const ALLOWED_SCRIPT_BEHAVIOR_KEYS: ReadonlySet<string> = new Set<string>([
  'enabled',
  'scriptId',
  'scriptAssetId',
  'executionPriority',
  'autoStart',
  'parameters',
]);

export function createDefaultScriptBehaviorComponent(): ScriptBehaviorComponentData {
  return Object.freeze({
    enabled: true,
    scriptId: createDeterministicScriptId(
      'default_project',
      'scripts/defaultBehavior.ts'
    ),
    scriptAssetId: null,
    executionPriority: 0,
    autoStart: true,
    parameters: Object.freeze({}),
  });
}

export function validateScriptBehaviorComponentData(
  raw: unknown
): ComponentValidationResult<ScriptBehaviorComponentData> {
  if (!isPlainScriptObject(raw)) {
    return {
      valid: false,
      data: null,
      errors: ['ScriptBehavior component must be a non-null plain object.'],
    };
  }

  const errors: string[] = [];

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_SCRIPT_BEHAVIOR_KEYS.has(key)) {
      errors.push(
        `Unexpected or forbidden property '${key}' in ScriptBehavior component.`
      );
    }
  }

  const enabled = raw.enabled !== undefined ? raw.enabled : true;
  if (typeof enabled !== 'boolean') {
    errors.push('ScriptBehavior.enabled must be a boolean.');
  }

  if (!isValidScriptId(raw.scriptId)) {
    errors.push(
      `Invalid ScriptBehavior.scriptId '${String(raw.scriptId)}'. Expected 'script_<16-hex>'.`
    );
  }

  let normalizedAssetId: string | null = null;
  if (raw.scriptAssetId !== undefined && raw.scriptAssetId !== null) {
    if (!isValidAssetId(raw.scriptAssetId)) {
      errors.push(
        `Invalid ScriptBehavior.scriptAssetId '${String(raw.scriptAssetId)}'. Expected 'asset_<16-hex>' or null.`
      );
    } else {
      normalizedAssetId = raw.scriptAssetId.toLowerCase();
    }
  }

  const executionPriority =
    raw.executionPriority !== undefined ? raw.executionPriority : 0;
  if (
    !isFiniteScriptNumber(executionPriority) ||
    !Number.isInteger(executionPriority) ||
    executionPriority < -10000 ||
    executionPriority > 10000
  ) {
    errors.push(
      'ScriptBehavior.executionPriority must be an integer in [-10000, 10000].'
    );
  }

  const autoStart = raw.autoStart !== undefined ? raw.autoStart : true;
  if (typeof autoStart !== 'boolean') {
    errors.push('ScriptBehavior.autoStart must be a boolean.');
  }

  const validatedParams: Record<string, ScriptBehaviorParameterValue> = {};
  if (raw.parameters !== undefined) {
    if (!isPlainScriptObject(raw.parameters)) {
      errors.push('ScriptBehavior.parameters must be a plain object.');
    } else if (
      estimateSerializedByteSize(raw.parameters) > MAX_SCRIPT_METADATA_SIZE
    ) {
      errors.push(
        `ScriptBehavior.parameters exceeds maximum size (${MAX_SCRIPT_METADATA_SIZE} bytes).`
      );
    } else {
      for (const [k, v] of Object.entries(raw.parameters)) {
        const keySec = isForbiddenScriptString(k);
        if (keySec.forbidden) {
          errors.push(keySec.reason!);
          continue;
        }
        if (typeof v === 'string') {
          const valSec = isForbiddenScriptString(v);
          if (valSec.forbidden) {
            errors.push(valSec.reason!);
            continue;
          }
          validatedParams[k] = v;
        } else if (
          (typeof v === 'number' && Number.isFinite(v)) ||
          typeof v === 'boolean'
        ) {
          validatedParams[k] = v;
        } else {
          errors.push(
            `ScriptBehavior.parameters['${k}'] must be a finite number, boolean, or safe string.`
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, data: null, errors };
  }

  return {
    valid: true,
    data: Object.freeze({
      enabled: enabled as boolean,
      scriptId: (raw.scriptId as string).toLowerCase() as ScriptId,
      scriptAssetId: normalizedAssetId,
      executionPriority: executionPriority as number,
      autoStart: autoStart as boolean,
      parameters: Object.freeze(validatedParams),
    }),
    errors: [],
  };
}

export const OFFICIAL_SCRIPT_BEHAVIOR_SPEC: ComponentSpecification<ScriptBehaviorComponentData> =
  Object.freeze({
    type: SCRIPT_BEHAVIOR_COMPONENT_TYPE,
    schemaVersion: 1,
    createDefault: createDefaultScriptBehaviorComponent,
    validate: validateScriptBehaviorComponentData,
  });

export function registerScriptingEcsComponents(
  registry: ComponentRegistry
): ComponentRegistry {
  if (!registry.isRegistered(SCRIPT_BEHAVIOR_COMPONENT_TYPE)) {
    registry.registerComponentType(OFFICIAL_SCRIPT_BEHAVIOR_SPEC);
  }
  return registry;
}

export interface ExtractedScriptBehaviorEntity {
  readonly entityId: string;
  readonly entityName: string;
  readonly entityEnabled: boolean;
  readonly behavior: ScriptBehaviorComponentData;
}

export interface SceneScriptingExtractedData {
  readonly sceneId: string;
  readonly scriptConfig: SceneScriptConfigurationContract;
  readonly behaviors: readonly ExtractedScriptBehaviorEntity[];
}

export function createDefaultSceneScriptConfig(): SceneScriptConfigurationContract {
  return Object.freeze({
    maxScriptInstances: 2048,
    maxInstructionsPerFrame: 50000,
    maxEventsPerFrame: 256,
    enableScriptExecution: true,
  });
}

/**
 * One-way immutable extraction of `ScriptBehavior` components and `scriptConfig`
 * from a `SceneDefinition` without mutating the scene.
 */
export function extractSceneScriptingData(
  scene: SceneDefinition,
  logger?: RedactedDiagnosticLogger
): SceneScriptingExtractedData {
  const scriptConfig: SceneScriptConfigurationContract = scene.scriptConfig
    ? Object.freeze({ ...scene.scriptConfig })
    : createDefaultSceneScriptConfig();

  const behaviors: ExtractedScriptBehaviorEntity[] = [];

  // Sort entities deterministically by entityId ASC
  const sortedEntities = [...scene.entities].sort((a, b) =>
    a.entityId.localeCompare(b.entityId)
  );

  for (const entity of sortedEntities) {
    const rawBehavior = entity.components[SCRIPT_BEHAVIOR_COMPONENT_TYPE];
    if (rawBehavior === undefined) continue;

    const val = validateScriptBehaviorComponentData(rawBehavior);
    if (!val.valid || !val.data) {
      logger?.record(
        'scripting',
        'WARN',
        `Skipping invalid ScriptBehavior on entity '${entity.entityId}': ${val.errors.join('; ')}`
      );
      continue;
    }

    behaviors.push(
      Object.freeze({
        entityId: entity.entityId,
        entityName: entity.name,
        entityEnabled: entity.enabled,
        behavior: val.data,
      })
    );
  }

  return Object.freeze({
    sceneId: scene.sceneId,
    scriptConfig,
    behaviors: Object.freeze(behaviors),
  });
}

/**
 * Synchronizes extracted `SceneDefinition` scripting behaviors into a `ScriptRuntime`
 * without mutating `SceneDefinition`.
 */
export function syncSceneToScriptRuntime(
  scene: SceneDefinition,
  runtime: ScriptRuntime,
  logger?: RedactedDiagnosticLogger
): ScriptValidationResult<{
  readonly activeInstances: readonly ScriptInstanceDescriptor[];
  readonly skippedUnregisteredScriptIds: readonly ScriptId[];
}> {
  if (runtime.getState() !== 'ready') {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_LIFECYCLE_ERROR',
          `ScriptRuntime must be 'ready' before syncing SceneDefinition (current: '${runtime.getState()}').`
        ),
      ],
    };
  }

  const extracted = extractSceneScriptingData(scene, logger);

  // Bind scene entities into ScriptBindings (read-only cloned references)
  const bindRes = runtime
    .getBindings()
    .bindEntities(scene.entities, runtime.getProjectId());
  if (!bindRes.valid) {
    return { valid: false, value: null, errors: bindRes.errors };
  }

  const skippedUnregisteredScriptIds: ScriptId[] = [];

  for (const item of extracted.behaviors) {
    const { entityId, entityEnabled, behavior } = item;
    const regEntry = runtime.getRegistry().findScript(behavior.scriptId);
    if (!regEntry) {
      skippedUnregisteredScriptIds.push(behavior.scriptId);
      logger?.record(
        'scripting',
        'WARN',
        `ScriptBehavior on entity '${entityId}' references unregistered scriptId '${behavior.scriptId}'; skipping.`
      );
      continue;
    }

    const deterministicInstId = createDeterministicScriptInstanceId(
      runtime.getProjectId(),
      behavior.scriptId,
      entityId
    );

    const existing = runtime.getInstance(deterministicInstId);
    const shouldBeEnabled =
      extracted.scriptConfig.enableScriptExecution &&
      entityEnabled &&
      behavior.enabled &&
      behavior.autoStart;

    if (!existing) {
      runtime.createInstance({
        instanceId: deterministicInstId,
        scriptId: behavior.scriptId,
        entityId,
        executionPriority: behavior.executionPriority,
        autoInitialize: true,
        autoEnable: shouldBeEnabled,
      });
    } else if (existing.lifecycleState !== 'destroyed') {
      if (shouldBeEnabled && existing.lifecycleState !== 'enabled') {
        if (existing.lifecycleState === 'created') {
          runtime.initializeInstance(deterministicInstId);
        }
        runtime.enableInstance(deterministicInstId);
      } else if (!shouldBeEnabled && existing.lifecycleState === 'enabled') {
        runtime.disableInstance(deterministicInstId);
      }
    }
  }

  return {
    valid: true,
    value: Object.freeze({
      activeInstances: runtime.listInstances(),
      skippedUnregisteredScriptIds: Object.freeze(skippedUnregisteredScriptIds),
    }),
    errors: [],
  };
}
