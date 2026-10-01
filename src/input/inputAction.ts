import {
  createDefaultVector2,
  createDefaultVector3,
  createInputError,
  createInputId,
  DigitalControlPhase,
  InputActionId,
  InputActionValueType,
  InputDiagnosticError,
  InputValidationResult,
  isFiniteInputNumber,
  isForbiddenInputString,
  isPlainInputObject,
  isValidInputActionId,
  Vector2,
  Vector3,
} from './inputTypes';

/**
 * Hylix V1.0.0 — Phase 08: Input Action Abstraction (Section 14)
 *
 * Decouples Gameplay/ECS from physical hardware controls (`KeyA`, `Touch0`, `ButtonA`)
 * via semantic actions (`Move`, `Jump`, `Attack`, `Pause`, `Interact`).
 */

export interface InputActionDescriptor {
  readonly actionId: InputActionId;
  readonly projectId: string;
  readonly name: string;
  readonly valueType: InputActionValueType;
  readonly deadZone: number;
  readonly sensitivity: number;
  readonly enabled: boolean;
}

export interface InputActionEvaluatedState {
  readonly actionId: InputActionId;
  readonly name: string;
  readonly valueType: InputActionValueType;
  readonly triggered: boolean;
  readonly phase: DigitalControlPhase;
  readonly buttonValue: boolean;
  readonly axis1D: number;
  readonly axis2D: Vector2;
  readonly axis3D: Vector3;
}

const VALID_ACTION_VALUE_TYPES: ReadonlySet<InputActionValueType> =
  new Set<InputActionValueType>(['button', 'axis1D', 'axis2D', 'axis3D']);

const ALLOWED_ACTION_KEYS: ReadonlySet<string> = new Set<string>([
  'actionId',
  'projectId',
  'name',
  'valueType',
  'deadZone',
  'sensitivity',
  'enabled',
]);

export function createDeterministicInputActionId(
  projectId: string,
  actionName: string
): InputActionId {
  return createInputId('action', `${projectId.trim()}::${actionName.trim()}`);
}

export function createIdleActionEvaluatedState(
  descriptor: InputActionDescriptor
): InputActionEvaluatedState {
  return Object.freeze({
    actionId: descriptor.actionId,
    name: descriptor.name,
    valueType: descriptor.valueType,
    triggered: false,
    phase: 'idle',
    buttonValue: false,
    axis1D: 0,
    axis2D: createDefaultVector2(),
    axis3D: createDefaultVector3(),
  });
}

export function validateInputActionDescriptor(
  candidate: unknown
): InputValidationResult<InputActionDescriptor> {
  if (!isPlainInputObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_INVALID_VALUE',
          'InputActionDescriptor must be a non-null plain object.'
        ),
      ],
    };
  }

  const errors: InputDiagnosticError[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_ACTION_KEYS.has(key)) {
      errors.push(
        createInputError(
          'INPUT_INVALID_VALUE',
          `Unexpected property '${key}' in InputActionDescriptor.`
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
        'INPUT_INVALID_VALUE',
        'InputActionDescriptor.projectId must be a non-empty string.'
      )
    );
  } else {
    const sec = isForbiddenInputString(candidate.projectId);
    if (sec.forbidden) {
      errors.push(createInputError('INPUT_INVALID_VALUE', sec.reason!));
    }
  }

  if (
    typeof candidate.name !== 'string' ||
    candidate.name.trim().length === 0 ||
    candidate.name.trim().length > 64
  ) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'InputActionDescriptor.name must be a non-empty string (1..64 chars).'
      )
    );
  } else {
    const sec = isForbiddenInputString(candidate.name);
    if (sec.forbidden) {
      errors.push(createInputError('INPUT_INVALID_VALUE', sec.reason!));
    }
  }

  const resolvedActionId =
    candidate.actionId !== undefined
      ? candidate.actionId
      : typeof candidate.projectId === 'string' &&
          typeof candidate.name === 'string'
        ? createDeterministicInputActionId(candidate.projectId, candidate.name)
        : '';

  if (!isValidInputActionId(resolvedActionId)) {
    errors.push(
      createInputError(
        'INPUT_ACTION_NOT_FOUND',
        `Invalid InputActionDescriptor.actionId '${String(resolvedActionId)}'. Expected action_<16-hex>.`
      )
    );
  }

  const valueType =
    candidate.valueType !== undefined ? candidate.valueType : 'button';
  if (
    typeof valueType !== 'string' ||
    !VALID_ACTION_VALUE_TYPES.has(valueType as InputActionValueType)
  ) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        `Invalid InputActionDescriptor.valueType '${String(valueType)}'. Expected button, axis1D, axis2D, or axis3D.`
      )
    );
  }

  const deadZone = candidate.deadZone !== undefined ? candidate.deadZone : 0.1;
  if (!isFiniteInputNumber(deadZone) || deadZone < 0 || deadZone >= 1.0) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'InputActionDescriptor.deadZone must be a finite number in [0, 1).'
      )
    );
  }

  const sensitivity =
    candidate.sensitivity !== undefined ? candidate.sensitivity : 1.0;
  if (
    !isFiniteInputNumber(sensitivity) ||
    sensitivity <= 0 ||
    sensitivity > 10.0
  ) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'InputActionDescriptor.sensitivity must be a finite number in (0, 10].'
      )
    );
  }

  const enabled = candidate.enabled !== undefined ? candidate.enabled : true;
  if (typeof enabled !== 'boolean') {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'InputActionDescriptor.enabled must be a boolean.'
      )
    );
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      actionId: resolvedActionId as InputActionId,
      projectId: (candidate.projectId as string).trim(),
      name: (candidate.name as string).trim(),
      valueType: valueType as InputActionValueType,
      deadZone: deadZone as number,
      sensitivity: sensitivity as number,
      enabled: enabled as boolean,
    }),
    errors: [],
  };
}
