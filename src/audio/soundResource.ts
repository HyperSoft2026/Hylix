import {
  AudioAssetSubtype,
  HylixAssetRegistry,
  isValidAssetId,
} from '../assets/assetRegistry';
import { isValidContentHash } from '../assets/contentHash';
import {
  ResourceHandle,
  ResourceManager,
  ResourceState,
} from '../assets/resourceManager';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  AudioLoadMode,
  AudioValidationResult,
  classifyAudioFormatFromPath,
  createAudioId,
  isFiniteAudioNumber,
  isForbiddenAudioInputString,
  isPlainAudioObject,
  isValidSoundResourceId,
  SoundResourceId,
  SUPPORTED_AUDIO_FORMATS,
  SupportedAudioFormat,
} from './audioTypes';

/**
 * Hylix V1.0.0 — Phase 07: Sound Resource Descriptor & Sound Resource Management
 *
 * Strictly separates:
 * - `AudioAsset` (`AssetMetadataRecord` in `HylixAssetRegistry` on disk)
 * - `SoundResourceDescriptor` (runtime/editor representation managed via Phase 04 `ResourceManager`)
 */

export const DEFAULT_AUDIO_SAMPLE_RATE_HZ = 44100;
export const MIN_AUDIO_SAMPLE_RATE_HZ = 8000;
export const MAX_AUDIO_SAMPLE_RATE_HZ = 192000;
export const DEFAULT_AUDIO_DURATION_SECONDS = 1.0;

export interface AudioStreamMetadata {
  readonly format: SupportedAudioFormat;
  readonly subtype: AudioAssetSubtype;
  readonly loadMode: AudioLoadMode;
  readonly durationSeconds: number;
  readonly sampleRateHz: number;
  readonly channels: 1 | 2;
}

export interface SoundResourceDescriptor {
  readonly soundResourceId: SoundResourceId;
  readonly projectId: string;
  readonly assetId: string;
  readonly resourceId: string;
  readonly format: SupportedAudioFormat;
  readonly subtype: AudioAssetSubtype;
  readonly loadMode: AudioLoadMode;
  readonly durationSeconds: number;
  readonly sampleRateHz: number;
  readonly channels: 1 | 2;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly state: ResourceState;
  readonly referenceCount: number;
}

const VALID_AUDIO_SUBTYPES: ReadonlySet<AudioAssetSubtype> =
  new Set<AudioAssetSubtype>([
    'audio',
    'music',
    'soundEffect',
    'voice',
    'ambience',
  ]);

const FORBIDDEN_RAW_PATH_KEYS: ReadonlySet<string> = new Set<string>([
  'soundPath',
  'audioPath',
  'filePath',
  'clipPath',
  'path',
  'url',
  'uri',
]);

const ALLOWED_SOUND_RESOURCE_KEYS: ReadonlySet<string> = new Set<string>([
  'soundResourceId',
  'projectId',
  'assetId',
  'resourceId',
  'format',
  'subtype',
  'loadMode',
  'durationSeconds',
  'sampleRateHz',
  'channels',
  'contentHash',
  'sizeBytes',
  'state',
  'referenceCount',
]);

export function createDeterministicSoundResourceId(
  projectId: string,
  assetId: string
): SoundResourceId {
  return createAudioId('sound', `${projectId.trim()}::${assetId.trim()}`);
}

/**
 * Validates audio stream metadata (`format`, `subtype`, `loadMode`, `durationSeconds`, `sampleRateHz`, `channels`).
 */
export function validateAudioStreamMetadata(
  candidate: unknown,
  fallbackFormat: SupportedAudioFormat = 'ogg'
): AudioValidationResult<AudioStreamMetadata> {
  if (!isPlainAudioObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['Audio metadata must be a non-null plain object.'],
    };
  }

  const errors: string[] = [];

  for (const key of Object.keys(candidate)) {
    if (FORBIDDEN_RAW_PATH_KEYS.has(key)) {
      errors.push(
        `Forbidden raw file path property '${key}' in audio metadata; use deterministic assetId.`
      );
    }
  }

  const rawFormat =
    candidate.format !== undefined ? candidate.format : fallbackFormat;
  if (
    typeof rawFormat !== 'string' ||
    !SUPPORTED_AUDIO_FORMATS.has(rawFormat as SupportedAudioFormat)
  ) {
    errors.push(
      `Unsupported audio format '${String(rawFormat)}'. Supported formats: wav, ogg, mp3.`
    );
  }

  const rawSubtype =
    candidate.subtype !== undefined ? candidate.subtype : 'audio';
  if (
    typeof rawSubtype !== 'string' ||
    !VALID_AUDIO_SUBTYPES.has(rawSubtype as AudioAssetSubtype)
  ) {
    errors.push(
      `Invalid audio subtype '${String(rawSubtype)}'. Expected audio, music, soundEffect, voice, or ambience.`
    );
  }

  const defaultLoadMode: AudioLoadMode =
    rawSubtype === 'music' || rawSubtype === 'ambience'
      ? 'streaming'
      : 'memory';
  const rawLoadMode =
    candidate.loadMode !== undefined ? candidate.loadMode : defaultLoadMode;
  if (rawLoadMode !== 'memory' && rawLoadMode !== 'streaming') {
    errors.push(
      `Invalid audio loadMode '${String(rawLoadMode)}'. Expected 'memory' or 'streaming'.`
    );
  }

  const durationSeconds =
    candidate.durationSeconds !== undefined
      ? candidate.durationSeconds
      : DEFAULT_AUDIO_DURATION_SECONDS;
  if (!isFiniteAudioNumber(durationSeconds) || durationSeconds <= 0) {
    errors.push('Audio durationSeconds must be a finite number > 0.');
  }

  const sampleRateHz =
    candidate.sampleRateHz !== undefined
      ? candidate.sampleRateHz
      : DEFAULT_AUDIO_SAMPLE_RATE_HZ;
  if (
    !isFiniteAudioNumber(sampleRateHz) ||
    !Number.isInteger(sampleRateHz) ||
    sampleRateHz < MIN_AUDIO_SAMPLE_RATE_HZ ||
    sampleRateHz > MAX_AUDIO_SAMPLE_RATE_HZ
  ) {
    errors.push(
      `Audio sampleRateHz must be an integer in [${MIN_AUDIO_SAMPLE_RATE_HZ}, ${MAX_AUDIO_SAMPLE_RATE_HZ}].`
    );
  }

  const channels = candidate.channels !== undefined ? candidate.channels : 2;
  if (channels !== 1 && channels !== 2) {
    errors.push('Audio channels must be 1 (mono) or 2 (stereo).');
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      format: rawFormat as SupportedAudioFormat,
      subtype: rawSubtype as AudioAssetSubtype,
      loadMode: rawLoadMode as AudioLoadMode,
      durationSeconds: durationSeconds as number,
      sampleRateHz: sampleRateHz as number,
      channels: channels as 1 | 2,
    }),
    errors: [],
  };
}

/**
 * Validates a `SoundResourceDescriptor`.
 */
export function validateSoundResourceDescriptor(
  candidate: unknown
): AudioValidationResult<SoundResourceDescriptor> {
  if (!isPlainAudioObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['SoundResourceDescriptor must be a non-null plain object.'],
    };
  }

  const errors: string[] = [];

  for (const key of Object.keys(candidate)) {
    if (FORBIDDEN_RAW_PATH_KEYS.has(key)) {
      errors.push(
        `Forbidden raw file path property '${key}' in SoundResourceDescriptor; audio resources must reference assetId.`
      );
    } else if (!ALLOWED_SOUND_RESOURCE_KEYS.has(key)) {
      errors.push(
        `Unexpected property '${key}' in SoundResourceDescriptor.`
      );
    }
  }

  if (
    typeof candidate.projectId !== 'string' ||
    candidate.projectId.trim().length === 0
  ) {
    errors.push('SoundResourceDescriptor.projectId must be a non-empty string.');
  } else {
    const sec = isForbiddenAudioInputString(candidate.projectId);
    if (sec.forbidden) errors.push(sec.reason!);
  }

  if (!isValidAssetId(candidate.assetId)) {
    errors.push(
      `Invalid SoundResourceDescriptor.assetId '${String(candidate.assetId)}'. Expected asset_<16-hex> or ast_<16-hex>.`
    );
  }

  const resolvedSoundId =
    candidate.soundResourceId !== undefined
      ? candidate.soundResourceId
      : typeof candidate.projectId === 'string' && isValidAssetId(candidate.assetId)
        ? createDeterministicSoundResourceId(
            candidate.projectId,
            candidate.assetId
          )
        : '';
  if (!isValidSoundResourceId(resolvedSoundId)) {
    errors.push(
      `Invalid soundResourceId '${String(resolvedSoundId)}'. Expected sound_<16-hex>.`
    );
  }

  if (
    typeof candidate.resourceId !== 'string' ||
    !/^res_[a-f0-9]{16}$/i.test(candidate.resourceId)
  ) {
    errors.push(
      `Invalid SoundResourceDescriptor.resourceId '${String(candidate.resourceId)}'. Expected res_<16-hex>.`
    );
  }

  const streamMetaCheck = validateAudioStreamMetadata({
    format: candidate.format,
    subtype: candidate.subtype,
    loadMode: candidate.loadMode,
    durationSeconds: candidate.durationSeconds,
    sampleRateHz: candidate.sampleRateHz,
    channels: candidate.channels,
  });
  if (!streamMetaCheck.valid || !streamMetaCheck.value) {
    errors.push(...streamMetaCheck.errors);
  }

  if (!isValidContentHash(candidate.contentHash)) {
    errors.push(
      `Invalid SoundResourceDescriptor.contentHash '${String(candidate.contentHash)}'.`
    );
  }

  if (
    typeof candidate.sizeBytes !== 'number' ||
    !Number.isInteger(candidate.sizeBytes) ||
    candidate.sizeBytes < 0
  ) {
    errors.push(
      'SoundResourceDescriptor.sizeBytes must be a non-negative integer.'
    );
  }

  const validStates: ReadonlySet<ResourceState> = new Set([
    'unloaded',
    'loading',
    'loaded',
    'failed',
    'invalidated',
  ]);
  if (
    typeof candidate.state !== 'string' ||
    !validStates.has(candidate.state as ResourceState)
  ) {
    errors.push(
      `Invalid SoundResourceDescriptor.state '${String(candidate.state)}'.`
    );
  }

  if (
    typeof candidate.referenceCount !== 'number' ||
    !Number.isInteger(candidate.referenceCount) ||
    candidate.referenceCount < 0
  ) {
    errors.push(
      'SoundResourceDescriptor.referenceCount must be a non-negative integer.'
    );
  }

  if (errors.length > 0 || !streamMetaCheck.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      soundResourceId: resolvedSoundId as SoundResourceId,
      projectId: (candidate.projectId as string).trim(),
      assetId: candidate.assetId as string,
      resourceId: candidate.resourceId as string,
      format: streamMetaCheck.value.format,
      subtype: streamMetaCheck.value.subtype,
      loadMode: streamMetaCheck.value.loadMode,
      durationSeconds: streamMetaCheck.value.durationSeconds,
      sampleRateHz: streamMetaCheck.value.sampleRateHz,
      channels: streamMetaCheck.value.channels,
      contentHash: candidate.contentHash as string,
      sizeBytes: candidate.sizeBytes as number,
      state: candidate.state as ResourceState,
      referenceCount: candidate.referenceCount as number,
    }),
    errors: [],
  };
}

export interface SoundResourceAcquireResult {
  readonly success: boolean;
  readonly soundResource: SoundResourceDescriptor | null;
  readonly resourceHandle: ResourceHandle | null;
  readonly fromCache: boolean;
  readonly status: 'available' | 'missing' | 'corrupted' | 'invalid';
  readonly errors: readonly string[];
}

/**
 * Coordinates `SoundResourceDescriptor` instances on top of Phase 04 `HylixAssetRegistry`
 * and `ResourceManager` without duplicating asset/resource storage.
 */
export class SoundResourceManager {
  private readonly projectId: string;
  private readonly registry: HylixAssetRegistry;
  private readonly resourceManager: ResourceManager;
  private readonly logger?: RedactedDiagnosticLogger;
  private readonly descriptorsByAssetId = new Map<
    string,
    SoundResourceDescriptor
  >();

  constructor(options: {
    readonly projectId: string;
    readonly registry: HylixAssetRegistry;
    readonly resourceManager: ResourceManager;
    readonly logger?: RedactedDiagnosticLogger;
  }) {
    this.projectId = options.projectId.trim();
    this.registry = options.registry;
    this.resourceManager = options.resourceManager;
    this.logger = options.logger;
  }

  public getProjectId(): string {
    return this.projectId;
  }

  /**
   * Acquires (loads or reuses from cache) a `SoundResourceDescriptor` for `assetId`,
   * enforcing audio format/metadata validation and SHA-256 content hash invalidation.
   */
  public acquireSoundResource(assetId: string): SoundResourceAcquireResult {
    if (!isValidAssetId(assetId)) {
      const msg = `Invalid audio assetId '${String(assetId)}'.`;
      this.logger?.record('audio', 'ERROR', `audio_resource_load_failed: ${msg}`);
      return {
        success: false,
        soundResource: null,
        resourceHandle: null,
        fromCache: false,
        status: 'invalid',
        errors: [msg],
      };
    }

    const assetRecord = this.registry.getAsset(assetId);
    if (!assetRecord) {
      const msg = `Audio asset '${assetId}' is not registered in HylixAssetRegistry.`;
      this.logger?.record('audio', 'ERROR', `audio_resource_load_failed: ${msg}`);
      return {
        success: false,
        soundResource: null,
        resourceHandle: null,
        fromCache: false,
        status: 'missing',
        errors: [msg],
      };
    }

    if (assetRecord.type !== 'audio') {
      const msg = `Asset '${assetId}' has type '${assetRecord.type}', expected 'audio'.`;
      this.logger?.record('audio', 'ERROR', `audio_resource_load_failed: ${msg}`);
      return {
        success: false,
        soundResource: null,
        resourceHandle: null,
        fromCache: false,
        status: 'invalid',
        errors: [msg],
      };
    }

    const pathFormat = classifyAudioFormatFromPath(assetRecord.path);
    if (!pathFormat) {
      const msg = `Audio asset '${assetRecord.path}' has unsupported extension; expected .wav, .ogg, or .mp3.`;
      this.logger?.record('audio', 'ERROR', `audio_resource_load_failed: ${msg}`);
      return {
        success: false,
        soundResource: null,
        resourceHandle: null,
        fromCache: false,
        status: 'invalid',
        errors: [msg],
      };
    }

    const rawMeta = assetRecord.metadata ?? {};
    const metaValidation = validateAudioStreamMetadata(
      {
        format: rawMeta.format ?? pathFormat,
        subtype: rawMeta.subtype ?? 'audio',
        loadMode: rawMeta.loadMode,
        durationSeconds:
          rawMeta.durationSeconds ??
          rawMeta.duration ??
          DEFAULT_AUDIO_DURATION_SECONDS,
        sampleRateHz:
          rawMeta.sampleRateHz ??
          rawMeta.sampleRate ??
          DEFAULT_AUDIO_SAMPLE_RATE_HZ,
        channels: rawMeta.channels ?? 2,
      },
      pathFormat
    );

    if (!metaValidation.valid || !metaValidation.value) {
      this.logger?.record(
        'audio',
        'ERROR',
        `audio_resource_load_failed: ${metaValidation.errors.join('; ')}`
      );
      return {
        success: false,
        soundResource: null,
        resourceHandle: null,
        fromCache: false,
        status: 'invalid',
        errors: metaValidation.errors,
      };
    }

    // Check if an existing descriptor was invalidated by an underlying contentHash change
    const existingDesc = this.descriptorsByAssetId.get(assetId);
    if (
      existingDesc &&
      existingDesc.contentHash !== assetRecord.contentHash
    ) {
      this.resourceManager.invalidateAudio(assetId);
      this.descriptorsByAssetId.set(
        assetId,
        Object.freeze({
          ...existingDesc,
          state: 'invalidated',
        })
      );
    }

    const loadRes = this.resourceManager.loadAudio(assetId);
    if (!loadRes.success || !loadRes.resource) {
      const updatedAsset = this.registry.getAsset(assetId);
      const failureStatus =
        updatedAsset?.importState === 'missing_source' ||
        updatedAsset?.lifecycleState === 'missing'
          ? 'missing'
          : updatedAsset?.importState === 'corrupted' ||
              updatedAsset?.lifecycleState === 'corrupted'
            ? 'corrupted'
            : 'invalid';

      return {
        success: false,
        soundResource: null,
        resourceHandle: loadRes.resource,
        fromCache: false,
        status: failureStatus,
        errors: loadRes.errors,
      };
    }

    const handle = loadRes.resource;
    const descriptorCandidate: SoundResourceDescriptor = {
      soundResourceId: createDeterministicSoundResourceId(
        this.projectId,
        assetId
      ),
      projectId: this.projectId,
      assetId,
      resourceId: handle.resourceId,
      format: metaValidation.value.format,
      subtype: metaValidation.value.subtype,
      loadMode: metaValidation.value.loadMode,
      durationSeconds: metaValidation.value.durationSeconds,
      sampleRateHz: metaValidation.value.sampleRateHz,
      channels: metaValidation.value.channels,
      contentHash: handle.loadedContentHash,
      sizeBytes: handle.sizeBytes,
      state: handle.state,
      referenceCount: handle.referenceCount,
    };

    const descValidation = validateSoundResourceDescriptor(descriptorCandidate);
    if (!descValidation.valid || !descValidation.value) {
      return {
        success: false,
        soundResource: null,
        resourceHandle: handle,
        fromCache: loadRes.fromCache,
        status: 'invalid',
        errors: descValidation.errors,
      };
    }

    this.descriptorsByAssetId.set(assetId, descValidation.value);
    return {
      success: true,
      soundResource: descValidation.value,
      resourceHandle: handle,
      fromCache: loadRes.fromCache,
      status: 'available',
      errors: [],
    };
  }

  public retainSoundResource(assetId: string): {
    readonly success: boolean;
    readonly soundResource: SoundResourceDescriptor | null;
    readonly error?: string;
  } {
    const ret = this.resourceManager.retainAudio(assetId);
    if (!ret.success || !ret.resource) {
      return {
        success: false,
        soundResource: this.descriptorsByAssetId.get(assetId) ?? null,
        error: ret.error,
      };
    }
    const existing = this.descriptorsByAssetId.get(assetId);
    if (!existing) {
      return {
        success: false,
        soundResource: null,
        error: `SoundResourceDescriptor for '${assetId}' is not tracked.`,
      };
    }
    const updated: SoundResourceDescriptor = Object.freeze({
      ...existing,
      state: ret.resource.state,
      referenceCount: ret.referenceCount,
    });
    this.descriptorsByAssetId.set(assetId, updated);
    return { success: true, soundResource: updated };
  }

  public releaseSoundResource(assetId: string): {
    readonly success: boolean;
    readonly referenceCount: number;
    readonly eligibleForUnload: boolean;
    readonly soundResource: SoundResourceDescriptor | null;
    readonly error?: string;
  } {
    const rel = this.resourceManager.releaseAudio(assetId);
    if (!rel.success || !rel.resource) {
      return {
        success: false,
        referenceCount: rel.referenceCount,
        eligibleForUnload: rel.eligibleForUnload,
        soundResource: this.descriptorsByAssetId.get(assetId) ?? null,
        error: rel.error,
      };
    }
    const existing = this.descriptorsByAssetId.get(assetId);
    const updated = existing
      ? Object.freeze({
          ...existing,
          state: rel.resource.state,
          referenceCount: rel.referenceCount,
        })
      : null;
    if (updated) {
      this.descriptorsByAssetId.set(assetId, updated);
    }
    return {
      success: true,
      referenceCount: rel.referenceCount,
      eligibleForUnload: rel.eligibleForUnload,
      soundResource: updated,
    };
  }

  public invalidateSoundResource(assetId: string): {
    readonly invalidated: boolean;
    readonly soundResource: SoundResourceDescriptor | null;
  } {
    const inv = this.resourceManager.invalidateAudio(assetId);
    const existing = this.descriptorsByAssetId.get(assetId);
    if (!existing) {
      return { invalidated: inv.invalidated, soundResource: null };
    }
    const updated: SoundResourceDescriptor = Object.freeze({
      ...existing,
      state: inv.resource ? inv.resource.state : 'invalidated',
    });
    this.descriptorsByAssetId.set(assetId, updated);
    return {
      invalidated: inv.invalidated,
      soundResource: updated,
    };
  }

  public getSoundResource(assetId: string): SoundResourceDescriptor | undefined {
    const existing = this.descriptorsByAssetId.get(assetId);
    if (!existing) return undefined;
    const handle = this.resourceManager.get(assetId);
    if (!handle) return undefined;
    const synced: SoundResourceDescriptor = Object.freeze({
      ...existing,
      state: handle.state,
      referenceCount: handle.referenceCount,
      contentHash: handle.loadedContentHash,
    });
    this.descriptorsByAssetId.set(assetId, synced);
    return synced;
  }

  public clearTrackedDescriptors(): void {
    this.descriptorsByAssetId.clear();
  }
}
