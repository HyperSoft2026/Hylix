import {
  computeDigitalControlPhase,
  createInputError,
  DigitalControlPhase,
  InputValidationResult,
  isFiniteInputNumber,
  isForbiddenInputString,
} from './inputTypes';

/**
 * Hylix V1.0.0 — Phase 08: Deterministic Control InputState (Section 13)
 *
 * Tracks `currentValue`, `previousValue`, `pressed`, `released`, `held`, and `phase`
 * for every control independently of rendering FPS.
 */

export const DIGITAL_PRESS_THRESHOLD = 0.5;

export interface ControlStateSnapshot {
  readonly control: string;
  readonly currentValue: number;
  readonly previousValue: number;
  readonly pressed: boolean;
  readonly released: boolean;
  readonly held: boolean;
  readonly phase: DigitalControlPhase;
}

export function computeControlStateSnapshot(
  control: string,
  previousValue: number,
  currentValue: number,
  threshold = DIGITAL_PRESS_THRESHOLD
): ControlStateSnapshot {
  const prevDown = Math.abs(previousValue) >= threshold;
  const currDown = Math.abs(currentValue) >= threshold;
  const phase = computeDigitalControlPhase(prevDown, currDown);

  return Object.freeze({
    control,
    currentValue,
    previousValue,
    pressed: currDown && !prevDown,
    released: !currDown && prevDown,
    held: currDown && prevDown,
    phase,
  });
}

export class InputState {
  private readonly statesByControl = new Map<string, ControlStateSnapshot>();
  private readonly pendingValuesByControl = new Map<string, number>();

  /**
   * Advances to the next deterministic tick before applying new events:
   * - `previousValue` becomes `currentValue` from the prior tick.
   * - Controls that were `'pressed'` and remain down transition deterministically to `'held'`.
   * - Controls that were `'released'` and remain up transition deterministically to `'idle'`.
   */
  public beginTick(): void {
    for (const [control, prevSnap] of Array.from(
      this.statesByControl.entries()
    )) {
      const nextSnap = computeControlStateSnapshot(
        control,
        prevSnap.currentValue,
        prevSnap.currentValue
      );
      if (
        nextSnap.phase === 'idle' &&
        nextSnap.currentValue === 0 &&
        nextSnap.previousValue === 0
      ) {
        this.statesByControl.delete(control);
        this.pendingValuesByControl.delete(control);
      } else {
        this.statesByControl.set(control, nextSnap);
        this.pendingValuesByControl.set(control, prevSnap.currentValue);
      }
    }
  }

  /**
   * Updates a control's value within the current tick.
   */
  public setControlValue(
    control: string,
    newValue: number
  ): InputValidationResult<ControlStateSnapshot> {
    if (typeof control !== 'string' || control.trim().length === 0) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_INVALID_VALUE',
            'Control identifier must be a non-empty string.'
          ),
        ],
      };
    }

    const sec = isForbiddenInputString(control);
    if (sec.forbidden) {
      return {
        valid: false,
        value: null,
        errors: [createInputError('INPUT_INVALID_VALUE', sec.reason!)],
      };
    }

    if (!isFiniteInputNumber(newValue)) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_INVALID_VALUE',
            `Control '${control}' value '${String(newValue)}' must be a finite number.`
          ),
        ],
      };
    }

    const key = control.trim();
    const existing = this.statesByControl.get(key);
    const previousValue = existing ? existing.previousValue : 0;

    const snapshot = computeControlStateSnapshot(key, previousValue, newValue);
    this.statesByControl.set(key, snapshot);
    this.pendingValuesByControl.set(key, newValue);

    return {
      valid: true,
      value: snapshot,
      errors: [],
    };
  }

  public getControlState(control: string): ControlStateSnapshot {
    const key = control.trim();
    return (
      this.statesByControl.get(key) ??
      Object.freeze({
        control: key,
        currentValue: 0,
        previousValue: 0,
        pressed: false,
        released: false,
        held: false,
        phase: 'idle',
      })
    );
  }

  public listActiveControlStates(): readonly ControlStateSnapshot[] {
    return Object.freeze(
      Array.from(this.statesByControl.values()).sort((a, b) =>
        a.control.localeCompare(b.control)
      )
    );
  }

  public reset(): void {
    this.statesByControl.clear();
    this.pendingValuesByControl.clear();
  }
}
