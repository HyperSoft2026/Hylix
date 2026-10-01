import { isValidAssetId } from '../assets/assetRegistry';
import { isValidEntityId } from '../ecs/ecsCore';
import { createDeterministicAudioBusId } from './audioBus';
import {
  AudioAttenuationModel,
  AudioBusId,
  AudioLoadMode,
  AudioPlaybackState,
  AudioSourceId,
  AudioSpatialMode,
  AudioValidationResult,
  createAudioId,
  createDefaultVector3,
  isFiniteAudioNumber,
  isForbiddenAudioInputString,
  isPlainAudioObject,
  isValidAudioBusId,
  isValidAudioSourceId,
  validateVector3,
  Vector3,
} from './audioTypes';

/**
 * Hylix V1.0.0 — Phase 07: Audio Source Descriptor & Validation
 */

export const DEFAULT_AUDIO_SOURCE_PRIORITY = 128;
export const MIN_AUDIO_SOURCE_PRIORITY = 0;
export const MAX_AUDIO_SOURCE_PRIORITY = 255;
export const MAX_AUDIO_SOURCE_VOLUME = 4.0;
export const MIN_AUDIO_SOURCE_PITCH = 0.01;
export const MAX_AUDIO_SOURCE_PITCH = 4.0;

export interface AudioSourceDescriptor {
  readonly sourceId: AudioSourceId;
  readonly projectId: string;
  readonly entityId: string;
  readonly audioAssetId: string;
  readonly busName: string;
  readonly busId: AudioBusId;
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
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly playbackState: AudioPlaybackState;
  readonly playbackPositionSeconds: number;
}

const FORBIDDEN_RAW_PATH_AND_RUNTIME_KEYS: ReadonlySet<string> =
  new Set<string>([
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
    'hardwareChannel',
  ]);

const ALLOWED_AUDIO_SOURCE_KEYS: ReadonlySet<string> = new Set<string>([
  'sourceId',
  'projectId',
  'entityId',
  'audioAssetId',
  'busName',
  'busId',
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
  'position',
  'velocity',
  'playbackState',
  'playbackPositionSeconds',
]);

export function createDeterministicAudioSourceId(
  projectId: string,
  entityId: string,
  slotKey = 'primary'
): AudioSourceId {
  return createAudioId(
    'source',
    `${projectId.trim()}::${entityId.trim()}::${slotKey.trim()}`
  );
}

export function validateAudioSourceDescriptor(
  candidate: unknown
): AudioValidationResult<AudioSourceDescriptor> {
  if (!isPlainAudioObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['AudioSourceDescriptor must be a non-null plain object.'],
    };
  }

  const errors: string[] = [];

  for (const key of Object.keys(candidate)) {
    if (FORBIDDEN_RAW_PATH_AND_RUNTIME_KEYS.has(key)) {
      errors.push(
        `Forbidden raw path or runtime property '${key}' in AudioSourceDescriptor.`
      );
    } else if (!ALLOWED_AUDIO_SOURCE_KEYS.has(key)) {
      errors.push(`Unexpected property '${key}' in AudioSourceDescriptor.`);
    }
  }

  if (
    typeof candidate.projectId !== 'string' ||
    candidate.projectId.trim().length === 0
  ) {
    errors.push('AudioSourceDescriptor.projectId must be a non-empty string.');
  } else {
    const sec = isForbiddenAudioInputString(candidate.projectId);
    if (sec.forbidden) errors.push(sec.reason!);
  }

  if (!isValidEntityId(candidate.entityId)) {
    errors.push(
      `Invalid AudioSourceDescriptor.entityId '${String(candidate.entityId)}'. Expected ent_<16-hex>.`
    );
  }

  if (!isValidAssetId(candidate.audioAssetId)) {
    errors.push(
      `Invalid AudioSourceDescriptor.audioAssetId '${String(candidate.audioAssetId)}'. Expected asset_<16-hex> or ast_<16-hex>.`
    );
  }

  const resolvedSourceId =
    candidate.sourceId !== undefined
      ? candidate.sourceId
      : typeof candidate.projectId === 'string' &&
          isValidEntityId(candidate.entityId)
        ? createDeterministicAudioSourceId(
            candidate.projectId,
            candidate.entityId
          )
        : '';

  if (!isValidAudioSourceId(resolvedSourceId)) {
    errors.push(
      `Invalid AudioSourceDescriptor.sourceId '${String(resolvedSourceId)}'. Expected source_<16-hex>.`
    );
  }

  const busName =
    candidate.busName !== undefined ? candidate.busName : 'SFX';
  if (typeof busName !== 'string' || busName.trim().length === 0) {
    errors.push('AudioSourceDescriptor.busName must be a non-empty string.');
  } else {
    const sec = isForbiddenAudioInputString(busName);
    if (sec.forbidden) errors.push(sec.reason!);
  }

  const resolvedBusId =
    candidate.busId !== undefined
      ? candidate.busId
      : typeof candidate.projectId === 'string' && typeof busName === 'string'
        ? createDeterministicAudioBusId(candidate.projectId, busName)
        : '';

  if (!isValidAudioBusId(resolvedBusId)) {
    errors.push(
      `Invalid AudioSourceDescriptor.busId '${String(resolvedBusId)}'. Expected bus_<16-hex>.`
    );
  }

  const spatialMode =
    candidate.spatialMode !== undefined ? candidate.spatialMode : 'nonSpatial';
  if (
    spatialMode !== 'nonSpatial' &&
    spatialMode !== 'spatial2D' &&
    spatialMode !== 'spatial3D'
  ) {
    errors.push(
      `Invalid AudioSourceDescriptor.spatialMode '${String(spatialMode)}'. Expected 'nonSpatial', 'spatial2D', or 'spatial3D'.`
    );
  }

  const loadMode =
    candidate.loadMode !== undefined ? candidate.loadMode : 'memory';
  if (loadMode !== 'memory' && loadMode !== 'streaming') {
    errors.push(
      `Invalid AudioSourceDescriptor.loadMode '${String(loadMode)}'. Expected 'memory' or 'streaming'.`
    );
  }

  const volume = candidate.volume !== undefined ? candidate.volume : 1.0;
  if (
    !isFiniteAudioNumber(volume) ||
    volume < 0 ||
    volume > MAX_AUDIO_SOURCE_VOLUME
  ) {
    errors.push(
      `AudioSourceDescriptor.volume must be a finite number in [0, ${MAX_AUDIO_SOURCE_VOLUME}].`
    );
  }

  const pitch = candidate.pitch !== undefined ? candidate.pitch : 1.0;
  if (
    !isFiniteAudioNumber(pitch) ||
    pitch <= 0 ||
    pitch > MAX_AUDIO_SOURCE_PITCH
  ) {
    errors.push(
      `AudioSourceDescriptor.pitch must be a finite number in (0, ${MAX_AUDIO_SOURCE_PITCH}].`
    );
  }

  const pan = candidate.pan !== undefined ? candidate.pan : 0.0;
  if (!isFiniteAudioNumber(pan) || pan < -1.0 || pan > 1.0) {
    errors.push(
      'AudioSourceDescriptor.pan must be a finite number in [-1, 1].'
    );
  }

  const loop = candidate.loop !== undefined ? candidate.loop : false;
  if (typeof loop !== 'boolean') {
    errors.push('AudioSourceDescriptor.loop must be a boolean.');
  }

  const playOnAwake =
    candidate.playOnAwake !== undefined ? candidate.playOnAwake : false;
  if (typeof playOnAwake !== 'boolean') {
    errors.push('AudioSourceDescriptor.playOnAwake must be a boolean.');
  }

  const muted = candidate.muted !== undefined ? candidate.muted : false;
  if (typeof muted !== 'boolean') {
    errors.push('AudioSourceDescriptor.muted must be a boolean.');
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
      `AudioSourceDescriptor.priority must be an integer in [${MIN_AUDIO_SOURCE_PRIORITY}, ${MAX_AUDIO_SOURCE_PRIORITY}].`
    );
  }

  const minDistance =
    candidate.minDistance !== undefined ? candidate.minDistance : 1.0;
  if (!isFiniteAudioNumber(minDistance) || minDistance < 0) {
    errors.push(
      'AudioSourceDescriptor.minDistance must be a finite number >= 0.'
    );
  }

  const maxDistance =
    candidate.maxDistance !== undefined ? candidate.maxDistance : 50.0;
  if (
    !isFiniteAudioNumber(maxDistance) ||
    maxDistance <= 0 ||
    (isFiniteAudioNumber(minDistance) && maxDistance <= minDistance)
  ) {
    errors.push(
      'AudioSourceDescriptor.maxDistance must be a finite number > minDistance and > 0.'
    );
  }

  const rolloffFactor =
    candidate.rolloffFactor !== undefined ? candidate.rolloffFactor : 1.0;
  if (!isFiniteAudioNumber(rolloffFactor) || rolloffFactor < 0) {
    errors.push(
      'AudioSourceDescriptor.rolloffFactor must be a finite number >= 0.'
    );
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
      `Invalid AudioSourceDescriptor.attenuationModel '${String(attenuationModel)}'. Expected 'linear', 'inverse', or 'exponential'.`
    );
  }

  const posCheck = validateVector3(
    candidate.position !== undefined
      ? candidate.position
      : createDefaultVector3()
  );
  if (!posCheck.valid || !posCheck.value) {
    errors.push(...posCheck.errors.map((e) => `position: ${e}`));
  }

  const velCheck = validateVector3(
    candidate.velocity !== undefined
      ? candidate.velocity
      : createDefaultVector3()
  );
  if (!velCheck.valid || !velCheck.value) {
    errors.push(...velCheck.errors.map((e) => `velocity: ${e}`));
  }

  const playbackState =
    candidate.playbackState !== undefined
      ? candidate.playbackState
      : 'stopped';
  if (
    playbackState !== 'stopped' &&
    playbackState !== 'playing' &&
    playbackState !== 'paused'
  ) {
    errors.push(
      `Invalid AudioSourceDescriptor.playbackState '${String(playbackState)}'.`
    );
  }

  const playbackPositionSeconds =
    candidate.playbackPositionSeconds !== undefined
      ? candidate.playbackPositionSeconds
      : 0;
  if (
    !isFiniteAudioNumber(playbackPositionSeconds) ||
    playbackPositionSeconds < 0
  ) {
    errors.push(
      'AudioSourceDescriptor.playbackPositionSeconds must be a finite number >= 0.'
    );
  }

  if (errors.length > 0 || !posCheck.value || !velCheck.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      sourceId: resolvedSourceId as AudioSourceId,
      projectId: (candidate.projectId as string).trim(),
      entityId: candidate.entityId as string,
      audioAssetId: candidate.audioAssetId as string,
      busName: (busName as string).trim(),
      busId: resolvedBusId as AudioBusId,
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
      position: posCheck.value,
      velocity: velCheck.value,
      playbackState: playbackState as AudioPlaybackState,
      playbackPositionSeconds: playbackPositionSeconds as number,
    }),
    errors: [],
  };
}
