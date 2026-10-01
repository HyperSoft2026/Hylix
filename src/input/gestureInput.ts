import {
  createDefaultVector2,
  isFiniteInputNumber,
  Vector2,
} from './inputTypes';
import { TouchPointState } from './touchInput';

/**
 * Hylix V1.0.0 — Phase 08: Touch Gesture Foundation (Section 23)
 *
 * Recognizes deterministic `tap`, `doubleTap`, `longPress`, and `swipe` gestures
 * directly from TouchPointState transitions without depending on Rendering.
 */

export type GestureType = 'tap' | 'doubleTap' | 'longPress' | 'swipe';

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface GestureEvent {
  readonly gestureType: GestureType;
  readonly touchId: number;
  readonly position: Vector2;
  readonly delta: Vector2;
  readonly swipeDirection: SwipeDirection | null;
  readonly durationMs: number;
  readonly simulationTick: number;
}

export interface GestureConfig {
  readonly maxTapMoveDistance?: number;
  readonly maxTapDurationMs?: number;
  readonly doubleTapWindowMs?: number;
  readonly longPressDurationMs?: number;
  readonly minSwipeDistance?: number;
}

export class GestureRecognizer {
  private readonly maxTapMoveDistance: number;
  private readonly maxTapDurationMs: number;
  private readonly doubleTapWindowMs: number;
  private readonly longPressDurationMs: number;
  private readonly minSwipeDistance: number;

  private lastTapTimestampMs: number | null = null;
  private lastTapPosition: Vector2 | null = null;
  private readonly longPressFiredForTouch = new Set<number>();
  private readonly recognizedInCurrentTick: GestureEvent[] = [];

  constructor(config?: GestureConfig) {
    this.maxTapMoveDistance = config?.maxTapMoveDistance ?? 20;
    this.maxTapDurationMs = config?.maxTapDurationMs ?? 300;
    this.doubleTapWindowMs = config?.doubleTapWindowMs ?? 350;
    this.longPressDurationMs = config?.longPressDurationMs ?? 500;
    this.minSwipeDistance = config?.minSwipeDistance ?? 40;
  }

  public beginTick(): void {
    this.recognizedInCurrentTick.length = 0;
  }

  public evaluateTouchPoint(point: TouchPointState): readonly GestureEvent[] {
    const emitted: GestureEvent[] = [];
    const totalDx = point.position.x - point.startPosition.x;
    const totalDy = point.position.y - point.startPosition.y;
    const travelDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
    const durationMs = Math.max(
      0,
      point.lastTimestampMs - point.startTimestampMs
    );

    if (point.phase === 'began') {
      this.longPressFiredForTouch.delete(point.touchId);
      return emitted;
    }

    if (point.phase === 'cancelled') {
      this.longPressFiredForTouch.delete(point.touchId);
      return emitted;
    }

    if (
      (point.phase === 'stationary' || point.phase === 'moved') &&
      !this.longPressFiredForTouch.has(point.touchId)
    ) {
      if (
        travelDist <= this.maxTapMoveDistance &&
        isFiniteInputNumber(durationMs) &&
        durationMs >= this.longPressDurationMs
      ) {
        this.longPressFiredForTouch.add(point.touchId);
        const longPressGesture: GestureEvent = Object.freeze({
          gestureType: 'longPress',
          touchId: point.touchId,
          position: point.position,
          delta: createDefaultVector2(),
          swipeDirection: null,
          durationMs,
          simulationTick: point.lastUpdatedTick,
        });
        emitted.push(longPressGesture);
        this.recognizedInCurrentTick.push(longPressGesture);
      }
      return emitted;
    }

    if (point.phase === 'ended') {
      const alreadyLongPressed = this.longPressFiredForTouch.has(point.touchId);
      this.longPressFiredForTouch.delete(point.touchId);

      if (alreadyLongPressed) {
        return emitted;
      }

      if (travelDist >= this.minSwipeDistance) {
        const swipeDirection: SwipeDirection =
          Math.abs(totalDx) >= Math.abs(totalDy)
            ? totalDx >= 0
              ? 'right'
              : 'left'
            : totalDy >= 0
              ? 'down'
              : 'up';

        const swipeGesture: GestureEvent = Object.freeze({
          gestureType: 'swipe',
          touchId: point.touchId,
          position: point.position,
          delta: Object.freeze({ x: totalDx, y: totalDy }),
          swipeDirection,
          durationMs,
          simulationTick: point.lastUpdatedTick,
        });
        emitted.push(swipeGesture);
        this.recognizedInCurrentTick.push(swipeGesture);
        return emitted;
      }

      if (
        travelDist <= this.maxTapMoveDistance &&
        durationMs <= this.maxTapDurationMs
      ) {
        const tapGesture: GestureEvent = Object.freeze({
          gestureType: 'tap',
          touchId: point.touchId,
          position: point.position,
          delta: Object.freeze({ x: totalDx, y: totalDy }),
          swipeDirection: null,
          durationMs,
          simulationTick: point.lastUpdatedTick,
        });
        emitted.push(tapGesture);
        this.recognizedInCurrentTick.push(tapGesture);

        if (
          this.lastTapTimestampMs !== null &&
          this.lastTapPosition !== null &&
          point.lastTimestampMs - this.lastTapTimestampMs <=
            this.doubleTapWindowMs
        ) {
          const dtDx = point.position.x - this.lastTapPosition.x;
          const dtDy = point.position.y - this.lastTapPosition.y;
          if (Math.hypot(dtDx, dtDy) <= this.maxTapMoveDistance * 1.5) {
            const doubleTapGesture: GestureEvent = Object.freeze({
              gestureType: 'doubleTap',
              touchId: point.touchId,
              position: point.position,
              delta: Object.freeze({ x: dtDx, y: dtDy }),
              swipeDirection: null,
              durationMs: point.lastTimestampMs - this.lastTapTimestampMs,
              simulationTick: point.lastUpdatedTick,
            });
            emitted.push(doubleTapGesture);
            this.recognizedInCurrentTick.push(doubleTapGesture);
            this.lastTapTimestampMs = null;
            this.lastTapPosition = null;
            return emitted;
          }
        }

        this.lastTapTimestampMs = point.lastTimestampMs;
        this.lastTapPosition = point.position;
      }
    }

    return Object.freeze(emitted);
  }

  public listRecognizedGestures(): readonly GestureEvent[] {
    return Object.freeze([...this.recognizedInCurrentTick]);
  }

  public reset(): void {
    this.lastTapTimestampMs = null;
    this.lastTapPosition = null;
    this.longPressFiredForTouch.clear();
    this.recognizedInCurrentTick.length = 0;
  }
}
