# Hylix V1.0.0 — Audio System + Sound Resource Management Specification

**Project**: Hylix  
**Organization**: HyperSoft  
**Phase**: Phase 07 — Audio System + Sound Resource Management (`src/audio/`)

---

## 1. Audio Architecture Overview

Hylix Audio is built from scratch by HyperSoft as a **platform-independent, deterministic, Local-First Audio Foundation**. It does not wrap or depend on Unity, Unreal Engine, Godot, FMOD, Wwise, OpenAL, SDL_mixer, Howler.js, Tone.js, or external Web Audio wrapper libraries.

### End-to-End Audio, Resource & ECS Pipeline

```text
HylixAssetRegistry (Audio Asset Metadata on Disk)
  ↓
ResourceManager.loadAudio / SoundResourceManager (In-Memory SoundResourceDescriptor)
  ↓
SceneDefinition / ECS Entities (Read-Only AudioSource & AudioListener Extraction)
  ↓
Project-Isolated AudioWorld (src/audio/audioWorld.ts)
  ↓
AudioBus Hierarchy (Master <- Music / SFX / Voice / UI / Ambience) + 2D/3D Spatial Attenuation
  ↓
Bounded VoicePoolManager (maxVoices + Deterministic Voice Eviction)
  ↓
PlatformAudioBackendContract (AndroidAudioOutputBridgeContract / NullContractAudioBackend)
```

---

## 2. Module Structure (`src/audio/`)

| File | Responsibility |
| :--- | :--- |
| `audioTypes.ts` | Deterministic IDs (`audio_`, `sound_`, `bus_`, `source_`, `listener_`, `voice_`), formats (`wav`, `ogg`, `mp3`), load/spatial modes, state machines, and security guards. |
| `soundResource.ts` | `SoundResourceDescriptor`, stream metadata validation (`durationSeconds`, `sampleRateHz`, `channels`), and `SoundResourceManager` layered on Phase 04 `ResourceManager`. |
| `audioBus.ts` | `AudioBusDescriptor`, canonical buses (`Master`, `Music`, `SFX`, `Voice`, `UI`, `Ambience`), cycle/orphan validation, mute/solo isolation, and `computeEffectiveBusVolume`. |
| `audioSource.ts` | `AudioSourceDescriptor` validation (`audioAssetId`, `volume`, `pitch`, `pan`, `priority`, `minDistance`, `maxDistance`, `rolloffFactor`, `attenuationModel`). |
| `audioListener.ts` | `AudioListenerDescriptor` validation (`position`, `forward`, `up`, `masterGain`) and deterministic single-active-listener selection (`selectActiveAudioListener`). |
| `spatialAudio.ts` | Pure 2D & 3D distance calculation, `linear`/`inverse`/`exponential` distance attenuation, and 2D/3D stereo panning (`leftChannelGain`, `rightChannelGain`). |
| `voiceManagement.ts` | `VoicePoolManager` enforcing `maxVoices` (`1..256`) and deterministic voice stealing (`reject`, `replaceLowestPriority`, `stopOldestEqualPriority`) + playback progression. |
| `audioWorld.ts` | Project-isolated `AudioWorld` state machine, playback lifecycle (`playSource`, `pauseSource`, `resumeSource`, `stopSource`), mixer routing, and frame `update(dt)`. |
| `audioExtraction.ts` | Official ECS `AudioSource` and `AudioListener` components, `SceneDefinition.audioConfig` validation, and read-only `extractSceneAudioData`. |
| `audioIntegration.ts` | `syncSceneTransformsToAudioWorld` and `cleanupAudioWorldForProjectClose`. |
| `audioValidation.ts` | Security policy auditor (`validateAudioPayloadSecurity`) and barrel exports. |

---

## 3. Architectural Separation: `AudioAsset` vs. `SoundResource`

- **`AudioAsset` (`AssetMetadataRecord` in `src/assets/assetRegistry.ts`)**: Persistent project file metadata stored in `.hylix/asset-registry.hylix.json` (`type: 'audio'`, `assetId: asset_<16-hex>`, `contentHash: sha256:<64-hex>`).
- **`SoundResource` (`SoundResourceDescriptor` in `src/audio/soundResource.ts`)**: Runtime/editor representation managed via Phase 04 `ResourceManager` (`loadAudio`, `retainAudio`, `releaseAudio`, `invalidateAudio`).
- **Automatic Hash Invalidation**: When an audio file's SHA-256 `contentHash` changes in `HylixAssetRegistry`, its cached `AudioResource` and `SoundResourceDescriptor` transition to `invalidated` and reload cleanly on the next acquisition.
- **Memory vs. Streaming Modes**: Short sound effects (`soundEffect`, `voice`) default to `loadMode: 'memory'`, while long tracks (`music`, `ambience`) default to `loadMode: 'streaming'`.

---

## 4. AudioWorld Lifecycle & Playback State Machines

### `AudioWorldState`
```text
uninitialized -> ready -> processing -> ready
ready <-> paused
uninitialized | ready | paused -> shutdown
```
Transitions out of `shutdown` (`shutdown -> ready`) are strictly rejected.

### `AudioPlaybackState`
```text
stopped -> playing -> paused -> playing -> stopped
playing -> stopped
```
Illegal transitions such as `stopped -> paused` or resuming a `stopped` source are rejected.

---

## 5. Hierarchical Audio Mixer & Buses

- **Canonical Hierarchy**: `Master` (root, `parentBusId: null`) with child buses `Music`, `SFX`, `Voice`, `UI`, and `Ambience`, plus support for custom project sub-buses.
- **Graph Validation**: Rejects self-parenting (`busId === parentBusId`), orphan buses, multiple root buses, and circular bus routing (`A -> B -> A`).
- **Effective Gain, Mute & Solo**:
  - `effectiveBusVolume = sceneMasterVolume * masterBusVolume * ... * childBusVolume`.
  - Muting any ancestor bus zeroes downstream gain.
  - Enabling `solo` on any bus isolates playback to soloed bus branches.

---

## 6. 2D/3D Spatial Audio & Bounded Voice Pool

- **Single Active Listener**: If multiple enabled `AudioListener` components exist in a Scene, `selectActiveAudioListener` deterministically selects the primary listener (`entityId ASC, listenerId ASC`) and logs a warning.
- **Spatial Modes**:
  - `nonSpatial`: Bypasses distance attenuation (`distanceAttenuation = 1.0`).
  - `spatial2D`: 2D distance attenuation + horizontal X-axis stereo pan (`[-1, 1]`).
  - `spatial3D`: 3D distance attenuation (`linear`, `inverse`, `exponential`) + 3D directional pan projected onto the listener's right basis vector (`forward x up`).
- **Bounded Voice Pool (`VoicePoolManager`)**:
  - Caps concurrent voices at `maxVoices` (default `32`, max `256`).
  - Supports deterministic eviction policies: `'reject'`, `'replaceLowestPriority'`, and `'stopOldestEqualPriority'`.

---

## 7. Platform Audio Backend Contract & Security

- **Platform Abstraction (`src/platform/platformAbstraction.ts`)**: `PlatformAudioBackendContract`, `NullContractAudioBackend`, and `AndroidAudioOutputBridgeContract` (`com.hypersoft.hylix`, future native targets `AAudio` / `OpenSL_ES`, zero extra Android permissions).
- **Security**: Zero `eval`, `Function()`, `child_process`, remote URLs (`http://`, `https://`), `/sdcard` paths, or `../` traversal. All audio assets are referenced exclusively by `asset_<16-hex>` IDs.
