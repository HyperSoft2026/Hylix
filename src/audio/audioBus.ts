import {
  AudioBusId,
  AudioValidationResult,
  CANONICAL_AUDIO_BUS_NAMES,
  clampAudioNumber,
  createAudioId,
  isFiniteAudioNumber,
  isForbiddenAudioInputString,
  isPlainAudioObject,
  isValidAudioBusId,
} from './audioTypes';

/**
 * Hylix V1.0.0 — Phase 07: Hierarchical Audio Mixer & Bus Graph
 *
 * Supports canonical buses (`Master`, `Music`, `SFX`, `Voice`, `UI`, `Ambience`)
 * and custom project buses with cycle detection, mute/solo propagation, and
 * deterministic effective gain calculation.
 */

export const MAX_AUDIO_BUS_VOLUME = 4.0;

export interface AudioBusDescriptor {
  readonly busId: AudioBusId;
  readonly projectId: string;
  readonly name: string;
  readonly parentBusId: AudioBusId | null;
  readonly volume: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly bypassEffects: boolean;
}

const ALLOWED_AUDIO_BUS_KEYS: ReadonlySet<string> = new Set<string>([
  'busId',
  'projectId',
  'name',
  'parentBusId',
  'volume',
  'muted',
  'solo',
  'bypassEffects',
]);

export function createDeterministicAudioBusId(
  projectId: string,
  busName: string
): AudioBusId {
  return createAudioId('bus', `${projectId.trim()}::${busName.trim()}`);
}

export function validateAudioBusDescriptor(
  candidate: unknown
): AudioValidationResult<AudioBusDescriptor> {
  if (!isPlainAudioObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['AudioBusDescriptor must be a non-null plain object.'],
    };
  }

  const errors: string[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_AUDIO_BUS_KEYS.has(key)) {
      errors.push(`Unexpected property '${key}' in AudioBusDescriptor.`);
    }
  }

  if (
    typeof candidate.projectId !== 'string' ||
    candidate.projectId.trim().length === 0
  ) {
    errors.push('AudioBusDescriptor.projectId must be a non-empty string.');
  } else {
    const sec = isForbiddenAudioInputString(candidate.projectId);
    if (sec.forbidden) errors.push(sec.reason!);
  }

  if (
    typeof candidate.name !== 'string' ||
    candidate.name.trim().length === 0 ||
    candidate.name.trim().length > 64
  ) {
    errors.push(
      'AudioBusDescriptor.name must be a non-empty string (1..64 chars).'
    );
  } else {
    const sec = isForbiddenAudioInputString(candidate.name);
    if (sec.forbidden) errors.push(sec.reason!);
  }

  const resolvedBusId =
    candidate.busId !== undefined
      ? candidate.busId
      : typeof candidate.projectId === 'string' &&
          typeof candidate.name === 'string'
        ? createDeterministicAudioBusId(candidate.projectId, candidate.name)
        : '';

  if (!isValidAudioBusId(resolvedBusId)) {
    errors.push(
      `Invalid AudioBusDescriptor.busId '${String(resolvedBusId)}'. Expected bus_<16-hex>.`
    );
  }

  const parentBusId =
    candidate.parentBusId !== undefined ? candidate.parentBusId : null;
  if (parentBusId !== null && !isValidAudioBusId(parentBusId)) {
    errors.push(
      `Invalid AudioBusDescriptor.parentBusId '${String(parentBusId)}'. Expected bus_<16-hex> or null.`
    );
  }
  if (parentBusId !== null && parentBusId === resolvedBusId) {
    errors.push(`AudioBus '${String(resolvedBusId)}' cannot be its own parent.`);
  }

  const volume = candidate.volume !== undefined ? candidate.volume : 1.0;
  if (
    !isFiniteAudioNumber(volume) ||
    volume < 0 ||
    volume > MAX_AUDIO_BUS_VOLUME
  ) {
    errors.push(
      `AudioBusDescriptor.volume must be a finite number in [0, ${MAX_AUDIO_BUS_VOLUME}].`
    );
  }

  const muted = candidate.muted !== undefined ? candidate.muted : false;
  if (typeof muted !== 'boolean') {
    errors.push('AudioBusDescriptor.muted must be a boolean.');
  }

  const solo = candidate.solo !== undefined ? candidate.solo : false;
  if (typeof solo !== 'boolean') {
    errors.push('AudioBusDescriptor.solo must be a boolean.');
  }

  const bypassEffects =
    candidate.bypassEffects !== undefined ? candidate.bypassEffects : false;
  if (typeof bypassEffects !== 'boolean') {
    errors.push('AudioBusDescriptor.bypassEffects must be a boolean.');
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      busId: resolvedBusId as AudioBusId,
      projectId: (candidate.projectId as string).trim(),
      name: (candidate.name as string).trim(),
      parentBusId: parentBusId as AudioBusId | null,
      volume: volume as number,
      muted: muted as boolean,
      solo: solo as boolean,
      bypassEffects: bypassEffects as boolean,
    }),
    errors: [],
  };
}

/**
 * Validates an entire collection of Audio Buses for:
 * - Single `Master` root bus (`parentBusId === null`)
 * - No orphan buses (`parentBusId` must exist in the graph)
 * - No self-parenting or circular routing (`A -> B -> A` or `A -> B -> C -> A`)
 */
export function validateAudioBusHierarchy(
  buses: readonly AudioBusDescriptor[]
): {
  readonly valid: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];
  const byId = new Map<AudioBusId, AudioBusDescriptor>();
  const byName = new Map<string, AudioBusDescriptor>();

  for (const bus of buses) {
    if (byId.has(bus.busId)) {
      errors.push(`Duplicate AudioBusId '${bus.busId}' in bus graph.`);
    }
    if (byName.has(bus.name.toLowerCase())) {
      errors.push(`Duplicate AudioBus name '${bus.name}' in bus graph.`);
    }
    byId.set(bus.busId, bus);
    byName.set(bus.name.toLowerCase(), bus);
  }

  let rootCount = 0;
  for (const bus of buses) {
    if (bus.parentBusId === null) {
      rootCount += 1;
      if (bus.name !== 'Master') {
        errors.push(
          `Only 'Master' bus may have parentBusId === null (found '${bus.name}').`
        );
      }
    } else {
      if (bus.parentBusId === bus.busId) {
        errors.push(`AudioBus '${bus.name}' cannot parent itself.`);
      } else if (!byId.has(bus.parentBusId)) {
        errors.push(
          `AudioBus '${bus.name}' references non-existent parentBusId '${bus.parentBusId}'.`
        );
      }
    }
  }

  if (buses.length > 0 && rootCount !== 1) {
    errors.push(
      `AudioBusGraph must have exactly 1 root 'Master' bus (found ${rootCount}).`
    );
  }

  // DFS cycle detection along parent pointers
  for (const bus of buses) {
    const visited = new Set<AudioBusId>();
    let cursor: AudioBusDescriptor | undefined = bus;
    while (cursor && cursor.parentBusId !== null) {
      if (visited.has(cursor.busId)) {
        errors.push(
          `Circular AudioBus routing detected involving bus '${bus.name}' (${bus.busId}).`
        );
        break;
      }
      visited.add(cursor.busId);
      cursor = byId.get(cursor.parentBusId);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Creates the canonical default Hylix Audio Bus hierarchy for a project:
 * `Master` (root) <- [`Music`, `SFX`, `Voice`, `UI`, `Ambience`]
 */
export function createDefaultProjectAudioBuses(
  projectId: string
): readonly AudioBusDescriptor[] {
  const masterId = createDeterministicAudioBusId(projectId, 'Master');
  const buses: AudioBusDescriptor[] = [];

  for (const name of CANONICAL_AUDIO_BUS_NAMES) {
    const isMaster = name === 'Master';
    const busId = isMaster
      ? masterId
      : createDeterministicAudioBusId(projectId, name);
    buses.push(
      Object.freeze({
        busId,
        projectId: projectId.trim(),
        name,
        parentBusId: isMaster ? null : masterId,
        volume: 1.0,
        muted: false,
        solo: false,
        bypassEffects: false,
      })
    );
  }

  return Object.freeze(buses);
}

/**
 * Computes the effective gain (`0..MAX_AUDIO_BUS_VOLUME`) of a target bus by walking
 * its ancestor chain up to `Master`, respecting `muted`, `solo`, and `masterVolume`.
 */
export function computeEffectiveBusVolume(
  busIdOrName: string,
  buses: readonly AudioBusDescriptor[],
  sceneMasterVolume = 1.0
): number {
  if (!isFiniteAudioNumber(sceneMasterVolume) || sceneMasterVolume <= 0) {
    return 0;
  }

  const byId = new Map<AudioBusId, AudioBusDescriptor>();
  const byName = new Map<string, AudioBusDescriptor>();
  for (const b of buses) {
    byId.set(b.busId, b);
    byName.set(b.name.toLowerCase(), b);
  }

  const target =
    byId.get(busIdOrName as AudioBusId) ??
    byName.get(busIdOrName.trim().toLowerCase());
  if (!target) {
    return 0;
  }

  // Build ancestor chain from target -> Master
  const chain: AudioBusDescriptor[] = [];
  const seen = new Set<AudioBusId>();
  let cursor: AudioBusDescriptor | undefined = target;
  while (cursor) {
    if (seen.has(cursor.busId)) {
      return 0; // Safety guard against cycles
    }
    seen.add(cursor.busId);
    chain.push(cursor);
    cursor = cursor.parentBusId ? byId.get(cursor.parentBusId) : undefined;
  }

  // Check if any bus in the graph has solo enabled (excluding Master)
  const anySoloActive = buses.some((b) => b.name !== 'Master' && b.solo);
  if (anySoloActive) {
    // A bus is audible under solo if it or one of its ancestors is soloed,
    // OR (if querying a parent bus like Master) one of its descendants is soloed.
    const chainHasSolo = chain.some((b) => b.solo);
    if (!chainHasSolo) {
      const hasSoloDescendant = buses.some((b) => {
        if (!b.solo) return false;
        let p: AudioBusDescriptor | undefined = b;
        const visited = new Set<AudioBusId>();
        while (p && !visited.has(p.busId)) {
          visited.add(p.busId);
          if (p.busId === target.busId) return true;
          p = p.parentBusId ? byId.get(p.parentBusId) : undefined;
        }
        return false;
      });
      if (!hasSoloDescendant) {
        return 0;
      }
    }
  }

  let effectiveGain = clampAudioNumber(
    sceneMasterVolume,
    0,
    MAX_AUDIO_BUS_VOLUME
  );
  for (const node of chain) {
    if (node.muted) {
      return 0;
    }
    effectiveGain *= clampAudioNumber(node.volume, 0, MAX_AUDIO_BUS_VOLUME);
  }

  return clampAudioNumber(effectiveGain, 0, MAX_AUDIO_BUS_VOLUME);
}
