# Hylix V1.0.0 — Rendering Foundation & 2D/3D Render Abstraction Specification

**Project**: Hylix  
**Organization**: HyperSoft  
**Phase**: Phase 05 — Rendering Foundation + 2D/3D Render Abstraction (`src/rendering/`)

---

## 1. Rendering Architecture Overview

Hylix Rendering is built from scratch by HyperSoft as a **platform-independent, Local-First 2D/3D/2.5D rendering foundation**. It does not wrap or depend on Three.js, Babylon.js, PixiJS, Phaser, Unity, Unreal Engine, or Godot.

### End-to-End Rendering Pipeline

```text
Scene / ECS State (Read-Only)
  ↓
Scene Render Extraction (src/rendering/sceneRenderer.ts)
  ↓
Deterministic RenderQueue (src/rendering/renderQueue.ts)
  ↓
RenderContext & RenderFrame Lifecycle (src/rendering/renderContext.ts, renderFrame.ts)
  ↓
RenderDevice & Resource Safety Layer (src/rendering/renderDevice.ts)
  ↓
RenderBackend Contract (src/rendering/renderBackend.ts)
  ↓
Platform Surface Adapter (Android Primary / Future iOS, Windows, Linux, macOS)
```

---

## 2. Module Structure (`src/rendering/`)

| File | Responsibility |
| :--- | :--- |
| `renderTypes.ts` | Deterministic render IDs, lifecycle state types, capability types, and security input filters. |
| `matrices.ts` | Pure `Vector2`, `Vector3`, `Vector4`, `ColorRGBA`, `Matrix4` (column-major 4x4), and `RenderTransform` (`T * R * S`, View, Perspective & Orthographic Projection). |
| `viewport.ts` | `Viewport` (`x, y, width, height`) with positive-dimension and overflow validation. |
| `camera.ts` | `PerspectiveCamera` and `OrthographicCamera` descriptors, frustum plane guards (`nearPlane > 0`, `farPlane > nearPlane`), and View/Projection matrix builders. |
| `mesh.ts` | GPU-independent `Vertex`, `Index`, `VertexLayout`, `SubMesh`, `MeshBounds`, and `MeshDescriptor`. |
| `material.ts` | Strongly-typed `MaterialDescriptor` referencing `materialAssetId` with discriminated parameters (`float`, `vector2`, `vector3`, `vector4`, `color`, `texture`). |
| `shader.ts` | `ShaderDescriptor` (`shaderAssetId`, `vertex | fragment | compute` stage types, `shaderMetadata`, and future Compute Shader readiness). |
| `texture.ts` | `TextureRenderResourceBridge` connecting Rendering directly to Phase 04 `ResourceManager` and `HylixAssetRegistry`. |
| `renderable.ts` | 2D (`SpriteDescriptor`, `SpriteTransform`, `SpriteRegion`, `SpriteColor`, `SpriteLayer`) and 3D (`Renderable3DDescriptor`) contracts. |
| `renderBackend.ts` | Platform-independent `RenderBackend` interface, lifecycle state machine, and honest `RenderCapabilities` reporting. |
| `renderFrame.ts` | `RenderFrame` state machine (`FrameCreated -> FrameBegun -> CommandsRecorded -> FrameSubmitted -> FrameCompleted`). |
| `renderDevice.ts` | Logical `RenderDevice` managing synchronization state, frame lifecycle, resource handles, and cross-project isolation. |
| `renderQueue.ts` | `RenderQueue` and 100% deterministic 2D/3D sorting (`compareRenderItemsDeterministically`). |
| `renderContext.ts` | Coordinates `RenderDevice`, `Viewport`, `Camera`, and `RenderQueue` frame execution. |
| `sceneRenderer.ts` | ECS rendering component specs (`Sprite2D`, `MeshRenderer3D`, `Camera`) and read-only `extractSceneRenderData`. |
| `renderingValidation.ts` | Security policy verifier (`validateRenderPayloadSecurity`) and barrel exports. |

---

## 3. RenderBackend Abstraction & RenderCapabilities

### Lifecycle State Machine (`isValidRenderBackendStateTransition`)
```text
uninitialized -> initializing -> ready -> rendering -> ready -> shutdown
```
Illegal calls (such as `beginFrame()` while `uninitialized` or `shutdown`, double `beginFrame()`, or `shutdown()` in the middle of an active frame) are deterministically rejected.

### Honest `RenderCapabilities` Contract
Hylix never fabricates fake GPU hardware numbers when a physical graphics backend is not initialized. Unbound/contract capabilities report `'notInitialized'`, `'unknown'`, or `'unsupported'`, and `validateRenderCapabilities` rejects any uninitialized backend attempting to claim numeric hardware limits.

---

## 4. RenderDevice & Resource Safety Guarantees

`RenderDevice` (`src/rendering/renderDevice.ts`) and `TextureRenderResourceBridge` (`src/rendering/texture.ts`) enforce:

1. **Zero Duplicate Loaders**: All asset loading, reference counting (`retain`/`release`), and bounded caching remain delegated to Phase 04 `ResourceManager`.
2. **Double-Destroy Prevention**: Calling `destroyRenderResource` or `destroyTextureBinding` twice on the same handle is rejected and logged.
3. **Use-After-Destroy & Use-After-Release Prevention**: Any attempt to use a destroyed handle or a handle whose `ResourceManager` reference count reached `0` is blocked.
4. **Use-After-Invalidate Prevention**: When an asset's SHA-256 `contentHash` changes in `HylixAssetRegistry`, bound render resources are marked `invalidated` (`render_resource_invalidated`) and cannot be used until re-acquired.
5. **Resource Type Mismatch Prevention**: Binding a `texture` asset as a `mesh` or `shader` resource is rejected.
6. **Cross-Project Isolation**: Resources created under `projectId: A` are strictly rejected if accessed by `projectId: B`.

---

## 5. Frame Lifecycle (`src/rendering/renderFrame.ts`)

Every frame follows an immutable progression:
```text
FrameCreated -> FrameBegun -> CommandsRecorded -> FrameSubmitted -> FrameCompleted
```
- `beginFrame()` cannot be called twice on the same frame.
- `endFrame()` cannot be called before `beginFrame()`.
- Draw commands cannot be recorded before `beginFrame()` or after `endFrame()`.
- Completed frames (`FrameCompleted`) cannot be reused.

---

## 6. Mathematical Foundation, Viewport & Camera System

- **Vectors & Matrices (`src/rendering/matrices.ts`)**:
  - `Vector2`, `Vector3`, `Vector4`, `ColorRGBA`, and column-major 16-element `Matrix4`.
  - Default `RenderTransform`: `position = (0, 0, 0)`, `rotation = (0, 0, 0)`, `scale = (1, 1, 1)`.
  - Strict rejection of `NaN`, `+Infinity`, and `-Infinity`.
- **Viewport (`src/rendering/viewport.ts`)**:
  - Validates `x`, `y`, `width > 0`, `height > 0`, and maximum dimension bounds (`32768`).
- **Camera (`src/rendering/camera.ts`)**:
  - Supports `perspective` (`fieldOfView` in `[1, 179]` degrees) and `orthographic` (`left < right`, `bottom < top`).
  - Enforces `nearPlane > 0` and `farPlane > nearPlane`.

---

## 7. 2D & 3D Rendering Contracts (`Sprite`, `Mesh`, `Material`, `Shader`)

- **2D Rendering (`SpriteDescriptor`)**:
  - Combines `SpriteTransform` (`position`, `rotation`, `scale`, `origin`), `SpriteRegion` (`u0, v0, u1, v1`), `SpriteColor`, `SpriteLayer` (`layerName`, `sortingLayer`, `orderInLayer`, `depth`), and `textureAssetId`.
  - Raw paths such as `texturePath: "/sdcard/game/player.png"` are strictly rejected.
- **3D Rendering (`Renderable3DDescriptor`, `MeshDescriptor`, `MaterialDescriptor`, `ShaderDescriptor`)**:
  - Links `entityId`, `meshAssetId`, `materialAssetId`, optional `shaderAssetId`, and `RenderTransform`.
  - `MaterialDescriptor` requires strongly-typed parameters (`float`, `vector2`, `vector3`, `vector4`, `color`, `texture`) and rejects arbitrary untyped objects.
  - `ShaderDescriptor` supports `vertex`, `fragment`, and reserves `compute` for future GPU compute pipelines.

---

## 8. Deterministic RenderQueue & Read-Only Scene Extraction

- **RenderQueue (`src/rendering/renderQueue.ts`)**:
  - Rejects any item containing raw filesystem paths or URLs.
  - Sorts deterministically without relying on randomness or object memory addresses:
    - **3D Pass**: `layer -> shaderAssetId -> materialAssetId -> meshAssetId -> depth -> entityId`
    - **2D Pass**: `layer -> orderInLayer -> depth -> textureAssetId -> entityId`
- **Scene Render Extraction (`extractSceneRenderData` in `src/rendering/sceneRenderer.ts`)**:
  - Reads `SceneDefinition` and ECS components (`Camera`, `Sprite2D`, `MeshRenderer3D`, `Transform`) in **100% read-only mode**.
  - Gracefully logs and reports missing or corrupted assets in `missingAssetDiagnostics` without crashing the frame or mutating the Scene.

---

## 9. Security Model, Android Architecture & Future Backends

- **Local-First Security**: Zero network calls, zero remote shader/texture URLs, zero `eval` / `Function()` / `child_process`, and zero direct access to `/sdcard`, `/system`, `/data`, or `/proc`.
- **Android Surface Isolation (`src/platform/platformAbstraction.ts`)**:
  - `createAndroidRenderSurfaceBridgeContract()` defines the Android surface boundary for `com.hypersoft.hylix` with `requiresExtraAndroidPermissions: false` and `allowsDirectSystemOrSdcardPaths: false`.
- **Future Graphics Backends**:
  - Future native backends (Android Vulkan / OpenGL ES, iOS Metal, Windows DirectX / Vulkan, Linux Vulkan, macOS Metal) implement `RenderBackend` without altering Hylix Rendering Core, ECS, or Scene System.
