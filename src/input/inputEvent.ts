import { isImplementedInputDeviceType } from './inputDevice';
import {
  ActiveInputDeviceType,
  createInputError,
  createInputId,
  InputDeviceId,
  InputDiagnosticError,
  InputEventId,
  InputValidationResult,
  isFiniteInputNumber,
  isForbiddenInputString,
  isPlainInputObject,
  isValidInputDeviceId,
  isValidInputEventId,
} from './inputTypes';

/**
 * Hylix V1.0.0 — Phase 08: Immutable InputEvent & Deterministic Ordering (Section 11)
 *
 * Every InputEvent is deeply frozen (`Object.freeze`) upon creation.
 * Identity is derived from canonical seed + monotonic sequence, never `timestampMs`.
 */

export type InputEventType =
  | 'key_down'
  | 'key_up'
  | 'mouse_move'
  | 'mouse_button_down'
  | 'mouse_button_up'
  | 'mouse_wheel'
  | 'touch_began'
  | 'touch_moved'
  | 'touch_stationary'
  | 'touch_ended'
  | 'touch_cancelled'
  | 'gamepad_button'
  | 'gamepad_axis'
  | 'virtual_control';

export interface InputEvent {
  readonly eventId: InputEventId;
  readonly projectId: string;
  readonly deviceId: InputDeviceId;
  readonly deviceType: ActiveInputDeviceType;
  readonly eventType: InputEventType;
  readonly control: string;
  readonly value: number;
  readonly secondaryValue: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly touchId: number | null;
  readonly pressure: number | null;
  readonly simulationTick: number;
  readonly timestampMs: number;
  readonly sequence: number;
}

export interface CreateInputEventInput {
  readonly eventId?: InputEventId;
  readonly projectId: string;
  readonly deviceId: InputDeviceId;
  readonly deviceType: ActiveInputDeviceType;
  readonly eventType: InputEventType;
  readonly control: string;
  readonly value: number;
  readonly secondaryValue?: number;
  readonly deltaX?: number;
  readonly deltaY?: number;
  readonly touchId?: number | null;
  readonly pressure?: number | null;
  readonly simulationTick?: number;
  readonly timestampMs?: number;
  readonly sequence: number;
}

const VALID_INPUT_EVENT_TYPES: ReadonlySet<InputEventType> =
  new Set<InputEventType>([
    'key_down',
    'key_up',
    'mouse_move',
    'mouse_button_down',
    'mouse_button_up',
    'mouse_wheel',
    'touch_began',
    'touch_moved',
    'touch_stationary',
    'touch_ended',
    'touch_cancelled',
    'gamepad_button',
    'gamepad_axis',
    'virtual_control',
  ]);

const ALLOWED_INPUT_EVENT_KEYS: ReadonlySet<string> = new Set<string>([
  'eventId',
  'projectId',
  'deviceId',
  'deviceType',
  'eventType',
  'control',
  'value',
  'secondaryValue',
  'deltaX',
  'deltaY',
  'touchId',
  'pressure',
  'simulationTick',
  'timestampMs',
  'sequence',
]);

export function createDeterministicInputEventId(
  projectId: string,
  deviceId: InputDeviceId,
  sequence: number,
  eventType: InputEventType,
  control: string
): InputEventId {
  return createInputId(
    'event',
    `${projectId.trim()}::${deviceId}::seq_${sequence}::${eventType}::${control.trim()}`
  );
}

/**
 * Validates and constructs a deeply frozen `InputEvent`.
 */
export function createValidatedInputEvent(
  candidate: unknown
): InputValidationResult<InputEvent> {
  if (!isPlainInputObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_EVENT_INVALID',
          'InputEvent payload must be a non-null plain object.'
        ),
      ],
    };
  }

  const errors: InputDiagnosticError[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_INPUT_EVENT_KEYS.has(key)) {
      errors.push(
        createInputError(
          'INPUT_EVENT_INVALID',
          `Unexpected property '${key}' in InputEvent.`
        )
      );
    }
  }

  if (
    typeof candidate.projectId !== 'string' ||
    candidate.projectId.trim().length === 0
  ) {
    errors.push(
      createInputError(
        'INPUT_EVENT_INVALID',
        'InputEvent.projectId must be a non-empty string.'
      )
    );
  } else {
    const sec = isForbiddenInputString(candidate.projectId);
    if (sec.forbidden) {
      errors.push(createInputError('INPUT_EVENT_INVALID', sec.reason!));
    }
  }

  if (!isValidInputDeviceId(candidate.deviceId)) {
    errors.push(
      createInputError(
        'INPUT_DEVICE_NOT_FOUND',
        `Invalid InputEvent.deviceId '${String(candidate.deviceId)}'. Expected device_<16-hex>.`
      )
    );
  }

  if (!isImplementedInputDeviceType(candidate.deviceType)) {
    errors.push(
      createInputError(
        'INPUT_EVENT_INVALID',
        `Invalid InputEvent.deviceType '${String(candidate.deviceType)}'.`
      )
    );
  }

  if (
    typeof candidate.eventType !== 'string' ||
    !VALID_INPUT_EVENT_TYPES.has(candidate.eventType as InputEventType)
  ) {
    errors.push(
      createInputError(
        'INPUT_EVENT_INVALID',
        `Invalid InputEvent.eventType '${String(candidate.eventType)}'.`
      )
    );
  }

  if (
    typeof candidate.control !== 'string' ||
    candidate.control.trim().length === 0 ||
    candidate.control.trim().length > 64
  ) {
    errors.push(
      createInputError(
        'INPUT_EVENT_INVALID',
        'InputEvent.control must be a non-empty canonical identifier string (1..64 chars).'
      )
    );
  } else {
    const sec = isForbiddenInputString(candidate.control);
    if (sec.forbidden) {
      errors.push(createInputError('INPUT_EVENT_INVALID', sec.reason!));
    }
  }

  if (!isFiniteInputNumber(candidate.value)) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        `InputEvent.value '${String(candidate.value)}' must be a finite number.`
      )
    );
  }

  const secondaryValue =
    candidate.secondaryValue !== undefined ? candidate.secondaryValue : 0;
  if (!isFiniteInputNumber(secondaryValue)) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        `InputEvent.secondaryValue '${String(secondaryValue)}' must be a finite number.`
      )
    );
  }

  const deltaX = candidate.deltaX !== undefined ? candidate.deltaX : 0;
  if (!isFiniteInputNumber(deltaX)) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'InputEvent.deltaX must be a finite number.'
      )
    );
  }

  const deltaY = candidate.deltaY !== undefined ? candidate.deltaY : 0;
  if (!isFiniteInputNumber(deltaY)) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'InputEvent.deltaY must be a finite number.'
      )
    );
  }

  const touchId =
    candidate.touchId !== undefined ? candidate.touchId : null;
  if (
    touchId !== null &&
    (typeof touchId !== 'number' || !Number.isInteger(touchId) || touchId < 0)
  ) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        `Invalid InputEvent.touchId '${String(touchId)}'; must be a non-negative integer or null.`
      )
    );
  }

  const pressure =
    candidate.pressure !== undefined ? candidate.pressure : null;
  if (
    pressure !== null &&
    (!isFiniteInputNumber(pressure) || pressure < 0 || pressure > 1)
  ) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        `Invalid InputEvent.pressure '${String(pressure)}'; must be in [0, 1] or null.`
      )
    );
  }

  const simulationTick =
    candidate.simulationTick !== undefined ? candidate.simulationTick : 0;
  if (
    typeof simulationTick !== 'number' ||
    !Number.isInteger(simulationTick) ||
    simulationTick < 0
  ) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'InputEvent.simulationTick must be a non-negative integer.'
      )
    );
  }

  const timestampMs =
    candidate.timestampMs !== undefined ? candidate.timestampMs : 0;
  if (!isFiniteInputNumber(timestampMs) || timestampMs < 0) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'InputEvent.timestampMs must be a finite number >= 0.'
      )
    );
  }

  const sequence = candidate.sequence;
  if (
    typeof sequence !== 'number' ||
    !Number.isInteger(sequence) ||
    sequence < 1
  ) {
    errors.push(
      createInputError(
        'INPUT_EVENT_INVALID',
        'InputEvent.sequence must be a positive integer >= 1.'
      )
    );
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  const resolvedEventId =
    candidate.eventId !== undefined
      ? candidate.eventId
      : createDeterministicInputEventId(
          candidate.projectId as string,
          candidate.deviceId as InputDeviceId,
          sequence as number,
          candidate.eventType as InputEventType,
          candidate.control as string
        );

  if (!isValidInputEventId(resolvedEventId)) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_EVENT_INVALID',
          `Invalid InputEvent.eventId '${String(resolvedEventId)}'. Expected event_<16-hex>.`
        ),
      ],
    };
  }

  const frozenEvent: InputEvent = Object.freeze({
    eventId: resolvedEventId,
    projectId: (candidate.projectId as string).trim(),
    deviceId: candidate.deviceId as InputDeviceId,
    deviceType: candidate.deviceType as ActiveInputDeviceType,
    eventType: candidate.eventType as InputEventType,
    control: (candidate.control as string).trim(),
    value: candidate.value as number,
    secondaryValue: secondaryValue as number,
    deltaX: deltaX as number,
    deltaY: deltaY as number,
    touchId: touchId as number | null,
    pressure: pressure as number | null,
    simulationTick: simulationTick as number,
    timestampMs: timestampMs as number,
    sequence: sequence as number,
  });

  return {
    valid: true,
    value: frozenEvent,
    errors: [],
  };
}

/**
 * Deterministically orders `InputEvent` items by:
 * 1. `sequence ASC`
 * 2. `deviceId ASC`
 * 3. `eventId ASC`
 */
export function sortInputEventsDeterministically(
  events: readonly InputEvent[]
): readonly InputEvent[] {
  return Object.freeze(
    events.slice().sort((a, b) => {
      if (a.sequence !== b.sequence) {
        return a.sequence - b.sequence;
      }
      const devCmp = a.deviceId.localeCompare(b.deviceId);
      if (devCmp !== 0) return devCmp;
      return a.eventId.localeCompare(b.eventId);
    })
  );
}
