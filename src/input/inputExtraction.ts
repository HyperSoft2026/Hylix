import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  ComponentRegistry,
  ComponentSpecification,
  ComponentValidationResult,
  HylixEntity,
} from '../ecs/ecsCore';
import {
  SceneDefinition,
  SceneInputConfigurationContract,
} from '../scene/sceneSystem';
import {
  InputBufferOverflowPolicy,
  isFiniteInputNumber,
  isForbiddenInputString,
  isPlainInputObject,
} from './inputTypes';

/**
 * Hylix V1.0.0 — Phase 08: Read-Only Scene/ECS Input Extraction (`InputReceiver`)
 *
 * Strictly separates authored `SceneDefinition` data from runtime `InputManager` state.
 * Never mutates `SceneDefinition`.
 */

export const INPUT_RECEIVER_COMPONENT_TYPE = 'InputReceiver' as const;

export interface InputReceiverComponentData {
  readonly contextName: string;
  readonly actionNames: readonly string[];
  readonly playerIndex: number;
  readonly enabled: boolean;
}

const ALLOWED_INPUT_RECEIVER_KEYS: ReadonlySet<string> = new Set<string>([
  'contextName',
  'actionNames',
  'playerIndex',
  'enabled',
]);

export function createDefaultInputReceiverComponent(): InputReceiverComponentData {
  return Object.freeze({
    contextName: 'Gameplay',
    actionNames: Object.freeze(['Move', 'Jump', 'Interact']),
    playerIndex: 0,
    enabled: true,
  });
}

export function validateInputReceiverComponentData(
  rawData: unknown
): ComponentValidationResult<InputReceiverComponentData> {
  if (!isPlainInputObject(rawData)) {
    return {
      valid: false,
      data: null,
      errors: ['InputReceiver component must be a non-null plain object.'],
    };
  }

  const errors: string[] = [];

  for (const key of Object.keys(rawData)) {
    if (!ALLOWED_INPUT_RECEIVER_KEYS.has(key)) {
      errors.push(
        `Unexpected or runtime property '${key}' in InputReceiver component.`
      );
    }
  }

  const contextName =
    rawData.contextName !== undefined ? rawData.contextName : 'Gameplay';
  if (
    typeof contextName !== 'string' ||
    contextName.trim().length === 0 ||
    contextName.trim().length > 64
  ) {
    errors.push(
      'InputReceiver.contextName must be a non-empty string (1..64 chars).'
    );
  } else {
    const sec = isForbiddenInputString(contextName);
    if (sec.forbidden && sec.reason) {
      errors.push(sec.reason);
    }
  }

  const actionNames: string[] = [];
  if (rawData.actionNames !== undefined) {
    if (!Array.isArray(rawData.actionNames)) {
      errors.push('InputReceiver.actionNames must be an array of strings.');
    } else {
      const seen = new Set<string>();
      for (const item of rawData.actionNames) {
        if (
          typeof item !== 'string' ||
          item.trim().length === 0 ||
          item.trim().length > 64
        ) {
          errors.push(
            `Invalid actionName '${String(item)}' in InputReceiver.actionNames.`
          );
        } else {
          const sec = isForbiddenInputString(item);
          if (sec.forbidden && sec.reason) {
            errors.push(sec.reason);
          } else {
            const clean = item.trim();
            if (!seen.has(clean)) {
              seen.add(clean);
              actionNames.push(clean);
            }
          }
        }
      }
    }
  }

  const playerIndex =
    rawData.playerIndex !== undefined ? rawData.playerIndex : 0;
  if (
    !isFiniteInputNumber(playerIndex) ||
    !Number.isInteger(playerIndex) ||
    playerIndex < 0 ||
    playerIndex > 7
  ) {
    errors.push('InputReceiver.playerIndex must be an integer in [0, 7].');
  }

  const enabled = rawData.enabled !== undefined ? rawData.enabled : true;
  if (typeof enabled !== 'boolean') {
    errors.push('InputReceiver.enabled must be a boolean.');
  }

  if (errors.length > 0) {
    return { valid: false, data: null, errors };
  }

  return {
    valid: true,
    data: Object.freeze({
      contextName: (contextName as string).trim(),
      actionNames: Object.freeze(actionNames),
      playerIndex: playerIndex as number,
      enabled: enabled as boolean,
    }),
    errors: [],
  };
}

export const OFFICIAL_INPUT_RECEIVER_SPEC: ComponentSpecification<InputReceiverComponentData> =
  Object.freeze({
    type: INPUT_RECEIVER_COMPONENT_TYPE,
    schemaVersion: 1,
    createDefault: createDefaultInputReceiverComponent,
    validate: validateInputReceiverComponentData,
  });

export function registerInputEcsComponents(
  registry: ComponentRegistry
): ComponentRegistry {
  if (!registry.isRegistered(INPUT_RECEIVER_COMPONENT_TYPE)) {
    registry.registerComponentType(OFFICIAL_INPUT_RECEIVER_SPEC);
  }
  return registry;
}

export interface ExtractedInputReceiverNode {
  readonly entityId: string;
  readonly entityName: string;
  readonly contextName: string;
  readonly actionNames: readonly string[];
  readonly playerIndex: number;
  readonly enabled: boolean;
}

export interface SceneInputFrameSnapshot {
  readonly sceneId: string;
  readonly projectId: string;
  readonly maxBufferedEvents: number;
  readonly bufferOverflowPolicy: InputBufferOverflowPolicy;
  readonly defaultDeadZone: number;
  readonly defaultContextName: string;
  readonly receivers: readonly ExtractedInputReceiverNode[];
  readonly errors: readonly string[];
}

function isEntityEnabledInHierarchy(
  entity: HylixEntity,
  byId: ReadonlyMap<string, HylixEntity>
): boolean {
  const visited = new Set<string>();
  let cursor: HylixEntity | undefined = entity;
  while (cursor && !visited.has(cursor.entityId)) {
    if (!cursor.enabled) return false;
    visited.add(cursor.entityId);
    cursor = cursor.parentEntityId
      ? byId.get(cursor.parentEntityId)
      : undefined;
  }
  return true;
}

/**
 * Extracts `InputReceiver` ECS entities and `inputConfig` from a `SceneDefinition`
 * without mutating the `SceneDefinition`.
 */
export function extractSceneInputData(
  scene: SceneDefinition,
  projectId: string,
  logger?: RedactedDiagnosticLogger
): SceneInputFrameSnapshot {
  const errors: string[] = [];
  const byId = new Map<string, HylixEntity>();
  for (const ent of scene.entities) {
    byId.set(ent.entityId, ent);
  }

  const inputCfg: SceneInputConfigurationContract = scene.inputConfig ?? {
    maxBufferedEvents: 512,
    bufferOverflowPolicy: 'rejectNewest',
    defaultDeadZone: 0.1,
    defaultContextName: 'Gameplay',
  };

  const receivers: ExtractedInputReceiverNode[] = [];
  const sortedEntities = scene.entities
    .slice()
    .sort((a, b) => a.entityId.localeCompare(b.entityId));

  for (const ent of sortedEntities) {
    if (!isEntityEnabledInHierarchy(ent, byId)) {
      continue;
    }

    const rawReceiver = ent.components[INPUT_RECEIVER_COMPONENT_TYPE];
    if (!rawReceiver) continue;

    const val = validateInputReceiverComponentData(rawReceiver);
    if (!val.valid || !val.data) {
      const msg = `Entity '${ent.entityId}' InputReceiver invalid: ${val.errors.join('; ')}`;
      errors.push(msg);
      logger?.record('input', 'ERROR', `input_validation_failed: ${msg}`);
      continue;
    }

    if (!val.data.enabled) continue;

    receivers.push(
      Object.freeze({
        entityId: ent.entityId,
        entityName: ent.name,
        contextName: val.data.contextName,
        actionNames: val.data.actionNames,
        playerIndex: val.data.playerIndex,
        enabled: val.data.enabled,
      })
    );
  }

  return Object.freeze({
    sceneId: scene.sceneId,
    projectId: projectId.trim(),
    maxBufferedEvents: inputCfg.maxBufferedEvents,
    bufferOverflowPolicy: inputCfg.bufferOverflowPolicy,
    defaultDeadZone: inputCfg.defaultDeadZone,
    defaultContextName: inputCfg.defaultContextName,
    receivers: Object.freeze(receivers),
    errors: Object.freeze(errors),
  });
}
