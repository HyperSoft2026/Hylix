import { HylixAssetRegistry } from '../assets/assetRegistry';
import { ResourceManager } from '../assets/resourceManager';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  NullContractAudioBackend,
  PlatformAudioBackendContract,
} from '../platform/platformAbstraction';
import {
  AudioBusDescriptor,
  computeEffectiveBusVolume,
  createDefaultProjectAudioBuses,
  validateAudioBusDescriptor,
  validateAudioBusHierarchy,
} from './audioBus';
import {
  AudioListenerDescriptor,
  selectActiveAudioListener,
  validateAudioListenerDescriptor,
} from './audioListener';
import {
  AudioSourceDescriptor,
  validateAudioSourceDescriptor,
} from './audioSource';
import {
  AudioBusId,
  AudioListenerId,
  AudioSourceId,
  AudioVoiceId,
  AudioWorldId,
  AudioWorldState,
  clampAudioNumber,
  createAudioId,
  isFiniteAudioNumber,
  isValidAudioPlaybackStateTransition,
  isValidAudioWorldId,
  isValidAudioWorldStateTransition,
  VoiceEvictionPolicy,
} from './audioTypes';
import {
  SoundResourceDescriptor,
  SoundResourceManager,
} from './soundResource';
import { computeSpatialMixResult } from './spatialAudio';
import {
  AudioVoiceInstance,
  DEFAULT_MAX_AUDIO_VOICES,
  VoicePoolManager,
} from './voiceManagement';

/**
 * Hylix V1.0.0 — Phase 07: Project-Isolated AudioWorld & Playback Engine
 *
 * Orchestrates:
 * - AudioWorld lifecycle (`uninitialized -> ready -> processing -> ready`, `ready <-> paused`, `-> shutdown`)
 * - Hierarchical Audio Mixer & Buses (`Master`, `Music`, `SFX`, `Voice`, `UI`, `Ambience`)
 * - Single Active AudioListener selection & 2D/3D Spatial Attenuation + Panning
 * - Bounded VoicePoolManager & deterministic voice stealing
 * - SoundResourceManager reference counting & invalidation
 * - PlatformAudioBackendContract command synchronization
 */

export interface AudioFrameSnapshot {
  readonly audioWorldId: AudioWorldId;
  readonly projectId: string;
  readonly frameSequence: number;
  readonly state: AudioWorldState;
  readonly masterVolume: number;
  readonly activeListenerId: AudioListenerId | null;
  readonly activeVoiceCount: number;
  readonly maxVoices: number;
  readonly activeVoices: readonly AudioVoiceInstance[];
  readonly finishedVoiceIds: readonly AudioVoiceId[];
  readonly loopedVoiceIds: readonly AudioVoiceId[];
}

export interface AudioWorldOptions {
  readonly projectId: string;
  readonly audioWorldId?: AudioWorldId;
  readonly registry: HylixAssetRegistry;
  readonly resourceManager: ResourceManager;
  readonly backend?: PlatformAudioBackendContract;
  readonly masterVolume?: number;
  readonly maxVoices?: number;
  readonly voiceEvictionPolicy?: VoiceEvictionPolicy;
  readonly defaultRolloff?: number;
  readonly logger?: RedactedDiagnosticLogger;
}

export class AudioWorld {
  private readonly projectId: string;
  private readonly audioWorldId: AudioWorldId;
  private readonly registry: HylixAssetRegistry;
  private readonly resourceManager: ResourceManager;
  private readonly soundResourceManager: SoundResourceManager;
  private readonly backend: PlatformAudioBackendContract;
  private readonly voicePool: VoicePoolManager;
  private readonly logger?: RedactedDiagnosticLogger;

  private state: AudioWorldState = 'uninitialized';
  private masterVolume: number;
  private defaultRolloff: number;
  private frameSequence = 0;

  private readonly busesById = new Map<AudioBusId, AudioBusDescriptor>();
  private readonly busIdByNameLower = new Map<string, AudioBusId>();
  private readonly sourcesById = new Map<AudioSourceId, AudioSourceDescriptor>();
  private readonly listenersById = new Map<
    AudioListenerId,
    AudioListenerDescriptor
  >();

  constructor(options: AudioWorldOptions) {
    this.projectId = options.projectId.trim();
    this.audioWorldId =
      options.audioWorldId && isValidAudioWorldId(options.audioWorldId)
        ? options.audioWorldId
        : createAudioId('audio', `${this.projectId}::world`);
    this.registry = options.registry;
    this.resourceManager = options.resourceManager;
    this.logger = options.logger;

    this.soundResourceManager = new SoundResourceManager({
      projectId: this.projectId,
      registry: this.registry,
      resourceManager: this.resourceManager,
      logger: this.logger,
    });

    this.backend = options.backend ?? new NullContractAudioBackend();
    this.masterVolume =
      options.masterVolume !== undefined &&
      isFiniteAudioNumber(options.masterVolume) &&
      options.masterVolume >= 0
        ? clampAudioNumber(options.masterVolume, 0, 4)
        : 1.0;
    this.defaultRolloff =
      options.defaultRolloff !== undefined &&
      isFiniteAudioNumber(options.defaultRolloff) &&
      options.defaultRolloff >= 0
        ? options.defaultRolloff
        : 1.0;

    this.voicePool = new VoicePoolManager({
      projectId: this.projectId,
      maxVoices: options.maxVoices ?? DEFAULT_MAX_AUDIO_VOICES,
      evictionPolicy: options.voiceEvictionPolicy ?? 'replaceLowestPriority',
    });

    this.initializeDefaultBuses();
  }

  private initializeDefaultBuses(): void {
    this.busesById.clear();
    this.busIdByNameLower.clear();
    for (const bus of createDefaultProjectAudioBuses(this.projectId)) {
      this.busesById.set(bus.busId, bus);
      this.busIdByNameLower.set(bus.name.toLowerCase(), bus.busId);
    }
  }

  public getProjectId(): string {
    return this.projectId;
  }

  public getAudioWorldId(): AudioWorldId {
    return this.audioWorldId;
  }

  public getState(): AudioWorldState {
    return this.state;
  }

  public getBackend(): PlatformAudioBackendContract {
    return this.backend;
  }

  public getSoundResourceManager(): SoundResourceManager {
    return this.soundResourceManager;
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public getDefaultRolloff(): number {
    return this.defaultRolloff;
  }

  public getMaxVoices(): number {
    return this.voicePool.getMaxVoices();
  }

  public getVoiceEvictionPolicy(): VoiceEvictionPolicy {
    return this.voicePool.getEvictionPolicy();
  }

  private transitionState(nextState: AudioWorldState): boolean {
    if (!isValidAudioWorldStateTransition(this.state, nextState)) {
      this.logger?.record(
        'audio',
        'ERROR',
        `Illegal AudioWorld state transition: '${this.state}' -> '${nextState}' in world '${this.audioWorldId}'.`
      );
      return false;
    }
    this.state = nextState;
    return true;
  }

  public initialize(): { readonly success: boolean; readonly error?: string } {
    if (this.state === 'shutdown') {
      const msg = `Cannot initialize AudioWorld '${this.audioWorldId}' after shutdown.`;
      this.logger?.record('audio', 'ERROR', msg);
      return { success: false, error: msg };
    }
    if (this.state === 'ready') {
      return { success: true };
    }
    if (!this.transitionState('ready')) {
      return {
        success: false,
        error: `Cannot transition AudioWorld from '${this.state}' to 'ready'.`,
      };
    }

    const backendInit = this.backend.initialize();
    if (!backendInit.success) {
      return {
        success: false,
        error: backendInit.error ?? 'Failed to initialize platform audio backend.',
      };
    }

    this.logger?.record(
      'audio',
      'INFO',
      `audio_world_initialized: worldId=${this.audioWorldId} projectId=${this.projectId}`
    );
    return { success: true };
  }

  public setMasterVolume(volume: number): {
    readonly success: boolean;
    readonly error?: string;
  } {
    if (!isFiniteAudioNumber(volume) || volume < 0 || volume > 4.0) {
      const msg = `Invalid masterVolume '${String(volume)}'; must be finite in [0, 4].`;
      this.logger?.record('audio', 'ERROR', msg);
      return { success: false, error: msg };
    }
    this.masterVolume = volume;
    this.refreshAllActiveVoiceMixes();
    return { success: true };
  }

  public configureWorld(config: {
    readonly masterVolume?: number;
    readonly maxVoices?: number;
    readonly voiceEvictionPolicy?: VoiceEvictionPolicy;
    readonly defaultRolloff?: number;
  }): { readonly success: boolean; readonly errors: readonly string[] } {
    const errors: string[] = [];
    if (config.masterVolume !== undefined) {
      if (
        !isFiniteAudioNumber(config.masterVolume) ||
        config.masterVolume < 0 ||
        config.masterVolume > 4.0
      ) {
        errors.push('masterVolume must be a finite number in [0, 4].');
      } else {
        this.masterVolume = config.masterVolume;
      }
    }
    if (config.defaultRolloff !== undefined) {
      if (
        !isFiniteAudioNumber(config.defaultRolloff) ||
        config.defaultRolloff < 0
      ) {
        errors.push('defaultRolloff must be a finite number >= 0.');
      } else {
        this.defaultRolloff = config.defaultRolloff;
      }
    }
    if (
      config.maxVoices !== undefined ||
      config.voiceEvictionPolicy !== undefined
    ) {
      this.voicePool.setConfiguration({
        maxVoices: config.maxVoices,
        evictionPolicy: config.voiceEvictionPolicy,
      });
    }
    if (errors.length > 0) {
      return { success: false, errors };
    }
    this.refreshAllActiveVoiceMixes();
    return { success: true, errors: [] };
  }

  // ==========================================
  // AUDIO BUS & MIXER MANAGEMENT
  // ==========================================

  public listBuses(): readonly AudioBusDescriptor[] {
    return Array.from(this.busesById.values()).sort((a, b) =>
      a.busId.localeCompare(b.busId)
    );
  }

  public getBus(busIdOrName: string): AudioBusDescriptor | undefined {
    const byId = this.busesById.get(busIdOrName as AudioBusId);
    if (byId) return byId;
    const mappedId = this.busIdByNameLower.get(busIdOrName.trim().toLowerCase());
    return mappedId ? this.busesById.get(mappedId) : undefined;
  }

  public registerBus(candidate: unknown): {
    readonly success: boolean;
    readonly bus: AudioBusDescriptor | null;
    readonly errors: readonly string[];
  } {
    const val = validateAudioBusDescriptor(candidate);
    if (!val.valid || !val.value) {
      this.logger?.record(
        'audio',
        'ERROR',
        `audio_bus_validation_failed: ${val.errors.join('; ')}`
      );
      return { success: false, bus: null, errors: val.errors };
    }

    const bus = val.value;
    if (bus.projectId !== this.projectId) {
      const msg = `Project Isolation Violation: AudioBus '${bus.name}' belongs to project '${bus.projectId}', expected '${this.projectId}'.`;
      this.logger?.record('audio', 'ERROR', msg);
      return { success: false, bus: null, errors: [msg] };
    }

    const simulated = [
      ...Array.from(this.busesById.values()).filter(
        (b) =>
          b.busId !== bus.busId &&
          b.name.toLowerCase() !== bus.name.toLowerCase()
      ),
      bus,
    ];
    const graphCheck = validateAudioBusHierarchy(simulated);
    if (!graphCheck.valid) {
      this.logger?.record(
        'audio',
        'ERROR',
        `audio_bus_hierarchy_failed: ${graphCheck.errors.join('; ')}`
      );
      return { success: false, bus: null, errors: graphCheck.errors };
    }

    this.busesById.set(bus.busId, bus);
    this.busIdByNameLower.set(bus.name.toLowerCase(), bus.busId);
    this.refreshAllActiveVoiceMixes();

    return { success: true, bus, errors: [] };
  }

  public setBusVolume(
    busIdOrName: string,
    volume: number
  ): { readonly success: boolean; readonly error?: string } {
    const bus = this.getBus(busIdOrName);
    if (!bus) {
      return { success: false, error: `Unknown AudioBus '${busIdOrName}'.` };
    }
    if (!isFiniteAudioNumber(volume) || volume < 0 || volume > 4.0) {
      return {
        success: false,
        error: `Invalid bus volume '${String(volume)}'; must be finite in [0, 4].`,
      };
    }
    const updated: AudioBusDescriptor = Object.freeze({ ...bus, volume });
    this.busesById.set(bus.busId, updated);
    this.refreshAllActiveVoiceMixes();
    return { success: true };
  }

  public setBusMuted(
    busIdOrName: string,
    muted: boolean
  ): { readonly success: boolean; readonly error?: string } {
    const bus = this.getBus(busIdOrName);
    if (!bus) {
      return { success: false, error: `Unknown AudioBus '${busIdOrName}'.` };
    }
    const updated: AudioBusDescriptor = Object.freeze({
      ...bus,
      muted: Boolean(muted),
    });
    this.busesById.set(bus.busId, updated);
    this.refreshAllActiveVoiceMixes();
    return { success: true };
  }

  public setBusSolo(
    busIdOrName: string,
    solo: boolean
  ): { readonly success: boolean; readonly error?: string } {
    const bus = this.getBus(busIdOrName);
    if (!bus) {
      return { success: false, error: `Unknown AudioBus '${busIdOrName}'.` };
    }
    const updated: AudioBusDescriptor = Object.freeze({
      ...bus,
      solo: Boolean(solo),
    });
    this.busesById.set(bus.busId, updated);
    this.refreshAllActiveVoiceMixes();
    return { success: true };
  }

  public getEffectiveBusVolume(busIdOrName: string): number {
    return computeEffectiveBusVolume(
      busIdOrName,
      Array.from(this.busesById.values()),
      this.masterVolume
    );
  }

  // ==========================================
  // AUDIO LISTENER MANAGEMENT
  // ==========================================

  public registerListener(candidate: unknown): {
    readonly success: boolean;
    readonly listener: AudioListenerDescriptor | null;
    readonly errors: readonly string[];
  } {
    if (this.state === 'shutdown') {
      return {
        success: false,
        listener: null,
        errors: ['Cannot register AudioListener after AudioWorld shutdown.'],
      };
    }

    const val = validateAudioListenerDescriptor(candidate);
    if (!val.valid || !val.value) {
      this.logger?.record(
        'audio',
        'ERROR',
        `audio_listener_validation_failed: ${val.errors.join('; ')}`
      );
      return { success: false, listener: null, errors: val.errors };
    }

    const listener = val.value;
    if (listener.projectId !== this.projectId) {
      const msg = `Project Isolation Violation: AudioListener '${listener.listenerId}' belongs to project '${listener.projectId}', expected '${this.projectId}'.`;
      this.logger?.record('audio', 'ERROR', msg);
      return { success: false, listener: null, errors: [msg] };
    }

    this.listenersById.set(listener.listenerId, listener);

    const selection = selectActiveAudioListener(
      Array.from(this.listenersById.values())
    );
    if (selection.duplicateEnabledListenerIds.length > 0) {
      this.logger?.record(
        'audio',
        'WARN',
        `Multiple enabled AudioListeners detected; deterministically selected '${selection.activeListener?.listenerId}' and muted duplicate listeners (${selection.duplicateEnabledListenerIds.join(', ')}).`
      );
    }

    this.refreshAllActiveVoiceMixes();
    return { success: true, listener, errors: [] };
  }

  public removeListener(listenerId: AudioListenerId): boolean {
    const deleted = this.listenersById.delete(listenerId);
    if (deleted) {
      this.refreshAllActiveVoiceMixes();
    }
    return deleted;
  }

  public getActiveListener(): AudioListenerDescriptor | null {
    return selectActiveAudioListener(Array.from(this.listenersById.values()))
      .activeListener;
  }

  public listListeners(): readonly AudioListenerDescriptor[] {
    return Array.from(this.listenersById.values()).sort((a, b) =>
      a.listenerId.localeCompare(b.listenerId)
    );
  }

  // ==========================================
  // AUDIO SOURCE & PLAYBACK LIFECYCLE
  // ==========================================

  public registerSource(candidate: unknown): {
    readonly success: boolean;
    readonly source: AudioSourceDescriptor | null;
    readonly errors: readonly string[];
  } {
    if (this.state === 'shutdown') {
      return {
        success: false,
        source: null,
        errors: ['Cannot register AudioSource after AudioWorld shutdown.'],
      };
    }

    const val = validateAudioSourceDescriptor(candidate);
    if (!val.valid || !val.value) {
      this.logger?.record(
        'audio',
        'ERROR',
        `audio_source_validation_failed: ${val.errors.join('; ')}`
      );
      return { success: false, source: null, errors: val.errors };
    }

    const source = val.value;
    if (source.projectId !== this.projectId) {
      const msg = `Project Isolation Violation: AudioSource '${source.sourceId}' belongs to project '${source.projectId}', expected '${this.projectId}'.`;
      this.logger?.record('audio', 'ERROR', msg);
      return { success: false, source: null, errors: [msg] };
    }

    const targetBus = this.getBus(source.busName) ?? this.getBus(source.busId);
    if (!targetBus) {
      const msg = `AudioSource '${source.sourceId}' references unknown AudioBus '${source.busName}'.`;
      this.logger?.record('audio', 'ERROR', msg);
      return { success: false, source: null, errors: [msg] };
    }

    const normalizedSource: AudioSourceDescriptor = Object.freeze({
      ...source,
      busName: targetBus.name,
      busId: targetBus.busId,
    });

    this.sourcesById.set(normalizedSource.sourceId, normalizedSource);
    return { success: true, source: normalizedSource, errors: [] };
  }

  public unregisterSource(sourceId: AudioSourceId): boolean {
    if (!this.sourcesById.has(sourceId)) return false;
    this.stopSource(sourceId);
    return this.sourcesById.delete(sourceId);
  }

  public getSource(sourceId: AudioSourceId): AudioSourceDescriptor | undefined {
    return this.sourcesById.get(sourceId);
  }

  public listSources(): readonly AudioSourceDescriptor[] {
    return Array.from(this.sourcesById.values()).sort((a, b) =>
      a.sourceId.localeCompare(b.sourceId)
    );
  }

  public updateSourceParameters(
    sourceId: AudioSourceId,
    patch: Partial<
      Pick<
        AudioSourceDescriptor,
        | 'volume'
        | 'pitch'
        | 'pan'
        | 'loop'
        | 'muted'
        | 'priority'
        | 'minDistance'
        | 'maxDistance'
        | 'rolloffFactor'
        | 'attenuationModel'
        | 'spatialMode'
        | 'position'
        | 'velocity'
        | 'busName'
      >
    >
  ): {
    readonly success: boolean;
    readonly source: AudioSourceDescriptor | null;
    readonly errors: readonly string[];
  } {
    const existing = this.sourcesById.get(sourceId);
    if (!existing) {
      return {
        success: false,
        source: null,
        errors: [`AudioSource '${sourceId}' is not registered.`],
      };
    }

    const nextBus =
      patch.busName !== undefined
        ? this.getBus(patch.busName)
        : this.getBus(existing.busId);
    if (!nextBus) {
      return {
        success: false,
        source: existing,
        errors: [`Unknown AudioBus '${String(patch.busName)}'.`],
      };
    }

    const candidate = {
      ...existing,
      ...patch,
      busName: nextBus.name,
      busId: nextBus.busId,
    };

    const val = validateAudioSourceDescriptor(candidate);
    if (!val.valid || !val.value) {
      return { success: false, source: existing, errors: val.errors };
    }

    this.sourcesById.set(sourceId, val.value);

    const activeVoice = this.voicePool.getVoiceBySourceId(sourceId);
    if (activeVoice) {
      const mix = this.computeSourceMix(val.value);
      this.voicePool.updateVoice(activeVoice.voiceId, {
        pitch: val.value.pitch,
        loop: val.value.loop,
        priority: val.value.priority,
        baseVolume: val.value.volume,
        effectiveVolume: mix.effectiveVolume,
        effectivePan: mix.effectivePan,
        leftChannelGain: mix.leftChannelGain,
        rightChannelGain: mix.rightChannelGain,
        position: val.value.position,
      });
      this.backend.setVolume(activeVoice.voiceId, mix.effectiveVolume);
      this.backend.setPitch(activeVoice.voiceId, val.value.pitch);
      this.backend.setPan(activeVoice.voiceId, mix.effectivePan);
      this.backend.setPosition(activeVoice.voiceId, val.value.position);
    }

    return { success: true, source: val.value, errors: [] };
  }

  private computeSourceMix(source: AudioSourceDescriptor) {
    const busVolume = this.getEffectiveBusVolume(source.busId);
    const activeListener = this.getActiveListener();
    return computeSpatialMixResult(
      {
        spatialMode: source.spatialMode,
        position: source.position,
        volume: source.volume,
        pan: source.pan,
        muted: source.muted,
        minDistance: source.minDistance,
        maxDistance: source.maxDistance,
        rolloffFactor: source.rolloffFactor,
        attenuationModel: source.attenuationModel,
      },
      activeListener
        ? {
            position: activeListener.position,
            forward: activeListener.forward,
            up: activeListener.up,
            masterGain: activeListener.masterGain,
            enabled: activeListener.enabled,
          }
        : null,
      busVolume
    );
  }

  private refreshAllActiveVoiceMixes(): void {
    for (const voice of this.voicePool.listActiveVoices()) {
      const source = this.sourcesById.get(voice.sourceId);
      if (!source) continue;
      const mix = this.computeSourceMix(source);
      this.voicePool.updateVoice(voice.voiceId, {
        effectiveVolume: mix.effectiveVolume,
        effectivePan: mix.effectivePan,
        leftChannelGain: mix.leftChannelGain,
        rightChannelGain: mix.rightChannelGain,
        position: source.position,
      });
      this.backend.setVolume(voice.voiceId, mix.effectiveVolume);
      this.backend.setPan(voice.voiceId, mix.effectivePan);
      this.backend.setPosition(voice.voiceId, source.position);
    }
  }

  /**
   * Starts playback of a registered `AudioSource`:
   * 1. Verifies AudioWorld is `'ready'`
   * 2. Acquires & validates `SoundResourceDescriptor` via `SoundResourceManager` (`HylixAssetRegistry` + `ResourceManager`)
   * 3. Allocates a bounded voice in `VoicePoolManager` (applying deterministic voice eviction if needed)
   * 4. Dispatches `createVoice` + `startVoice` to `PlatformAudioBackendContract`
   */
  public playSource(sourceId: AudioSourceId): {
    readonly success: boolean;
    readonly voice: AudioVoiceInstance | null;
    readonly soundResource: SoundResourceDescriptor | null;
    readonly evictedVoiceId: AudioVoiceId | null;
    readonly errors: readonly string[];
  } {
    if (this.state !== 'ready') {
      const msg = `Cannot play AudioSource '${sourceId}' while AudioWorld state is '${this.state}' (expected 'ready').`;
      this.logger?.record('audio', 'ERROR', msg);
      return {
        success: false,
        voice: null,
        soundResource: null,
        evictedVoiceId: null,
        errors: [msg],
      };
    }

    const source = this.sourcesById.get(sourceId);
    if (!source) {
      const msg = `AudioSource '${sourceId}' is not registered in AudioWorld '${this.audioWorldId}'.`;
      this.logger?.record('audio', 'ERROR', msg);
      return {
        success: false,
        voice: null,
        soundResource: null,
        evictedVoiceId: null,
        errors: [msg],
      };
    }

    // If already playing or paused on this source, stop existing voice first so resource ref counts stay exact
    if (source.playbackState !== 'stopped') {
      this.stopSource(sourceId);
    }

    const currentSource = this.sourcesById.get(sourceId)!;
    if (
      !isValidAudioPlaybackStateTransition(
        currentSource.playbackState,
        'playing'
      )
    ) {
      const msg = `Illegal playback transition '${currentSource.playbackState}' -> 'playing' for '${sourceId}'.`;
      return {
        success: false,
        voice: null,
        soundResource: null,
        evictedVoiceId: null,
        errors: [msg],
      };
    }

    // Acquire sound resource (increments ResourceManager referenceCount)
    const acquireRes = this.soundResourceManager.acquireSoundResource(
      currentSource.audioAssetId
    );
    if (!acquireRes.success || !acquireRes.soundResource) {
      this.logger?.record(
        'audio',
        'ERROR',
        `audio_playback_failed: sourceId=${sourceId} assetId=${currentSource.audioAssetId} (${acquireRes.errors.join('; ')})`
      );
      return {
        success: false,
        voice: null,
        soundResource: null,
        evictedVoiceId: null,
        errors: acquireRes.errors,
      };
    }

    const soundResource = acquireRes.soundResource;
    const mix = this.computeSourceMix(currentSource);

    const allocation = this.voicePool.allocateVoice({
      projectId: this.projectId,
      sourceId: currentSource.sourceId,
      entityId: currentSource.entityId,
      audioAssetId: currentSource.audioAssetId,
      soundResourceId: soundResource.soundResourceId,
      busId: currentSource.busId,
      busName: currentSource.busName,
      priority: currentSource.priority,
      loop: currentSource.loop,
      durationSeconds: soundResource.durationSeconds,
      pitch: currentSource.pitch,
      baseVolume: currentSource.volume,
      effectiveVolume: mix.effectiveVolume,
      effectivePan: mix.effectivePan,
      leftChannelGain: mix.leftChannelGain,
      rightChannelGain: mix.rightChannelGain,
      position: currentSource.position,
    });

    if (!allocation.allocated || !allocation.voice) {
      // Release the acquired sound resource since voice allocation was rejected
      this.soundResourceManager.releaseSoundResource(currentSource.audioAssetId);
      const reason =
        allocation.reason ?? `Voice allocation rejected for '${sourceId}'.`;
      this.logger?.record('audio', 'WARN', `audio_voice_rejected: ${reason}`);
      return {
        success: false,
        voice: null,
        soundResource,
        evictedVoiceId: null,
        errors: [reason],
      };
    }

    // If a lower-priority voice was evicted, clean up its backend voice, source state, and resource reference
    let evictedVoiceId: AudioVoiceId | null = null;
    if (allocation.evictedVoice) {
      evictedVoiceId = allocation.evictedVoice.voiceId;
      this.backend.stopVoice(evictedVoiceId);
      this.backend.destroyVoice(evictedVoiceId);
      this.soundResourceManager.releaseSoundResource(
        allocation.evictedVoice.audioAssetId
      );
      const evictedSource = this.sourcesById.get(
        allocation.evictedVoice.sourceId
      );
      if (evictedSource) {
        this.sourcesById.set(
          evictedSource.sourceId,
          Object.freeze({
            ...evictedSource,
            playbackState: 'stopped',
            playbackPositionSeconds: 0,
          })
        );
      }
      this.logger?.record(
        'audio',
        'INFO',
        `audio_voice_evicted: evictedVoiceId=${evictedVoiceId} bySourceId=${sourceId}`
      );
    }

    const voice = allocation.voice;
    this.backend.createVoice(voice.voiceId, voice.audioAssetId);
    this.backend.setVolume(voice.voiceId, voice.effectiveVolume);
    this.backend.setPitch(voice.voiceId, voice.pitch);
    this.backend.setPan(voice.voiceId, voice.effectivePan);
    this.backend.setPosition(voice.voiceId, voice.position);
    this.backend.startVoice(voice.voiceId);

    this.sourcesById.set(
      sourceId,
      Object.freeze({
        ...currentSource,
        playbackState: 'playing',
        playbackPositionSeconds: 0,
      })
    );

    this.logger?.record(
      'audio',
      'INFO',
      `audio_playback_started: voiceId=${voice.voiceId} sourceId=${sourceId} assetId=${currentSource.audioAssetId}`
    );

    return {
      success: true,
      voice,
      soundResource,
      evictedVoiceId,
      errors: [],
    };
  }

  public pauseSource(sourceId: AudioSourceId): {
    readonly success: boolean;
    readonly error?: string;
  } {
    if (this.state !== 'ready' && this.state !== 'paused') {
      return {
        success: false,
        error: `Cannot pause source '${sourceId}' in AudioWorld state '${this.state}'.`,
      };
    }

    const source = this.sourcesById.get(sourceId);
    if (!source) {
      return {
        success: false,
        error: `AudioSource '${sourceId}' is not registered.`,
      };
    }

    if (
      !isValidAudioPlaybackStateTransition(source.playbackState, 'paused')
    ) {
      const msg = `Illegal playback state transition: cannot pause AudioSource '${sourceId}' while in state '${source.playbackState}'.`;
      this.logger?.record('audio', 'WARN', msg);
      return { success: false, error: msg };
    }

    const voice = this.voicePool.getVoiceBySourceId(sourceId);
    if (voice) {
      this.voicePool.updateVoice(voice.voiceId, { state: 'paused' });
      this.backend.pauseVoice(voice.voiceId);
    }

    this.sourcesById.set(
      sourceId,
      Object.freeze({
        ...source,
        playbackState: 'paused',
      })
    );

    this.logger?.record(
      'audio',
      'INFO',
      `audio_playback_paused: sourceId=${sourceId}`
    );
    return { success: true };
  }

  public resumeSource(sourceId: AudioSourceId): {
    readonly success: boolean;
    readonly error?: string;
  } {
    if (this.state !== 'ready') {
      return {
        success: false,
        error: `Cannot resume source '${sourceId}' while AudioWorld state is '${this.state}'.`,
      };
    }

    const source = this.sourcesById.get(sourceId);
    if (!source) {
      return {
        success: false,
        error: `AudioSource '${sourceId}' is not registered.`,
      };
    }

    if (
      source.playbackState !== 'paused' ||
      !isValidAudioPlaybackStateTransition(source.playbackState, 'playing')
    ) {
      const msg = `Illegal playback state transition: cannot resume AudioSource '${sourceId}' while in state '${source.playbackState}' (must be 'paused').`;
      this.logger?.record('audio', 'WARN', msg);
      return { success: false, error: msg };
    }

    const voice = this.voicePool.getVoiceBySourceId(sourceId);
    if (voice) {
      this.voicePool.updateVoice(voice.voiceId, { state: 'playing' });
      this.backend.resumeVoice(voice.voiceId);
    }

    this.sourcesById.set(
      sourceId,
      Object.freeze({
        ...source,
        playbackState: 'playing',
      })
    );

    this.logger?.record(
      'audio',
      'INFO',
      `audio_playback_resumed: sourceId=${sourceId}`
    );
    return { success: true };
  }

  public stopSource(sourceId: AudioSourceId): {
    readonly success: boolean;
    readonly error?: string;
  } {
    const source = this.sourcesById.get(sourceId);
    if (!source) {
      return {
        success: false,
        error: `AudioSource '${sourceId}' is not registered.`,
      };
    }

    if (source.playbackState === 'stopped') {
      return { success: true };
    }

    const voice = this.voicePool.getVoiceBySourceId(sourceId);
    if (voice) {
      this.backend.stopVoice(voice.voiceId);
      this.backend.destroyVoice(voice.voiceId);
      this.voicePool.releaseVoice(voice.voiceId);
      this.soundResourceManager.releaseSoundResource(voice.audioAssetId);
    }

    this.sourcesById.set(
      sourceId,
      Object.freeze({
        ...source,
        playbackState: 'stopped',
        playbackPositionSeconds: 0,
      })
    );

    this.logger?.record(
      'audio',
      'INFO',
      `audio_playback_stopped: sourceId=${sourceId}`
    );
    return { success: true };
  }

  public stopAll(): { readonly stoppedCount: number } {
    let count = 0;
    for (const voice of this.voicePool.listActiveVoices()) {
      this.stopSource(voice.sourceId);
      count += 1;
    }
    return { stoppedCount: count };
  }

  public pauseWorld(): boolean {
    if (!this.transitionState('paused')) {
      return false;
    }
    for (const voice of this.voicePool.listActiveVoices()) {
      if (voice.state === 'playing') {
        this.backend.pauseVoice(voice.voiceId);
      }
    }
    this.logger?.record(
      'audio',
      'INFO',
      `audio_world_paused: worldId=${this.audioWorldId}`
    );
    return true;
  }

  public resumeWorld(): boolean {
    if (!this.transitionState('ready')) {
      return false;
    }
    for (const voice of this.voicePool.listActiveVoices()) {
      if (voice.state === 'playing') {
        this.backend.resumeVoice(voice.voiceId);
      }
    }
    this.logger?.record(
      'audio',
      'INFO',
      `audio_world_resumed: worldId=${this.audioWorldId}`
    );
    return true;
  }

  /**
   * Advances the `AudioWorld` deterministically by `deltaTimeSeconds`:
   * - Rejects updates when not in `'ready'` state (e.g. `'paused'`, `'uninitialized'`, or `'shutdown'`).
   * - Transitions `ready -> processing -> ready`.
   * - Updates spatial attenuation & stereo panning for all active voices.
   * - Advances playback positions, loops looping tracks, and releases completed non-looping voices.
   */
  public update(deltaTimeSeconds: number): {
    readonly success: boolean;
    readonly snapshot: AudioFrameSnapshot | null;
    readonly error?: string;
  } {
    if (this.state !== 'ready') {
      return {
        success: false,
        snapshot: null,
        error: `Cannot update AudioWorld '${this.audioWorldId}' in state '${this.state}' (expected 'ready').`,
      };
    }

    if (!isFiniteAudioNumber(deltaTimeSeconds) || deltaTimeSeconds < 0) {
      return {
        success: false,
        snapshot: null,
        error: `Invalid deltaTimeSeconds '${String(deltaTimeSeconds)}'; must be finite >= 0.`,
      };
    }

    if (!this.transitionState('processing')) {
      return {
        success: false,
        snapshot: null,
        error: 'Failed to transition AudioWorld to processing.',
      };
    }

    this.frameSequence += 1;
    this.refreshAllActiveVoiceMixes();

    const stepResult = this.voicePool.advancePlayback(deltaTimeSeconds);

    // Clean up finished non-looping voices and release their SoundResource references
    const finishedVoiceIds: AudioVoiceId[] = [];
    for (const finished of stepResult.finishedVoices) {
      finishedVoiceIds.push(finished.voiceId);
      this.backend.stopVoice(finished.voiceId);
      this.backend.destroyVoice(finished.voiceId);
      this.soundResourceManager.releaseSoundResource(finished.audioAssetId);

      const src = this.sourcesById.get(finished.sourceId);
      if (src) {
        this.sourcesById.set(
          src.sourceId,
          Object.freeze({
            ...src,
            playbackState: 'stopped',
            playbackPositionSeconds: 0,
          })
        );
      }
    }

    // Synchronize playbackPositionSeconds back onto active sources
    for (const activeVoice of stepResult.activeVoices) {
      const src = this.sourcesById.get(activeVoice.sourceId);
      if (src) {
        this.sourcesById.set(
          src.sourceId,
          Object.freeze({
            ...src,
            playbackPositionSeconds: activeVoice.playbackPositionSeconds,
          })
        );
      }
    }

    this.transitionState('ready');

    const activeListener = this.getActiveListener();
    const snapshot: AudioFrameSnapshot = Object.freeze({
      audioWorldId: this.audioWorldId,
      projectId: this.projectId,
      frameSequence: this.frameSequence,
      state: this.state,
      masterVolume: this.masterVolume,
      activeListenerId: activeListener ? activeListener.listenerId : null,
      activeVoiceCount: stepResult.activeVoices.length,
      maxVoices: this.voicePool.getMaxVoices(),
      activeVoices: stepResult.activeVoices,
      finishedVoiceIds: Object.freeze(finishedVoiceIds),
      loopedVoiceIds: stepResult.loopedVoiceIds,
    });

    return {
      success: true,
      snapshot,
    };
  }

  public listActiveVoices(): readonly AudioVoiceInstance[] {
    return this.voicePool.listActiveVoices();
  }

  public getActiveVoiceCount(): number {
    return this.voicePool.getActiveVoiceCount();
  }

  /**
   * Shuts down the `AudioWorld`, stopping all voices, releasing all audio resource references,
   * and shutting down the platform audio backend contract.
   */
  public shutdown(): {
    readonly success: boolean;
    readonly releasedVoicesCount: number;
    readonly error?: string;
  } {
    if (this.state === 'shutdown') {
      return {
        success: false,
        releasedVoicesCount: 0,
        error: `AudioWorld '${this.audioWorldId}' is already shut down.`,
      };
    }

    const stopRes = this.stopAll();
    this.sourcesById.clear();
    this.listenersById.clear();
    this.soundResourceManager.clearTrackedDescriptors();
    this.backend.shutdown();
    this.transitionState('shutdown');

    this.logger?.record(
      'audio',
      'INFO',
      `audio_world_shutdown: worldId=${this.audioWorldId} releasedVoices=${stopRes.stoppedCount}`
    );

    return {
      success: true,
      releasedVoicesCount: stopRes.stoppedCount,
    };
  }
}
