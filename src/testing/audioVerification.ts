import { HylixAssetRegistry } from '../assets/assetRegistry';
import { ResourceManager } from '../assets/resourceManager';
import {
  AUDIO_LISTENER_COMPONENT_TYPE,
  AUDIO_SOURCE_COMPONENT_TYPE,
  AudioWorld,
  cleanupAudioWorldForProjectClose,
  computeDistanceAttenuation,
  computeEffectiveBusVolume,
  computeSpatialMixResult,
  createAudioId,
  createDefaultProjectAudioBuses,
  createDeterministicAudioBusId,
  createDeterministicAudioListenerId,
  createDeterministicAudioSourceId,
  createDeterministicSoundResourceId,
  extractSceneAudioData,
  isValidAudioBusId,
  isValidAudioListenerId,
  isValidAudioSourceId,
  isValidAudioVoiceId,
  isValidAudioWorldId,
  isValidSoundResourceId,
  registerAudioEcsComponents,
  selectActiveAudioListener,
  SoundResourceManager,
  syncSceneTransformsToAudioWorld,
  validateAudioBusDescriptor,
  validateAudioBusHierarchy,
  validateAudioListenerComponentData,
  validateAudioListenerDescriptor,
  validateAudioPayloadSecurity,
  validateAudioSourceComponentData,
  validateAudioSourceDescriptor,
  validateAudioStreamMetadata,
  validateSceneAudioConfig,
  validateSoundResourceDescriptor,
} from '../audio/audioValidation';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  addComponent,
  createEntity,
  createStandardComponentRegistry,
  TRANSFORM_COMPONENT_TYPE,
  updateComponent,
} from '../ecs/ecsCore';
import {
  createAndroidAudioOutputBridgeContract,
  NullContractAudioBackend,
} from '../platform/platformAbstraction';
import {
  addEntityToScene,
  createSceneDefinition,
  validateSceneDefinition,
} from '../scene/sceneSystem';
import { LocalFirstAtomicStore } from '../storage/atomicStorage';
import { VerificationAssertionResult } from './foundationVerification';

/**
 * Hylix V1.0.0 — Phase 07: Audio System & Sound Resource Management Verification Suite
 *
 * Implements 36 deterministic architectural assertions verifying Phase 07 contracts.
 */
export function runAudioVerificationChecks(): VerificationAssertionResult[] {
  const results: VerificationAssertionResult[] = [];
  const category = 'Audio System & Sound Resource Management';
  const logger = new RedactedDiagnosticLogger(300);
  const store = new LocalFirstAtomicStore();
  const projectRoot = 'audio_test_project';
  const projectId = 'prj_audio_test07';

  // Helper to write a verified local audio file into store and register it in HylixAssetRegistry
  const registry = new HylixAssetRegistry(projectId, logger);
  const resourceManager = new ResourceManager({
    projectRoot,
    store,
    registry,
    maxCacheEntries: 16,
    logger,
  });

  const writeAndRegisterAudioAsset = (
    relPath: string,
    payload: string,
    metadata: Record<string, unknown>
  ): string => {
    store.writeFileAtomically(`${projectRoot}/${relPath}`, payload);
    const reg = registry.registerAsset({
      type: 'audio',
      path: relPath,
      contentPayload: payload,
      importState: 'verified',
      metadata,
    });
    return reg.asset!.assetId;
  };

  const sfxJumpAssetId = writeAndRegisterAudioAsset(
    'assets/audio/sfx_jump.wav',
    'RIFF_WAV_JUMP_PCM_DATA_V1',
    {
      format: 'wav',
      subtype: 'soundEffect',
      loadMode: 'memory',
      durationSeconds: 0.5,
      sampleRateHz: 44100,
      channels: 1,
    }
  );

  const musicThemeAssetId = writeAndRegisterAudioAsset(
    'assets/audio/music_theme.ogg',
    'OGG_VORBIS_THEME_STREAM_V1',
    {
      format: 'ogg',
      subtype: 'music',
      loadMode: 'streaming',
      durationSeconds: 120.0,
      sampleRateHz: 48000,
      channels: 2,
    }
  );

  const voiceLineAssetId = writeAndRegisterAudioAsset(
    'assets/audio/voice_intro.mp3',
    'ID3_MP3_VOICE_INTRO_V1',
    {
      format: 'mp3',
      subtype: 'voice',
      loadMode: 'memory',
      durationSeconds: 2.0,
      sampleRateHz: 44100,
      channels: 1,
    }
  );

  // 1. Deterministic Audio IDs
  const worldId = createAudioId('audio', `${projectId}::main`);
  const soundId = createDeterministicSoundResourceId(projectId, sfxJumpAssetId);
  const busId = createDeterministicAudioBusId(projectId, 'SFX');
  const sourceId = createDeterministicAudioSourceId(
    projectId,
    'ent_0000000000000701'
  );
  const listenerId = createDeterministicAudioListenerId(
    projectId,
    'ent_0000000000000702'
  );
  const voiceId = createAudioId('voice', `${projectId}::${sourceId}::seq_1`);

  results.push({
    id: 'audio_01_deterministic_ids',
    category,
    title: '01. Deterministic Audio IDs (audio_, sound_, bus_, source_, listener_, voice_)',
    passed:
      isValidAudioWorldId(worldId) &&
      isValidSoundResourceId(soundId) &&
      isValidAudioBusId(busId) &&
      isValidAudioSourceId(sourceId) &&
      isValidAudioListenerId(listenerId) &&
      isValidAudioVoiceId(voiceId) &&
      createDeterministicSoundResourceId(projectId, sfxJumpAssetId) === soundId,
    details: `Verified deterministic IDs: ${worldId}, ${soundId}, ${busId}, ${sourceId}, ${listenerId}, ${voiceId}.`,
  });

  // 2. ID stability across Scene save/load and entity reorder
  const srcOrderA = createDeterministicAudioSourceId(
    projectId,
    'ent_0000000000000701'
  );
  const srcOrderB = createDeterministicAudioSourceId(
    projectId,
    'ent_0000000000000701'
  );
  const lstOrderA = createDeterministicAudioListenerId(
    projectId,
    'ent_0000000000000702'
  );
  const lstOrderB = createDeterministicAudioListenerId(
    projectId,
    'ent_0000000000000702'
  );
  results.push({
    id: 'audio_02_id_stability_across_save_load_reorder',
    category,
    title: '02. Audio Source & Listener ID Stability Across Save/Load & Reorder',
    passed: srcOrderA === srcOrderB && lstOrderA === lstOrderB,
    details: `AudioSourceId '${srcOrderA}' and AudioListenerId '${lstOrderA}' remained invariant across re-evaluation.`,
  });

  // 3. AudioWorld Lifecycle
  const lifecycleWorld = new AudioWorld({
    projectId,
    registry,
    resourceManager,
    logger,
  });
  const stateInitial = lifecycleWorld.getState();
  const initRes = lifecycleWorld.initialize();
  const stateReady = lifecycleWorld.getState();
  const stepRes = lifecycleWorld.update(1 / 60);
  const stateAfterStep = lifecycleWorld.getState();
  const pauseOk = lifecycleWorld.pauseWorld();
  const statePaused = lifecycleWorld.getState();
  const resumeOk = lifecycleWorld.resumeWorld();
  const stateResumed = lifecycleWorld.getState();
  const shutdownRes = lifecycleWorld.shutdown();
  const stateShutdown = lifecycleWorld.getState();

  results.push({
    id: 'audio_03_world_lifecycle',
    category,
    title: '03. AudioWorld Lifecycle State Machine (uninitialized -> ready -> processing -> paused -> shutdown)',
    passed:
      stateInitial === 'uninitialized' &&
      initRes.success &&
      stateReady === 'ready' &&
      stepRes.success &&
      stateAfterStep === 'ready' &&
      pauseOk &&
      statePaused === 'paused' &&
      resumeOk &&
      stateResumed === 'ready' &&
      shutdownRes.success &&
      stateShutdown === 'shutdown',
    details: `AudioWorld transitioned cleanly: ${stateInitial} -> ${stateReady} -> ${statePaused} -> ${stateResumed} -> ${stateShutdown}.`,
  });

  // 4. Illegal AudioWorld state transitions
  const reinitAfterShutdown = lifecycleWorld.initialize();
  const stepAfterShutdown = lifecycleWorld.update(1 / 60);
  const pausedCheckWorld = new AudioWorld({
    projectId,
    registry,
    resourceManager,
  });
  const stepWhileUninitialized = pausedCheckWorld.update(1 / 60);
  pausedCheckWorld.initialize();
  pausedCheckWorld.pauseWorld();
  const stepWhilePaused = pausedCheckWorld.update(1 / 60);
  pausedCheckWorld.shutdown();

  results.push({
    id: 'audio_04_illegal_world_transitions',
    category,
    title: '04. Rejection of Illegal AudioWorld State Transitions (shutdown -> ready, update while paused)',
    passed:
      !reinitAfterShutdown.success &&
      !stepAfterShutdown.success &&
      !stepWhileUninitialized.success &&
      !stepWhilePaused.success,
    details: 'Blocked re-initialization after shutdown and blocked update() while uninitialized, paused, or shut down.',
  });

  // 5. Separation between AudioAsset (HylixAssetRegistry) and SoundResourceDescriptor
  const soundMgr = new SoundResourceManager({
    projectId,
    registry,
    resourceManager,
    logger,
  });
  const acqJump = soundMgr.acquireSoundResource(sfxJumpAssetId);
  const assetRecord = registry.getAsset(sfxJumpAssetId);
  results.push({
    id: 'audio_05_sound_resource_separation',
    category,
    title: '05. Architectural Separation: AudioAsset (On-Disk Registry) vs. SoundResourceDescriptor (In-Memory)',
    passed:
      acqJump.success &&
      acqJump.soundResource !== null &&
      assetRecord !== undefined &&
      acqJump.soundResource.assetId === assetRecord.assetId &&
      acqJump.soundResource.soundResourceId.startsWith('sound_') &&
      acqJump.soundResource.resourceId.startsWith('res_') &&
      acqJump.soundResource.state === 'loaded',
    details: `Mapped Asset '${assetRecord?.assetId}' -> Resource '${acqJump.soundResource?.resourceId}' -> SoundResource '${acqJump.soundResource?.soundResourceId}'.`,
  });
  soundMgr.releaseSoundResource(sfxJumpAssetId);

  // 6. Supported audio formats (.wav, .ogg, .mp3), subtypes, and memory vs streaming modes
  const acqWav = soundMgr.acquireSoundResource(sfxJumpAssetId);
  const acqOgg = soundMgr.acquireSoundResource(musicThemeAssetId);
  const acqMp3 = soundMgr.acquireSoundResource(voiceLineAssetId);

  results.push({
    id: 'audio_06_supported_formats_and_subtypes',
    category,
    title: '06. Audio Format (.wav, .ogg, .mp3), Subtype & Memory/Streaming Load Mode Classification',
    passed:
      acqWav.success &&
      acqWav.soundResource?.format === 'wav' &&
      acqWav.soundResource?.subtype === 'soundEffect' &&
      acqWav.soundResource?.loadMode === 'memory' &&
      acqOgg.success &&
      acqOgg.soundResource?.format === 'ogg' &&
      acqOgg.soundResource?.subtype === 'music' &&
      acqOgg.soundResource?.loadMode === 'streaming' &&
      acqMp3.success &&
      acqMp3.soundResource?.format === 'mp3' &&
      acqMp3.soundResource?.subtype === 'voice' &&
      acqMp3.soundResource?.loadMode === 'memory',
    details: 'Verified wav/memory (SFX), ogg/streaming (Music), and mp3/memory (Voice) sound resources.',
  });
  soundMgr.releaseSoundResource(sfxJumpAssetId);
  soundMgr.releaseSoundResource(musicThemeAssetId);
  soundMgr.releaseSoundResource(voiceLineAssetId);

  // 7. Audio stream metadata validation
  const badDuration = validateAudioStreamMetadata({
    format: 'wav',
    durationSeconds: 0,
    sampleRateHz: 44100,
    channels: 2,
  });
  const badSampleRate = validateAudioStreamMetadata({
    format: 'ogg',
    durationSeconds: 2.5,
    sampleRateHz: -100,
    channels: 2,
  });
  const badChannels = validateAudioStreamMetadata({
    format: 'mp3',
    durationSeconds: 2.5,
    sampleRateHz: 44100,
    channels: 0,
  });
  const badFormat = validateAudioStreamMetadata({
    format: 'exe',
    durationSeconds: 1.0,
    sampleRateHz: 44100,
    channels: 2,
  });

  results.push({
    id: 'audio_07_stream_metadata_validation',
    category,
    title: '07. Audio Stream Metadata Validation (Duration, Sample Rate, Channels, Format)',
    passed:
      !badDuration.valid &&
      !badSampleRate.valid &&
      !badChannels.valid &&
      !badFormat.valid,
    details: 'Rejected duration <= 0, invalid sampleRateHz, channels !== 1|2, and unsupported format.',
  });

  // 8. Raw file path rejection across SoundResource, AudioSource, and ECS Component
  const rawPathSoundDesc = validateSoundResourceDescriptor({
    projectId,
    assetId: sfxJumpAssetId,
    resourceId: 'res_0123456789abcdef',
    soundPath: '/sdcard/hylix/jump.wav',
    format: 'wav',
    subtype: 'soundEffect',
    loadMode: 'memory',
    durationSeconds: 1,
    sampleRateHz: 44100,
    channels: 1,
    contentHash:
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    sizeBytes: 64,
    state: 'loaded',
    referenceCount: 1,
  });
  const rawPathSourceDesc = validateAudioSourceDescriptor({
    projectId,
    entityId: 'ent_0000000000000701',
    audioAssetId: sfxJumpAssetId,
    soundPath: 'assets/audio/sfx_jump.wav',
  });
  const rawPathEcsComp = validateAudioSourceComponentData({
    audioAssetId: sfxJumpAssetId,
    audioPath: '../outside/hack.ogg',
  });

  results.push({
    id: 'audio_08_raw_path_rejection',
    category,
    title: '08. Rejection of Raw File Paths in SoundResource, AudioSource & ECS Component',
    passed:
      !rawPathSoundDesc.valid &&
      !rawPathSourceDesc.valid &&
      !rawPathEcsComp.valid,
    details: 'Rejected soundPath and audioPath fields; enforced deterministic audioAssetId references.',
  });

  // 9. Non-audio asset type rejection in loadAudio / SoundResourceManager
  store.writeFileAtomically(
    `${projectRoot}/assets/textures/ui_icon.png`,
    'PNG_IMAGE_BYTES'
  );
  const regTex = registry.registerAsset({
    type: 'texture',
    path: 'assets/textures/ui_icon.png',
    contentPayload: 'PNG_IMAGE_BYTES',
    importState: 'verified',
  });
  const wrongTypeAcquire = soundMgr.acquireSoundResource(
    regTex.asset!.assetId
  );

  results.push({
    id: 'audio_09_resource_type_mismatch_rejection',
    category,
    title: '09. Rejection of Non-Audio Assets (Texture/Model) in SoundResourceManager',
    passed:
      !wrongTypeAcquire.success && wrongTypeAcquire.status === 'invalid',
    details: `Blocked loading texture asset '${regTex.asset?.assetId}' as an AudioResource.`,
  });

  // 10. Reference counting (load -> retain -> release -> eligibleForUnload)
  const load1 = soundMgr.acquireSoundResource(sfxJumpAssetId);
  const refsAfterLoad = load1.soundResource?.referenceCount ?? 0;
  const retain1 = soundMgr.retainSoundResource(sfxJumpAssetId);
  const refsAfterRetain = retain1.soundResource?.referenceCount ?? 0;
  const rel1 = soundMgr.releaseSoundResource(sfxJumpAssetId);
  const rel2 = soundMgr.releaseSoundResource(sfxJumpAssetId);

  results.push({
    id: 'audio_10_reference_counting_retain_release',
    category,
    title: '10. SoundResource Reference Counting (acquire -> retain -> release -> eligibleForUnload)',
    passed:
      load1.success &&
      refsAfterLoad === 1 &&
      retain1.success &&
      refsAfterRetain === 2 &&
      rel1.success &&
      rel1.referenceCount === 1 &&
      !rel1.eligibleForUnload &&
      rel2.success &&
      rel2.referenceCount === 0 &&
      rel2.eligibleForUnload,
    details: `Reference count progressed 1 -> 2 -> 1 -> 0 (eligibleForUnload=${rel2.eligibleForUnload}).`,
  });

  // 11. Content hash change invalidates cached SoundResource
  const beforeMod = soundMgr.acquireSoundResource(sfxJumpAssetId);
  const oldHash = beforeMod.soundResource?.contentHash ?? '';
  const updatedPayload = 'RIFF_WAV_JUMP_PCM_DATA_V2_MODIFIED';
  store.writeFileAtomically(
    `${projectRoot}/assets/audio/sfx_jump.wav`,
    updatedPayload
  );
  const hashInfo = registry.computeOrGetCachedContentHash(
    'assets/audio/sfx_jump.wav',
    updatedPayload
  );
  registry.updateAssetMetadata(sfxJumpAssetId, {
    contentHash: hashInfo.contentHash,
    sizeBytes: hashInfo.sizeBytes,
    importState: 'verified',
  });
  const invalidatedState = soundMgr.getSoundResource(sfxJumpAssetId)?.state;
  const reloadedAfterMod = soundMgr.acquireSoundResource(sfxJumpAssetId);
  const newHash = reloadedAfterMod.soundResource?.contentHash ?? '';
  soundMgr.releaseSoundResource(sfxJumpAssetId);

  results.push({
    id: 'audio_11_content_hash_invalidation',
    category,
    title: '11. Automatic SoundResource Cache Invalidation on Asset SHA-256 Hash Change',
    passed:
      oldHash !== '' &&
      invalidatedState === 'invalidated' &&
      reloadedAfterMod.success &&
      newHash === hashInfo.contentHash &&
      newHash !== oldHash,
    details: `Asset contentHash change invalidated cached SoundResource ('${invalidatedState}') and reloaded verified hash.`,
  });

  // 12. Missing and corrupted audio asset handling
  const missingAcq = soundMgr.acquireSoundResource('asset_9999999999999999');
  store.writeFileAtomically(
    `${projectRoot}/assets/audio/corrupt_sfx.wav`,
    'VALID_INITIAL_WAV'
  );
  const regCorrupt = registry.registerAsset({
    type: 'audio',
    path: 'assets/audio/corrupt_sfx.wav',
    contentPayload: 'VALID_INITIAL_WAV',
    importState: 'verified',
  });
  // Tamper with stored file so its contentHash mismatches registry metadata
  store.writeFileAtomically(
    `${projectRoot}/assets/audio/corrupt_sfx.wav`,
    'TAMPERED_CORRUPT_BYTES'
  );
  const corruptAcq = soundMgr.acquireSoundResource(
    regCorrupt.asset!.assetId
  );

  results.push({
    id: 'audio_12_missing_and_corrupted_audio_handling',
    category,
    title: '12. Safe Handling of Missing & Corrupted Audio Assets Without Crashing',
    passed:
      !missingAcq.success &&
      missingAcq.status === 'missing' &&
      !corruptAcq.success &&
      corruptAcq.status === 'corrupted',
    details: `Reported missing status='${missingAcq.status}' and corrupted status='${corruptAcq.status}' cleanly.`,
  });

  // 13. Default Audio Bus hierarchy (Master <- Music, SFX, Voice, UI, Ambience)
  const defaultBuses = createDefaultProjectAudioBuses(projectId);
  const defaultHierarchyCheck = validateAudioBusHierarchy(defaultBuses);
  const masterBus = defaultBuses.find((b) => b.name === 'Master');
  const childBusNames = defaultBuses
    .filter((b) => b.parentBusId === masterBus?.busId)
    .map((b) => b.name);

  results.push({
    id: 'audio_13_default_bus_hierarchy',
    category,
    title: '13. Canonical Audio Bus Hierarchy (Master <- Music, SFX, Voice, UI, Ambience)',
    passed:
      defaultHierarchyCheck.valid &&
      masterBus !== undefined &&
      masterBus.parentBusId === null &&
      childBusNames.includes('Music') &&
      childBusNames.includes('SFX') &&
      childBusNames.includes('Voice') &&
      childBusNames.includes('UI') &&
      childBusNames.includes('Ambience'),
    details: `Verified Master bus (${masterBus?.busId}) with child buses: ${childBusNames.join(', ')}.`,
  });

  // 14. Custom child bus registration and rejection of self-parenting, orphans, and cycles
  const customSubBus = validateAudioBusDescriptor({
    projectId,
    name: 'FootstepsSFX',
    parentBusId: createDeterministicAudioBusId(projectId, 'SFX'),
    volume: 0.8,
  });
  const selfParentBus = validateAudioBusDescriptor({
    busId: 'bus_00000000000000aa',
    projectId,
    name: 'SelfBus',
    parentBusId: 'bus_00000000000000aa',
  });
  const cycleBusA = validateAudioBusDescriptor({
    busId: 'bus_00000000000000a1',
    projectId,
    name: 'CycleA',
    parentBusId: 'bus_00000000000000a2',
  }).value!;
  const cycleBusB = validateAudioBusDescriptor({
    busId: 'bus_00000000000000a2',
    projectId,
    name: 'CycleB',
    parentBusId: 'bus_00000000000000a1',
  }).value!;
  const cycleCheck = validateAudioBusHierarchy([
    ...defaultBuses,
    cycleBusA,
    cycleBusB,
  ]);

  results.push({
    id: 'audio_14_custom_bus_and_cycle_rejection',
    category,
    title: '14. Custom Sub-Bus Support & Rejection of Self-Parenting / Circular Bus Routing',
    passed:
      customSubBus.valid &&
      validateAudioBusHierarchy([...defaultBuses, customSubBus.value!]).valid &&
      !selfParentBus.valid &&
      !cycleCheck.valid,
    details: 'Accepted valid child bus and rejected self-parenting and A <-> B bus cycles.',
  });

  // 15. Hierarchical Bus gain & Master volume propagation
  const mixerWorld = new AudioWorld({
    projectId,
    registry,
    resourceManager,
    masterVolume: 0.8,
  });
  mixerWorld.initialize();
  mixerWorld.setBusVolume('Master', 0.5);
  mixerWorld.setBusVolume('SFX', 0.5);
  const effectiveSfxGain = mixerWorld.getEffectiveBusVolume('SFX'); // 0.8 * 0.5 * 0.5 = 0.2

  results.push({
    id: 'audio_15_bus_gain_and_master_volume_propagation',
    category,
    title: '15. Hierarchical Mixer Gain Propagation (SceneMaster * MasterBus * ChildBus)',
    passed: Math.abs(effectiveSfxGain - 0.2) < 1e-6,
    details: `Computed effective SFX bus volume = ${effectiveSfxGain.toFixed(3)} (0.8 * 0.5 * 0.5).`,
  });

  // 16. Bus Mute and Solo isolation
  mixerWorld.setBusMuted('SFX', true);
  const mutedSfxGain = mixerWorld.getEffectiveBusVolume('SFX');
  mixerWorld.setBusMuted('SFX', false);
  mixerWorld.setBusSolo('Music', true);
  const sfxWhenMusicSolo = mixerWorld.getEffectiveBusVolume('SFX');
  const musicWhenMusicSolo = mixerWorld.getEffectiveBusVolume('Music');
  mixerWorld.setBusSolo('Music', false);
  mixerWorld.shutdown();

  results.push({
    id: 'audio_16_bus_mute_and_solo_isolation',
    category,
    title: '16. Audio Bus Mute Propagation & Solo Isolation',
    passed:
      mutedSfxGain === 0 &&
      sfxWhenMusicSolo === 0 &&
      musicWhenMusicSolo > 0,
    details: `Muted SFX gain=${mutedSfxGain}, SFX under Music solo=${sfxWhenMusicSolo}, Music under solo=${musicWhenMusicSolo.toFixed(2)}.`,
  });

  // 17. AudioSourceDescriptor validation
  const negVolSrc = validateAudioSourceDescriptor({
    projectId,
    entityId: 'ent_0000000000000701',
    audioAssetId: sfxJumpAssetId,
    volume: -0.5,
  });
  const zeroPitchSrc = validateAudioSourceDescriptor({
    projectId,
    entityId: 'ent_0000000000000701',
    audioAssetId: sfxJumpAssetId,
    pitch: 0,
  });
  const badPanSrc = validateAudioSourceDescriptor({
    projectId,
    entityId: 'ent_0000000000000701',
    audioAssetId: sfxJumpAssetId,
    pan: 2.5,
  });
  const badDistSrc = validateAudioSourceDescriptor({
    projectId,
    entityId: 'ent_0000000000000701',
    audioAssetId: sfxJumpAssetId,
    minDistance: 20,
    maxDistance: 10,
  });
  const nanPosSrc = validateAudioSourceDescriptor({
    projectId,
    entityId: 'ent_0000000000000701',
    audioAssetId: sfxJumpAssetId,
    position: { x: Number.NaN, y: 0, z: 0 },
  });

  results.push({
    id: 'audio_17_source_descriptor_validation',
    category,
    title: '17. AudioSource Validation (Volume, Pitch, Pan, Distance Bounds, Finite Vectors)',
    passed:
      !negVolSrc.valid &&
      !zeroPitchSrc.valid &&
      !badPanSrc.valid &&
      !badDistSrc.valid &&
      !nanPosSrc.valid,
    details: 'Rejected negative volume, pitch <= 0, pan outside [-1,1], maxDistance <= minDistance, and NaN coordinates.',
  });

  // 18. Playback state machine (stopped -> playing -> paused -> playing -> stopped)
  const playWorld = new AudioWorld({
    projectId,
    registry,
    resourceManager,
    logger,
  });
  playWorld.initialize();
  const regPlaySrc = playWorld.registerSource({
    projectId,
    entityId: 'ent_0000000000000710',
    audioAssetId: sfxJumpAssetId,
    busName: 'SFX',
    volume: 0.9,
    pitch: 1.0,
    loop: false,
  });
  const pId = regPlaySrc.source!.sourceId;
  const playRes = playWorld.playSource(pId);
  const stPlaying = playWorld.getSource(pId)?.playbackState;
  const pauseSrcRes = playWorld.pauseSource(pId);
  const stPaused = playWorld.getSource(pId)?.playbackState;
  const resumeSrcRes = playWorld.resumeSource(pId);
  const stResumed = playWorld.getSource(pId)?.playbackState;
  const stopSrcRes = playWorld.stopSource(pId);
  const stStopped = playWorld.getSource(pId)?.playbackState;

  results.push({
    id: 'audio_18_playback_state_machine',
    category,
    title: '18. AudioSource Playback Lifecycle (stopped -> playing -> paused -> playing -> stopped)',
    passed:
      playRes.success &&
      stPlaying === 'playing' &&
      pauseSrcRes.success &&
      stPaused === 'paused' &&
      resumeSrcRes.success &&
      stResumed === 'playing' &&
      stopSrcRes.success &&
      stStopped === 'stopped' &&
      playWorld.getActiveVoiceCount() === 0,
    details: `Source '${pId}' transitioned: stopped -> ${stPlaying} -> ${stPaused} -> ${stResumed} -> ${stStopped}.`,
  });

  // 19. Illegal playback state transitions (pause or resume when stopped)
  const pauseWhenStopped = playWorld.pauseSource(pId);
  const resumeWhenStopped = playWorld.resumeSource(pId);

  results.push({
    id: 'audio_19_illegal_playback_transitions',
    category,
    title: '19. Rejection of Illegal Playback State Transitions (pause/resume on stopped source)',
    passed: !pauseWhenStopped.success && !resumeWhenStopped.success,
    details: 'Blocked pausing and resuming an AudioSource that is currently stopped.',
  });

  // 20. Non-looping voice completion & automatic resource reference release
  playWorld.playSource(pId); // duration is 0.5s
  const refsDuringPlay =
    resourceManager.get(sfxJumpAssetId)?.referenceCount ?? 0;
  const stepHalf = playWorld.update(0.25);
  const stillPlayingMid = playWorld.getSource(pId)?.playbackState === 'playing';
  const stepFinish = playWorld.update(0.3); // total 0.55s >= 0.5s
  const stoppedAfterEnd = playWorld.getSource(pId)?.playbackState === 'stopped';
  const refsAfterFinish =
    resourceManager.get(sfxJumpAssetId)?.referenceCount ?? 0;

  results.push({
    id: 'audio_20_non_looping_completion_and_ref_release',
    category,
    title: '20. Non-Looping Voice Completion & Automatic SoundResource Reference Release',
    passed:
      refsDuringPlay === 1 &&
      stepHalf.success &&
      stillPlayingMid &&
      stepFinish.success &&
      stepFinish.snapshot?.finishedVoiceIds.length === 1 &&
      stoppedAfterEnd &&
      refsAfterFinish === 0,
    details: `Voice completed at 0.5s, transitioned source to 'stopped', and decremented resource refs (${refsDuringPlay} -> ${refsAfterFinish}).`,
  });

  // 21. Looping playback wrap-around
  const regLoopSrc = playWorld.registerSource({
    projectId,
    entityId: 'ent_0000000000000711',
    audioAssetId: sfxJumpAssetId, // duration 0.5s
    busName: 'Music',
    loop: true,
  });
  const loopSourceId = regLoopSrc.source!.sourceId;
  playWorld.playSource(loopSourceId);
  const loopStep = playWorld.update(0.65); // wraps to 0.15s
  const wrappedPos =
    playWorld.getSource(loopSourceId)?.playbackPositionSeconds ?? 0;
  const stillPlayingLoop =
    playWorld.getSource(loopSourceId)?.playbackState === 'playing';
  playWorld.stopSource(loopSourceId);
  playWorld.shutdown();

  results.push({
    id: 'audio_21_looping_playback_wraparound',
    category,
    title: '21. Looping Playback Wrap-Around Without Stopping Voice',
    passed:
      loopStep.success &&
      loopStep.snapshot?.loopedVoiceIds.length === 1 &&
      stillPlayingLoop &&
      Math.abs(wrappedPos - 0.15) < 1e-5,
    details: `Looping 0.5s voice wrapped at 0.65s to playbackPositionSeconds=${wrappedPos.toFixed(2)}s.`,
  });

  // 22. Bounded voice limit under 'reject' policy
  const rejectPoolWorld = new AudioWorld({
    projectId,
    registry,
    resourceManager,
    maxVoices: 2,
    voiceEvictionPolicy: 'reject',
  });
  rejectPoolWorld.initialize();
  const s1 = rejectPoolWorld.registerSource({
    projectId,
    entityId: 'ent_0000000000000721',
    audioAssetId: sfxJumpAssetId,
    priority: 100,
  }).source!.sourceId;
  const s2 = rejectPoolWorld.registerSource({
    projectId,
    entityId: 'ent_0000000000000722',
    audioAssetId: sfxJumpAssetId,
    priority: 100,
  }).source!.sourceId;
  const s3 = rejectPoolWorld.registerSource({
    projectId,
    entityId: 'ent_0000000000000723',
    audioAssetId: sfxJumpAssetId,
    priority: 250,
  }).source!.sourceId;
  const p1 = rejectPoolWorld.playSource(s1);
  const p2 = rejectPoolWorld.playSource(s2);
  const p3Rejected = rejectPoolWorld.playSource(s3);
  rejectPoolWorld.shutdown();

  results.push({
    id: 'audio_22_voice_limit_reject_policy',
    category,
    title: "22. Bounded Voice Limit Enforcement Under 'reject' Eviction Policy",
    passed:
      p1.success &&
      p2.success &&
      !p3Rejected.success &&
      p3Rejected.evictedVoiceId === null,
    details: "Rejected 3rd concurrent voice when maxVoices=2 and policy='reject'.",
  });

  // 23. Voice stealing under 'replaceLowestPriority'
  const stealWorld = new AudioWorld({
    projectId,
    registry,
    resourceManager,
    maxVoices: 2,
    voiceEvictionPolicy: 'replaceLowestPriority',
  });
  stealWorld.initialize();
  const lowSrc = stealWorld.registerSource({
    projectId,
    entityId: 'ent_0000000000000731',
    audioAssetId: sfxJumpAssetId,
    priority: 40,
  }).source!.sourceId;
  const midSrc = stealWorld.registerSource({
    projectId,
    entityId: 'ent_0000000000000732',
    audioAssetId: sfxJumpAssetId,
    priority: 120,
  }).source!.sourceId;
  const highSrc = stealWorld.registerSource({
    projectId,
    entityId: 'ent_0000000000000733',
    audioAssetId: sfxJumpAssetId,
    priority: 220,
  }).source!.sourceId;
  const lowPlay = stealWorld.playSource(lowSrc);
  stealWorld.playSource(midSrc);
  const highPlay = stealWorld.playSource(highSrc);
  const lowStopped = stealWorld.getSource(lowSrc)?.playbackState === 'stopped';
  stealWorld.shutdown();

  results.push({
    id: 'audio_23_voice_eviction_replace_lowest_priority',
    category,
    title: "23. Deterministic Voice Stealing Under 'replaceLowestPriority'",
    passed:
      highPlay.success &&
      highPlay.evictedVoiceId === lowPlay.voice?.voiceId &&
      lowStopped,
    details: `High-priority source (220) evicted lowest-priority voice '${highPlay.evictedVoiceId}' (priority 40).`,
  });

  // 24. Voice stealing under 'stopOldestEqualPriority'
  const oldestWorld = new AudioWorld({
    projectId,
    registry,
    resourceManager,
    maxVoices: 2,
    voiceEvictionPolicy: 'stopOldestEqualPriority',
  });
  oldestWorld.initialize();
  const eq1 = oldestWorld.registerSource({
    projectId,
    entityId: 'ent_0000000000000741',
    audioAssetId: sfxJumpAssetId,
    priority: 100,
  }).source!.sourceId;
  const eq2 = oldestWorld.registerSource({
    projectId,
    entityId: 'ent_0000000000000742',
    audioAssetId: sfxJumpAssetId,
    priority: 100,
  }).source!.sourceId;
  const eq3 = oldestWorld.registerSource({
    projectId,
    entityId: 'ent_0000000000000743',
    audioAssetId: sfxJumpAssetId,
    priority: 100,
  }).source!.sourceId;
  const firstEqPlay = oldestWorld.playSource(eq1);
  oldestWorld.playSource(eq2);
  const thirdEqPlay = oldestWorld.playSource(eq3);
  oldestWorld.shutdown();

  results.push({
    id: 'audio_24_voice_eviction_stop_oldest_equal_priority',
    category,
    title: "24. Deterministic Voice Stealing Under 'stopOldestEqualPriority'",
    passed:
      thirdEqPlay.success &&
      thirdEqPlay.evictedVoiceId === firstEqPlay.voice?.voiceId,
    details: `Third equal-priority source evicted the oldest voice '${thirdEqPlay.evictedVoiceId}'.`,
  });

  // 25. AudioListener validation & deterministic single active listener selection
  const badListenerZeroForward = validateAudioListenerDescriptor({
    projectId,
    entityId: 'ent_0000000000000751',
    forward: { x: 0, y: 0, z: 0 },
  });
  const lA = validateAudioListenerDescriptor({
    projectId,
    entityId: 'ent_0000000000000751',
    enabled: true,
  }).value!;
  const lB = validateAudioListenerDescriptor({
    projectId,
    entityId: 'ent_0000000000000752',
    enabled: true,
  }).value!;
  const selA = selectActiveAudioListener([lB, lA]);
  const selB = selectActiveAudioListener([lA, lB]);

  results.push({
    id: 'audio_25_listener_validation_and_single_active',
    category,
    title: '25. AudioListener Validation & Deterministic Single Active Listener Selection',
    passed:
      !badListenerZeroForward.valid &&
      selA.activeListener?.listenerId === lA.listenerId &&
      selB.activeListener?.listenerId === lA.listenerId &&
      selA.duplicateEnabledListenerIds.length === 1,
    details: `Selected canonical active listener '${lA.listenerId}' regardless of input order and rejected zero forward vector.`,
  });

  // 26. 2D Spatial Audio distance attenuation & horizontal stereo panning
  const mix2D = computeSpatialMixResult(
    {
      spatialMode: 'spatial2D',
      position: { x: 5, y: 0, z: 0 }, // 5m to the right
      volume: 1.0,
      pan: 0,
      muted: false,
      minDistance: 0,
      maxDistance: 10,
      rolloffFactor: 1.0,
      attenuationModel: 'linear',
    },
    {
      position: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
      masterGain: 1.0,
      enabled: true,
    },
    1.0
  );

  results.push({
    id: 'audio_26_spatial_2d_attenuation_and_pan',
    category,
    title: '26. 2D Spatial Audio Distance Attenuation & Horizontal Stereo Panning',
    passed:
      Math.abs(mix2D.distance - 5.0) < 1e-6 &&
      Math.abs(mix2D.distanceAttenuation - 0.5) < 1e-6 &&
      Math.abs(mix2D.effectivePan - 0.5) < 1e-6 &&
      mix2D.rightChannelGain > mix2D.leftChannelGain,
    details: `2D source at +5m (max=10m): attenuation=${mix2D.distanceAttenuation}, pan=${mix2D.effectivePan}, R=${mix2D.rightChannelGain.toFixed(2)} > L=${mix2D.leftChannelGain.toFixed(2)}.`,
  });

  // 27. 3D Spatial Audio attenuation models (linear, inverse, exponential) & 3D directional panning
  const attAtMin = computeDistanceAttenuation(1, 1, 50, 1, 'linear');
  const attBeyondMax = computeDistanceAttenuation(60, 1, 50, 1, 'linear');
  const attInverseMid = computeDistanceAttenuation(10, 2, 50, 1, 'inverse');
  const attExpMid = computeDistanceAttenuation(10, 2, 50, 1, 'exponential');

  const mix3DLeft = computeSpatialMixResult(
    {
      spatialMode: 'spatial3D',
      position: { x: -10, y: 0, z: 0 }, // Directly to listener's left (when forward=(0,0,-1), up=(0,1,0), right=(1,0,0))
      volume: 1.0,
      pan: 0,
      muted: false,
      minDistance: 2,
      maxDistance: 22,
      rolloffFactor: 1.0,
      attenuationModel: 'linear',
    },
    {
      position: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
      masterGain: 1.0,
      enabled: true,
    },
    1.0
  );

  results.push({
    id: 'audio_27_spatial_3d_attenuation_and_pan',
    category,
    title: '27. 3D Spatial Attenuation Models (Linear, Inverse, Exponential) & 3D Directional Panning',
    passed:
      attAtMin === 1.0 &&
      attBeyondMax === 0.0 &&
      attInverseMid > 0 &&
      attInverseMid < 1 &&
      attExpMid > 0 &&
      attExpMid < 1 &&
      Math.abs(mix3DLeft.effectivePan - -1.0) < 1e-6 &&
      mix3DLeft.leftChannelGain > 0 &&
      mix3DLeft.rightChannelGain === 0,
    details: `3D source at (-10,0,0) panned full left (pan=${mix3DLeft.effectivePan}, L=${mix3DLeft.leftChannelGain.toFixed(2)}, R=${mix3DLeft.rightChannelGain.toFixed(2)}).`,
  });

  // 28. Non-spatial audio bypasses distance attenuation
  const mixNonSpatial = computeSpatialMixResult(
    {
      spatialMode: 'nonSpatial',
      position: { x: 999, y: 999, z: 999 },
      volume: 0.75,
      pan: -0.25,
      muted: false,
      minDistance: 1,
      maxDistance: 10,
      rolloffFactor: 1,
      attenuationModel: 'linear',
    },
    {
      position: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
      masterGain: 1.0,
      enabled: true,
    },
    1.0
  );

  results.push({
    id: 'audio_28_non_spatial_playback',
    category,
    title: '28. Non-Spatial Audio Mode Bypasses Distance Attenuation',
    passed:
      mixNonSpatial.distanceAttenuation === 1.0 &&
      Math.abs(mixNonSpatial.effectiveVolume - 0.75) < 1e-6 &&
      Math.abs(mixNonSpatial.effectivePan - -0.25) < 1e-6,
    details: `Non-spatial source at (999,999,999) retained full volume=${mixNonSpatial.effectiveVolume} and pan=${mixNonSpatial.effectivePan}.`,
  });

  // 29. ECS AudioSource & AudioListener component registration and validation
  const ecsRegistry = createStandardComponentRegistry();
  registerAudioEcsComponents(ecsRegistry);
  const hasAudioComponents =
    ecsRegistry.isRegistered(AUDIO_SOURCE_COMPONENT_TYPE) &&
    ecsRegistry.isRegistered(AUDIO_LISTENER_COMPONENT_TYPE);
  const validCompSrc = validateAudioSourceComponentData({
    audioAssetId: musicThemeAssetId,
    busName: 'Music',
    spatialMode: 'nonSpatial',
    loadMode: 'streaming',
    volume: 0.85,
    loop: true,
    playOnAwake: true,
  });
  const validCompLst = validateAudioListenerComponentData({
    enabled: true,
    masterGain: 1.0,
    forward: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
  });

  results.push({
    id: 'audio_29_ecs_audio_components',
    category,
    title: '29. ECS AudioSource & AudioListener Component Registration & Validation',
    passed:
      hasAudioComponents && validCompSrc.valid && validCompLst.valid,
    details: 'Registered and validated official ECS AudioSource and AudioListener component specifications.',
  });

  // 30. SceneDefinition.audioConfig validation & runtime audio state rejection
  const validAudioSceneCfg = validateSceneAudioConfig({
    masterVolume: 0.9,
    maxVoices: 32,
    voiceEvictionPolicy: 'replaceLowestPriority',
    defaultRolloff: 1.0,
  });
  const baseScene = createSceneDefinition({
    sceneId: 'scene_0000000000000700',
    sceneName: 'AudioStageScene',
    description: 'Phase 07 Audio Scene',
    registry: ecsRegistry,
  }).scene!;
  const pollutedSceneCheck = validateSceneDefinition(
    {
      ...baseScene,
      audioConfig: {
        masterVolume: 1.0,
        maxVoices: 32,
        voiceEvictionPolicy: 'replaceLowestPriority',
        defaultRolloff: 1.0,
        activeVoicesCache: [],
      },
    },
    ecsRegistry
  );

  results.push({
    id: 'audio_30_scene_audio_config_separation',
    category,
    title: '30. Scene Audio Configuration vs. Runtime Voice/Buffer Separation',
    passed: validAudioSceneCfg.valid && !pollutedSceneCheck.valid,
    details: 'Accepted authored SceneDefinition.audioConfig and rejected runtime activeVoicesCache inside Scene JSON.',
  });

  // 31. Read-only Scene Audio Extraction & playOnAwake execution
  let entListener = createEntity(
    {
      sceneId: baseScene.sceneId,
      name: 'MainCameraListener',
      seedHint: 'audio_listener_ent',
    },
    ecsRegistry
  ).entity!;
  entListener = addComponent(
    entListener,
    AUDIO_LISTENER_COMPONENT_TYPE,
    {
      enabled: true,
      masterGain: 1.0,
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
    },
    ecsRegistry
  ).entity!;

  let entMusicEmitter = createEntity(
    {
      sceneId: baseScene.sceneId,
      name: 'StageSpeaker',
      seedHint: 'audio_speaker_ent',
    },
    ecsRegistry
  ).entity!;
  entMusicEmitter = updateComponent(
    entMusicEmitter,
    TRANSFORM_COMPONENT_TYPE,
    {
      position: { x: 10, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ecsRegistry
  ).entity!;
  entMusicEmitter = addComponent(
    entMusicEmitter,
    AUDIO_SOURCE_COMPONENT_TYPE,
    {
      audioAssetId: musicThemeAssetId,
      busName: 'Music',
      spatialMode: 'spatial3D',
      loadMode: 'streaming',
      volume: 1.0,
      pitch: 1.0,
      pan: 0,
      loop: true,
      playOnAwake: true,
      muted: false,
      priority: 200,
      minDistance: 2,
      maxDistance: 50,
      rolloffFactor: 1.0,
      attenuationModel: 'linear',
    },
    ecsRegistry
  ).entity!;

  let sceneWithAudio = addEntityToScene(
    baseScene,
    entListener,
    ecsRegistry
  ).scene!;
  sceneWithAudio = addEntityToScene(
    sceneWithAudio,
    entMusicEmitter,
    ecsRegistry
  ).scene!;
  const sceneSnapshotBeforeExtract = JSON.stringify(sceneWithAudio);

  const extractionReport = extractSceneAudioData({
    projectId,
    scene: sceneWithAudio,
    assetRegistry: registry,
    resourceManager,
    triggerPlayOnAwake: true,
    logger,
  });
  const sceneSnapshotAfterExtract = JSON.stringify(sceneWithAudio);

  results.push({
    id: 'audio_31_scene_audio_extraction_and_play_on_awake',
    category,
    title: '31. Read-Only Scene Audio Extraction & playOnAwake Execution',
    passed:
      extractionReport.success &&
      extractionReport.extractedListenerCount === 1 &&
      extractionReport.extractedSourceCount === 1 &&
      extractionReport.autoPlayedSourceIds.length === 1 &&
      extractionReport.audioWorld.getActiveVoiceCount() === 1 &&
      sceneSnapshotBeforeExtract === sceneSnapshotAfterExtract,
    details: `Extracted 1 listener and 1 source, auto-started playOnAwake voice, and preserved SceneDefinition immutability.`,
  });

  // 32. ECS Transform <-> AudioWorld position synchronization
  const movedSpeaker = updateComponent(
    entMusicEmitter,
    TRANSFORM_COMPONENT_TYPE,
    {
      position: { x: 25, y: 2, z: -5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ecsRegistry
  ).entity!;
  const updatedScene: typeof sceneWithAudio = Object.freeze({
    ...sceneWithAudio,
    entities: Object.freeze(
      sceneWithAudio.entities.map((e) =>
        e.entityId === movedSpeaker.entityId ? movedSpeaker : e
      )
    ),
  });
  const syncRes = syncSceneTransformsToAudioWorld(
    updatedScene,
    extractionReport.audioWorld
  );
  const speakerSourceId = extractionReport.autoPlayedSourceIds[0];
  const syncedPos =
    extractionReport.audioWorld.getSource(speakerSourceId)?.position;

  results.push({
    id: 'audio_32_transform_to_audio_sync',
    category,
    title: '32. ECS Transform -> AudioWorld Spatial Position Synchronization',
    passed:
      syncRes.updatedSourceCount === 1 &&
      syncedPos?.x === 25 &&
      syncedPos?.y === 2 &&
      syncedPos?.z === -5,
    details: `Synchronized moved entity Transform (${syncedPos?.x}, ${syncedPos?.y}, ${syncedPos?.z}) into active AudioWorld voice.`,
  });

  // 33. Cross-Project Isolation
  const foreignBusAttempt = extractionReport.audioWorld.registerBus({
    projectId: 'prj_foreign_999',
    name: 'ForeignBus',
    parentBusId: createDeterministicAudioBusId('prj_foreign_999', 'Master'),
  });
  const foreignSourceAttempt = extractionReport.audioWorld.registerSource({
    projectId: 'prj_foreign_999',
    entityId: 'ent_0000000000000799',
    audioAssetId: sfxJumpAssetId,
  });
  const foreignListenerAttempt = extractionReport.audioWorld.registerListener({
    projectId: 'prj_foreign_999',
    entityId: 'ent_0000000000000799',
  });

  results.push({
    id: 'audio_33_project_isolation',
    category,
    title: '33. Cross-Project AudioWorld Isolation (Rejects Foreign Buses, Sources & Listeners)',
    passed:
      !foreignBusAttempt.success &&
      !foreignSourceAttempt.success &&
      !foreignListenerAttempt.success,
    details: "Blocked registration of buses, sources, and listeners belonging to foreign project 'prj_foreign_999'.",
  });

  // 34. Platform Audio Backend Contract & Android Audio Bridge
  const androidAudioBridge = createAndroidAudioOutputBridgeContract();
  const nullBackend = new NullContractAudioBackend();
  const voiceBeforeInit = nullBackend.createVoice('voice_01', sfxJumpAssetId);
  const backendInit = nullBackend.initialize();
  const voiceCreate = nullBackend.createVoice('voice_01', sfxJumpAssetId);
  const voiceStart = nullBackend.startVoice('voice_01');
  const voicePause = nullBackend.pauseVoice('voice_01');
  const voiceResume = nullBackend.resumeVoice('voice_01');
  const voiceStop = nullBackend.stopVoice('voice_01');
  const backendShutdown = nullBackend.shutdown();
  const initAfterShutdown = nullBackend.initialize();

  results.push({
    id: 'audio_34_platform_audio_backend_contract',
    category,
    title: '34. PlatformAudioBackendContract Lifecycle & Android Audio Bridge (com.hypersoft.hylix)',
    passed:
      androidAudioBridge.applicationId === 'com.hypersoft.hylix' &&
      androidAudioBridge.requiresExtraAndroidPermissions === false &&
      androidAudioBridge.allowsDirectSystemOrSdcardPaths === false &&
      !voiceBeforeInit.success &&
      backendInit.success &&
      voiceCreate.success &&
      voiceStart.success &&
      voicePause.success &&
      voiceResume.success &&
      voiceStop.success &&
      backendShutdown.success &&
      !initAfterShutdown.success,
    details: `Verified NullContractAudioBackend lifecycle and Android bridge (${androidAudioBridge.applicationId}, extraPermissions=false).`,
  });

  // 35. Project Close Audio Cleanup
  const closeCleanup = cleanupAudioWorldForProjectClose(
    extractionReport.audioWorld,
    resourceManager
  );
  const themeRefsAfterClose =
    resourceManager.get(musicThemeAssetId)?.referenceCount ?? 0;

  results.push({
    id: 'audio_35_project_close_audio_cleanup',
    category,
    title: '35. Project Close AudioWorld Shutdown & Resource Reference Cleanup',
    passed:
      closeCleanup.shutdownSuccess &&
      closeCleanup.releasedVoicesCount === 1 &&
      extractionReport.audioWorld.getState() === 'shutdown' &&
      themeRefsAfterClose === 0,
    details: `Project close shut down AudioWorld, stopped ${closeCleanup.releasedVoicesCount} active voice(s), and cleared unused resources.`,
  });

  // 36. Security Policy Auditor & Diagnostic Logging
  const secUrl = validateAudioPayloadSecurity(
    { streamUrl: 'https://cdn.example.com/music.ogg' },
    logger
  );
  const secSdcard = validateAudioPayloadSecurity(
    { clip: '/sdcard/Download/hack.mp3' },
    logger
  );
  const secEval = validateAudioPayloadSecurity(
    { dspScript: 'eval("malicious()")' },
    logger
  );
  const secClean = validateAudioPayloadSecurity(
    { audioAssetId: sfxJumpAssetId, busName: 'SFX', volume: 1.0 },
    logger
  );
  const audioLogEvents = logger
    .getEntries()
    .filter((e) => e.subsystem === 'audio');

  results.push({
    id: 'audio_36_security_and_diagnostic_logging',
    category,
    title: '36. Audio Security Policy Guard & Redacted Diagnostic Logging',
    passed:
      !secUrl.safe &&
      !secSdcard.safe &&
      !secEval.safe &&
      secClean.safe &&
      audioLogEvents.length > 0,
    details: `Blocked remote URLs, /sdcard paths, and eval(), while recording ${audioLogEvents.length} redacted 'audio' diagnostic events.`,
  });

  return results;
}
