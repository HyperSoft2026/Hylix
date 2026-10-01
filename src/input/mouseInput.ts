import { InputEvent } from './inputEvent';
import { ControlStateSnapshot, InputState } from './inputState';
import {
  createDefaultVector2,
  createInputError,
  DigitalControlPhase,
  InputValidationResult,
  isFiniteInputNumber,
  Vector2,
} from './inputTypes';

/**
 * Hylix V1.0.0 — Phase 08: Mouse Input Foundation (Section 8)
 *
 * Supports pointer `position`, per-tick `delta`, scroll `wheel`, and canonical buttons
 * (`MouseLeft`, `MouseMiddle`, `MouseRight`, `MouseButton4`, `MouseButton5`) with
 * `pressed`, `held`, `released`, and `idle` states.
 *
 * Strictly decouples raw pointer coordinates from viewport and world coordinates.
 */

export type CanonicalMouseButton =
  | 'MouseLeft'
  | 'MouseMiddle'
  | 'MouseRight'
  | 'MouseButton4'
  | 'MouseButton5';

export const CANONICAL_MOUSE_BUTTONS: ReadonlySet<CanonicalMouseButton> =
  new Set<CanonicalMouseButton>([
    'MouseLeft',
    'MouseMiddle',
    'MouseRight',
    'MouseButton4',
    'MouseButton5',
  ]);

export function isValidCanonicalMouseButton(
  candidate: unknown
): candidate is CanonicalMouseButton {
  return (
    typeof candidate === 'string' &&
    CANONICAL_MOUSE_BUTTONS.has(candidate as CanonicalMouseButton)
  );
}

export interface MouseStateSnapshot {
  readonly position: Vector2;
  readonly delta: Vector2;
  readonly wheel: Vector2;
  readonly buttons: Readonly<Record<CanonicalMouseButton, DigitalControlPhase>>;
}

export class MouseInput {
  private readonly buttonState = new InputState();
  private position: Vector2 = createDefaultVector2();
  private delta: Vector2 = createDefaultVector2();
  private wheel: Vector2 = createDefaultVector2();
  private hasPositionSample = false;

  /**
   * Advances mouse state at the start of a tick:
   * - Resets per-tick `delta` and `wheel` to `(0, 0)`.
   * - Advances button phases (`pressed -> held`, `released -> idle`).
   */
  public beginTick(): void {
    this.delta = createDefaultVector2();
    this.wheel = createDefaultVector2();
    this.buttonState.beginTick();
  }

  public applyEvent(event: InputEvent): InputValidationResult<MouseStateSnapshot> {
    if (event.eventType === 'mouse_move') {
      if (
        !isFiniteInputNumber(event.value) ||
        !isFiniteInputNumber(event.secondaryValue) ||
        !isFiniteInputNumber(event.deltaX) ||
        !isFiniteInputNumber(event.deltaY)
      ) {
        return {
          valid: false,
          value: null,
          errors: [
            createInputError(
              'INPUT_INVALID_VALUE',
              'Mouse move coordinates and deltas must be finite numbers.'
            ),
          ],
        };
      }

      const nextX = event.value;
      const nextY = event.secondaryValue;
      const computedDx =
        event.deltaX !== 0
          ? event.deltaX
          : this.hasPositionSample
            ? nextX - this.position.x
            : 0;
      const computedDy =
        event.deltaY !== 0
          ? event.deltaY
          : this.hasPositionSample
            ? nextY - this.position.y
            : 0;

      this.position = Object.freeze({ x: nextX, y: nextY });
      this.delta = Object.freeze({
        x: this.delta.x + computedDx,
        y: this.delta.y + computedDy,
      });
      this.hasPositionSample = true;

      return {
        valid: true,
        value: this.getSnapshot(),
        errors: [],
      };
    }

    if (event.eventType === 'mouse_wheel') {
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
              'Mouse wheel deltas must be finite numbers.'
            ),
          ],
        };
      }

      this.wheel = Object.freeze({
        x: this.wheel.x + event.value,
        y: this.wheel.y + event.secondaryValue,
      });

      return {
        valid: true,
        value: this.getSnapshot(),
        errors: [],
      };
    }

    if (
      event.eventType === 'mouse_button_down' ||
      event.eventType === 'mouse_button_up'
    ) {
      if (!isValidCanonicalMouseButton(event.control)) {
        return {
          valid: false,
          value: null,
          errors: [
            createInputError(
              'INPUT_INVALID_VALUE',
              `Invalid mouse button identifier '${event.control}'. Expected MouseLeft, MouseMiddle, MouseRight, MouseButton4, or MouseButton5.`
            ),
          ],
        };
      }

      const btn = event.control;
      const currentSnap = this.buttonState.getControlState(btn);
      if (event.eventType === 'mouse_button_down') {
        if (currentSnap.phase !== 'pressed' && currentSnap.phase !== 'held') {
          this.buttonState.setControlValue(btn, 1);
        }
      } else {
        this.buttonState.setControlValue(btn, 0);
      }

      return {
        valid: true,
        value: this.getSnapshot(),
        errors: [],
      };
    }

    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_EVENT_INVALID',
          `MouseInput cannot process eventType '${event.eventType}'.`
        ),
      ],
    };
  }

  public getPosition(): Vector2 {
    return this.position;
  }

  public getDelta(): Vector2 {
    return this.delta;
  }

  public getWheel(): Vector2 {
    return this.wheel;
  }

  public isButtonDown(button: CanonicalMouseButton): boolean {
    const phase = this.getButtonPhase(button);
    return phase === 'pressed' || phase === 'held';
  }

  public isButtonPressed(button: CanonicalMouseButton): boolean {
    if (!isValidCanonicalMouseButton(button)) return false;
    return this.buttonState.getControlState(button).pressed;
  }

  public isButtonHeld(button: CanonicalMouseButton): boolean {
    if (!isValidCanonicalMouseButton(button)) return false;
    return this.buttonState.getControlState(button).held;
  }

  public isButtonReleased(button: CanonicalMouseButton): boolean {
    if (!isValidCanonicalMouseButton(button)) return false;
    return this.buttonState.getControlState(button).released;
  }

  public getButtonPhase(button: CanonicalMouseButton): DigitalControlPhase {
    if (!isValidCanonicalMouseButton(button)) return 'idle';
    return this.buttonState.getControlState(button).phase;
  }

  public getButtonState(
    button: CanonicalMouseButton
  ): ControlStateSnapshot | null {
    if (!isValidCanonicalMouseButton(button)) return null;
    return this.buttonState.getControlState(button);
  }

  public getSnapshot(): MouseStateSnapshot {
    return Object.freeze({
      position: this.position,
      delta: this.delta,
      wheel: this.wheel,
      buttons: Object.freeze({
        MouseLeft: this.getButtonPhase('MouseLeft'),
        MouseMiddle: this.getButtonPhase('MouseMiddle'),
        MouseRight: this.getButtonPhase('MouseRight'),
        MouseButton4: this.getButtonPhase('MouseButton4'),
        MouseButton5: this.getButtonPhase('MouseButton5'),
      }),
    });
  }

  public reset(): void {
    this.buttonState.reset();
    this.position = createDefaultVector2();
    this.delta = createDefaultVector2();
    this.wheel = createDefaultVector2();
    this.hasPositionSample = false;
  }
}
