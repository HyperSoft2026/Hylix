import {
  isValidCanonicalGamepadAxis,
  isValidCanonicalGamepadButton,
} from './gamepadInput';
import {
  InputActionDescriptor,
  validateInputActionDescriptor,
} from './inputAction';
import { isImplementedInputDeviceType } from './inputDevice';
import {
  ActiveInputDeviceType,
  createInputError,
  createInputId,
  DEFAULT_MAX_BINDINGS_PER_ACTION,
  DEFAULT_MAX_INPUT_ACTIONS,
  InputActionId,
  InputBindingId,
  InputDiagnosticError,
  InputValidationResult,
  isFiniteInputNumber,
  isForbiddenInputString,
  isPlainInputObject,
  isValidInputActionId,
  isValidInputBindingId,
} from './inputTypes';
import { isValidCanonicalKeyCode } from './keyboardInput';
import { isValidCanonicalMouseButton } from './mouseInput';

/**
 * Hylix V1.0.0 — Phase 08: Input Binding & Action Map System (Sections 15 & 31)
 *
 * Allows an Action to bind to multiple platform-independent controls
 * (e.g., `Jump -> Keyboard Space` + `Jump -> Gamepad A`) with bounded memory limits.
 */

export type BindingAxisComponent = 'x' | 'y' | 'z';

export interface InputBindingDescriptor {
  readonly bindingId: InputBindingId;
  readonly projectId: string;
  readonly actionId: InputActionId;
  readonly deviceType: ActiveInputDeviceType;
  readonly control: string;
  readonly scale: number;
  readonly axisComponent: BindingAxisComponent;
  readonly deadZone?: number;
  readonly sensitivity?: number;
  readonly invert: boolean;
  readonly consumeEvent: boolean;
}

const ALLOWED_BINDING_KEYS: ReadonlySet<string> = new Set<string>([
  'bindingId',
  'projectId',
  'actionId',
  'deviceType',
  'control',
  'scale',
  'axisComponent',
  'deadZone',
  'sensitivity',
  'invert',
  'consumeEvent',
]);

const VALID_MOUSE_CONTROLS: ReadonlySet<string> = new Set<string>([
  'MouseLeft',
  'MouseMiddle',
  'MouseRight',
  'MouseButton4',
  'MouseButton5',
  'MouseDeltaX',
  'MouseDeltaY',
  'MouseWheelX',
  'MouseWheelY',
]);

const VALID_TOUCH_CONTROLS: ReadonlySet<string> = new Set<string>([
  'TouchPrimary',
  'Touch0',
  'Touch1',
  'Touch2',
  'Touch3',
  'TouchDeltaX',
  'TouchDeltaY',
  'GestureTap',
  'GestureDoubleTap',
  'GestureLongPress',
  'GestureSwipeLeft',
  'GestureSwipeRight',
  'GestureSwipeUp',
  'GestureSwipeDown',
]);

export function createDeterministicInputBindingId(
  projectId: string,
  actionId: InputActionId,
  deviceType: ActiveInputDeviceType,
  control: string,
  axisComponent: BindingAxisComponent = 'x'
): InputBindingId {
  return createInputId(
    'binding',
    `${projectId.trim()}::${actionId}::${deviceType}::${control.trim()}::${axisComponent}`
  );
}

export function isValidControlForDeviceType(
  deviceType: ActiveInputDeviceType,
  control: string
): boolean {
  switch (deviceType) {
    case 'keyboard':
      return isValidCanonicalKeyCode(control);
    case 'mouse':
      return VALID_MOUSE_CONTROLS.has(control);
    case 'gamepad':
      return (
        isValidCanonicalGamepadButton(control) ||
        isValidCanonicalGamepadAxis(control)
      );
    case 'touch':
      return VALID_TOUCH_CONTROLS.has(control);
    case 'virtual':
      return /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(control);
  }
}

export function validateInputBindingDescriptor(
  candidate: unknown
): InputValidationResult<InputBindingDescriptor> {
  if (!isPlainInputObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_BINDING_INVALID',
          'InputBindingDescriptor must be a non-null plain object.'
        ),
      ],
    };
  }

  const errors: InputDiagnosticError[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_BINDING_KEYS.has(key)) {
      errors.push(
        createInputError(
          'INPUT_BINDING_INVALID',
          `Unexpected property '${key}' in InputBindingDescriptor.`
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
        'INPUT_BINDING_INVALID',
        'InputBindingDescriptor.projectId must be a non-empty string.'
      )
    );
  } else {
    const sec = isForbiddenInputString(candidate.projectId);
    if (sec.forbidden) {
      errors.push(createInputError('INPUT_BINDING_INVALID', sec.reason!));
    }
  }

  if (!isValidInputActionId(candidate.actionId)) {
    errors.push(
      createInputError(
        'INPUT_ACTION_NOT_FOUND',
        `Invalid InputBindingDescriptor.actionId '${String(candidate.actionId)}'. Expected action_<16-hex>.`
      )
    );
  }

  if (!isImplementedInputDeviceType(candidate.deviceType)) {
    errors.push(
      createInputError(
        'INPUT_BINDING_INVALID',
        `Invalid InputBindingDescriptor.deviceType '${String(candidate.deviceType)}'.`
      )
    );
  }

  const control =
    typeof candidate.control === 'string' ? candidate.control.trim() : '';
  if (control.length === 0) {
    errors.push(
      createInputError(
        'INPUT_BINDING_INVALID',
        'InputBindingDescriptor.control must be a non-empty string.'
      )
    );
  } else {
    const sec = isForbiddenInputString(control);
    if (sec.forbidden) {
      errors.push(createInputError('INPUT_BINDING_INVALID', sec.reason!));
    } else if (
      isImplementedInputDeviceType(candidate.deviceType) &&
      !isValidControlForDeviceType(candidate.deviceType, control)
    ) {
      errors.push(
        createInputError(
          'INPUT_BINDING_INVALID',
          `Control '${control}' is not a valid canonical control for deviceType '${candidate.deviceType}'.`
        )
      );
    }
  }

  const axisComponent =
    candidate.axisComponent !== undefined ? candidate.axisComponent : 'x';
  if (axisComponent !== 'x' && axisComponent !== 'y' && axisComponent !== 'z') {
    errors.push(
      createInputError(
        'INPUT_BINDING_INVALID',
        `Invalid axisComponent '${String(axisComponent)}'; expected 'x', 'y', or 'z'.`
      )
    );
  }

  const scale = candidate.scale !== undefined ? candidate.scale : 1.0;
  if (
    !isFiniteInputNumber(scale) ||
    scale === 0 ||
    Math.abs(scale) > 10.0
  ) {
    errors.push(
      createInputError(
        'INPUT_BINDING_INVALID',
        'InputBindingDescriptor.scale must be a non-zero finite number in [-10, 10].'
      )
    );
  }

  if (candidate.deadZone !== undefined) {
    if (
      !isFiniteInputNumber(candidate.deadZone) ||
      candidate.deadZone < 0 ||
      candidate.deadZone >= 1.0
    ) {
      errors.push(
        createInputError(
          'INPUT_BINDING_INVALID',
          'InputBindingDescriptor.deadZone must be a finite number in [0, 1).'
        )
      );
    }
  }

  if (candidate.sensitivity !== undefined) {
    if (
      !isFiniteInputNumber(candidate.sensitivity) ||
      candidate.sensitivity <= 0 ||
      candidate.sensitivity > 10.0
    ) {
      errors.push(
        createInputError(
          'INPUT_BINDING_INVALID',
          'InputBindingDescriptor.sensitivity must be a finite number in (0, 10].'
        )
      );
    }
  }

  const invert = candidate.invert !== undefined ? candidate.invert : false;
  if (typeof invert !== 'boolean') {
    errors.push(
      createInputError(
        'INPUT_BINDING_INVALID',
        'InputBindingDescriptor.invert must be a boolean.'
      )
    );
  }

  const consumeEvent =
    candidate.consumeEvent !== undefined ? candidate.consumeEvent : true;
  if (typeof consumeEvent !== 'boolean') {
    errors.push(
      createInputError(
        'INPUT_BINDING_INVALID',
        'InputBindingDescriptor.consumeEvent must be a boolean.'
      )
    );
  }

  const resolvedBindingId =
    candidate.bindingId !== undefined
      ? candidate.bindingId
      : typeof candidate.projectId === 'string' &&
          isValidInputActionId(candidate.actionId) &&
          isImplementedInputDeviceType(candidate.deviceType) &&
          control.length > 0 &&
          (axisComponent === 'x' ||
            axisComponent === 'y' ||
            axisComponent === 'z')
        ? createDeterministicInputBindingId(
            candidate.projectId,
            candidate.actionId,
            candidate.deviceType,
            control,
            axisComponent
          )
        : '';

  if (!isValidInputBindingId(resolvedBindingId)) {
    errors.push(
      createInputError(
        'INPUT_BINDING_INVALID',
        `Invalid InputBindingDescriptor.bindingId '${String(resolvedBindingId)}'. Expected binding_<16-hex>.`
      )
    );
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      bindingId: resolvedBindingId as InputBindingId,
      projectId: (candidate.projectId as string).trim(),
      actionId: candidate.actionId as InputActionId,
      deviceType: candidate.deviceType as ActiveInputDeviceType,
      control,
      scale: scale as number,
      axisComponent: axisComponent as BindingAxisComponent,
      ...(candidate.deadZone !== undefined
        ? { deadZone: candidate.deadZone as number }
        : {}),
      ...(candidate.sensitivity !== undefined
        ? { sensitivity: candidate.sensitivity as number }
        : {}),
      invert: invert as boolean,
      consumeEvent: consumeEvent as boolean,
    }),
    errors: [],
  };
}

/**
 * Project-isolated Action & Binding Map with bounded capacity.
 */
export class InputActionMap {
  private readonly projectId: string;
  private readonly maxActions: number;
  private readonly maxBindingsPerAction: number;

  private readonly actionsById = new Map<InputActionId, InputActionDescriptor>();
  private readonly actionIdByNameLower = new Map<string, InputActionId>();
  private readonly bindingsByActionId = new Map<
    InputActionId,
    Map<InputBindingId, InputBindingDescriptor>
  >();

  constructor(options: {
    readonly projectId: string;
    readonly maxActions?: number;
    readonly maxBindingsPerAction?: number;
  }) {
    this.projectId = options.projectId.trim();
    this.maxActions = Math.max(
      1,
      Math.min(1024, Math.floor(options.maxActions ?? DEFAULT_MAX_INPUT_ACTIONS))
    );
    this.maxBindingsPerAction = Math.max(
      1,
      Math.min(
        64,
        Math.floor(
          options.maxBindingsPerAction ?? DEFAULT_MAX_BINDINGS_PER_ACTION
        )
      )
    );
  }

  public getProjectId(): string {
    return this.projectId;
  }

  public registerAction(
    candidate: unknown
  ): InputValidationResult<InputActionDescriptor> {
    const val = validateInputActionDescriptor(candidate);
    if (!val.valid || !val.value) {
      return val;
    }

    const action = val.value;
    if (action.projectId !== this.projectId) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_CROSS_PROJECT_ACCESS',
            `Cannot register InputAction from project '${action.projectId}' in InputActionMap for project '${this.projectId}'.`
          ),
        ],
      };
    }

    if (
      !this.actionsById.has(action.actionId) &&
      this.actionsById.size >= this.maxActions
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_BUFFER_FULL',
            `Max InputActions limit (${this.maxActions}) reached.`
          ),
        ],
      };
    }

    this.actionsById.set(action.actionId, action);
    this.actionIdByNameLower.set(action.name.toLowerCase(), action.actionId);
    if (!this.bindingsByActionId.has(action.actionId)) {
      this.bindingsByActionId.set(action.actionId, new Map());
    }

    return {
      valid: true,
      value: action,
      errors: [],
    };
  }

  public getAction(
    actionIdOrName: string
  ): InputActionDescriptor | undefined {
    const byId = this.actionsById.get(actionIdOrName as InputActionId);
    if (byId) return byId;
    const mapped = this.actionIdByNameLower.get(
      actionIdOrName.trim().toLowerCase()
    );
    return mapped ? this.actionsById.get(mapped) : undefined;
  }

  public listActions(): readonly InputActionDescriptor[] {
    return Object.freeze(
      Array.from(this.actionsById.values()).sort((a, b) =>
        a.actionId.localeCompare(b.actionId)
      )
    );
  }

  public addBinding(
    candidate: unknown
  ): InputValidationResult<InputBindingDescriptor> {
    const val = validateInputBindingDescriptor(candidate);
    if (!val.valid || !val.value) {
      return val;
    }

    const binding = val.value;
    if (binding.projectId !== this.projectId) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_CROSS_PROJECT_ACCESS',
            `Cannot register InputBinding from project '${binding.projectId}' in InputActionMap for project '${this.projectId}'.`
          ),
        ],
      };
    }

    if (!this.actionsById.has(binding.actionId)) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_ACTION_NOT_FOUND',
            `Cannot bind to unregistered actionId '${binding.actionId}'.`
          ),
        ],
      };
    }

    const bindingMap = this.bindingsByActionId.get(binding.actionId)!;
    if (
      !bindingMap.has(binding.bindingId) &&
      bindingMap.size >= this.maxBindingsPerAction
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_BUFFER_FULL',
            `Max bindings per action (${this.maxBindingsPerAction}) reached for action '${binding.actionId}'.`
          ),
        ],
      };
    }

    bindingMap.set(binding.bindingId, binding);
    return {
      valid: true,
      value: binding,
      errors: [],
    };
  }

  public removeBinding(bindingId: InputBindingId): boolean {
    for (const map of this.bindingsByActionId.values()) {
      if (map.delete(bindingId)) {
        return true;
      }
    }
    return false;
  }

  public listBindingsForAction(
    actionId: InputActionId
  ): readonly InputBindingDescriptor[] {
    const map = this.bindingsByActionId.get(actionId);
    if (!map) return [];
    return Object.freeze(
      Array.from(map.values()).sort((a, b) =>
        a.bindingId.localeCompare(b.bindingId)
      )
    );
  }

  public listAllBindings(): readonly InputBindingDescriptor[] {
    const all: InputBindingDescriptor[] = [];
    for (const map of this.bindingsByActionId.values()) {
      all.push(...map.values());
    }
    return Object.freeze(
      all.sort((a, b) => a.bindingId.localeCompare(b.bindingId))
    );
  }

  public clear(): void {
    this.actionsById.clear();
    this.actionIdByNameLower.clear();
    this.bindingsByActionId.clear();
  }
}

export { isValidCanonicalMouseButton };
