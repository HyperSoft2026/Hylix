import {
  AndroidInputBridgeContract,
  createAndroidInputBridgeContract,
  NullContractInputBackend,
  PlatformInputBackendContract,
  PlatformInputBackendLifecycleState,
  PlatformInputTouchCapabilities,
  PlatformRawInputSample,
} from '../platform/platformAbstraction';
import { GestureEvent } from './gestureInput';
import { InputActionEvaluatedState } from './inputAction';
import {
  ExtractedInputReceiverNode,
  extractSceneInputData,
  INPUT_RECEIVER_COMPONENT_TYPE,
  InputReceiverComponentData,
  OFFICIAL_INPUT_RECEIVER_SPEC,
  registerInputEcsComponents,
  SceneInputFrameSnapshot,
  validateInputReceiverComponentData,
} from './inputExtraction';
import { InputManager } from './inputManager';
import {
  clampInputNumber,
  createInputError,
  InputValidationResult,
  isFiniteInputNumber,
  Vector2,
} from './inputTypes';
import { MouseStateSnapshot } from './mouseInput';
import { TouchPointState } from './touchInput';

/**
 * Hylix V1.0.0 — Phase 08: Input Integration Layer (ECS, Coordinate Decoupling, Project Cleanup)
 *
 * Keeps Input Runtime strictly independent from Rendering, Physics, Audio, and UI
 * while providing pure, deterministic integration contracts.
 */

export {
  createAndroidInputBridgeContract,
  extractSceneInputData,
  INPUT_RECEIVER_COMPONENT_TYPE,
  NullContractInputBackend,
  OFFICIAL_INPUT_RECEIVER_SPEC,
  registerInputEcsComponents,
  validateInputReceiverComponentData,
};
export type {
  AndroidInputBridgeContract,
  ExtractedInputReceiverNode,
  InputReceiverComponentData,
  PlatformInputBackendContract,
  PlatformInputBackendLifecycleState,
  PlatformInputTouchCapabilities,
  PlatformRawInputSample,
  SceneInputFrameSnapshot,
};

export interface ViewportRectContract {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Camera2DViewContract {
  readonly position: Vector2;
  readonly orthoHeight: number;
  readonly aspect: number;
}

/**
 * Converts a raw screen/pointer position `(x, y)` into normalized viewport coordinates `[0, 1] x [0, 1]`
 * without coupling `MouseInput` or `TouchInput` directly to the Renderer.
 */
export function screenToNormalizedViewportPosition(
  screenPos: Vector2,
  viewport: ViewportRectContract
): InputValidationResult<Vector2> {
  if (
    !isFiniteInputNumber(screenPos.x) ||
    !isFiniteInputNumber(screenPos.y) ||
    !isFiniteInputNumber(viewport.x) ||
    !isFiniteInputNumber(viewport.y) ||
    !isFiniteInputNumber(viewport.width) ||
    !isFiniteInputNumber(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_INVALID_VALUE',
          'Screen position and viewport dimensions must be finite numbers with width > 0 and height > 0.'
        ),
      ],
    };
  }

  const u = clampInputNumber(
    (screenPos.x - viewport.x) / viewport.width,
    0,
    1
  );
  const v = clampInputNumber(
    (screenPos.y - viewport.y) / viewport.height,
    0,
    1
  );

  return {
    valid: true,
    value: Object.freeze({ x: u, y: v }),
    errors: [],
  };
}

/**
 * Converts normalized viewport coordinates `u, v in [0, 1]` into 2D world space
 * using a pure `Camera2DViewContract` snapshot.
 */
export function normalizedViewportToWorld2D(
  normalizedViewportPos: Vector2,
  camera: Camera2DViewContract
): InputValidationResult<Vector2> {
  if (
    !isFiniteInputNumber(normalizedViewportPos.x) ||
    !isFiniteInputNumber(normalizedViewportPos.y) ||
    !isFiniteInputNumber(camera.position.x) ||
    !isFiniteInputNumber(camera.position.y) ||
    !isFiniteInputNumber(camera.orthoHeight) ||
    !isFiniteInputNumber(camera.aspect) ||
    camera.orthoHeight <= 0 ||
    camera.aspect <= 0
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_INVALID_VALUE',
          'Normalized viewport coordinates and Camera2D parameters must be finite numbers with orthoHeight > 0 and aspect > 0.'
        ),
      ],
    };
  }

  const ndcX = normalizedViewportPos.x * 2 - 1;
  const ndcY = 1 - normalizedViewportPos.y * 2;
  const halfHeight = camera.orthoHeight * 0.5;
  const halfWidth = halfHeight * camera.aspect;

  const worldX = camera.position.x + ndcX * halfWidth;
  const worldY = camera.position.y + ndcY * halfHeight;

  return {
    valid: true,
    value: Object.freeze({ x: worldX, y: worldY }),
    errors: [],
  };
}

export interface GameplayInputReadOnlySnapshot {
  readonly projectId: string;
  readonly simulationTick: number;
  readonly contextName: string | null;
  readonly actionsByName: Readonly<Record<string, InputActionEvaluatedState>>;
  readonly mouse: MouseStateSnapshot;
  readonly touches: readonly TouchPointState[];
  readonly gestures: readonly GestureEvent[];
}

/**
 * Creates a deeply frozen, read-only gameplay input snapshot from `InputManager`.
 * Ensures ECS systems and gameplay logic can read input deterministically without
 * mutating `InputManager` state.
 */
export function createGameplayInputSnapshot(
  inputManager: InputManager,
  contextIdOrName?: string
): GameplayInputReadOnlySnapshot {
  const actionsRecord: Record<string, InputActionEvaluatedState> = {};
  const allActions = inputManager.getActionMap().listActions();

  for (const act of allActions) {
    const state = inputManager.getActionState(act.actionId, contextIdOrName);
    if (state) {
      actionsRecord[act.name] = state;
    }
  }

  return Object.freeze({
    projectId: inputManager.getProjectId(),
    simulationTick: inputManager.getCurrentSimulationTick(),
    contextName: contextIdOrName ?? null,
    actionsByName: Object.freeze(actionsRecord),
    mouse: inputManager.getMouseSnapshot(),
    touches: inputManager.listTouches(),
    gestures: inputManager.listRecognizedGestures(),
  });
}

export interface EvaluatedEntityInputReceiver {
  readonly entityId: string;
  readonly contextName: string;
  readonly playerIndex: number;
  readonly actions: Readonly<Record<string, InputActionEvaluatedState>>;
}

/**
 * Evaluates extracted ECS `InputReceiver` nodes against an active `InputManager`
 * without mutating the `SceneDefinition` or `InputManager`.
 */
export function evaluateSceneInputReceivers(
  sceneSnapshot: SceneInputFrameSnapshot,
  inputManager: InputManager
): readonly EvaluatedEntityInputReceiver[] {
  if (sceneSnapshot.projectId !== inputManager.getProjectId()) {
    return Object.freeze([]);
  }

  const results: EvaluatedEntityInputReceiver[] = [];
  for (const receiver of sceneSnapshot.receivers) {
    if (!receiver.enabled) continue;
    const actionsMap: Record<string, InputActionEvaluatedState> = {};
    for (const actionName of receiver.actionNames) {
      const state = inputManager.getActionState(
        actionName,
        receiver.contextName
      );
      if (state) {
        actionsMap[actionName] = state;
      }
    }
    results.push(
      Object.freeze({
        entityId: receiver.entityId,
        contextName: receiver.contextName,
        playerIndex: receiver.playerIndex,
        actions: Object.freeze(actionsMap),
      })
    );
  }

  return Object.freeze(results);
}

/**
 * Cleans up and shuts down a project's `InputManager` when closing a project.
 * Guarantees zero cross-project leakage of buffered events, devices, or held states.
 */
export function cleanupInputManagerForProjectClose(
  inputManager: InputManager
): {
  readonly shutdownSuccess: boolean;
  readonly clearedBufferedEvents: number;
  readonly clearedDevicesCount: number;
} {
  const bufferedCount = inputManager.getBuffer().size();
  const deviceCount = inputManager.listDevices().length;
  const res = inputManager.shutdown();

  return Object.freeze({
    shutdownSuccess: res.success,
    clearedBufferedEvents: bufferedCount,
    clearedDevicesCount: deviceCount,
  });
}
