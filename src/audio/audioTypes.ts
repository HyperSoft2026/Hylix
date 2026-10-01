import { computeDeterministicChecksum } from '../storage/atomicStorage';
import {
  createDefaultVector2,
  createDefaultVector3,
  validateVector2,
  validateVector3,
  Vector2,
  Vector3,
} from '../rendering/matrices';

/**
 * Hylix V1.0.0 — Phase 07: Audio Foundation Types, Deterministic IDs & State Transitions
 *
 * Built from scratch by HyperSoft. Zero external audio engines or libraries
 * (No Unity, Unreal, Godot, FMOD, Wwise, OpenAL, SDL_mixer, Howler.js, or Tone.js).
 */

export {
  createDefaultVector2,
  createDefaultVector3,
  validateVector2,
  validateVector3,
};
export type { Vector2, Vector3 };

export type AudioIdPrefix =
  | 'audio'
  | 'sound'
  | 'bus'
  | 'source'
  | 'listener'
  | 'voice';

export type AudioWorldId = `audio_${string}`;
export type SoundResourceId = `sound_${string}`;
export type AudioBusId = `bus_${string}`;
export type AudioSourceId = `source_${string}`;
export type AudioListenerId = `listener_${string}`;
export type AudioVoiceId = `voice_${string}`;

export type SupportedAudioFormat = 'wav' | 'ogg' | 'mp3';

export type AudioLoadMode = 'memory' | 'streaming';

export type AudioSpatialMode = 'nonSpatial' | 'spatial2D' | 'spatial3D';

export type AudioAttenuationModel = 'linear' | 'inverse' | 'exponential';

export type VoiceEvictionPolicy =
  | 'reject'
  | 'replaceLowestPriority'
  | 'stopOldestEqualPriority';

export type AudioWorldState =
  | 'uninitialized'
  | 'ready'
  | 'processing'
  | 'paused'
  | 'shutdown';

export type AudioPlaybackState = 'stopped' | 'playing' | 'paused';

export type CanonicalAudioBusName =
  | 'Master'
  | 'Music'
  | 'SFX'
  | 'Voice'
  | 'UI'
  | 'Ambience';

export interface AudioValidationResult<T = unknown> {
  readonly valid: boolean;
  readonly value: T | null;
  readonly errors: readonly string[];
}

export const SUPPORTED_AUDIO_FORMATS: ReadonlySet<SupportedAudioFormat> =
  new Set<SupportedAudioFormat>(['wav', 'ogg', 'mp3']);

export const CANONICAL_AUDIO_BUS_NAMES: readonly CanonicalAudioBusName[] =
  Object.freeze(['Master', 'Music', 'SFX', 'Voice', 'UI', 'Ambience'] as const);

const AUDIO_ID_REGEX_BY_PREFIX: Readonly<Record<AudioIdPrefix, RegExp>> =
  Object.freeze({
    audio: /^audio_[a-f0-9]{16}$/i,
    sound: /^sound_[a-f0-9]{16}$/i,
    bus: /^bus_[a-f0-9]{16}$/i,
    source: /^source_[a-f0-9]{16}$/i,
    listener: /^listener_[a-f0-9]{16}$/i,
    voice: /^voice_[a-f0-9]{16}$/i,
  });

const ALLOWED_AUDIO_WORLD_TRANSITIONS: Readonly<
  Record<AudioWorldState, readonly AudioWorldState[]>
> = Object.freeze({
  uninitialized: Object.freeze(['ready', 'shutdown'] as const),
  ready: Object.freeze(['processing', 'paused', 'shutdown'] as const),
  processing: Object.freeze(['ready', 'shutdown'] as const),
  paused: Object.freeze(['ready', 'shutdown'] as const),
  shutdown: Object.freeze([] as const),
});

const ALLOWED_PLAYBACK_STATE_TRANSITIONS: Readonly<
  Record<AudioPlaybackState, readonly AudioPlaybackState[]>
> = Object.freeze({
  stopped: Object.freeze(['playing'] as const),
  playing: Object.freeze(['paused', 'stopped'] as const),
  paused: Object.freeze(['playing', 'stopped'] as const),
});

const FORBIDDEN_AUDIO_STRING_PATTERNS: readonly RegExp[] = Object.freeze([
  /\0/,
  /(^|[\\/])\.\.([\\/]|$)/,
  /^(https?|wss?|ftp|file):\/\//i,
  /^\/(sdcard|storage|system|data|proc|dev|etc|root|mnt)(\/|$)/i,
  /^[a-zA-Z]:[\\/]/,
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /\bchild_process\b/i,
  /\b(sh|bash|cmd|powershell)\s+-c\b/i,
  /\.(jks|keystore|p12|pfx|pem)$/i,
  /signing\.properties$/i,
]);

/**
 * Generates a deterministic Audio ID (`<prefix>_<16-hex>`) from a canonical seed.
 * Never uses `Math.random()` or array indices.
 */
export function createAudioId<TPrefix extends AudioIdPrefix>(
  prefix: TPrefix,
  canonicalSeed: string
): `${TPrefix}_${string}` {
  const normalizedSeed = canonicalSeed.trim();
  const hex = computeDeterministicChecksum(
    `hylix_audio_id::${prefix}::${normalizedSeed}`
  );
  return `${prefix}_${hex}` as `${TPrefix}_${string}`;
}

export function isValidAudioId<TPrefix extends AudioIdPrefix>(
  prefix: TPrefix,
  candidate: unknown
): candidate is `${TPrefix}_${string}` {
  if (typeof candidate !== 'string') return false;
  const regex = AUDIO_ID_REGEX_BY_PREFIX[prefix];
  return Boolean(regex && regex.test(candidate));
}

export function isValidAudioWorldId(
  candidate: unknown
): candidate is AudioWorldId {
  return isValidAudioId('audio', candidate);
}

export function isValidSoundResourceId(
  candidate: unknown
): candidate is SoundResourceId {
  return isValidAudioId('sound', candidate);
}

export function isValidAudioBusId(candidate: unknown): candidate is AudioBusId {
  return isValidAudioId('bus', candidate);
}

export function isValidAudioSourceId(
  candidate: unknown
): candidate is AudioSourceId {
  return isValidAudioId('source', candidate);
}

export function isValidAudioListenerId(
  candidate: unknown
): candidate is AudioListenerId {
  return isValidAudioId('listener', candidate);
}

export function isValidAudioVoiceId(
  candidate: unknown
): candidate is AudioVoiceId {
  return isValidAudioId('voice', candidate);
}

export function isValidAudioWorldStateTransition(
  from: AudioWorldState,
  to: AudioWorldState
): boolean {
  const allowed = ALLOWED_AUDIO_WORLD_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

export function isValidAudioPlaybackStateTransition(
  from: AudioPlaybackState,
  to: AudioPlaybackState
): boolean {
  const allowed = ALLOWED_PLAYBACK_STATE_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

export function isFiniteAudioNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function clampAudioNumber(
  value: number,
  min: number,
  max: number
): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function isPlainAudioObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isForbiddenAudioInputString(candidate: string): {
  readonly forbidden: boolean;
  readonly reason?: string;
} {
  for (const pattern of FORBIDDEN_AUDIO_STRING_PATTERNS) {
    if (pattern.test(candidate)) {
      return {
        forbidden: true,
        reason: `String '${candidate}' violates Hylix Audio Local-First/Security policy (${pattern.source}).`,
      };
    }
  }
  return { forbidden: false };
}

export function classifyAudioFormatFromPath(
  pathOrName: string
): SupportedAudioFormat | null {
  if (typeof pathOrName !== 'string') return null;
  const clean = pathOrName.trim().toLowerCase();
  const dotIdx = clean.lastIndexOf('.');
  if (dotIdx < 0) return null;
  const ext = clean.slice(dotIdx + 1);
  if (SUPPORTED_AUDIO_FORMATS.has(ext as SupportedAudioFormat)) {
    return ext as SupportedAudioFormat;
  }
  return null;
}

export function dotVector3(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossVector3(a: Vector3, b: Vector3): Vector3 {
  return Object.freeze({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
}

export function subtractVector3(a: Vector3, b: Vector3): Vector3 {
  return Object.freeze({
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  });
}

export function lengthVector3(v: Vector3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function normalizeVector3(v: Vector3): {
  readonly normalized: Vector3;
  readonly length: number;
} {
  const len = lengthVector3(v);
  if (len <= 1e-9) {
    return {
      normalized: Object.freeze({ x: 0, y: 0, z: 0 }),
      length: 0,
    };
  }
  return {
    normalized: Object.freeze({
      x: v.x / len,
      y: v.y / len,
      z: v.z / len,
    }),
    length: len,
  };
}
