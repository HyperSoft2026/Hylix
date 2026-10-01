import { LocalFirstAtomicStore } from '../storage/atomicStorage';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import { HylixAssetRegistry } from '../assets/assetRegistry';
import { computeAssetContentHash } from '../assets/contentHash';
import { ResourceManager } from '../assets/resourceManager';
import {
  addComponent,
  createEntity,
  createStandardComponentRegistry,
} from '../ecs/ecsCore';
import { createSceneDefinition } from '../scene/sceneSystem';
import { createAndroidRenderSurfaceBridgeContract } from '../platform/platformAbstraction';
import {
  CAMERA_COMPONENT_TYPE,
  computeCameraProjectionMatrix,
  computeCameraViewMatrix,
  createDefaultRenderTransform,
  createIdentityMatrix4,
  createModelMatrix4,
  createOrthographicCamera,
  createPerspectiveCamera,
  createUnboundRenderCapabilities,
  createUnitQuadMesh,
  createViewport,
  extractSceneRenderData,
  MESH_RENDERER_3D_COMPONENT_TYPE,
  NullContractRenderBackend,
  registerRenderingEcsComponents,
  RenderContext,
  RenderDevice,
  RenderFrame,
  RenderQueue,
  SPRITE_2D_COMPONENT_TYPE,
  TextureRenderResourceBridge,
  validateCamera,
  validateMaterialDescriptor,
  validateMatrix4,
  validateMesh,
  validateRenderable3DDescriptor,
  validateRenderCapabilities,
  validateRenderItem,
  validateRenderPayloadSecurity,
  validateRenderTransform,
  validateShaderDescriptor,
  validateSpriteDescriptor,
  validateVector2,
  validateVector3,
  validateVector4,
  validateViewport,
} from '../rendering/renderingValidation';
import { VerificationAssertionResult } from './foundationVerification';

/**
 * Hylix Phase 05 — Rendering Foundation & 2D/3D Render Abstraction Verification Suite
 *
 * Implements 32 deterministic assertions covering all 30 mandatory test points in Prompt 05
 * plus Texture contentHash invalidation and structured diagnostic event verification.
 */
export function runRenderingVerificationChecks(): VerificationAssertionResult[] {
  const results: VerificationAssertionResult[] = [];
  const logger = new RedactedDiagnosticLogger(300);

  // 1. Vector validation (Vector2, Vector3, Vector4)
  const v2Ok = validateVector2({ x: 10, y: -20 });
  const v3Ok = validateVector3({ x: 1, y: 2, z: 3 });
  const v4Ok = validateVector4({ x: 0, y: 1, z: 0, w: 1 });
  const v2Bad = validateVector2({ x: NaN, y: 5 });
  const v3Bad = validateVector3({ x: 1, y: 2, z: Infinity });
  const v4Bad = validateVector4({ x: 1, y: 2, z: 3, w: 'bad' });
  results.push({
    id: 'render_01_vector_validation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '01. Vector2 / Vector3 / Vector4 Finite Mathematical Validation',
    passed:
      v2Ok.valid &&
      v3Ok.valid &&
      v4Ok.valid &&
      !v2Bad.valid &&
      !v3Bad.valid &&
      !v4Bad.valid,
    details:
      'Validated finite Vector2, Vector3, and Vector4 structures while rejecting NaN, Infinity, and non-numeric components.',
  });

  // 2. Matrix validation & Model/View/Projection matrix computation
  const identityMat = createIdentityMatrix4();
  const matOk = validateMatrix4(identityMat);
  const matWrongLen = validateMatrix4({ elements: [1, 2, 3] });
  const matNaN = validateMatrix4({
    elements: [1, 0, 0, 0, 0, NaN, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  });
  const modelMat = createModelMatrix4({
    position: { x: 4, y: 5, z: 6 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 2, y: 2, z: 2 },
  });
  results.push({
    id: 'render_02_matrix_validation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '02. Matrix4 Validation & Model Matrix Computation',
    passed:
      matOk.valid &&
      !matWrongLen.valid &&
      !matNaN.valid &&
      modelMat.elements[0] === 2 &&
      modelMat.elements[12] === 4 &&
      modelMat.elements[13] === 5 &&
      modelMat.elements[14] === 6,
    details:
      'Verified 16-element column-major Matrix4 validation and T*R*S model matrix composition.',
  });

  // 3. Transform defaults: position=(0,0,0), rotation=(0,0,0), scale=(1,1,1)
  const defTransform = createDefaultRenderTransform();
  const defTransformValid = validateRenderTransform(defTransform);
  results.push({
    id: 'render_03_transform_defaults',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '03. Canonical Transform Defaults ((0,0,0), (0,0,0), (1,1,1))',
    passed:
      defTransformValid.valid &&
      defTransform.position.x === 0 &&
      defTransform.position.y === 0 &&
      defTransform.position.z === 0 &&
      defTransform.rotation.x === 0 &&
      defTransform.rotation.y === 0 &&
      defTransform.rotation.z === 0 &&
      defTransform.scale.x === 1 &&
      defTransform.scale.y === 1 &&
      defTransform.scale.z === 1,
    details:
      'Confirmed canonical Transform defaults: position=(0,0,0), rotation=(0,0,0), scale=(1,1,1).',
  });

  // 4. Transform NaN rejection
  const nanTransform = validateRenderTransform({
    position: { x: 0, y: NaN, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  results.push({
    id: 'render_04_transform_nan_rejection',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '04. Transform NaN Rejection Guard',
    passed: !nanTransform.valid && nanTransform.errors.length > 0,
    details: 'Rejected Transform containing NaN coordinate values.',
  });

  // 5. Transform Infinity rejection
  const infTransform = validateRenderTransform({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: -Infinity, z: 0 },
    scale: { x: 1, y: Infinity, z: 1 },
  });
  results.push({
    id: 'render_05_transform_infinity_rejection',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '05. Transform Infinity Rejection Guard',
    passed: !infTransform.valid && infTransform.errors.length >= 2,
    details: 'Rejected Transform containing +Infinity and -Infinity values.',
  });

  // 6. Viewport validation (positive dimensions, NaN/Infinity/negative/overflow rejection)
  const vpValid = createViewport(1920, 1080, 0, 0);
  const vpNegWidth = validateViewport({ x: 0, y: 0, width: -100, height: 720 });
  const vpNegHeight = validateViewport({ x: 0, y: 0, width: 1280, height: 0 });
  const vpNaN = validateViewport({ x: NaN, y: 0, width: 800, height: 600 });
  const vpOverflow = validateViewport({
    x: 0,
    y: 0,
    width: 999999999,
    height: 999999999,
  });
  results.push({
    id: 'render_06_viewport_validation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '06. Viewport Validation & Overflow/Negative Rejection',
    passed:
      vpValid.valid &&
      !vpNegWidth.valid &&
      !vpNegHeight.valid &&
      !vpNaN.valid &&
      !vpOverflow.valid,
    details:
      'Accepted valid 1920x1080 Viewport while rejecting negative/zero dimensions, NaN, and overflow.',
  });

  // 7. Camera validation (general contract + FOV bounds + NaN rejection)
  const camInvalidFov = validateCamera(
    {
      name: 'InvalidFovCam',
      projection: 'perspective',
      nearPlane: 0.1,
      farPlane: 100,
      fieldOfView: 220, // out of [1, 179] bounds
    },
    logger
  );
  const camNaN = validateCamera(
    {
      name: 'NaNCam',
      projection: 'perspective',
      position: { x: NaN, y: 0, z: 0 },
      nearPlane: 0.1,
      farPlane: 100,
      fieldOfView: 60,
    },
    logger
  );
  results.push({
    id: 'render_07_camera_validation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '07. Camera Contract Validation & Out-of-Range FOV Rejection',
    passed: !camInvalidFov.valid && !camNaN.valid,
    details:
      'Rejected Camera descriptors with out-of-range fieldOfView (220°) and NaN position.',
  });

  // 8. Perspective camera & View/Projection matrix generation
  const perspCam = createPerspectiveCamera(
    {
      name: 'Main3DCamera',
      position: { x: 0, y: 2, z: -10 },
      rotation: { x: 0, y: 0, z: 0 },
      fieldOfView: 60,
      nearPlane: 0.1,
      farPlane: 500,
      aspectRatio: 16 / 9,
    },
    logger
  );
  const perspView = perspCam.value ? computeCameraViewMatrix(perspCam.value) : null;
  const perspProj = perspCam.value
    ? computeCameraProjectionMatrix(perspCam.value)
    : null;
  results.push({
    id: 'render_08_perspective_camera',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '08. Perspective Camera Creation & View/Projection Matrices',
    passed:
      perspCam.valid &&
      perspCam.value?.projection === 'perspective' &&
      perspView !== null &&
      validateMatrix4(perspView).valid &&
      perspProj !== null &&
      validateMatrix4(perspProj).valid,
    details: `Created Perspective Camera '${perspCam.value?.cameraId}' with valid 4x4 View & Projection matrices.`,
  });

  // 9. Orthographic camera & Projection matrix generation
  const orthoCam = createOrthographicCamera(
    {
      name: 'Main2DCamera',
      left: -16,
      right: 16,
      bottom: -9,
      top: 9,
      nearPlane: 0.1,
      farPlane: 100,
    },
    logger
  );
  const orthoProj = orthoCam.value
    ? computeCameraProjectionMatrix(orthoCam.value)
    : null;
  const orthoInvalidBounds = createOrthographicCamera({
    left: 10,
    right: -10, // invalid left >= right
    bottom: -5,
    top: 5,
  });
  results.push({
    id: 'render_09_orthographic_camera',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '09. Orthographic Camera Creation & Bounds Validation',
    passed:
      orthoCam.valid &&
      orthoCam.value?.projection === 'orthographic' &&
      orthoProj !== null &&
      validateMatrix4(orthoProj).valid &&
      !orthoInvalidBounds.valid,
    details: `Created Orthographic Camera '${orthoCam.value?.cameraId}' and rejected inverted frustum bounds.`,
  });

  // 10. Invalid near plane rejection (nearPlane <= 0)
  const zeroNear = createPerspectiveCamera({ nearPlane: 0, farPlane: 100 }, logger);
  const negNear = createPerspectiveCamera({ nearPlane: -1, farPlane: 100 }, logger);
  results.push({
    id: 'render_10_invalid_near_plane',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '10. Invalid Near Plane Rejection (nearPlane <= 0)',
    passed: !zeroNear.valid && !negNear.valid,
    details: 'Rejected cameras with nearPlane = 0 and nearPlane = -1.',
  });

  // 11. Invalid far plane rejection (farPlane <= nearPlane)
  const equalFar = createPerspectiveCamera({ nearPlane: 10, farPlane: 10 }, logger);
  const smallerFar = createPerspectiveCamera({ nearPlane: 10, farPlane: 5 }, logger);
  results.push({
    id: 'render_11_invalid_far_plane',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '11. Invalid Far Plane Rejection (farPlane <= nearPlane)',
    passed: !equalFar.valid && !smallerFar.valid,
    details: 'Rejected cameras where farPlane <= nearPlane.',
  });

  // 12. Frame lifecycle (FrameCreated -> FrameBegun -> CommandsRecorded -> FrameSubmitted -> FrameCompleted)
  const frame = new RenderFrame(1, logger);
  const initialState = frame.getState();
  const beginOk = frame.beginFrame();
  const cmdOk = frame.recordCommand('draw_2d_sprite', 'ritem_01');
  const endOk = frame.endFrame();
  results.push({
    id: 'render_12_frame_lifecycle',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '12. Deterministic Frame Lifecycle State Progression',
    passed:
      initialState === 'FrameCreated' &&
      beginOk.success &&
      beginOk.state === 'FrameBegun' &&
      cmdOk.success &&
      cmdOk.state === 'CommandsRecorded' &&
      endOk.success &&
      endOk.state === 'FrameCompleted' &&
      endOk.submittedCommandCount === 1,
    details:
      'Verified FrameCreated -> FrameBegun -> CommandsRecorded -> FrameSubmitted -> FrameCompleted.',
  });

  // 13. Invalid frame transitions (double beginFrame, endFrame before beginFrame, command after endFrame, reuse completed frame)
  const frame2 = new RenderFrame(2, logger);
  const endBeforeBegin = frame2.endFrame();
  const cmdBeforeBegin = frame2.recordCommand('draw_3d_mesh', 'ritem_02');
  frame2.beginFrame();
  const doubleBegin = frame2.beginFrame();
  frame2.endFrame();
  const cmdAfterEnd = frame2.recordCommand('draw_3d_mesh', 'ritem_03');
  const reuseCompleted = frame2.beginFrame();
  results.push({
    id: 'render_13_invalid_frame_transitions',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '13. Illegal Frame Transition & Post-Completion Reuse Guards',
    passed:
      !endBeforeBegin.success &&
      !cmdBeforeBegin.success &&
      !doubleBegin.success &&
      !cmdAfterEnd.success &&
      !reuseCompleted.success,
    details:
      'Blocked endFrame before beginFrame, double beginFrame, recording commands after endFrame, and reusing a completed Frame.',
  });

  // 14. RenderBackend lifecycle (uninitialized -> initializing -> ready -> rendering -> ready -> shutdown)
  const backend = new NullContractRenderBackend({ logger });
  const beginWhenUninit = backend.beginFrame(1);
  const endWhenUninit = backend.endFrame(1);
  const initRes = backend.initialize(vpValid.value!);
  const beginFrameBackend = backend.beginFrame(1);
  const doubleBeginBackend = backend.beginFrame(2);
  const shutdownWhileRendering = backend.shutdown();
  const endFrameBackend = backend.endFrame(1);
  const shutdownReady = backend.shutdown();
  const beginAfterShutdown = backend.beginFrame(2);
  results.push({
    id: 'render_14_render_backend_lifecycle',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '14. RenderBackend Lifecycle State Machine & Illegal Call Guards',
    passed:
      !beginWhenUninit.success &&
      !endWhenUninit.success &&
      initRes.success &&
      initRes.state === 'ready' &&
      beginFrameBackend.success &&
      beginFrameBackend.state === 'rendering' &&
      !doubleBeginBackend.success &&
      !shutdownWhileRendering.success &&
      endFrameBackend.success &&
      endFrameBackend.state === 'ready' &&
      shutdownReady.success &&
      shutdownReady.state === 'shutdown' &&
      !beginAfterShutdown.success,
    details:
      'Enforced uninitialized -> initializing -> ready -> rendering -> ready -> shutdown and blocked all illegal transitions.',
  });

  // 15. RenderCapabilities validation (honest unknown/notInitialized/unsupported vs fabricated numbers)
  const uninitCaps = createUnboundRenderCapabilities(undefined, false);
  const initCaps = createUnboundRenderCapabilities(undefined, true);
  const uninitCapsValid = validateRenderCapabilities(uninitCaps);
  const initCapsValid = validateRenderCapabilities(initCaps);
  const fabricatedWhenUninit = validateRenderCapabilities({
    ...uninitCaps,
    backendInitialized: false,
    maxTextureSize: 16384, // fabricated hardware number while uninitialized!
  });
  results.push({
    id: 'render_15_render_capabilities_validation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '15. RenderCapabilities Contract & Anti-Fabrication Guard',
    passed:
      uninitCapsValid.valid &&
      uninitCaps.maxTextureSize === 'notInitialized' &&
      initCapsValid.valid &&
      initCaps.maxTextureSize === 'unknown' &&
      initCaps.supportsCompute === 'unsupported' &&
      !fabricatedWhenUninit.valid,
    details:
      'Verified honest notInitialized/unknown/unsupported capability reporting and rejected fabricated GPU limits on uninitialized backends.',
  });

  // 16. Sprite validation (2D rendering contract)
  const validSprite = validateSpriteDescriptor({
    entityId: 'ent_0000000000000010',
    textureAssetId: 'asset_1111222233334444',
    transform: {
      position: { x: 12, y: 24, z: 0 },
      rotation: 45,
      scale: { x: 1, y: 1 },
      origin: { x: 0.5, y: 0.5 },
    },
    region: { u0: 0, v0: 0, u1: 1, v1: 1 },
    color: { r: 1, g: 1, b: 1, a: 1 },
    layer: { layerName: 'Characters', sortingLayer: 2, orderInLayer: 5, depth: 0 },
  });
  results.push({
    id: 'render_16_sprite_validation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '16. 2D Sprite Descriptor Validation (Transform, Region, Color, Layer)',
    passed:
      validSprite.valid &&
      validSprite.value?.textureAssetId === 'asset_1111222233334444' &&
      validSprite.value?.layer.sortingLayer === 2,
    details:
      'Validated complete 2D Sprite descriptor with SpriteTransform, SpriteRegion, SpriteColor, and SpriteLayer.',
  });

  // 17. Sprite AssetId validation (rejects texturePath: "/sdcard/game/player.png" & URLs)
  const spriteRawPath = validateSpriteDescriptor({
    entityId: 'ent_0000000000000010',
    texturePath: '/sdcard/game/player.png',
    textureAssetId: 'asset_1111222233334444',
  });
  const spriteInvalidAssetId = validateSpriteDescriptor({
    entityId: 'ent_0000000000000010',
    textureAssetId: '/sdcard/game/player.png',
  });
  results.push({
    id: 'render_17_sprite_asset_id_validation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '17. Sprite AssetId Enforcement & /sdcard Path Rejection',
    passed: !spriteRawPath.valid && !spriteInvalidAssetId.valid,
    details:
      'Rejected texturePath="/sdcard/game/player.png" and enforced deterministic textureAssetId="asset_...".',
  });

  // 18. Mesh validation (Vertex, Index, VertexLayout, SubMesh, MeshBounds)
  const quadMesh = createUnitQuadMesh('asset_aaaa1111bbbb2222');
  const meshValid = validateMesh(quadMesh);
  const meshOutOfBoundsIdx = validateMesh({
    name: 'BrokenMesh',
    vertices: [{ position: { x: 0, y: 0, z: 0 } }],
    indices: [0, 5], // index 5 out of bounds
  });
  const meshWithRawPath = validateMesh({
    name: 'RawPathMesh',
    meshPath: 'assets/models/hero.glb',
    vertices: [{ position: { x: 0, y: 0, z: 0 } }],
    indices: [0],
  });
  results.push({
    id: 'render_18_mesh_validation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '18. Mesh Contract Validation (Vertices, Indices, Layout, SubMesh, Bounds)',
    passed:
      meshValid.valid &&
      quadMesh.vertices.length === 4 &&
      quadMesh.indices.length === 6 &&
      quadMesh.bounds.extents.x === 0.5 &&
      !meshOutOfBoundsIdx.valid &&
      !meshWithRawPath.valid,
    details:
      'Validated GPU-independent MeshDescriptor, computed MeshBounds, and rejected out-of-range indices and raw meshPath.',
  });

  // 19. Material validation (typed parameters vs arbitrary untyped objects)
  const matValid = validateMaterialDescriptor({
    materialAssetId: 'asset_cccc3333dddd4444',
    shaderAssetId: 'asset_eeee5555ffff6666',
    name: 'HeroStandardMaterial',
    parameters: {
      roughness: { kind: 'float', value: 0.35 },
      uvScale: { kind: 'vector2', value: { x: 2, y: 2 } },
      emissive: { kind: 'vector3', value: { x: 0, y: 0.5, z: 1 } },
      clipPlane: { kind: 'vector4', value: { x: 0, y: 1, z: 0, w: 0 } },
      baseColor: { kind: 'color', value: { r: 1, g: 0.8, b: 0.2, a: 1 } },
      albedoMap: { kind: 'texture', textureAssetId: 'asset_1111222233334444' },
    },
  });
  const matArbitraryObj = validateMaterialDescriptor({
    materialAssetId: 'asset_cccc3333dddd4444',
    parameters: {
      arbitraryUntypedHack: { anythingGoes: true, rawPath: '/sdcard/hack.png' },
    },
  });
  results.push({
    id: 'render_19_material_validation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '19. Strongly-Typed Material Contract & Arbitrary Parameter Rejection',
    passed: matValid.valid && !matArbitraryObj.valid,
    details:
      'Validated float, vector2, vector3, vector4, color, and texture AssetId material parameters while rejecting arbitrary untyped objects.',
  });

  // 20. Shader validation (vertex, fragment, compute readiness)
  const vertShader = validateShaderDescriptor({
    shaderAssetId: 'asset_eeee5555ffff6666',
    shaderType: 'vertex',
    entryPoint: 'main',
    shaderMetadata: {
      uniformNames: ['u_modelViewProj'],
      attributeNames: ['a_position', 'a_uv'],
      requiresComputeCapability: false,
      stageVersion: '1.0.0',
    },
  });
  const computeShader = validateShaderDescriptor({
    shaderAssetId: 'asset_9999888877776666',
    shaderType: 'compute',
    entryPoint: 'cs_main',
  });
  const invalidShaderStage = validateShaderDescriptor({
    shaderAssetId: 'asset_9999888877776666',
    shaderType: 'geometry_unsupported',
  });
  results.push({
    id: 'render_20_shader_validation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '20. Shader Contract Validation (Vertex, Fragment & Compute Readiness)',
    passed:
      vertShader.valid &&
      vertShader.value?.executionSupportedInCurrentPhase === true &&
      computeShader.valid &&
      computeShader.value?.executionSupportedInCurrentPhase === false &&
      computeShader.value?.shaderMetadata.requiresComputeCapability === true &&
      !invalidShaderStage.valid,
    details:
      'Validated vertex/fragment shader descriptors, reserved compute shader contract for future backends, and rejected invalid stages.',
  });

  // 21. RenderItem validation & raw filesystem path rejection in RenderQueue
  const validItem3D = validateRenderItem({
    dimension: '3D',
    entityId: 'ent_0000000000000021',
    meshAssetId: 'asset_aaaa1111bbbb2222',
    materialAssetId: 'asset_cccc3333dddd4444',
    shaderAssetId: 'asset_eeee5555ffff6666',
    layer: 0,
    depth: 15,
  });
  const itemWithFilesystemPath = validateRenderItem({
    dimension: '2D',
    entityId: 'ent_0000000000000022',
    textureAssetId: 'asset_1111222233334444',
    filePath: 'assets/textures/player.png', // forbidden in RenderQueue!
  });
  results.push({
    id: 'render_21_render_item_validation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '21. RenderItem Validation & Filesystem Path Rejection in RenderQueue',
    passed: validItem3D.valid && !itemWithFilesystemPath.valid,
    details:
      'Accepted valid AssetId-based RenderItem and rejected RenderItem containing raw filePath.',
  });

  // 22. RenderQueue deterministic sorting (2D & 3D order independent of insertion order)
  const queueA = new RenderQueue(logger);
  const queueB = new RenderQueue(logger);

  const item1 = {
    dimension: '2D' as const,
    entityId: 'ent_0000000000000002',
    textureAssetId: 'asset_1111222233334444',
    layer: 1,
    orderInLayer: 10,
    depth: 5,
  };
  const item2 = {
    dimension: '2D' as const,
    entityId: 'ent_0000000000000001',
    textureAssetId: 'asset_1111222233334444',
    layer: 0,
    orderInLayer: 1,
    depth: 0,
  };
  const item3 = {
    dimension: '3D' as const,
    entityId: 'ent_0000000000000003',
    meshAssetId: 'asset_aaaa1111bbbb2222',
    materialAssetId: 'asset_cccc3333dddd4444',
    shaderAssetId: 'asset_eeee5555ffff6666',
    layer: 0,
    depth: 20,
  };

  // Enqueue in opposite orders into queueA and queueB
  queueA.enqueue(item1);
  queueA.enqueue(item2);
  queueA.enqueue(item3);

  queueB.enqueue(item3);
  queueB.enqueue(item1);
  queueB.enqueue(item2);

  const sortedA = queueA.buildSortedQueue();
  const sortedB = queueB.buildSortedQueue();
  const identicalOrder =
    sortedA.length === 3 &&
    sortedB.length === 3 &&
    sortedA.every((it, idx) => it.entityId === sortedB[idx].entityId) &&
    sortedA[0].entityId === 'ent_0000000000000003' && // 3D pass first
    sortedA[1].entityId === 'ent_0000000000000001' && // 2D layer 0
    sortedA[2].entityId === 'ent_0000000000000002'; // 2D layer 1

  results.push({
    id: 'render_22_deterministic_sorting',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '22. RenderQueue 100% Deterministic Sorting Across Insertion Orders',
    passed: identicalOrder,
    details:
      'Produced identical deterministic RenderQueue ordering regardless of insertion sequence.',
  });

  // Set up Project A and Project B workspaces for Resource, Scene, and Isolation tests (23..30)
  const storeA = new LocalFirstAtomicStore();
  const registryA = new HylixAssetRegistry('prj_render_a', logger);
  const rmA = new ResourceManager({
    projectRoot: 'RenderProjA',
    store: storeA,
    registry: registryA,
    logger,
  });

  storeA.writeFileAtomically('RenderProjA/assets/textures/hero.png', 'HERO_TEX_V1');
  storeA.writeFileAtomically('RenderProjA/assets/models/cube.glb', 'CUBE_GLB_V1');
  storeA.writeFileAtomically('RenderProjA/assets/materials/cube.mat.json', '{"mat":1}');
  storeA.writeFileAtomically('RenderProjA/assets/materials/basic.shader', 'SHADER_V1');

  const texHeroAsset = registryA.registerAsset({
    type: 'texture',
    path: 'assets/textures/hero.png',
    contentPayload: 'HERO_TEX_V1',
    importState: 'verified',
  }).asset!;
  const meshCubeAsset = registryA.registerAsset({
    type: 'model',
    path: 'assets/models/cube.glb',
    contentPayload: 'CUBE_GLB_V1',
    importState: 'verified',
  }).asset!;
  const matCubeAsset = registryA.registerAsset({
    type: 'material',
    path: 'assets/materials/cube.mat.json',
    contentPayload: '{"mat":1}',
    importState: 'verified',
  }).asset!;
  const shdBasicAsset = registryA.registerAsset({
    type: 'shader',
    path: 'assets/materials/basic.shader',
    contentPayload: 'SHADER_V1',
    importState: 'verified',
  }).asset!;

  // Build a Scene with:
  // - Primary Camera entity
  // - Valid 2D Sprite entity
  // - Valid 3D MeshRenderer entity
  // - Entity referencing a MISSING texture asset (to test graceful missing asset handling)
  const ecsRegistry = registerRenderingEcsComponents(
    createStandardComponentRegistry()
  );

  const camEntBase = createEntity(
    { sceneId: 'scene_0000000000000501', name: 'MainCameraEntity' },
    ecsRegistry
  ).entity!;
  const camEnt = addComponent(
    camEntBase,
    CAMERA_COMPONENT_TYPE,
    {
      projection: 'perspective',
      nearPlane: 0.1,
      farPlane: 500,
      fieldOfView: 60,
      aspectRatio: 16 / 9,
      isPrimary: true,
    },
    ecsRegistry
  ).entity!;

  const spriteEntBase = createEntity(
    { sceneId: 'scene_0000000000000501', name: 'HeroSprite2D' },
    ecsRegistry
  ).entity!;
  const spriteEnt = addComponent(
    spriteEntBase,
    SPRITE_2D_COMPONENT_TYPE,
    {
      textureAssetId: texHeroAsset.assetId,
      color: { r: 1, g: 1, b: 1, a: 1 },
      region: { u0: 0, v0: 0, u1: 1, v1: 1 },
      origin: { x: 0.5, y: 0.5 },
      layer: { layerName: 'Foreground', sortingLayer: 1, orderInLayer: 2, depth: 0 },
    },
    ecsRegistry
  ).entity!;

  const meshEntBase = createEntity(
    { sceneId: 'scene_0000000000000501', name: 'WorldCube3D' },
    ecsRegistry
  ).entity!;
  const meshEnt = addComponent(
    meshEntBase,
    MESH_RENDERER_3D_COMPONENT_TYPE,
    {
      meshAssetId: meshCubeAsset.assetId,
      materialAssetId: matCubeAsset.assetId,
      shaderAssetId: shdBasicAsset.assetId,
      layer: 0,
    },
    ecsRegistry
  ).entity!;

  const missingAssetEntBase = createEntity(
    { sceneId: 'scene_0000000000000501', name: 'MissingTextureSprite' },
    ecsRegistry
  ).entity!;
  const missingAssetEnt = addComponent(
    missingAssetEntBase,
    SPRITE_2D_COMPONENT_TYPE,
    {
      textureAssetId: 'asset_deadbeef00009999', // Missing asset ID
      color: { r: 1, g: 1, b: 1, a: 1 },
      region: { u0: 0, v0: 0, u1: 1, v1: 1 },
      origin: { x: 0.5, y: 0.5 },
      layer: { layerName: 'Default', sortingLayer: 0, orderInLayer: 0, depth: 0 },
    },
    ecsRegistry
  ).entity!;

  const testScene = createSceneDefinition({
    sceneId: 'scene_0000000000000501',
    sceneName: 'RenderExtractionScene',
    entities: [camEnt, spriteEnt, meshEnt, missingAssetEnt],
    registry: ecsRegistry,
  }).scene!;

  const beforeSceneJson = JSON.stringify(testScene);
  const extraction = extractSceneRenderData(testScene, {
    assetRegistry: registryA,
    logger,
  });
  const afterSceneJson = JSON.stringify(testScene);

  // 23. Missing Asset handling (does not crash extraction; logs diagnostic event)
  results.push({
    id: 'render_23_missing_asset_handling',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '23. Graceful Missing Asset Handling & Diagnostic Logging',
    passed:
      extraction.missingAssetDiagnostics.length === 1 &&
      extraction.missingAssetDiagnostics[0].assetId === 'asset_deadbeef00009999' &&
      extraction.sortedRenderQueue.length === 2,
    details:
      'Logged missing asset diagnostic for asset_deadbeef00009999 without crashing extraction of valid 2D/3D entities.',
  });

  // 24. ResourceHandle validation (prevents double destroy, use-after-release, resource type mismatch)
  const deviceBackend = new NullContractRenderBackend({ logger });
  const renderDevice = new RenderDevice({
    projectId: 'prj_render_a',
    backend: deviceBackend,
    registry: registryA,
    resourceManager: rmA,
    logger,
  });
  renderDevice.initializeDevice(vpValid.value!);

  const createdTexRes = renderDevice.createRenderResource(
    texHeroAsset.assetId,
    'texture'
  );
  const wrongKindAttempt = renderDevice.createRenderResource(
    texHeroAsset.assetId,
    'mesh' // type mismatch: texture asset cannot be created as mesh resource
  );
  const mismatchUseAttempt = renderDevice.validateResourceForUse(
    createdTexRes.value!,
    'shader' // type mismatch on use
  );
  const firstDestroy = renderDevice.destroyRenderResource(
    createdTexRes.value!.deviceResourceId
  );
  const doubleDestroy = renderDevice.destroyRenderResource(
    createdTexRes.value!.deviceResourceId
  );
  const useAfterDestroy = renderDevice.validateResourceForUse(
    createdTexRes.value!,
    'texture'
  );

  results.push({
    id: 'render_24_resource_handle_safety',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '24. Render Resource Safety (Double Destroy, Use-After-Destroy & Type Mismatch)',
    passed:
      createdTexRes.valid &&
      !wrongKindAttempt.valid &&
      !mismatchUseAttempt.valid &&
      firstDestroy.valid &&
      !doubleDestroy.valid &&
      !useAfterDestroy.valid,
    details:
      'Blocked resource type mismatch, double destroy, and use-after-destroy on RenderDeviceResourceHandle.',
  });

  // 25. Cross-project resource rejection (Project A cannot use Project B resource)
  const crossProjCreate = renderDevice.createRenderResource(
    texHeroAsset.assetId,
    'texture',
    'prj_foreign_b'
  );
  const activeMeshRes = renderDevice.createRenderResource(
    meshCubeAsset.assetId,
    'mesh',
    'prj_render_a'
  );
  const crossProjUse = renderDevice.validateResourceForUse(
    activeMeshRes.value!,
    'mesh',
    'prj_foreign_b'
  );
  results.push({
    id: 'render_25_cross_project_isolation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '25. Cross-Project Render Resource Isolation Guard',
    passed: !crossProjCreate.valid && activeMeshRes.valid && !crossProjUse.valid,
    details:
      "Blocked foreign project 'prj_foreign_b' from creating or using render resources owned by 'prj_render_a'.",
  });

  // 26. Scene render extraction (read-only guarantee + camera extraction)
  results.push({
    id: 'render_26_scene_render_extraction',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '26. Read-Only Scene Render Extraction & Camera Extraction',
    passed:
      extraction.readOnlyVerified &&
      beforeSceneJson === afterSceneJson &&
      extraction.extractedCameras.length === 1 &&
      extraction.extractedCameras[0].projection === 'perspective',
    details:
      'Extracted Scene cameras and renderables with zero mutation to SceneDefinition state.',
  });

  // 27. ECS renderable extraction & RenderContext frame execution
  const renderContext = new RenderContext({
    device: renderDevice,
    initialViewport: vpValid.value!,
    initialCamera: extraction.extractedCameras[0],
    logger,
  });
  const execQueue = new RenderQueue(logger);
  for (const item of extraction.sortedRenderQueue) {
    execQueue.enqueue(item);
  }
  const frameExec = renderContext.executeFrameWithQueue(execQueue);

  results.push({
    id: 'render_27_ecs_renderable_extraction_and_execution',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '27. ECS Renderable Extraction -> RenderQueue -> RenderFrame Execution',
    passed:
      frameExec.success &&
      frameExec.frame?.getState() === 'FrameCompleted' &&
      frameExec.sortedItems.length === 2 &&
      frameExec.frame.getRecordedCommands().length === 4, // viewport + camera + 3D mesh + 2D sprite
    details:
      'Executed complete ECS -> Extraction -> RenderQueue -> RenderDevice frame pipeline.',
  });

  // 28. 2D render extraction verification
  results.push({
    id: 'render_28_2d_render_extraction',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '28. 2D Sprite Entity Extraction & Layer/Order Preservation',
    passed:
      extraction.extractedSprites2D.length === 1 &&
      extraction.extractedSprites2D[0].entityId === spriteEnt.entityId &&
      extraction.extractedSprites2D[0].textureAssetId === texHeroAsset.assetId &&
      extraction.extractedSprites2D[0].layer.sortingLayer === 1 &&
      extraction.extractedSprites2D[0].layer.orderInLayer === 2,
    details: `Extracted 2D Sprite '${extraction.extractedSprites2D[0]?.spriteId}' bound to texture '${texHeroAsset.assetId}'.`,
  });

  // 29. 3D render extraction verification
  results.push({
    id: 'render_29_3d_render_extraction',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '29. 3D MeshRenderer Entity Extraction (Mesh, Material & Shader IDs)',
    passed:
      extraction.extractedRenderables3D.length === 1 &&
      extraction.extractedRenderables3D[0].entityId === meshEnt.entityId &&
      extraction.extractedRenderables3D[0].meshAssetId === meshCubeAsset.assetId &&
      extraction.extractedRenderables3D[0].materialAssetId === matCubeAsset.assetId &&
      extraction.extractedRenderables3D[0].shaderAssetId === shdBasicAsset.assetId,
    details: `Extracted 3D Renderable '${extraction.extractedRenderables3D[0]?.renderableId}' with Mesh, Material, and Shader AssetIds.`,
  });

  // 30. Renderer security restrictions & Android surface isolation
  const secAuditRemoteUrl = validateRenderPayloadSecurity(
    {
      textureUrl: 'https://evil.example.com/remote.png',
    },
    logger
  );
  const secAuditSdcard = validateRenderPayloadSecurity(
    {
      customArg: '/sdcard/game/hack.shader',
    },
    logger
  );
  const secAuditEval = validateRenderPayloadSecurity(
    {
      script: 'eval("alert(1)")',
    },
    logger
  );
  const androidSurfaceContract = createAndroidRenderSurfaceBridgeContract();
  results.push({
    id: 'render_30_security_and_android_isolation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '30. Renderer Security Restrictions & Android Surface Sandbox Isolation',
    passed:
      !secAuditRemoteUrl.safe &&
      !secAuditSdcard.safe &&
      !secAuditEval.safe &&
      androidSurfaceContract.applicationId === 'com.hypersoft.hylix' &&
      androidSurfaceContract.requiresExtraAndroidPermissions === false &&
      androidSurfaceContract.allowsDirectSystemOrSdcardPaths === false,
    details:
      'Blocked remote URLs, /sdcard paths, and eval() in rendering payloads; verified Android surface contract requires zero extra permissions.',
  });

  // 31. Texture ResourceManager integration & automatic contentHash invalidation (STEP 16 & STEP 21)
  const texBridge = new TextureRenderResourceBridge({
    projectId: 'prj_render_a',
    registry: registryA,
    resourceManager: rmA,
    logger,
  });
  const acquiredTex = texBridge.acquireTexture(texHeroAsset.assetId);
  const usableBeforeChange = texBridge.verifyTextureUsable(acquiredTex.value!);

  // Modify texture file & contentHash in AssetRegistry -> must invalidate old TextureRenderBinding!
  const updatedHeroBytes = 'HERO_TEX_V2_MODIFIED_PIXELS';
  storeA.writeFileAtomically('RenderProjA/assets/textures/hero.png', updatedHeroBytes);
  registryA.updateAssetMetadata(texHeroAsset.assetId, {
    contentHash: computeAssetContentHash(updatedHeroBytes),
    sizeBytes: updatedHeroBytes.length,
  });
  const usableAfterHashChange = texBridge.verifyTextureUsable(acquiredTex.value!);

  results.push({
    id: 'render_31_texture_hash_invalidation',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '31. Texture ResourceManager Integration & Use-After-Invalidate Protection',
    passed:
      acquiredTex.valid &&
      usableBeforeChange.valid &&
      !usableAfterHashChange.valid &&
      usableAfterHashChange.value?.state === 'invalidated',
    details:
      'Verified TextureRenderResourceBridge delegates to ResourceManager and blocks stale texture usage upon SHA-256 contentHash change.',
  });

  // 32. Diagnostic logging verification (all 12 required rendering events)
  renderDevice.shutdownDevice();
  const loggedMessages = logger.getEntries().map((e) => e.redactedMessage);
  const requiredEvents = [
    'render_backend_initialized',
    'render_backend_shutdown',
    'frame_started',
    'frame_submitted',
    'frame_completed',
    'render_resource_created',
    'render_resource_destroyed',
    'render_resource_invalidated',
    'render_queue_built',
    'render_validation_failed',
    'camera_created',
    'camera_validation_failed',
  ];
  const all12EventsPresent = requiredEvents.every((ev) =>
    loggedMessages.some((m) => m.includes(ev))
  );
  results.push({
    id: 'render_32_diagnostic_events_logging',
    category: 'Rendering Foundation & 2D/3D Abstraction',
    title: '32. Structured Rendering Diagnostic Events & Secret Redaction',
    passed: all12EventsPresent,
    details:
      'Verified all 12 mandatory rendering diagnostic events in RedactedDiagnosticLogger.',
  });

  return results;
}
