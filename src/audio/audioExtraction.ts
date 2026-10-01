import {
  HylixAssetRegistry,
  isValidAssetId,
} from '../assets/assetRegistry';
import { ResourceManager } from '../assets/resourceManager';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  ComponentRegistry,
  ComponentSpecification,
  ComponentValidationResult,
  HylixEntity,
  TRANSFORM_COMPONENT_TYPE,
  validateTransformComponentData,
} from '../ecs/ecsCore';
import {
  SceneAudioConfigurationContract,
  SceneDefinition,
} from '../scene/sceneSystem';
import {
  createDeterministicAudioListenerId,
  validateAudioListenerDescriptor,
} from './audioListener';
import {
  createDeterministicAudioSourceId,
  DEFAULT_AUDIO_SOURCE_PRIORITY,
  MAX_AUDIO_SOURCE_PITCH,
  MAX_AUDIO_SOURCE_PRIORITY,
  MAX_AUDIO_SOURCE_VOLUME,
  MIN_AUDIO_SOURCE_PRIORITY,
  validateAudioSourceDescriptor,
} from './audioSource';
import {
  AudioAttenuationModel,
  AudioLoadMode,
  AudioSourceId,
  AudioSpatialMode,
  createDefaultVector3,
  isFiniteAudioNumber,
  isForbiddenAudioInputString,
  isPlainAudioObject,
  validateVector3,
  Vector3,
  VoiceEvictionPolicy,
} from './audioTypes';
import { AudioWorld } from './audioWorld';

/**
 * Hylix V1.0.0 — Phase 07: ECS Audio Components (`AudioSource`, `AudioListener`)
 * & Read-Only Scene Audio Extraction (`extractSceneAudioData`).
 */

export const AUDIO_SOURCE_COMPONENT_TYPE = 'AudioSource';
export const AUDIO_LISTENER_COMPONENT_TYPE = 'AudioListener';

export interface AudioSourceComponentData {
  readonly audioAssetId: string;
  readonly busName: string;
  readonly spatialMode: AudioSpatialMode;
  readonly loadMode: AudioLoadMode;
  readonly volume: number;
  readonly pitch: number;
  readonly pan: number;
  readonly loop: boolean;
  readonly playOnAwake: boolean;
  readonly muted: boolean;
  readonly priority: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly rolloffFactor: number;
  readonly attenuationModel: AudioAttenuationModel;
}

export interface AudioListenerComponentData {
  readonly enabled: boolean;
  readonly masterGain: number;
  readonly forward: Vector3;
  readonly up: Vector3;
}

const FORBIDDEN_COMPONENT_AUDIO_KEYS: ReadonlySet<string> = new Set<string>([
  'soundPath',
  'audioPath',
  'filePath',
  'clipPath',
  'path',
  'url',
  'uri',
  'pcmBuffer',
  'decodedSamples',
  'nativeAudioTrack',
  'activeVoiceHandle',
]);

const ALLOWED_AUDIO_SOURCE_COMP_KEYS: ReadonlySet<string> = new Set<string>([
  'audioAssetId',
  'busName',
  'spatialMode',
  'loadMode',
  'volume',
  'pitch',
  'pan',
  'loop',
  'playOnAwake',
  'muted',
  'priority',
  'minDistance',
  'maxDistance',
  'rolloffFactor',
  'attenuationModel',
]);

const ALLOWED_AUDIO_LISTENER_COMP_KEYS: ReadonlySet<string> = new Set<string>([
  'enabled',
  'masterGain',
  'forward',
  'up',
]);

export function createDefaultAudioSourceComponentData(): AudioSourceComponentData {
  return Object.freeze({
    audioAssetId: 'asset_0000000000000001',
    busName: 'SFX',
    spatialMode: 'nonSpatial',
    loadMode: 'memory',
    volume: 1.0,
    pitch: 1.0,
    pan: 0.0,
    loop: false,
    playOnAwake: false,
    muted: false,
    priority: DEFAULT_AUDIO_SOURCE_PRIORITY,
    minDistance: 1.0,
    maxDistance: 50.0,
    rolloffFactor: 1.0,
    attenuationModel: 'linear',
  });
}

export function validateAudioSourceComponentData(
  candidate: unknown
): ComponentValidationResult<AudioSourceComponentData> {
  if (!isPlainAudioObject(candidate)) {
    return {
      valid: false,
      data: null,
      errors: ['AudioSource component must be a non-null plain object.'],
    };
  }

  const errors: string[] = [];
  for (const key of Object.keys(candidate)) {
    if (FORBIDDEN_COMPONENT_AUDIO_KEYS.has(key)) {
      errors.push(
        `Forbidden raw file path or runtime field '${key}' in AudioSource component; use deterministic audioAssetId.`
      );
    } else if (!ALLOWED_AUDIO_SOURCE_COMP_KEYS.has(key)) {
      errors.push(`Unexpected property '${key}' in AudioSource component.`);
    }
  }

  if (!isValidAssetId(candidate.audioAssetId)) {
    errors.push(
      `Invalid AudioSource.audioAssetId '${String(candidate.audioAssetId)}'. Expected deterministic asset_<16-hex> or ast_<16-hex>.`
    );
  }

  const busName =
    candidate.busName !== undefined ? candidate.busName : 'SFX';
  if (typeof busName !== 'string' || busName.trim().length === 0) {
    errors.push('AudioSource.busName must be a non-empty string.');
  } else {
    const sec = isForbiddenAudioInputString(busName);
    if (sec.forbidden) errors.push(sec.reason!);
  }

  const spatialMode =
    candidate.spatialMode !== undefined ? candidate.spatialMode : 'nonSpatial';
  if (
    spatialMode !== 'nonSpatial' &&
    spatialMode !== 'spatial2D' &&
    spatialMode !== 'spatial3D'
  ) {
    errors.push(
      `Invalid AudioSource.spatialMode '${String(spatialMode)}'. Expected 'nonSpatial', 'spatial2D', or 'spatial3D'.`
    );
  }

  const loadMode =
    candidate.loadMode !== undefined ? candidate.loadMode : 'memory';
  if (loadMode !== 'memory' && loadMode !== 'streaming') {
    errors.push(
      `Invalid AudioSource.loadMode '${String(loadMode)}'. Expected 'memory' or 'streaming'.`
    );
  }

  const volume = candidate.volume !== undefined ? candidate.volume : 1.0;
  if (
    !isFiniteAudioNumber(volume) ||
    volume < 0 ||
    volume > MAX_AUDIO_SOURCE_VOLUME
  ) {
    errors.push(
      `AudioSource.volume must be a finite number in [0, ${MAX_AUDIO_SOURCE_VOLUME}].`
    );
  }

  const pitch = candidate.pitch !== undefined ? candidate.pitch : 1.0;
  if (
    !isFiniteAudioNumber(pitch) ||
    pitch <= 0 ||
    pitch > MAX_AUDIO_SOURCE_PITCH
  ) {
    errors.push(
      `AudioSource.pitch must be a finite number in (0, ${MAX_AUDIO_SOURCE_PITCH}].`
    );
  }

  const pan = candidate.pan !== undefined ? candidate.pan : 0.0;
  if (!isFiniteAudioNumber(pan) || pan < -1.0 || pan > 1.0) {
    errors.push('AudioSource.pan must be a finite number in [-1, 1].');
  }

  const loop = candidate.loop !== undefined ? candidate.loop : false;
  if (typeof loop !== 'boolean') {
    errors.push('AudioSource.loop must be a boolean.');
  }

  const playOnAwake =
    candidate.playOnAwake !== undefined ? candidate.playOnAwake : false;
  if (typeof playOnAwake !== 'boolean') {
    errors.push('AudioSource.playOnAwake must be a boolean.');
  }

  const muted = candidate.muted !== undefined ? candidate.muted : false;
  if (typeof muted !== 'boolean') {
    errors.push('AudioSource.muted must be a boolean.');
  }

  const priority =
    candidate.priority !== undefined
      ? candidate.priority
      : DEFAULT_AUDIO_SOURCE_PRIORITY;
  if (
    !isFiniteAudioNumber(priority) ||
    !Number.isInteger(priority) ||
    priority < MIN_AUDIO_SOURCE_PRIORITY ||
    priority > MAX_AUDIO_SOURCE_PRIORITY
  ) {
    errors.push(
      `AudioSource.priority must be an integer in [${MIN_AUDIO_SOURCE_PRIORITY}, ${MAX_AUDIO_SOURCE_PRIORITY}].`
    );
  }

  const minDistance =
    candidate.minDistance !== undefined ? candidate.minDistance : 1.0;
  if (!isFiniteAudioNumber(minDistance) || minDistance < 0) {
    errors.push('AudioSource.minDistance must be a finite number >= 0.');
  }

  const maxDistance =
    candidate.maxDistance !== undefined ? candidate.maxDistance : 50.0;
  if (
    !isFiniteAudioNumber(maxDistance) ||
    maxDistance <= 0 ||
    (isFiniteAudioNumber(minDistance) && maxDistance <= minDistance)
  ) {
    errors.push(
      'AudioSource.maxDistance must be a finite number > minDistance and > 0.'
    );
  }

  const rolloffFactor =
    candidate.rolloffFactor !== undefined ? candidate.rolloffFactor : 1.0;
  if (!isFiniteAudioNumber(rolloffFactor) || rolloffFactor < 0) {
    errors.push('AudioSource.rolloffFactor must be a finite number >= 0.');
  }

  const attenuationModel =
    candidate.attenuationModel !== undefined
      ? candidate.attenuationModel
      : 'linear';
  if (
    attenuationModel !== 'linear' &&
    attenuationModel !== 'inverse' &&
    attenuationModel !== 'exponential'
  ) {
    errors.push(
      `Invalid AudioSource.attenuationModel '${String(attenuationModel)}'.`
    );
  }

  if (errors.length > 0) {
    return { valid: false, data: null, errors };
  }

  return {
    valid: true,
    data: Object.freeze({
      audioAssetId: candidate.audioAssetId as string,
      busName: (busName as string).trim(),
      spatialMode: spatialMode as AudioSpatialMode,
      loadMode: loadMode as AudioLoadMode,
      volume: volume as number,
      pitch: pitch as number,
      pan: pan as number,
      loop: loop as boolean,
      playOnAwake: playOnAwake as boolean,
      muted: muted as boolean,
      priority: priority as number,
      minDistance: minDistance as number,
      maxDistance: maxDistance as number,
      rolloffFactor: rolloffFactor as number,
      attenuationModel: attenuationModel as AudioAttenuationModel,
    }),
    errors: [],
  };
}

export function createDefaultAudioListenerComponentData(): AudioListenerComponentData {
  return Object.freeze({
    enabled: true,
    masterGain: 1.0,
    forward: Object.freeze({ x: 0, y: 0, z: -1 }),
    up: Object.freeze({ x: 0, y: 1, z: 0 }),
  });
}

export function validateAudioListenerComponentData(
  candidate: unknown
): ComponentValidationResult<AudioListenerComponentData> {
  if (!isPlainAudioObject(candidate)) {
    return {
      valid: false,
      data: null,
      errors: ['AudioListener component must be a non-null plain object.'],
    };
  }

  const errors: string[] = [];
  for (const key of Object.keys(candidate)) {
    if (FORBIDDEN_COMPONENT_AUDIO_KEYS.has(key)) {
      errors.push(
        `Forbidden runtime property '${key}' in AudioListener component.`
      );
    } else if (!ALLOWED_AUDIO_LISTENER_COMP_KEYS.has(key)) {
      errors.push(`Unexpected property '${key}' in AudioListener component.`);
    }
  }

  const enabled = candidate.enabled !== undefined ? candidate.enabled : true;
  if (typeof enabled !== 'boolean') {
    errors.push('AudioListener.enabled must be a boolean.');
  }

  const masterGain =
    candidate.masterGain !== undefined ? candidate.masterGain : 1.0;
  if (!isFiniteAudioNumber(masterGain) || masterGain < 0 || masterGain > 4.0) {
    errors.push(
      'AudioListener.masterGain must be a finite number in [0, 4].'
    );
  }

  const fwdCheck = validateVector3(
    candidate.forward !== undefined
      ? candidate.forward
      : Object.freeze({ x: 0, y: 0, z: -1 })
  );
  if (!fwdCheck.valid || !fwdCheck.value) {
    errors.push(...fwdCheck.errors.map((e) => `forward: ${e}`));
  } else if (
    Math.hypot(fwdCheck.value.x, fwdCheck.value.y, fwdCheck.value.z) <= 1e-6
  ) {
    errors.push('AudioListener.forward cannot be a zero vector.');
  }

  const upCheck = validateVector3(
    candidate.up !== undefined
      ? candidate.up
      : Object.freeze({ x: 0, y: 1, z: 0 })
  );
  if (!upCheck.valid || !upCheck.value) {
    errors.push(...upCheck.errors.map((e) => `up: ${e}`));
  } else if (
    Math.hypot(upCheck.value.x, upCheck.value.y, upCheck.value.z) <= 1e-6
  ) {
    errors.push('AudioListener.up cannot be a zero vector.');
  }

  if (errors.length > 0 || !fwdCheck.value || !upCheck.value) {
    return { valid: false, data: null, errors };
  }

  return {
    valid: true,
    data: Object.freeze({
      enabled: enabled as boolean,
      masterGain: masterGain as number,
      forward: fwdCheck.value,
      up: upCheck.value,
    }),
    errors: [],
  };
}

export const OFFICIAL_AUDIO_SOURCE_SPEC: ComponentSpecification<AudioSourceComponentData> =
  Object.freeze({
    type: AUDIO_SOURCE_COMPONENT_TYPE,
    schemaVersion: 1,
    createDefault: createDefaultAudioSourceComponentData,
    validate: validateAudioSourceComponentData,
  });

export const OFFICIAL_AUDIO_LISTENER_SPEC: ComponentSpecification<AudioListenerComponentData> =
  Object.freeze({
    type: AUDIO_LISTENER_COMPONENT_TYPE,
    schemaVersion: 1,
    createDefault: createDefaultAudioListenerComponentData,
    validate: validateAudioListenerComponentData,
  });

export function registerAudioEcsComponents(
  registry: ComponentRegistry
): ComponentRegistry {
  if (!registry.isRegistered(AUDIO_SOURCE_COMPONENT_TYPE)) {
    registry.registerComponentType(OFFICIAL_AUDIO_SOURCE_SPEC);
  }
  if (!registry.isRegistered(AUDIO_LISTENER_COMPONENT_TYPE)) {
    registry.registerComponentType(OFFICIAL_AUDIO_LISTENER_SPEC);
  }
  return registry;
}

export function validateSceneAudioConfig(candidate: unknown): {
  readonly valid: boolean;
  readonly config: SceneAudioConfigurationContract | null;
  readonly errors: readonly string[];
} {
  if (!isPlainAudioObject(candidate)) {
    return {
      valid: false,
      config: null,
      errors: ['Scene audioConfig must be a non-null plain object.'],
    };
  }

  const errors: string[] = [];
  const allowedKeys = new Set([
    'masterVolume',
    'maxVoices',
    'voiceEvictionPolicy',
    'defaultRolloff',
  ]);
  for (const k of Object.keys(candidate)) {
    if (!allowedKeys.has(k)) {
      errors.push(
        `Forbidden runtime or unknown property '${k}' in Scene audioConfig.`
      );
    }
  }

  const masterVolume =
    candidate.masterVolume !== undefined ? candidate.masterVolume : 1.0;
  if (
    !isFiniteAudioNumber(masterVolume) ||
    masterVolume < 0 ||
    masterVolume > 4.0
  ) {
    errors.push('audioConfig.masterVolume must be a finite number in [0, 4].');
  }

  const maxVoices =
    candidate.maxVoices !== undefined ? candidate.maxVoices : 32;
  if (
    !isFiniteAudioNumber(maxVoices) ||
    !Number.isInteger(maxVoices) ||
    maxVoices < 1 ||
    maxVoices > 256
  ) {
    errors.push('audioConfig.maxVoices must be an integer in [1, 256].');
  }

  const voiceEvictionPolicy =
    candidate.voiceEvictionPolicy !== undefined
      ? candidate.voiceEvictionPolicy
      : 'replaceLowestPriority';
  if (
    voiceEvictionPolicy !== 'reject' &&
    voiceEvictionPolicy !== 'replaceLowestPriority' &&
    voiceEvictionPolicy !== 'stopOldestEqualPriority'
  ) {
    errors.push(
      `Invalid audioConfig.voiceEvictionPolicy '${String(voiceEvictionPolicy)}'.`
    );
  }

  const defaultRolloff =
    candidate.defaultRolloff !== undefined ? candidate.defaultRolloff : 1.0;
  if (!isFiniteAudioNumber(defaultRolloff) || defaultRolloff < 0) {
    errors.push('audioConfig.defaultRolloff must be a finite number >= 0.');
  }

  if (errors.length > 0) {
    return { valid: false, config: null, errors };
  }

  return {
    valid: true,
    config: Object.freeze({
      masterVolume: masterVolume as number,
      maxVoices: maxVoices as number,
      voiceEvictionPolicy: voiceEvictionPolicy as VoiceEvictionPolicy,
      defaultRolloff: defaultRolloff as number,
    }),
    errors: [],
  };
}

function resolveEntityWorldPosition(
  entity: HylixEntity,
  entitiesById: ReadonlyMap<string, HylixEntity>
): Vector3 {
  let x = 0;
  let y = 0;
  let z = 0;
  const visited = new Set<string>();
  let cursor: HylixEntity | undefined = entity;

  while (cursor && !visited.has(cursor.entityId)) {
    visited.add(cursor.entityId);
    const rawTransform = cursor.components[TRANSFORM_COMPONENT_TYPE];
    if (rawTransform) {
      const val = validateTransformComponentData(rawTransform);
      if (val.valid && val.data) {
        x += val.data.position.x;
        y += val.data.position.y;
        z += val.data.position.z;
      }
    }
    cursor = cursor.parentEntityId
      ? entitiesById.get(cursor.parentEntityId)
      : undefined;
  }

  return Object.freeze({ x, y, z });
}

export interface SceneAudioExtractionReport {
  readonly success: boolean;
  readonly audioWorld: AudioWorld;
  readonly extractedSourceCount: number;
  readonly extractedListenerCount: number;
  readonly autoPlayedSourceIds: readonly AudioSourceId[];
  readonly missingAudioAssetIds: readonly string[];
  readonly corruptedAudioAssetIds: readonly string[];
  readonly invalidTypeAssetIds: readonly string[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/**
 * Extracts `AudioSource` and `AudioListener` components from a `SceneDefinition`
 * (read-only) into a project-isolated `AudioWorld`.
 * Gracefully reports missing, corrupted, or wrong-type audio assets without crashing.
 */
export function extractSceneAudioData(options: {
  readonly projectId: string;
  readonly scene: SceneDefinition;
  readonly assetRegistry: HylixAssetRegistry;
  readonly resourceManager: ResourceManager;
  readonly audioWorld?: AudioWorld;
  readonly triggerPlayOnAwake?: boolean;
  readonly logger?: RedactedDiagnosticLogger;
}): SceneAudioExtractionReport {
  const {
    projectId,
    scene,
    assetRegistry,
    resourceManager,
    triggerPlayOnAwake = false,
    logger,
  } = options;

  const sceneConfig = scene.audioConfig;
  const world =
    options.audioWorld ??
    new AudioWorld({
      projectId,
      registry: assetRegistry,
      resourceManager,
      masterVolume: sceneConfig?.masterVolume ?? 1.0,
      maxVoices: sceneConfig?.maxVoices ?? 32,
      voiceEvictionPolicy:
        sceneConfig?.voiceEvictionPolicy ?? 'replaceLowestPriority',
      defaultRolloff: sceneConfig?.defaultRolloff ?? 1.0,
      logger,
    });

  if (world.getState() === 'uninitialized') {
    world.initialize();
  }

  if (sceneConfig) {
    world.configureWorld(sceneConfig);
  }

  const entitiesById = new Map<string, HylixEntity>();
  for (const ent of scene.entities) {
    entitiesById.set(ent.entityId, ent);
  }

  // Sort entities deterministically by entityId ASC
  const sortedEntities = scene.entities
    .slice()
    .sort((a, b) => a.entityId.localeCompare(b.entityId));

  let extractedSourceCount = 0;
  let extractedListenerCount = 0;
  const autoPlayedSourceIds: AudioSourceId[] = [];
  const missingAudioAssetIds: string[] = [];
  const corruptedAudioAssetIds: string[] = [];
  const invalidTypeAssetIds: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const entity of sortedEntities) {
    if (!entity.enabled) continue;

    const worldPos = resolveEntityWorldPosition(entity, entitiesById);

    // 1. Extract AudioListener if present
    const rawListener = entity.components[AUDIO_LISTENER_COMPONENT_TYPE];
    if (rawListener !== undefined) {
      const lCheck = validateAudioListenerComponentData(rawListener);
      if (!lCheck.valid || !lCheck.data) {
        errors.push(
          `Entity '${entity.entityId}' AudioListener invalid: ${lCheck.errors.join('; ')}`
        );
      } else {
        const listenerDesc = validateAudioListenerDescriptor({
          listenerId: createDeterministicAudioListenerId(
            projectId,
            entity.entityId
          ),
          projectId,
          entityId: entity.entityId,
          enabled: lCheck.data.enabled,
          masterGain: lCheck.data.masterGain,
          position: worldPos,
          forward: lCheck.data.forward,
          up: lCheck.data.up,
          velocity: createDefaultVector3(),
        });
        if (listenerDesc.valid && listenerDesc.value) {
          const regL = world.registerListener(listenerDesc.value);
          if (regL.success) {
            extractedListenerCount += 1;
          } else {
            errors.push(...regL.errors);
          }
        } else {
          errors.push(...listenerDesc.errors);
        }
      }
    }

    // 2. Extract AudioSource if present
    const rawSource = entity.components[AUDIO_SOURCE_COMPONENT_TYPE];
    if (rawSource !== undefined) {
      const sCheck = validateAudioSourceComponentData(rawSource);
      if (!sCheck.valid || !sCheck.data) {
        errors.push(
          `Entity '${entity.entityId}' AudioSource invalid: ${sCheck.errors.join('; ')}`
        );
        continue;
      }

      const comp = sCheck.data;
      const assetResolution = assetRegistry.resolveAssetReference(
        comp.audioAssetId
      );

      if (assetResolution.status === 'missing') {
        missingAudioAssetIds.push(comp.audioAssetId);
        const warn = `Scene '${scene.sceneId}' entity '${entity.entityId}' references missing audio asset '${comp.audioAssetId}'.`;
        warnings.push(warn);
        logger?.record('audio', 'WARN', warn);
        continue;
      }

      if (assetResolution.status === 'corrupted') {
        corruptedAudioAssetIds.push(comp.audioAssetId);
        const warn = `Scene '${scene.sceneId}' entity '${entity.entityId}' references corrupted audio asset '${comp.audioAssetId}'.`;
        warnings.push(warn);
        logger?.record('audio', 'WARN', warn);
        continue;
      }

      if (
        !assetResolution.asset ||
        assetResolution.asset.type !== 'audio'
      ) {
        invalidTypeAssetIds.push(comp.audioAssetId);
        const warn = `Scene '${scene.sceneId}' entity '${entity.entityId}' references non-audio asset '${comp.audioAssetId}' (type '${assetResolution.asset?.type ?? 'unknown'}').`;
        warnings.push(warn);
        logger?.record('audio', 'WARN', warn);
        continue;
      }

      const sourceId = createDeterministicAudioSourceId(
        projectId,
        entity.entityId
      );
      const regSource = world.registerSource({
        sourceId,
        projectId,
        entityId: entity.entityId,
        audioAssetId: comp.audioAssetId,
        busName: comp.busName,
        spatialMode: comp.spatialMode,
        loadMode: comp.loadMode,
        volume: comp.volume,
        pitch: comp.pitch,
        pan: comp.pan,
        loop: comp.loop,
        playOnAwake: comp.playOnAwake,
        muted: comp.muted,
        priority: comp.priority,
        minDistance: comp.minDistance,
        maxDistance: comp.maxDistance,
        rolloffFactor: comp.rolloffFactor,
        attenuationModel: comp.attenuationModel,
        position: worldPos,
        velocity: createDefaultVector3(),
      });

      if (!regSource.success || !regSource.source) {
        errors.push(...regSource.errors);
        continue;
      }

      extractedSourceCount += 1;

      if (triggerPlayOnAwake && comp.playOnAwake) {
        const playRes = world.playSource(regSource.source.sourceId);
        if (playRes.success) {
          autoPlayedSourceIds.push(regSource.source.sourceId);
        } else {
          warnings.push(...playRes.errors);
        }
      }
    }
  }

  return Object.freeze({
    success: errors.length === 0,
    audioWorld: world,
    extractedSourceCount,
    extractedListenerCount,
    autoPlayedSourceIds: Object.freeze(autoPlayedSourceIds),
    missingAudioAssetIds: Object.freeze(missingAudioAssetIds),
    corruptedAudioAssetIds: Object.freeze(corruptedAudioAssetIds),
    invalidTypeAssetIds: Object.freeze(invalidTypeAssetIds),
    warnings: Object.freeze(warnings),
    errors: Object.freeze(errors),
  });
}
