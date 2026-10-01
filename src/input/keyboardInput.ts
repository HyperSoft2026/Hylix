import { InputEvent } from './inputEvent';
import { ControlStateSnapshot, InputState } from './inputState';
import {
  createInputError,
  DigitalControlPhase,
  InputValidationResult,
} from './inputTypes';

/**
 * Hylix V1.0.0 — Phase 08: Canonical Keyboard Input & Key Definitions (Sections 6 & 7)
 *
 * Uses platform-independent canonical key identifiers (`KeyA`, `Digit0`, `ArrowUp`, `Space`, etc.)
 * and enforces deterministic `idle -> pressed -> held -> released -> idle` transitions without
 * emitting duplicate `pressed` states on held keys.
 */

export type CanonicalKeyCode =
  | 'KeyA'
  | 'KeyB'
  | 'KeyC'
  | 'KeyD'
  | 'KeyE'
  | 'KeyF'
  | 'KeyG'
  | 'KeyH'
  | 'KeyI'
  | 'KeyJ'
  | 'KeyK'
  | 'KeyL'
  | 'KeyM'
  | 'KeyN'
  | 'KeyO'
  | 'KeyP'
  | 'KeyQ'
  | 'KeyR'
  | 'KeyS'
  | 'KeyT'
  | 'KeyU'
  | 'KeyV'
  | 'KeyW'
  | 'KeyX'
  | 'KeyY'
  | 'KeyZ'
  | 'Digit0'
  | 'Digit1'
  | 'Digit2'
  | 'Digit3'
  | 'Digit4'
  | 'Digit5'
  | 'Digit6'
  | 'Digit7'
  | 'Digit8'
  | 'Digit9'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Enter'
  | 'Escape'
  | 'Space'
  | 'Tab'
  | 'Backspace'
  | 'Delete'
  | 'Insert'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'
  | 'Shift'
  | 'ShiftLeft'
  | 'ShiftRight'
  | 'Control'
  | 'ControlLeft'
  | 'ControlRight'
  | 'Alt'
  | 'AltLeft'
  | 'AltRight'
  | 'F1'
  | 'F2'
  | 'F3'
  | 'F4'
  | 'F5'
  | 'F6'
  | 'F7'
  | 'F8'
  | 'F9'
  | 'F10'
  | 'F11'
  | 'F12';

export const CANONICAL_KEY_CODES: ReadonlySet<CanonicalKeyCode> =
  new Set<CanonicalKeyCode>([
    'KeyA',
    'KeyB',
    'KeyC',
    'KeyD',
    'KeyE',
    'KeyF',
    'KeyG',
    'KeyH',
    'KeyI',
    'KeyJ',
    'KeyK',
    'KeyL',
    'KeyM',
    'KeyN',
    'KeyO',
    'KeyP',
    'KeyQ',
    'KeyR',
    'KeyS',
    'KeyT',
    'KeyU',
    'KeyV',
    'KeyW',
    'KeyX',
    'KeyY',
    'KeyZ',
    'Digit0',
    'Digit1',
    'Digit2',
    'Digit3',
    'Digit4',
    'Digit5',
    'Digit6',
    'Digit7',
    'Digit8',
    'Digit9',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Enter',
    'Escape',
    'Space',
    'Tab',
    'Backspace',
    'Delete',
    'Insert',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'Shift',
    'ShiftLeft',
    'ShiftRight',
    'Control',
    'ControlLeft',
    'ControlRight',
    'Alt',
    'AltLeft',
    'AltRight',
    'F1',
    'F2',
    'F3',
    'F4',
    'F5',
    'F6',
    'F7',
    'F8',
    'F9',
    'F10',
    'F11',
    'F12',
  ]);

export function isValidCanonicalKeyCode(
  candidate: unknown
): candidate is CanonicalKeyCode {
  return (
    typeof candidate === 'string' &&
    CANONICAL_KEY_CODES.has(candidate as CanonicalKeyCode)
  );
}

export function validateCanonicalKeyCode(
  candidate: unknown
): InputValidationResult<CanonicalKeyCode> {
  if (!isValidCanonicalKeyCode(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_INVALID_VALUE',
          `Invalid key identifier '${String(candidate)}'. Must be a canonical Hylix key code (e.g., KeyA, Digit0, ArrowUp, Space, Escape).`
        ),
      ],
    };
  }
  return {
    valid: true,
    value: candidate,
    errors: [],
  };
}

export class KeyboardInput {
  private readonly state = new InputState();

  /**
   * Advances all tracked keys to the next deterministic tick:
   * - `pressed` -> `held`
   * - `released` -> `idle`
   */
  public beginTick(): void {
    this.state.beginTick();
  }

  /**
   * Applies a validated keyboard event (`key_down` or `key_up`).
   * Ignores redundant `key_down` events if the key is already down (`pressed` or `held`)
   * so OS key-repeat never re-triggers `pressed` while held.
   */
  public applyEvent(
    event: InputEvent
  ): InputValidationResult<ControlStateSnapshot> {
    const keyVal = validateCanonicalKeyCode(event.control);
    if (!keyVal.valid || !keyVal.value) {
      return {
        valid: false,
        value: null,
        errors: keyVal.errors,
      };
    }

    const key = keyVal.value;
    const currentSnap = this.state.getControlState(key);

    if (event.eventType === 'key_down') {
      if (currentSnap.phase === 'pressed' || currentSnap.phase === 'held') {
        return {
          valid: true,
          value: currentSnap,
          errors: [],
        };
      }
      return this.state.setControlValue(key, 1);
    }

    if (event.eventType === 'key_up') {
      return this.state.setControlValue(key, 0);
    }

    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_EVENT_INVALID',
          `KeyboardInput cannot process non-keyboard eventType '${event.eventType}'.`
        ),
      ],
    };
  }

  public isKeyDown(key: string): boolean {
    if (!isValidCanonicalKeyCode(key)) return false;
    const snap = this.state.getControlState(key);
    return snap.phase === 'pressed' || snap.phase === 'held';
  }

  public isKeyPressed(key: string): boolean {
    if (!isValidCanonicalKeyCode(key)) return false;
    return this.state.getControlState(key).pressed;
  }

  public isKeyHeld(key: string): boolean {
    if (!isValidCanonicalKeyCode(key)) return false;
    return this.state.getControlState(key).held;
  }

  public isKeyReleased(key: string): boolean {
    if (!isValidCanonicalKeyCode(key)) return false;
    return this.state.getControlState(key).released;
  }

  public getKeyPhase(key: string): DigitalControlPhase {
    if (!isValidCanonicalKeyCode(key)) return 'idle';
    return this.state.getControlState(key).phase;
  }

  public getKeyState(key: string): ControlStateSnapshot | null {
    if (!isValidCanonicalKeyCode(key)) return null;
    return this.state.getControlState(key);
  }

  public reset(): void {
    this.state.reset();
  }
}
