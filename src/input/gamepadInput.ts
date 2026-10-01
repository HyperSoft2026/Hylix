import { InputEvent } from './inputEvent';
import { ControlStateSnapshot, InputState } from './inputState';
import {
  clampInputNumber,
  createInputError,
  DigitalControlPhase,
  InputValidationResult,
  isFiniteInputNumber,
} from './inputTypes';

/**
 * Hylix V1.0.0 — Phase 08: Gamepad Input Foundation (Section 10)
 *
 * Canonical Buttons: `A`, `B`, `X`, `Y`, `Start`, `Select`, `L1`, `R1`, `L2`, `R2`,
 *                    `DPadUp`, `DPadDown`, `DPadLeft`, `DPadRight`.
 * Canonical Axes: `LeftX`, `LeftY`, `RightX`, `RightY`, `TriggerL`, `TriggerR`.
 *
 * Ranges:
 * - Buttons: normalized `[0, 1]`
 * - Axes: normalized `[-1, 1]`
 * Strictly rejects `NaN`, `Infinity`, and `-Infinity`.
 */

export type CanonicalGamepadButton =
  | 'A'
  | 'B'
  | 'X'
  | 'Y'
  | 'Start'
  | 'Select'
  | 'L1'
  | 'R1'
  | 'L2'
  | 'R2'
  | 'DPadUp'
  | 'DPadDown'
  | 'DPadLeft'
  | 'DPadRight';

export type CanonicalGamepadAxis =
  | 'LeftX'
  | 'LeftY'
  | 'RightX'
  | 'RightY'
  | 'TriggerL'
  | 'TriggerR';

export const CANONICAL_GAMEPAD_BUTTONS: ReadonlySet<CanonicalGamepadButton> =
  new Set<CanonicalGamepadButton>([
    'A',
    'B',
    'X',
    'Y',
    'Start',
    'Select',
    'L1',
    'R1',
    'L2',
    'R2',
    'DPadUp',
    'DPadDown',
    'DPadLeft',
    'DPadRight',
  ]);

export const CANONICAL_GAMEPAD_AXES: ReadonlySet<CanonicalGamepadAxis> =
  new Set<CanonicalGamepadAxis>([
    'LeftX',
    'LeftY',
    'RightX',
    'RightY',
    'TriggerL',
    'TriggerR',
  ]);

export function isValidCanonicalGamepadButton(
  candidate: unknown
): candidate is CanonicalGamepadButton {
  return (
    typeof candidate === 'string' &&
    CANONICAL_GAMEPAD_BUTTONS.has(candidate as CanonicalGamepadButton)
  );
}

export function isValidCanonicalGamepadAxis(
  candidate: unknown
): candidate is CanonicalGamepadAxis {
  return (
    typeof candidate === 'string' &&
    CANONICAL_GAMEPAD_AXES.has(candidate as CanonicalGamepadAxis)
  );
}

export function validateAndNormalizeGamepadButtonValue(
  rawValue: unknown
): InputValidationResult<number> {
  if (!isFiniteInputNumber(rawValue)) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_INVALID_VALUE',
          `Gamepad button value '${String(rawValue)}' must be a finite number.`
        ),
      ],
    };
  }
  if (rawValue < 0 || rawValue > 1) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_INVALID_VALUE',
          `Gamepad button value ${rawValue} is outside allowed range [0, 1].`
        ),
      ],
    };
  }
  return {
    valid: true,
    value: clampInputNumber(rawValue, 0, 1),
    errors: [],
  };
}

export function validateAndNormalizeGamepadAxisValue(
  rawValue: unknown
): InputValidationResult<number> {
  if (!isFiniteInputNumber(rawValue)) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_INVALID_VALUE',
          `Gamepad axis value '${String(rawValue)}' must be a finite number.`
        ),
      ],
    };
  }
  if (rawValue < -1 || rawValue > 1) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_INVALID_VALUE',
          `Gamepad axis value ${rawValue} is outside allowed range [-1, 1].`
        ),
      ],
    };
  }
  const normalized = clampInputNumber(rawValue, -1, 1);
  return {
    valid: true,
    value: normalized === 0 ? 0 : normalized,
    errors: [],
  };
}

export class GamepadInput {
  private readonly buttonState = new InputState();
  private readonly axesById = new Map<CanonicalGamepadAxis, number>();

  constructor() {
    this.resetAxes();
  }

  private resetAxes(): void {
    for (const axis of CANONICAL_GAMEPAD_AXES) {
      this.axesById.set(axis, 0);
    }
  }

  public beginTick(): void {
    this.buttonState.beginTick();
  }

  public applyEvent(
    event: InputEvent
  ): InputValidationResult<ControlStateSnapshot | number> {
    if (event.eventType === 'gamepad_button') {
      if (!isValidCanonicalGamepadButton(event.control)) {
        return {
          valid: false,
          value: null,
          errors: [
            createInputError(
              'INPUT_INVALID_VALUE',
              `Invalid gamepad button '${event.control}'.`
            ),
          ],
        };
      }

      const normCheck = validateAndNormalizeGamepadButtonValue(event.value);
      if (!normCheck.valid || normCheck.value === null) {
        return {
          valid: false,
          value: null,
          errors: normCheck.errors,
        };
      }

      return this.buttonState.setControlValue(event.control, normCheck.value);
    }

    if (event.eventType === 'gamepad_axis') {
      if (!isValidCanonicalGamepadAxis(event.control)) {
        return {
          valid: false,
          value: null,
          errors: [
            createInputError(
              'INPUT_INVALID_VALUE',
              `Invalid gamepad axis '${event.control}'.`
            ),
          ],
        };
      }

      const normCheck = validateAndNormalizeGamepadAxisValue(event.value);
      if (!normCheck.valid || normCheck.value === null) {
        return {
          valid: false,
          value: null,
          errors: normCheck.errors,
        };
      }

      this.axesById.set(event.control, normCheck.value);
      return {
        valid: true,
        value: normCheck.value,
        errors: [],
      };
    }

    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_EVENT_INVALID',
          `GamepadInput cannot process eventType '${event.eventType}'.`
        ),
      ],
    };
  }

  public getButtonValue(button: CanonicalGamepadButton): number {
    if (!isValidCanonicalGamepadButton(button)) return 0;
    return this.buttonState.getControlState(button).currentValue;
  }

  public isButtonDown(button: CanonicalGamepadButton): boolean {
    if (!isValidCanonicalGamepadButton(button)) return false;
    const phase = this.buttonState.getControlState(button).phase;
    return phase === 'pressed' || phase === 'held';
  }

  public isButtonPressed(button: CanonicalGamepadButton): boolean {
    if (!isValidCanonicalGamepadButton(button)) return false;
    return this.buttonState.getControlState(button).pressed;
  }

  public isButtonHeld(button: CanonicalGamepadButton): boolean {
    if (!isValidCanonicalGamepadButton(button)) return false;
    return this.buttonState.getControlState(button).held;
  }

  public isButtonReleased(button: CanonicalGamepadButton): boolean {
    if (!isValidCanonicalGamepadButton(button)) return false;
    return this.buttonState.getControlState(button).released;
  }

  public getButtonPhase(button: CanonicalGamepadButton): DigitalControlPhase {
    if (!isValidCanonicalGamepadButton(button)) return 'idle';
    return this.buttonState.getControlState(button).phase;
  }

  public getAxisValue(axis: CanonicalGamepadAxis): number {
    if (!isValidCanonicalGamepadAxis(axis)) return 0;
    return this.axesById.get(axis) ?? 0;
  }

  public reset(): void {
    this.buttonState.reset();
    this.resetAxes();
  }
}
