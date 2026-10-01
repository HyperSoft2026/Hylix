import { isValidEntityId } from '../ecs/ecsCore';
import {
  AudioListenerId,
  AudioValidationResult,
  createAudioId,
  createDefaultVector3,
  isFiniteAudioNumber,
  isForbiddenAudioInputString,
  isPlainAudioObject,
  isValidAudioListenerId,
  normalizeVector3,
  validateVector3,
  Vector3,
} from './audioTypes';

/**
 * Hylix V1.0.0 — Phase 07: Audio Listener Descriptor & Single Active Listener Rule
 */

export interface AudioListenerDescriptor {
  readonly listenerId: AudioListenerId;
  readonly projectId: string;
  readonly entityId: string;
  readonly enabled: boolean;
  readonly masterGain: number;
  readonly position: Vector3;
  readonly forward: Vector3;
  readonly up: Vector3;
  readonly velocity: Vector3;
}

const ALLOWED_AUDIO_LISTENER_KEYS: ReadonlySet<string> = new Set<string>([
  'listenerId',
  'projectId',
  'entityId',
  'enabled',
  'masterGain',
  'position',
  'forward',
  'up',
  'velocity',
]);

export function createDeterministicAudioListenerId(
  projectId: string,
  entityId: string
): AudioListenerId {
  return createAudioId(
    'listener',
    `${projectId.trim()}::${entityId.trim()}`
  );
}

export function validateAudioListenerDescriptor(
  candidate: unknown
): AudioValidationResult<AudioListenerDescriptor> {
  if (!isPlainAudioObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['AudioListenerDescriptor must be a non-null plain object.'],
    };
  }

  const errors: string[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_AUDIO_LISTENER_KEYS.has(key)) {
      errors.push(`Unexpected property '${key}' in AudioListenerDescriptor.`);
    }
  }

  if (
    typeof candidate.projectId !== 'string' ||
    candidate.projectId.trim().length === 0
  ) {
    errors.push('AudioListenerDescriptor.projectId must be a non-empty string.');
  } else {
    const sec = isForbiddenAudioInputString(candidate.projectId);
    if (sec.forbidden) errors.push(sec.reason!);
  }

  if (!isValidEntityId(candidate.entityId)) {
    errors.push(
      `Invalid AudioListenerDescriptor.entityId '${String(candidate.entityId)}'. Expected ent_<16-hex>.`
    );
  }

  const resolvedListenerId =
    candidate.listenerId !== undefined
      ? candidate.listenerId
      : typeof candidate.projectId === 'string' &&
          isValidEntityId(candidate.entityId)
        ? createDeterministicAudioListenerId(
            candidate.projectId,
            candidate.entityId
          )
        : '';

  if (!isValidAudioListenerId(resolvedListenerId)) {
    errors.push(
      `Invalid AudioListenerDescriptor.listenerId '${String(resolvedListenerId)}'. Expected listener_<16-hex>.`
    );
  }

  const enabled = candidate.enabled !== undefined ? candidate.enabled : true;
  if (typeof enabled !== 'boolean') {
    errors.push('AudioListenerDescriptor.enabled must be a boolean.');
  }

  const masterGain =
    candidate.masterGain !== undefined ? candidate.masterGain : 1.0;
  if (!isFiniteAudioNumber(masterGain) || masterGain < 0 || masterGain > 4.0) {
    errors.push(
      'AudioListenerDescriptor.masterGain must be a finite number in [0, 4].'
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

  const fwdCheck = validateVector3(
    candidate.forward !== undefined
      ? candidate.forward
      : Object.freeze({ x: 0, y: 0, z: -1 })
  );
  let normalizedForward: Vector3 = Object.freeze({ x: 0, y: 0, z: -1 });
  if (!fwdCheck.valid || !fwdCheck.value) {
    errors.push(...fwdCheck.errors.map((e) => `forward: ${e}`));
  } else {
    const norm = normalizeVector3(fwdCheck.value);
    if (norm.length <= 1e-6) {
      errors.push('AudioListenerDescriptor.forward cannot be a zero vector.');
    } else {
      normalizedForward = norm.normalized;
    }
  }

  const upCheck = validateVector3(
    candidate.up !== undefined
      ? candidate.up
      : Object.freeze({ x: 0, y: 1, z: 0 })
  );
  let normalizedUp: Vector3 = Object.freeze({ x: 0, y: 1, z: 0 });
  if (!upCheck.valid || !upCheck.value) {
    errors.push(...upCheck.errors.map((e) => `up: ${e}`));
  } else {
    const norm = normalizeVector3(upCheck.value);
    if (norm.length <= 1e-6) {
      errors.push('AudioListenerDescriptor.up cannot be a zero vector.');
    } else {
      normalizedUp = norm.normalized;
    }
  }

  const velCheck = validateVector3(
    candidate.velocity !== undefined
      ? candidate.velocity
      : createDefaultVector3()
  );
  if (!velCheck.valid || !velCheck.value) {
    errors.push(...velCheck.errors.map((e) => `velocity: ${e}`));
  }

  if (errors.length > 0 || !posCheck.value || !velCheck.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      listenerId: resolvedListenerId as AudioListenerId,
      projectId: (candidate.projectId as string).trim(),
      entityId: candidate.entityId as string,
      enabled: enabled as boolean,
      masterGain: masterGain as number,
      position: posCheck.value,
      forward: normalizedForward,
      up: normalizedUp,
      velocity: velCheck.value,
    }),
    errors: [],
  };
}

/**
 * Deterministically selects the single active `AudioListenerDescriptor` from a list
 * of listeners (sorted by `entityId ASC`, then `listenerId ASC`).
 */
export function selectActiveAudioListener(
  listeners: readonly AudioListenerDescriptor[]
): {
  readonly activeListener: AudioListenerDescriptor | null;
  readonly duplicateEnabledListenerIds: readonly AudioListenerId[];
} {
  const enabledSorted = listeners
    .filter((l) => l.enabled)
    .slice()
    .sort((a, b) => {
      const entCmp = a.entityId.localeCompare(b.entityId);
      if (entCmp !== 0) return entCmp;
      return a.listenerId.localeCompare(b.listenerId);
    });

  if (enabledSorted.length === 0) {
    return {
      activeListener: null,
      duplicateEnabledListenerIds: [],
    };
  }

  return {
    activeListener: enabledSorted[0],
    duplicateEnabledListenerIds: Object.freeze(
      enabledSorted.slice(1).map((l) => l.listenerId)
    ),
  };
}
