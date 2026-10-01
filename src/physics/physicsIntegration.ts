import { HylixAssetRegistry } from '../assets/assetRegistry';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  HylixEntity,
  TRANSFORM_COMPONENT_TYPE,
  validateTransformComponentData,
} from '../ecs/ecsCore';
import {
  extractSceneRenderData,
  SceneRenderExtractionResult,
} from '../rendering/sceneRenderer';
import { SceneDefinition } from '../scene/sceneSystem';
import { PhysicsStepResult, PhysicsWorld } from './physicsWorld';

/**
 * Hylix V1.0.0 — Phase 06: Physics <-> ECS <-> Rendering Integration Bridge (STEP 27 & STEP 29)
 *
 * Canonical Pipeline:
 *   ECS
 *     ↓
 *   Physics Extraction (`extractScenePhysicsData`)
 *     ↓
 *   PhysicsWorld Simulation (`world.step`)
 *     ↓
 *   Physics Results -> ECS Transform Update (`applyPhysicsWorldToScene`)
 *     ↓
 *   Render Extraction (`extractSceneRenderData`)
 *     ↓
 *   RenderQueue
 *
 * Guarantees:
 * - Physics NEVER touches GPU APIs or RenderBackend directly.
 * - Renderer NEVER runs Physics simulation; it reads the updated ECS `Transform`.
 */

/**
 * Purely and immutably synchronizes simulated `PhysicsWorld` body positions and rotations
 * back into an array of `HylixEntity` `Transform` components (STEP 27).
 */
export function applyPhysicsWorldToEntities(
  world: PhysicsWorld,
  entities: readonly HylixEntity[]
): readonly HylixEntity[] {
  const updatedEntities: HylixEntity[] = [];

  for (const entity of entities) {
    const body = world.getBodyByEntityId(entity.entityId);
    if (!body || !body.isEnabled || body.bodyType === 'static') {
      updatedEntities.push(entity);
      continue;
    }

    const existingTransformRaw = entity.components[TRANSFORM_COMPONENT_TYPE];
    const existingTransformCheck =
      validateTransformComponentData(existingTransformRaw);
    const scale =
      existingTransformCheck.valid && existingTransformCheck.data
        ? existingTransformCheck.data.scale
        : Object.freeze({ x: 1, y: 1, z: 1 });

    const nextTransform = Object.freeze({
      position: Object.freeze({
        x: body.position.x,
        y: body.position.y,
        z: body.position.z,
      }),
      rotation: Object.freeze({
        x: body.rotation.x,
        y: body.rotation.y,
        z: body.rotation.z,
      }),
      scale,
    });

    updatedEntities.push(
      Object.freeze({
        ...entity,
        components: Object.freeze({
          ...entity.components,
          [TRANSFORM_COMPONENT_TYPE]: nextTransform,
        }),
      })
    );
  }

  return Object.freeze(updatedEntities);
}

/**
 * Returns a new `SceneDefinition` snapshot with `Transform` components updated from `PhysicsWorld`.
 * Does not mutate the original `scene` object.
 */
export function applyPhysicsWorldToScene(
  world: PhysicsWorld,
  scene: SceneDefinition
): SceneDefinition {
  return Object.freeze({
    ...scene,
    entities: applyPhysicsWorldToEntities(world, scene.entities),
  });
}

/**
 * Executes a single deterministic Physics step, updates ECS `Transform` components,
 * and extracts the resulting `SceneRenderExtractionResult` (`RenderQueue`) (STEP 29).
 */
export function stepPhysicsAndSynchronizeRenderData(
  world: PhysicsWorld,
  scene: SceneDefinition,
  options?: {
    readonly fixedDeltaTime?: number;
    readonly assetRegistry?: HylixAssetRegistry;
    readonly logger?: RedactedDiagnosticLogger;
  }
): {
  readonly stepResult: PhysicsStepResult;
  readonly updatedScene: SceneDefinition;
  readonly renderExtraction: SceneRenderExtractionResult;
} {
  const stepResult = world.step(options?.fixedDeltaTime);
  const updatedScene = applyPhysicsWorldToScene(world, scene);
  const renderExtraction = extractSceneRenderData(updatedScene, {
    assetRegistry: options?.assetRegistry,
    logger: options?.logger,
  });

  return Object.freeze({
    stepResult,
    updatedScene,
    renderExtraction,
  });
}
