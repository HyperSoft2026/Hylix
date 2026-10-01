import { InputEvent } from './inputEvent';
import {
  createDefaultVector2,
  createInputError,
  DEFAULT_MAX_ACTIVE_TOUCHES,
  InputValidationResult,
  isFiniteInputNumber,
  TouchPhase,
  Vector2,
} from './inputTypes';

/**
 * Hylix V1.0.0 — Phase 08: Multi-Touch Input Foundation (Sections 9 & 22)
 *
 * Supports multi-touch (`touchId = 0, 1, 2...`), `position`, `delta`,
 * `phase` (`began`, `moved`, `stationary`, `ended`, `cancelled`), and
 * honest `pressure` (`number | null` — strictly `null` when platform capability
 * `supportsTouchPressure` is false; never fabricates pressure).
 */

export interface TouchPointState {
  readonly touchId: number;
  readonly position: Vector2;
  readonly startPosition: Vector2;
  readonly previousPosition: Vector2;
  readonly delta: Vector2;
  readonly pressure: number | null;
  readonly phase: TouchPhase;
  readonly startTick: number;
  readonly lastUpdatedTick: number;
  readonly startTimestampMs: number;
  readonly lastTimestampMs: number;
}

export class TouchInput {
  private readonly maxTouchPoints: number;
  private supportsPressure: boolean;
  private readonly touchesById = new Map<number, TouchPointState>();
  private readonly completedInCurrentTick: TouchPointState[] = [];

  constructor(options?: {
    readonly maxTouchPoints?: number;
    readonly supportsPressure?: boolean;
  }) {
    this.maxTouchPoints = Math.max(
      1,
      Math.min(32, Math.floor(options?.maxTouchPoints ?? DEFAULT_MAX_ACTIVE_TOUCHES))
    );
    this.supportsPressure = Boolean(options?.supportsPressure ?? false);
  }

  public setSupportsPressure(supportsPressure: boolean): void {
    this.supportsPressure = Boolean(supportsPressure);
  }

  public getSupportsPressure(): boolean {
    return this.supportsPressure;
  }

  public getMaxTouchPoints(): number {
    return this.maxTouchPoints;
  }

  /**
   * Advances active touch points at the start of a simulation tick:
   * - Purges touches that finished (`ended` or `cancelled`) in the previous tick.
   * - Transitions active (`began` or `moved`) touches to `stationary` with `delta = (0, 0)`
   *   until a new movement/end event arrives in the current tick.
   */
  public beginTick(): void {
    this.completedInCurrentTick.length = 0;

    for (const [touchId, point] of Array.from(this.touchesById.entries())) {
      if (point.phase === 'ended' || point.phase === 'cancelled') {
        this.touchesById.delete(touchId);
      } else {
        this.touchesById.set(
          touchId,
          Object.freeze({
            ...point,
            previousPosition: point.position,
            delta: createDefaultVector2(),
            phase: 'stationary',
          })
        );
      }
    }
  }

  public applyEvent(
    event: InputEvent
  ): InputValidationResult<TouchPointState> {
    if (
      event.touchId === null ||
      !Number.isInteger(event.touchId) ||
      event.touchId < 0
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_INVALID_VALUE',
            `Invalid touchId '${String(event.touchId)}'; must be a non-negative integer.`
          ),
        ],
      };
    }

    if (
      !isFiniteInputNumber(event.value) ||
      !isFiniteInputNumber(event.secondaryValue)
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_INVALID_VALUE',
            'Touch coordinates (x, y) must be finite numbers.'
          ),
        ],
      };
    }

    // Enforce non-fabrication of touch pressure when capability is absent
    const resolvedPressure: number | null =
      this.supportsPressure &&
      event.pressure !== null &&
      isFiniteInputNumber(event.pressure)
        ? event.pressure
        : null;

    const touchId = event.touchId;
    const existing = this.touchesById.get(touchId);
    const nextPos: Vector2 = Object.freeze({
      x: event.value,
      y: event.secondaryValue,
    });

    if (event.eventType === 'touch_began') {
      if (!existing && this.touchesById.size >= this.maxTouchPoints) {
        return {
          valid: false,
          value: null,
          errors: [
            createInputError(
              'INPUT_BUFFER_FULL',
              `Max active touch points (${this.maxTouchPoints}) reached; cannot start touchId ${touchId}.`
            ),
          ],
        };
      }

      const point: TouchPointState = Object.freeze({
        touchId,
        position: nextPos,
        startPosition: nextPos,
        previousPosition: nextPos,
        delta: createDefaultVector2(),
        pressure: resolvedPressure,
        phase: 'began',
        startTick: event.simulationTick,
        lastUpdatedTick: event.simulationTick,
        startTimestampMs: event.timestampMs,
        lastTimestampMs: event.timestampMs,
      });

      this.touchesById.set(touchId, point);
      return { valid: true, value: point, errors: [] };
    }

    if (!existing) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_EVENT_INVALID',
            `Received '${event.eventType}' for untracked touchId ${touchId} before 'touch_began'.`
          ),
        ],
      };
    }

    const computedDelta: Vector2 = Object.freeze({
      x:
        event.deltaX !== 0
          ? event.deltaX
          : nextPos.x - existing.position.x,
      y:
        event.deltaY !== 0
          ? event.deltaY
          : nextPos.y - existing.position.y,
    });

    let nextPhase: TouchPhase;
    switch (event.eventType) {
      case 'touch_moved':
        nextPhase = 'moved';
        break;
      case 'touch_stationary':
        nextPhase = 'stationary';
        break;
      case 'touch_ended':
        nextPhase = 'ended';
        break;
      case 'touch_cancelled':
        nextPhase = 'cancelled';
        break;
      default:
        return {
          valid: false,
          value: null,
          errors: [
            createInputError(
              'INPUT_EVENT_INVALID',
              `TouchInput cannot process eventType '${event.eventType}'.`
            ),
          ],
        };
    }

    const updatedPoint: TouchPointState = Object.freeze({
      ...existing,
      previousPosition: existing.position,
      position: nextPos,
      delta: nextPhase === 'stationary' ? createDefaultVector2() : computedDelta,
      pressure: resolvedPressure,
      phase: nextPhase,
      lastUpdatedTick: event.simulationTick,
      lastTimestampMs: event.timestampMs,
    });

    this.touchesById.set(touchId, updatedPoint);
    if (nextPhase === 'ended' || nextPhase === 'cancelled') {
      this.completedInCurrentTick.push(updatedPoint);
    }

    return {
      valid: true,
      value: updatedPoint,
      errors: [],
    };
  }

  public getTouch(touchId: number): TouchPointState | undefined {
    return this.touchesById.get(touchId);
  }

  /**
   * Lists all tracked touches sorted deterministically by `touchId ASC`.
   */
  public listTouches(): readonly TouchPointState[] {
    return Object.freeze(
      Array.from(this.touchesById.values()).sort(
        (a, b) => a.touchId - b.touchId
      )
    );
  }

  public getActiveTouchCount(): number {
    let count = 0;
    for (const p of this.touchesById.values()) {
      if (p.phase !== 'ended' && p.phase !== 'cancelled') {
        count += 1;
      }
    }
    return count;
  }

  public reset(): void {
    this.touchesById.clear();
    this.completedInCurrentTick.length = 0;
  }
}
