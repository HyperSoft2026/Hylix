import {
  AudioAttenuationModel,
  AudioSpatialMode,
  clampAudioNumber,
  crossVector3,
  dotVector3,
  isFiniteAudioNumber,
  normalizeVector3,
  subtractVector3,
  Vector3,
} from './audioTypes';

/**
 * Hylix V1.0.0 — Phase 07: 2D & 3D Spatial Audio Attenuation & Stereo Panning
 *
 * Pure, deterministic spatial audio calculations owned by Hylix.
 */

export interface SpatialListenerParameters {
  readonly position: Vector3;
  readonly forward: Vector3;
  readonly up: Vector3;
  readonly masterGain: number;
  readonly enabled: boolean;
}

export interface SpatialSourceParameters {
  readonly spatialMode: AudioSpatialMode;
  readonly position: Vector3;
  readonly volume: number;
  readonly pan: number;
  readonly muted: boolean;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly rolloffFactor: number;
  readonly attenuationModel: AudioAttenuationModel;
}

export interface SpatialAudioMixOutput {
  readonly distance: number;
  readonly distanceAttenuation: number;
  readonly effectiveVolume: number;
  readonly effectivePan: number;
  readonly leftChannelGain: number;
  readonly rightChannelGain: number;
}

export function computeDistance2D(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function computeDistance3D(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Computes deterministic distance attenuation in `[0, 1]` for 2D and 3D spatial sources.
 * - At `distance <= minDistance`, attenuation is `1.0`.
 * - At `distance >= maxDistance`, attenuation is `0.0`.
 */
export function computeDistanceAttenuation(
  distance: number,
  minDistance: number,
  maxDistance: number,
  rolloffFactor: number,
  model: AudioAttenuationModel = 'linear'
): number {
  if (
    !isFiniteAudioNumber(distance) ||
    !isFiniteAudioNumber(minDistance) ||
    !isFiniteAudioNumber(maxDistance) ||
    !isFiniteAudioNumber(rolloffFactor) ||
    minDistance < 0 ||
    maxDistance <= minDistance ||
    rolloffFactor < 0
  ) {
    return 0;
  }

  if (distance <= minDistance) {
    return 1.0;
  }

  if (distance >= maxDistance) {
    return 0.0;
  }

  if (rolloffFactor === 0) {
    return 1.0;
  }

  const span = maxDistance - minDistance;
  if (span <= 1e-9) {
    return 0.0;
  }

  switch (model) {
    case 'linear': {
      const normalized = (distance - minDistance) / span;
      return clampAudioNumber(1.0 - rolloffFactor * normalized, 0.0, 1.0);
    }
    case 'inverse': {
      const safeMin = Math.max(minDistance, 0.0001);
      const gain =
        safeMin / (safeMin + rolloffFactor * (distance - safeMin));
      return clampAudioNumber(gain, 0.0, 1.0);
    }
    case 'exponential': {
      const safeMin = Math.max(minDistance, 0.0001);
      const ratio = distance / safeMin;
      const gain = Math.pow(ratio, -rolloffFactor);
      return clampAudioNumber(gain, 0.0, 1.0);
    }
    default:
      return 0.0;
  }
}

/**
 * Computes 2D horizontal stereo pan in `[-1, 1]` relative to listener X position.
 */
export function computeSpatialStereoPan2D(
  sourcePosition: Vector3,
  listenerPosition: Vector3,
  maxDistance: number
): number {
  if (!isFiniteAudioNumber(maxDistance) || maxDistance <= 0) {
    return 0;
  }
  const dx = sourcePosition.x - listenerPosition.x;
  return clampAudioNumber(dx / maxDistance, -1.0, 1.0);
}

/**
 * Computes 3D directional stereo pan in `[-1, 1]` by projecting the normalized
 * listener-to-source direction onto the listener's right basis vector (`forward x up`).
 */
export function computeSpatialStereoPan3D(
  sourcePosition: Vector3,
  listener: Pick<SpatialListenerParameters, 'position' | 'forward' | 'up'>
): number {
  const toSource = subtractVector3(sourcePosition, listener.position);
  const { normalized: dirToSource, length } = normalizeVector3(toSource);
  if (length <= 1e-6) {
    return 0;
  }

  const rightRaw = crossVector3(listener.forward, listener.up);
  const { normalized: rightVec, length: rightLen } = normalizeVector3(rightRaw);
  if (rightLen <= 1e-6) {
    return 0;
  }

  const dotRight = dotVector3(dirToSource, rightVec);
  return clampAudioNumber(dotRight, -1.0, 1.0);
}

/**
 * Computes the complete spatial mix output (`distance`, `distanceAttenuation`,
 * `effectiveVolume`, `effectivePan`, `leftChannelGain`, `rightChannelGain`).
 */
export function computeSpatialMixResult(
  source: SpatialSourceParameters,
  listener: SpatialListenerParameters | null,
  busEffectiveVolume = 1.0
): SpatialAudioMixOutput {
  if (source.muted || busEffectiveVolume <= 0 || source.volume <= 0) {
    return Object.freeze({
      distance: 0,
      distanceAttenuation: 0,
      effectiveVolume: 0,
      effectivePan: clampAudioNumber(source.pan, -1, 1),
      leftChannelGain: 0,
      rightChannelGain: 0,
    });
  }

  if (listener && !listener.enabled) {
    return Object.freeze({
      distance: 0,
      distanceAttenuation: 0,
      effectiveVolume: 0,
      effectivePan: clampAudioNumber(source.pan, -1, 1),
      leftChannelGain: 0,
      rightChannelGain: 0,
    });
  }

  const listenerGain = listener
    ? clampAudioNumber(listener.masterGain, 0, 4)
    : 1.0;

  if (source.spatialMode === 'nonSpatial' || !listener) {
    const effectiveVolume = clampAudioNumber(
      source.volume * busEffectiveVolume * listenerGain,
      0,
      4
    );
    const effectivePan = clampAudioNumber(source.pan, -1, 1);
    const leftWeight = clampAudioNumber(
      effectivePan <= 0 ? 1.0 : 1.0 - effectivePan,
      0,
      1
    );
    const rightWeight = clampAudioNumber(
      effectivePan >= 0 ? 1.0 : 1.0 + effectivePan,
      0,
      1
    );
    return Object.freeze({
      distance: 0,
      distanceAttenuation: 1.0,
      effectiveVolume,
      effectivePan,
      leftChannelGain: effectiveVolume * leftWeight,
      rightChannelGain: effectiveVolume * rightWeight,
    });
  }

  const distance =
    source.spatialMode === 'spatial2D'
      ? computeDistance2D(source.position, listener.position)
      : computeDistance3D(source.position, listener.position);

  const distanceAttenuation = computeDistanceAttenuation(
    distance,
    source.minDistance,
    source.maxDistance,
    source.rolloffFactor,
    source.attenuationModel
  );

  const spatialPan =
    source.spatialMode === 'spatial2D'
      ? computeSpatialStereoPan2D(
          source.position,
          listener.position,
          source.maxDistance
        )
      : computeSpatialStereoPan3D(source.position, listener);

  const effectivePan = clampAudioNumber(source.pan + spatialPan, -1.0, 1.0);
  const effectiveVolume = clampAudioNumber(
    source.volume * busEffectiveVolume * listenerGain * distanceAttenuation,
    0,
    4
  );

  const leftWeight = clampAudioNumber(
    effectivePan <= 0 ? 1.0 : 1.0 - effectivePan,
    0,
    1
  );
  const rightWeight = clampAudioNumber(
    effectivePan >= 0 ? 1.0 : 1.0 + effectivePan,
    0,
    1
  );

  return Object.freeze({
    distance,
    distanceAttenuation,
    effectiveVolume,
    effectivePan,
    leftChannelGain: effectiveVolume * leftWeight,
    rightChannelGain: effectiveVolume * rightWeight,
  });
}
