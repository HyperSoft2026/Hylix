import {
  ActiveInputDeviceType,
  createInputError,
  createInputId,
  IMPLEMENTED_INPUT_DEVICE_TYPES,
  InputDeviceId,
  InputDeviceType,
  InputDiagnosticError,
  InputValidationResult,
  isForbiddenInputString,
  isPlainInputObject,
  isValidInputDeviceId,
  RESERVED_FUTURE_INPUT_DEVICE_TYPES,
  ReservedFutureInputDeviceType,
} from './inputTypes';

/**
 * Hylix V1.0.0 — Phase 08: Platform-Agnostic Input Device Abstraction (Section 5)
 *
 * Active implemented types: `'keyboard' | 'mouse' | 'touch' | 'gamepad' | 'virtual'`.
 * Reserved future types: `'pen' | 'joystick' | 'motion' | 'sensor'`.
 * Never fabricates capabilities for unknown or unimplemented devices.
 */

export interface InputDeviceCapabilities {
  readonly supportsKeys: boolean;
  readonly supportsPointerPosition: boolean;
  readonly supportsPointerDelta: boolean;
  readonly supportsWheel: boolean;
  readonly supportsMultiTouch: boolean;
  readonly maxTouchPoints: number;
  readonly supportsTouchPressure: boolean;
  readonly supportsAnalogAxes: boolean;
  readonly buttonCount: number;
  readonly axisCount: number;
}

export interface InputDeviceDescriptor {
  readonly deviceId: InputDeviceId;
  readonly projectId: string;
  readonly deviceType: InputDeviceType;
  readonly connected: boolean;
  readonly enabled: boolean;
  readonly displayName: string;
  readonly capabilities: InputDeviceCapabilities;
}

const ALLOWED_DEVICE_KEYS: ReadonlySet<string> = new Set<string>([
  'deviceId',
  'projectId',
  'deviceType',
  'connected',
  'enabled',
  'displayName',
  'capabilities',
]);

const ALLOWED_CAPABILITY_KEYS: ReadonlySet<string> = new Set<string>([
  'supportsKeys',
  'supportsPointerPosition',
  'supportsPointerDelta',
  'supportsWheel',
  'supportsMultiTouch',
  'maxTouchPoints',
  'supportsTouchPressure',
  'supportsAnalogAxes',
  'buttonCount',
  'axisCount',
]);

export function isImplementedInputDeviceType(
  deviceType: unknown
): deviceType is ActiveInputDeviceType {
  return (
    typeof deviceType === 'string' &&
    IMPLEMENTED_INPUT_DEVICE_TYPES.has(deviceType as ActiveInputDeviceType)
  );
}

export function isReservedFutureInputDeviceType(
  deviceType: unknown
): deviceType is ReservedFutureInputDeviceType {
  return (
    typeof deviceType === 'string' &&
    RESERVED_FUTURE_INPUT_DEVICE_TYPES.has(
      deviceType as ReservedFutureInputDeviceType
    )
  );
}

export function createDeterministicInputDeviceId(
  projectId: string,
  deviceType: InputDeviceType,
  slotKey = '0'
): InputDeviceId {
  return createInputId(
    'device',
    `${projectId.trim()}::${deviceType}::${slotKey.trim()}`
  );
}

/**
 * Returns accurate, non-fabricated canonical capabilities for implemented device types.
 */
export function createCanonicalDeviceCapabilities(
  deviceType: ActiveInputDeviceType,
  overrides?: Partial<InputDeviceCapabilities>
): InputDeviceCapabilities {
  switch (deviceType) {
    case 'keyboard':
      return Object.freeze({
        supportsKeys: true,
        supportsPointerPosition: false,
        supportsPointerDelta: false,
        supportsWheel: false,
        supportsMultiTouch: false,
        maxTouchPoints: 0,
        supportsTouchPressure: false,
        supportsAnalogAxes: false,
        buttonCount: overrides?.buttonCount ?? 104,
        axisCount: 0,
      });
    case 'mouse':
      return Object.freeze({
        supportsKeys: false,
        supportsPointerPosition: true,
        supportsPointerDelta: true,
        supportsWheel: overrides?.supportsWheel ?? true,
        supportsMultiTouch: false,
        maxTouchPoints: 0,
        supportsTouchPressure: false,
        supportsAnalogAxes: false,
        buttonCount: overrides?.buttonCount ?? 5,
        axisCount: 2,
      });
    case 'touch':
      return Object.freeze({
        supportsKeys: false,
        supportsPointerPosition: true,
        supportsPointerDelta: true,
        supportsWheel: false,
        supportsMultiTouch: overrides?.supportsMultiTouch ?? true,
        maxTouchPoints: overrides?.maxTouchPoints ?? 10,
        supportsTouchPressure: overrides?.supportsTouchPressure ?? false,
        supportsAnalogAxes: false,
        buttonCount: 0,
        axisCount: 0,
      });
    case 'gamepad':
      return Object.freeze({
        supportsKeys: false,
        supportsPointerPosition: false,
        supportsPointerDelta: false,
        supportsWheel: false,
        supportsMultiTouch: false,
        maxTouchPoints: 0,
        supportsTouchPressure: false,
        supportsAnalogAxes: true,
        buttonCount: overrides?.buttonCount ?? 14,
        axisCount: overrides?.axisCount ?? 6,
      });
    case 'virtual':
      return Object.freeze({
        supportsKeys: overrides?.supportsKeys ?? true,
        supportsPointerPosition: overrides?.supportsPointerPosition ?? false,
        supportsPointerDelta: overrides?.supportsPointerDelta ?? false,
        supportsWheel: false,
        supportsMultiTouch: false,
        maxTouchPoints: 0,
        supportsTouchPressure: false,
        supportsAnalogAxes: overrides?.supportsAnalogAxes ?? true,
        buttonCount: overrides?.buttonCount ?? 8,
        axisCount: overrides?.axisCount ?? 4,
      });
  }
}

export function validateInputDeviceCapabilities(
  candidate: unknown,
  deviceType: InputDeviceType
): InputValidationResult<InputDeviceCapabilities> {
  if (!isPlainInputObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_INVALID_VALUE',
          'InputDeviceDescriptor.capabilities must be a non-null plain object.'
        ),
      ],
    };
  }

  const errors: InputDiagnosticError[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_CAPABILITY_KEYS.has(key)) {
      errors.push(
        createInputError(
          'INPUT_INVALID_VALUE',
          `Unexpected capability property '${key}'.`
        )
      );
    }
  }

  const boolKeys = [
    'supportsKeys',
    'supportsPointerPosition',
    'supportsPointerDelta',
    'supportsWheel',
    'supportsMultiTouch',
    'supportsTouchPressure',
    'supportsAnalogAxes',
  ] as const;

  for (const k of boolKeys) {
    if (typeof candidate[k] !== 'boolean') {
      errors.push(
        createInputError(
          'INPUT_INVALID_VALUE',
          `Capability '${k}' must be a boolean.`
        )
      );
    }
  }

  const maxTouchPoints = candidate.maxTouchPoints;
  if (
    typeof maxTouchPoints !== 'number' ||
    !Number.isInteger(maxTouchPoints) ||
    maxTouchPoints < 0 ||
    maxTouchPoints > 32
  ) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'Capability maxTouchPoints must be an integer in [0, 32].'
      )
    );
  }

  const buttonCount = candidate.buttonCount;
  if (
    typeof buttonCount !== 'number' ||
    !Number.isInteger(buttonCount) ||
    buttonCount < 0 ||
    buttonCount > 256
  ) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'Capability buttonCount must be an integer in [0, 256].'
      )
    );
  }

  const axisCount = candidate.axisCount;
  if (
    typeof axisCount !== 'number' ||
    !Number.isInteger(axisCount) ||
    axisCount < 0 ||
    axisCount > 64
  ) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'Capability axisCount must be an integer in [0, 64].'
      )
    );
  }

  // Prevent fabricating contradictory capabilities for a deviceType
  if (deviceType !== 'touch') {
    if (candidate.supportsMultiTouch === true || (typeof maxTouchPoints === 'number' && maxTouchPoints > 0)) {
      errors.push(
        createInputError(
          'INPUT_INVALID_VALUE',
          `Device type '${deviceType}' cannot fabricate touch capabilities (supportsMultiTouch / maxTouchPoints > 0).`
        )
      );
    }
    if (candidate.supportsTouchPressure === true) {
      errors.push(
        createInputError(
          'INPUT_INVALID_VALUE',
          `Device type '${deviceType}' cannot claim supportsTouchPressure.`
        )
      );
    }
  } else {
    if (typeof maxTouchPoints === 'number' && maxTouchPoints < 1) {
      errors.push(
        createInputError(
          'INPUT_INVALID_VALUE',
          'Touch device must support at least 1 touch point (maxTouchPoints >= 1).'
        )
      );
    }
  }

  if (deviceType === 'keyboard' && candidate.supportsKeys !== true) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'Keyboard device must have supportsKeys = true.'
      )
    );
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      supportsKeys: candidate.supportsKeys as boolean,
      supportsPointerPosition: candidate.supportsPointerPosition as boolean,
      supportsPointerDelta: candidate.supportsPointerDelta as boolean,
      supportsWheel: candidate.supportsWheel as boolean,
      supportsMultiTouch: candidate.supportsMultiTouch as boolean,
      maxTouchPoints: maxTouchPoints as number,
      supportsTouchPressure: candidate.supportsTouchPressure as boolean,
      supportsAnalogAxes: candidate.supportsAnalogAxes as boolean,
      buttonCount: buttonCount as number,
      axisCount: axisCount as number,
    }),
    errors: [],
  };
}

export function validateInputDeviceDescriptor(
  candidate: unknown
): InputValidationResult<InputDeviceDescriptor> {
  if (!isPlainInputObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_INVALID_VALUE',
          'InputDeviceDescriptor must be a non-null plain object.'
        ),
      ],
    };
  }

  const errors: InputDiagnosticError[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_DEVICE_KEYS.has(key)) {
      errors.push(
        createInputError(
          'INPUT_INVALID_VALUE',
          `Unexpected property '${key}' in InputDeviceDescriptor.`
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
        'InputDeviceDescriptor.projectId must be a non-empty string.'
      )
    );
  } else {
    const sec = isForbiddenInputString(candidate.projectId);
    if (sec.forbidden) {
      errors.push(createInputError('INPUT_INVALID_VALUE', sec.reason!));
    }
  }

  const rawType = candidate.deviceType;
  if (isReservedFutureInputDeviceType(rawType)) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        `Device type '${rawType}' is a reserved future abstraction contract and cannot be registered as an active runtime device in Phase 08.`
      )
    );
  } else if (!isImplementedInputDeviceType(rawType)) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        `Unknown or unsupported deviceType '${String(rawType)}'. Supported active types: keyboard, mouse, touch, gamepad, virtual.`
      )
    );
  }

  const resolvedDeviceId =
    candidate.deviceId !== undefined
      ? candidate.deviceId
      : typeof candidate.projectId === 'string' &&
          isImplementedInputDeviceType(rawType)
        ? createDeterministicInputDeviceId(
            candidate.projectId,
            rawType,
            typeof candidate.displayName === 'string'
              ? candidate.displayName
              : '0'
          )
        : '';

  if (!isValidInputDeviceId(resolvedDeviceId)) {
    errors.push(
      createInputError(
        'INPUT_DEVICE_NOT_FOUND',
        `Invalid deviceId '${String(resolvedDeviceId)}'. Expected device_<16-hex>.`
      )
    );
  }

  const connected =
    candidate.connected !== undefined ? candidate.connected : true;
  if (typeof connected !== 'boolean') {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'InputDeviceDescriptor.connected must be a boolean.'
      )
    );
  }

  const enabled = candidate.enabled !== undefined ? candidate.enabled : true;
  if (typeof enabled !== 'boolean') {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'InputDeviceDescriptor.enabled must be a boolean.'
      )
    );
  }

  const displayName =
    candidate.displayName !== undefined
      ? candidate.displayName
      : typeof rawType === 'string'
        ? `Hylix ${rawType} Device`
        : '';
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    errors.push(
      createInputError(
        'INPUT_INVALID_VALUE',
        'InputDeviceDescriptor.displayName must be a non-empty string.'
      )
    );
  } else {
    const sec = isForbiddenInputString(displayName);
    if (sec.forbidden) {
      errors.push(createInputError('INPUT_INVALID_VALUE', sec.reason!));
    }
  }

  let validatedCaps: InputDeviceCapabilities | null = null;
  if (isImplementedInputDeviceType(rawType)) {
    const rawCaps =
      candidate.capabilities !== undefined
        ? candidate.capabilities
        : createCanonicalDeviceCapabilities(rawType);
    const capsCheck = validateInputDeviceCapabilities(rawCaps, rawType);
    if (!capsCheck.valid || !capsCheck.value) {
      errors.push(...capsCheck.errors);
    } else {
      validatedCaps = capsCheck.value;
    }
  }

  if (errors.length > 0 || !validatedCaps || !isImplementedInputDeviceType(rawType)) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      deviceId: resolvedDeviceId as InputDeviceId,
      projectId: (candidate.projectId as string).trim(),
      deviceType: rawType,
      connected: connected as boolean,
      enabled: enabled as boolean,
      displayName: (displayName as string).trim(),
      capabilities: validatedCaps,
    }),
    errors: [],
  };
}
