import { ResourceManager } from '../assets/resourceManager';
import {
  HylixEntity,
  TRANSFORM_COMPONENT_TYPE,
  validateTransformComponentData,
} from '../ecs/ecsCore';
import { SceneDefinition } from '../scene/sceneSystem';
import { createDeterministicAudioListenerId } from './audioListener';
import { createDeterministicAudioSourceId } from './audioSource';
import { Vector3 } from './audioTypes';
import { AudioWorld } from './audioWorld';

/**
 * Hylix V1.0.0 — Phase 07: Scene/ECS Transform <-> AudioWorld Synchronization
 * & Project Lifecycle Cleanup
 */

function computeWorldPos(
  entity: HylixEntity,
  byId: ReadonlyMap<string, HylixEntity>
): Vector3 {
  let x = 0;
  let y = 0;
  let z = 0;
  const visited = new Set<string>();
  let cursor: HylixEntity | undefined = entity;
  while (cursor && !visited.has(cursor.entityId)) {
    visited.add(cursor.entityId);
    const rawTransform = cursor.components[TRANSFORM_COMPONENT_TYPE];
    if (rawTransform) {
      const check = validateTransformComponentData(rawTransform);
      if (check.valid && check.data) {
        x += check.data.position.x;
        y += check.data.position.y;
        z += check.data.position.z;
      }
    }
    cursor = cursor.parentEntityId
      ? byId.get(cursor.parentEntityId)
      : undefined;
  }
  return Object.freeze({ x, y, z });
}

/**
 * Synchronizes entity `Transform` positions from `SceneDefinition` (e.g., after
 * a Physics step or ECS transform update) into the active `AudioWorld`.
 * Never mutates `SceneDefinition`.
 */
export function syncSceneTransformsToAudioWorld(
  scene: SceneDefinition,
  audioWorld: AudioWorld
): {
  readonly updatedSourceCount: number;
  readonly updatedListenerCount: number;
} {
  const byId = new Map<string, HylixEntity>();
  for (const ent of scene.entities) {
    byId.set(ent.entityId, ent);
  }

  const projectId = audioWorld.getProjectId();
  let updatedSourceCount = 0;
  let updatedListenerCount = 0;

  for (const ent of scene.entities) {
    if (!ent.enabled) continue;
    const worldPos = computeWorldPos(ent, byId);

    const sourceId = createDeterministicAudioSourceId(projectId, ent.entityId);
    const existingSource = audioWorld.getSource(sourceId);
    if (existingSource) {
      const upd = audioWorld.updateSourceParameters(sourceId, {
        position: worldPos,
      });
      if (upd.success) {
        updatedSourceCount += 1;
      }
    }

    const listenerId = createDeterministicAudioListenerId(
      projectId,
      ent.entityId
    );
    const existingListeners = audioWorld.listListeners();
    const matchListener = existingListeners.find(
      (l) => l.listenerId === listenerId
    );
    if (matchListener) {
      const reg = audioWorld.registerListener({
        ...matchListener,
        position: worldPos,
      });
      if (reg.success) {
        updatedListenerCount += 1;
      }
    }
  }

  return Object.freeze({
    updatedSourceCount,
    updatedListenerCount,
  });
}

/**
 * Stops all active voices, shuts down the `AudioWorld`, and clears unused
 * resources in `ResourceManager` when closing a project.
 */
export function cleanupAudioWorldForProjectClose(
  audioWorld: AudioWorld,
  resourceManager?: ResourceManager
): {
  readonly shutdownSuccess: boolean;
  readonly releasedVoicesCount: number;
  readonly clearedUnusedResources: number;
} {
  const shutdownRes = audioWorld.shutdown();
  const cleared = resourceManager
    ? resourceManager.clearUnused().clearedCount
    : 0;

  return Object.freeze({
    shutdownSuccess: shutdownRes.success,
    releasedVoicesCount: shutdownRes.releasedVoicesCount,
    clearedUnusedResources: cleared,
  });
}
