import {
  AudioBusId,
  AudioPlaybackState,
  AudioSourceId,
  AudioVoiceId,
  createAudioId,
  isFiniteAudioNumber,
  SoundResourceId,
  Vector3,
  VoiceEvictionPolicy,
} from './audioTypes';

/**
 * Hylix V1.0.0 — Phase 07: Bounded Voice Pool, Voice Stealing & Playback Progression
 *
 * Enforces `maxVoices` (`1..256`) and deterministic eviction policies:
 * - `'reject'`
 * - `'replaceLowestPriority'`
 * - `'stopOldestEqualPriority'`
 */

export const DEFAULT_MAX_AUDIO_VOICES = 32;
export const MIN_SAFE_AUDIO_VOICES = 1;
export const MAX_SAFE_AUDIO_VOICES = 256;

export interface AudioVoiceInstance {
  readonly voiceId: AudioVoiceId;
  readonly projectId: string;
  readonly sourceId: AudioSourceId;
  readonly entityId: string;
  readonly audioAssetId: string;
  readonly soundResourceId: SoundResourceId;
  readonly busId: AudioBusId;
  readonly busName: string;
  readonly state: AudioPlaybackState;
  readonly priority: number;
  readonly loop: boolean;
  readonly durationSeconds: number;
  readonly playbackPositionSeconds: number;
  readonly pitch: number;
  readonly baseVolume: number;
  readonly effectiveVolume: number;
  readonly effectivePan: number;
  readonly leftChannelGain: number;
  readonly rightChannelGain: number;
  readonly position: Vector3;
  readonly startedAtOrder: number;
}

export interface VoiceAllocationRequest {
  readonly projectId: string;
  readonly sourceId: AudioSourceId;
  readonly entityId: string;
  readonly audioAssetId: string;
  readonly soundResourceId: SoundResourceId;
  readonly busId: AudioBusId;
  readonly busName: string;
  readonly priority: number;
  readonly loop: boolean;
  readonly durationSeconds: number;
  readonly pitch: number;
  readonly baseVolume: number;
  readonly effectiveVolume: number;
  readonly effectivePan: number;
  readonly leftChannelGain: number;
  readonly rightChannelGain: number;
  readonly position: Vector3;
}

export interface VoiceAllocationResult {
  readonly allocated: boolean;
  readonly voice: AudioVoiceInstance | null;
  readonly evictedVoice: AudioVoiceInstance | null;
  readonly reason?: string;
}

export function createDeterministicAudioVoiceId(
  projectId: string,
  sourceId: AudioSourceId,
  instanceSequence: number
): AudioVoiceId {
  return createAudioId(
    'voice',
    `${projectId.trim()}::${sourceId}::seq_${instanceSequence}`
  );
}

/**
 * Manages bounded active voices and deterministic voice stealing.
 */
export class VoicePoolManager {
  private readonly projectId: string;
  private maxVoices: number;
  private evictionPolicy: VoiceEvictionPolicy;
  private readonly voicesById = new Map<AudioVoiceId, AudioVoiceInstance>();
  private readonly voiceIdBySourceId = new Map<AudioSourceId, AudioVoiceId>();
  private orderCounter = 0;

  constructor(options: {
    readonly projectId: string;
    readonly maxVoices?: number;
    readonly evictionPolicy?: VoiceEvictionPolicy;
  }) {
    this.projectId = options.projectId.trim();
    const requestedMax = options.maxVoices ?? DEFAULT_MAX_AUDIO_VOICES;
    this.maxVoices = Math.max(
      MIN_SAFE_AUDIO_VOICES,
      Math.min(MAX_SAFE_AUDIO_VOICES, Math.floor(requestedMax))
    );
    this.evictionPolicy = options.evictionPolicy ?? 'replaceLowestPriority';
  }

  public getMaxVoices(): number {
    return this.maxVoices;
  }

  public getEvictionPolicy(): VoiceEvictionPolicy {
    return this.evictionPolicy;
  }

  public setConfiguration(config: {
    readonly maxVoices?: number;
    readonly evictionPolicy?: VoiceEvictionPolicy;
  }): void {
    if (
      config.maxVoices !== undefined &&
      Number.isInteger(config.maxVoices) &&
      config.maxVoices >= MIN_SAFE_AUDIO_VOICES &&
      config.maxVoices <= MAX_SAFE_AUDIO_VOICES
    ) {
      this.maxVoices = config.maxVoices;
    }
    if (config.evictionPolicy !== undefined) {
      this.evictionPolicy = config.evictionPolicy;
    }
  }

  public getActiveVoiceCount(): number {
    return this.voicesById.size;
  }

  public getVoice(voiceId: AudioVoiceId): AudioVoiceInstance | undefined {
    return this.voicesById.get(voiceId);
  }

  public getVoiceBySourceId(
    sourceId: AudioSourceId
  ): AudioVoiceInstance | undefined {
    const vid = this.voiceIdBySourceId.get(sourceId);
    return vid ? this.voicesById.get(vid) : undefined;
  }

  public listActiveVoices(): readonly AudioVoiceInstance[] {
    return Array.from(this.voicesById.values()).sort((a, b) =>
      a.voiceId.localeCompare(b.voiceId)
    );
  }

  /**
   * Selects a candidate voice to evict when the pool is full (`voicesById.size >= maxVoices`).
   */
  private selectVoiceForEviction(
    incomingPriority: number
  ): AudioVoiceInstance | null {
    if (this.evictionPolicy === 'reject') {
      return null;
    }

    const activeList = Array.from(this.voicesById.values());
    if (activeList.length === 0) {
      return null;
    }

    if (this.evictionPolicy === 'replaceLowestPriority') {
      // Sort by priority ASC, then startedAtOrder ASC (oldest first), then voiceId ASC
      const sortedLowest = activeList.slice().sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        if (a.startedAtOrder !== b.startedAtOrder) {
          return a.startedAtOrder - b.startedAtOrder;
        }
        return a.voiceId.localeCompare(b.voiceId);
      });
      const candidate = sortedLowest[0];
      if (incomingPriority > candidate.priority) {
        return candidate;
      }
      return null;
    }

    if (this.evictionPolicy === 'stopOldestEqualPriority') {
      // Find voices with priority <= incomingPriority, ordered by startedAtOrder ASC (oldest first)
      const eligible = activeList
        .filter((v) => v.priority <= incomingPriority)
        .sort((a, b) => {
          if (a.startedAtOrder !== b.startedAtOrder) {
            return a.startedAtOrder - b.startedAtOrder;
          }
          if (a.priority !== b.priority) {
            return a.priority - b.priority;
          }
          return a.voiceId.localeCompare(b.voiceId);
        });
      return eligible[0] ?? null;
    }

    return null;
  }

  public allocateVoice(request: VoiceAllocationRequest): VoiceAllocationResult {
    if (request.projectId !== this.projectId) {
      return {
        allocated: false,
        voice: null,
        evictedVoice: null,
        reason: `Project Isolation Violation: Cannot allocate voice for project '${request.projectId}' in pool '${this.projectId}'.`,
      };
    }

    // If this source already has an active voice, replace/restart it cleanly
    const existingForSource = this.getVoiceBySourceId(request.sourceId);
    if (existingForSource) {
      this.voicesById.delete(existingForSource.voiceId);
      this.voiceIdBySourceId.delete(request.sourceId);
    }

    let evictedVoice: AudioVoiceInstance | null = null;

    if (this.voicesById.size >= this.maxVoices) {
      const candidateToEvict = this.selectVoiceForEviction(request.priority);
      if (!candidateToEvict) {
        return {
          allocated: false,
          voice: null,
          evictedVoice: null,
          reason: `Max voices limit (${this.maxVoices}) reached under policy '${this.evictionPolicy}' for incoming priority ${request.priority}.`,
        };
      }
      evictedVoice = Object.freeze({
        ...candidateToEvict,
        state: 'stopped' as const,
      });
      this.voicesById.delete(candidateToEvict.voiceId);
      this.voiceIdBySourceId.delete(candidateToEvict.sourceId);
    }

    this.orderCounter += 1;
    const voiceId = createDeterministicAudioVoiceId(
      this.projectId,
      request.sourceId,
      this.orderCounter
    );

    const newVoice: AudioVoiceInstance = Object.freeze({
      voiceId,
      projectId: this.projectId,
      sourceId: request.sourceId,
      entityId: request.entityId,
      audioAssetId: request.audioAssetId,
      soundResourceId: request.soundResourceId,
      busId: request.busId,
      busName: request.busName,
      state: 'playing',
      priority: request.priority,
      loop: request.loop,
      durationSeconds: Math.max(0.001, request.durationSeconds),
      playbackPositionSeconds: 0,
      pitch: request.pitch,
      baseVolume: request.baseVolume,
      effectiveVolume: request.effectiveVolume,
      effectivePan: request.effectivePan,
      leftChannelGain: request.leftChannelGain,
      rightChannelGain: request.rightChannelGain,
      position: request.position,
      startedAtOrder: this.orderCounter,
    });

    this.voicesById.set(voiceId, newVoice);
    this.voiceIdBySourceId.set(request.sourceId, voiceId);

    return {
      allocated: true,
      voice: newVoice,
      evictedVoice,
    };
  }

  public updateVoice(
    voiceId: AudioVoiceId,
    patch: Partial<
      Pick<
        AudioVoiceInstance,
        | 'state'
        | 'playbackPositionSeconds'
        | 'pitch'
        | 'baseVolume'
        | 'effectiveVolume'
        | 'effectivePan'
        | 'leftChannelGain'
        | 'rightChannelGain'
        | 'position'
        | 'loop'
        | 'priority'
      >
    >
  ): AudioVoiceInstance | null {
    const existing = this.voicesById.get(voiceId);
    if (!existing) return null;
    const updated: AudioVoiceInstance = Object.freeze({
      ...existing,
      ...patch,
    });
    this.voicesById.set(voiceId, updated);
    return updated;
  }

  public releaseVoice(voiceId: AudioVoiceId): AudioVoiceInstance | null {
    const existing = this.voicesById.get(voiceId);
    if (!existing) return null;
    this.voicesById.delete(voiceId);
    this.voiceIdBySourceId.delete(existing.sourceId);
    return Object.freeze({
      ...existing,
      state: 'stopped',
    });
  }

  public releaseAllVoices(): readonly AudioVoiceInstance[] {
    const released = Array.from(this.voicesById.values()).map((v) =>
      Object.freeze({ ...v, state: 'stopped' as const })
    );
    this.voicesById.clear();
    this.voiceIdBySourceId.clear();
    return Object.freeze(released);
  }

  /**
   * Advances playback time on all `'playing'` voices by `deltaTimeSeconds * pitch`.
   * - Looping voices wrap `playbackPositionSeconds` modulo `durationSeconds`.
   * - Non-looping voices that reach `durationSeconds` finish and are removed from the active pool.
   */
  public advancePlayback(deltaTimeSeconds: number): {
    readonly activeVoices: readonly AudioVoiceInstance[];
    readonly finishedVoices: readonly AudioVoiceInstance[];
    readonly loopedVoiceIds: readonly AudioVoiceId[];
  } {
    if (!isFiniteAudioNumber(deltaTimeSeconds) || deltaTimeSeconds <= 0) {
      return {
        activeVoices: this.listActiveVoices(),
        finishedVoices: [],
        loopedVoiceIds: [],
      };
    }

    const finishedVoices: AudioVoiceInstance[] = [];
    const loopedVoiceIds: AudioVoiceId[] = [];

    for (const voice of this.listActiveVoices()) {
      if (voice.state !== 'playing') continue;

      const nextTime =
        voice.playbackPositionSeconds + deltaTimeSeconds * voice.pitch;
      if (nextTime >= voice.durationSeconds) {
        if (voice.loop) {
          const wrappedTime = nextTime % voice.durationSeconds;
          this.updateVoice(voice.voiceId, {
            playbackPositionSeconds: wrappedTime,
          });
          loopedVoiceIds.push(voice.voiceId);
        } else {
          const completed = this.releaseVoice(voice.voiceId);
          if (completed) {
            finishedVoices.push(
              Object.freeze({
                ...completed,
                playbackPositionSeconds: voice.durationSeconds,
              })
            );
          }
        }
      } else {
        this.updateVoice(voice.voiceId, {
          playbackPositionSeconds: nextTime,
        });
      }
    }

    return {
      activeVoices: this.listActiveVoices(),
      finishedVoices: Object.freeze(finishedVoices),
      loopedVoiceIds: Object.freeze(loopedVoiceIds),
    };
  }
}
