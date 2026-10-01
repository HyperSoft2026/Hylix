import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  NullContractInputBackend,
  PlatformInputBackendContract,
} from '../platform/platformAbstraction';
import {
  CanonicalGamepadAxis,
  CanonicalGamepadButton,
  GamepadInput,
} from './gamepadInput';
import { GestureConfig, GestureEvent, GestureRecognizer } from './gestureInput';
import {
  createIdleActionEvaluatedState,
  InputActionDescriptor,
  InputActionEvaluatedState,
} from './inputAction';
import {
  BufferedInputEventInput,
  InputBuffer,
  InputBufferPushResult,
} from './inputBuffer';
import {
  InputContextDescriptor,
  sortInputContextsByPriority,
  validateInputContextDescriptor,
} from './inputContext';
import {
  createDeterministicInputDeviceId,
  InputDeviceDescriptor,
  validateInputDeviceDescriptor,
} from './inputDevice';
import { InputEvent, sortInputEventsDeterministically } from './inputEvent';
import { InputActionMap, InputBindingDescriptor } from './inputMap';
import {
  computeControlStateSnapshot,
  ControlStateSnapshot,
  DIGITAL_PRESS_THRESHOLD,
  InputState,
} from './inputState';
import {
  ActiveInputDeviceType,
  clampInputNumber,
  computeDigitalControlPhase,
  createDefaultVector2,
  createDefaultVector3,
  createInputError,
  createInputId,
  DEFAULT_MAX_ACTIVE_TOUCHES,
  DEFAULT_MAX_BINDINGS_PER_ACTION,
  DEFAULT_MAX_INPUT_ACTIONS,
  DEFAULT_MAX_INPUT_CONTEXTS,
  DEFAULT_MAX_INPUT_DEVICES,
  DEFAULT_MAX_INPUT_EVENTS,
  DigitalControlPhase,
  InputActionId,
  InputBindingId,
  InputBufferOverflowPolicy,
  InputContextId,
  InputDeviceId,
  InputDiagnosticError,
  InputEventId,
  InputLifecycleState,
  InputManagerId,
  InputValidationResult,
  isValidInputLifecycleTransition,
  processAxisValue,
  Vector2,
  Vector3,
} from './inputTypes';
import { CanonicalKeyCode, KeyboardInput } from './keyboardInput';
import {
  CanonicalMouseButton,
  MouseInput,
  MouseStateSnapshot,
} from './mouseInput';
import { TouchInput, TouchPointState } from './touchInput';

/**
 * Hylix V1.0.0 — Phase 08: Project-Isolated Deterministic InputManager
 *
 * Pipeline:
 * Platform Input -> Raw Input Events -> InputBuffer -> InputState -> Action Mapping -> Gameplay/ECS
 *
 * Enforces:
 * - Strict lifecycle (`uninitialized -> initializing -> ready -> processing -> ready -> shutdown`)
 * - Project isolation (`projectId` boundary checks on all devices, events, actions, bindings, contexts)
 * - Frame-rate independent deterministic simulation tick updates
 * - Priority-ordered `InputContext` evaluation & event consumption
 * - Replay recording and deterministic playback
 */

export function createDeterministicInputManagerId(
  projectId: string
): InputManagerId {
  return createInputId('input', `manager::${projectId.trim()}`);
}

export interface InputManagerOptions {
  readonly projectId: string;
  readonly maxBufferedEvents?: number;
  readonly bufferOverflowPolicy?: InputBufferOverflowPolicy;
  readonly maxDevices?: number;
  readonly maxContexts?: number;
  readonly maxActions?: number;
  readonly maxBindingsPerAction?: number;
  readonly maxTouchPoints?: number;
  readonly gestureConfig?: GestureConfig;
  readonly backend?: PlatformInputBackendContract;
  readonly logger?: RedactedDiagnosticLogger;
  readonly registerDefaultDevices?: boolean;
}

export interface InputUpdateTickReport {
  readonly success: boolean;
  readonly simulationTick: number;
  readonly processedEventsCount: number;
  readonly recognizedGesturesCount: number;
  readonly evaluatedActionsCount: number;
  readonly errors: readonly InputDiagnosticError[];
}

export class InputManager {
  private readonly projectId: string;
  private readonly inputManagerId: InputManagerId;
  private readonly maxDevices: number;
  private readonly maxContexts: number;
  private readonly registerDefaultDevicesOnInit: boolean;
  private readonly backend: PlatformInputBackendContract;
  private readonly logger?: RedactedDiagnosticLogger;

  private state: InputLifecycleState = 'uninitialized';
  private currentSimulationTick = 0;

  private readonly buffer: InputBuffer;
  private readonly actionMap: InputActionMap;
  private readonly keyboardInput = new KeyboardInput();
  private readonly mouseInput = new MouseInput();
  private readonly touchInput: TouchInput;
  private readonly gamepadInput = new GamepadInput();
  private readonly gestureRecognizer: GestureRecognizer;
  private readonly virtualControlState = new InputState();
  private readonly derivedControlState = new InputState();

  private readonly devicesById = new Map<InputDeviceId, InputDeviceDescriptor>();
  private readonly contextsById = new Map<
    InputContextId,
    InputContextDescriptor
  >();
  private readonly contextIdByNameLower = new Map<string, InputContextId>();

  private readonly evaluatedActionsById = new Map<
    InputActionId,
    InputActionEvaluatedState
  >();
  private readonly evaluatedActionsByContextAndId = new Map<
    string,
    InputActionEvaluatedState
  >();
  private readonly previousActionActiveById = new Map<string, boolean>();
  private readonly recordedEventsHistory: InputEvent[] = [];
  private readonly maxRecordedHistoryEvents = 2048;

  constructor(options: InputManagerOptions) {
    this.projectId = options.projectId.trim();
    this.inputManagerId = createDeterministicInputManagerId(this.projectId);
    this.maxDevices = Math.max(
      1,
      Math.min(128, Math.floor(options.maxDevices ?? DEFAULT_MAX_INPUT_DEVICES))
    );
    this.maxContexts = Math.max(
      1,
      Math.min(
        128,
        Math.floor(options.maxContexts ?? DEFAULT_MAX_INPUT_CONTEXTS)
      )
    );
    this.registerDefaultDevicesOnInit =
      options.registerDefaultDevices ?? true;
    this.backend = options.backend ?? new NullContractInputBackend();
    this.logger = options.logger;

    const touchCaps = this.backend.getTouchCapabilities();
    this.touchInput = new TouchInput({
      maxTouchPoints: options.maxTouchPoints ?? touchCaps.maxTouchPoints ?? DEFAULT_MAX_ACTIVE_TOUCHES,
      supportsPressure: touchCaps.supportsTouchPressure,
    });
    this.gestureRecognizer = new GestureRecognizer(options.gestureConfig);

    this.buffer = new InputBuffer({
      projectId: this.projectId,
      maxEvents: options.maxBufferedEvents ?? DEFAULT_MAX_INPUT_EVENTS,
      overflowPolicy: options.bufferOverflowPolicy ?? 'rejectNewest',
      logger: this.logger,
    });

    this.actionMap = new InputActionMap({
      projectId: this.projectId,
      maxActions: options.maxActions ?? DEFAULT_MAX_INPUT_ACTIONS,
      maxBindingsPerAction:
        options.maxBindingsPerAction ?? DEFAULT_MAX_BINDINGS_PER_ACTION,
    });
  }

  public getInputManagerId(): InputManagerId {
    return this.inputManagerId;
  }

  public getProjectId(): string {
    return this.projectId;
  }

  public getState(): InputLifecycleState {
    return this.state;
  }

  public getCurrentSimulationTick(): number {
    return this.currentSimulationTick;
  }

  public getBackend(): PlatformInputBackendContract {
    return this.backend;
  }

  public getBuffer(): InputBuffer {
    return this.buffer;
  }

  public getActionMap(): InputActionMap {
    return this.actionMap;
  }

  /**
   * Initializes the `InputManager` (`uninitialized -> initializing -> ready`).
   * Rejects re-initialization after `shutdown`.
   */
  public initialize(): {
    readonly success: boolean;
    readonly errors: readonly InputDiagnosticError[];
  } {
    if (!isValidInputLifecycleTransition(this.state, 'initializing')) {
      const err = createInputError(
        'INPUT_ILLEGAL_STATE_TRANSITION',
        `Illegal InputManager lifecycle transition '${this.state}' -> 'initializing'.`
      );
      this.logger?.record(
        'input',
        'ERROR',
        `input_validation_failed: ${err.message}`
      );
      return { success: false, errors: [err] };
    }

    this.state = 'initializing';

    const backendInit = this.backend.initialize();
    if (!backendInit.success) {
      this.state = 'shutdown';
      const err = createInputError(
        'INPUT_ILLEGAL_STATE_TRANSITION',
        backendInit.error ?? 'Failed to initialize PlatformInputBackendContract.'
      );
      return { success: false, errors: [err] };
    }

    const touchCaps = this.backend.getTouchCapabilities();
    this.touchInput.setSupportsPressure(touchCaps.supportsTouchPressure);

    if (this.registerDefaultDevicesOnInit && this.devicesById.size === 0) {
      const defaultTypes: readonly ActiveInputDeviceType[] = [
        'keyboard',
        'mouse',
        'touch',
        'gamepad',
        'virtual',
      ];
      for (const dt of defaultTypes) {
        const devId = createDeterministicInputDeviceId(this.projectId, dt, '0');
        const descCheck = validateInputDeviceDescriptor({
          deviceId: devId,
          projectId: this.projectId,
          deviceType: dt,
          connected: true,
          enabled: true,
          displayName: `Default ${dt} Device`,
          ...(dt === 'touch'
            ? {
                capabilities: {
                  supportsKeys: false,
                  supportsPointerPosition: true,
                  supportsPointerDelta: true,
                  supportsWheel: false,
                  supportsMultiTouch: touchCaps.supportsMultiTouch,
                  maxTouchPoints: touchCaps.maxTouchPoints,
                  supportsTouchPressure: touchCaps.supportsTouchPressure,
                  supportsAnalogAxes: false,
                  buttonCount: 0,
                  axisCount: 0,
                },
              }
            : {}),
        });
        if (descCheck.valid && descCheck.value) {
          this.devicesById.set(descCheck.value.deviceId, descCheck.value);
        }
      }
    }

    this.state = 'ready';
    this.logger?.record(
      'input',
      'INFO',
      `input_manager_initialized: inputManagerId=${this.inputManagerId} projectId=${this.projectId}`
    );

    return { success: true, errors: [] };
  }

  /**
   * Shuts down the `InputManager` (`-> shutdown`), clears all buffered events,
   * resets all device states, and shuts down the platform input backend.
   */
  public shutdown(): {
    readonly success: boolean;
    readonly errors: readonly InputDiagnosticError[];
  } {
    if (!isValidInputLifecycleTransition(this.state, 'shutdown')) {
      const err = createInputError(
        'INPUT_ILLEGAL_STATE_TRANSITION',
        `Illegal InputManager lifecycle transition '${this.state}' -> 'shutdown'.`
      );
      return { success: false, errors: [err] };
    }

    this.buffer.clear();
    this.keyboardInput.reset();
    this.mouseInput.reset();
    this.touchInput.reset();
    this.gamepadInput.reset();
    this.gestureRecognizer.reset();
    this.virtualControlState.reset();
    this.derivedControlState.reset();
    this.evaluatedActionsById.clear();
    this.evaluatedActionsByContextAndId.clear();
    this.previousActionActiveById.clear();
    this.devicesById.clear();
    this.contextsById.clear();
    this.contextIdByNameLower.clear();
    this.actionMap.clear();
    this.recordedEventsHistory.length = 0;

    this.backend.shutdown();
    this.state = 'shutdown';

    this.logger?.record(
      'input',
      'INFO',
      `input_manager_shutdown: inputManagerId=${this.inputManagerId} projectId=${this.projectId}`
    );

    return { success: true, errors: [] };
  }

  private ensureOperational(): InputDiagnosticError | null {
    if (this.state !== 'ready' && this.state !== 'processing') {
      return createInputError(
        'INPUT_NOT_INITIALIZED',
        `InputManager '${this.inputManagerId}' is in state '${this.state}' (expected 'ready' or 'processing').`
      );
    }
    return null;
  }

  public registerDevice(
    candidate: unknown
  ): InputValidationResult<InputDeviceDescriptor> {
    const opErr = this.ensureOperational();
    if (opErr) {
      return { valid: false, value: null, errors: [opErr] };
    }

    const val = validateInputDeviceDescriptor(candidate);
    if (!val.valid || !val.value) {
      this.logger?.record(
        'input',
        'ERROR',
        `input_validation_failed: ${val.errors.map((e) => e.message).join('; ')}`
      );
      return val;
    }

    const device = val.value;
    if (device.projectId !== this.projectId) {
      const err = createInputError(
        'INPUT_CROSS_PROJECT_ACCESS',
        `Cannot register InputDevice from project '${device.projectId}' in InputManager for project '${this.projectId}'.`
      );
      this.logger?.record(
        'input',
        'ERROR',
        `input_validation_failed: ${err.message}`
      );
      return { valid: false, value: null, errors: [err] };
    }

    if (
      !this.devicesById.has(device.deviceId) &&
      this.devicesById.size >= this.maxDevices
    ) {
      const err = createInputError(
        'INPUT_BUFFER_FULL',
        `Max InputDevices limit (${this.maxDevices}) reached.`
      );
      return { valid: false, value: null, errors: [err] };
    }

    this.devicesById.set(device.deviceId, device);
    if (device.deviceType === 'touch') {
      this.touchInput.setSupportsPressure(
        device.capabilities.supportsTouchPressure
      );
    }

    this.logger?.record(
      'input',
      'INFO',
      `input_device_registered: deviceId=${device.deviceId} type=${device.deviceType}`
    );

    return { valid: true, value: device, errors: [] };
  }

  public setDeviceConnected(
    deviceId: InputDeviceId,
    connected: boolean
  ): InputValidationResult<InputDeviceDescriptor> {
    const opErr = this.ensureOperational();
    if (opErr) {
      return { valid: false, value: null, errors: [opErr] };
    }

    const existing = this.devicesById.get(deviceId);
    if (!existing) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_DEVICE_NOT_FOUND',
            `InputDevice '${deviceId}' is not registered.`
          ),
        ],
      };
    }

    const updated: InputDeviceDescriptor = Object.freeze({
      ...existing,
      connected: Boolean(connected),
    });
    this.devicesById.set(deviceId, updated);

    if (!connected) {
      this.resetDeviceTypeState(existing.deviceType);
      this.logger?.record(
        'input',
        'INFO',
        `input_device_disconnected: deviceId=${deviceId} type=${existing.deviceType}`
      );
    }

    return { valid: true, value: updated, errors: [] };
  }

  public setDeviceEnabled(
    deviceId: InputDeviceId,
    enabled: boolean
  ): InputValidationResult<InputDeviceDescriptor> {
    const opErr = this.ensureOperational();
    if (opErr) {
      return { valid: false, value: null, errors: [opErr] };
    }

    const existing = this.devicesById.get(deviceId);
    if (!existing) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_DEVICE_NOT_FOUND',
            `InputDevice '${deviceId}' is not registered.`
          ),
        ],
      };
    }

    const updated: InputDeviceDescriptor = Object.freeze({
      ...existing,
      enabled: Boolean(enabled),
    });
    this.devicesById.set(deviceId, updated);

    if (!enabled) {
      this.resetDeviceTypeState(existing.deviceType);
    }

    return { valid: true, value: updated, errors: [] };
  }

  private resetDeviceTypeState(deviceType: string): void {
    switch (deviceType) {
      case 'keyboard':
        this.keyboardInput.reset();
        break;
      case 'mouse':
        this.mouseInput.reset();
        break;
      case 'touch':
        this.touchInput.reset();
        this.gestureRecognizer.reset();
        break;
      case 'gamepad':
        this.gamepadInput.reset();
        break;
      case 'virtual':
        this.virtualControlState.reset();
        break;
    }
  }

  public getDevice(deviceId: InputDeviceId): InputDeviceDescriptor | undefined {
    return this.devicesById.get(deviceId);
  }

  public getDefaultDeviceId(
    deviceType: ActiveInputDeviceType
  ): InputDeviceId | undefined {
    const canonicalId = createDeterministicInputDeviceId(
      this.projectId,
      deviceType,
      '0'
    );
    if (this.devicesById.has(canonicalId)) {
      return canonicalId;
    }
    for (const dev of this.listDevices()) {
      if (dev.deviceType === deviceType) {
        return dev.deviceId;
      }
    }
    return undefined;
  }

  public listDevices(): readonly InputDeviceDescriptor[] {
    return Object.freeze(
      Array.from(this.devicesById.values()).sort((a, b) =>
        a.deviceId.localeCompare(b.deviceId)
      )
    );
  }

  /**
   * Validates and enqueues an `InputEvent` into the bounded `InputBuffer`.
   */
  public pushEvent(input: BufferedInputEventInput): InputBufferPushResult {
    const opErr = this.ensureOperational();
    if (opErr) {
      return {
        success: false,
        event: null,
        droppedEvent: null,
        errors: [opErr],
      };
    }

    if (input.projectId !== this.projectId) {
      const err = createInputError(
        'INPUT_CROSS_PROJECT_ACCESS',
        `Cannot push InputEvent from project '${input.projectId}' into InputManager for project '${this.projectId}'.`
      );
      this.logger?.record(
        'input',
        'ERROR',
        `input_validation_failed: ${err.message}`
      );
      return {
        success: false,
        event: null,
        droppedEvent: null,
        errors: [err],
      };
    }

    const device = this.devicesById.get(input.deviceId);
    if (!device) {
      const err = createInputError(
        'INPUT_DEVICE_NOT_FOUND',
        `InputDevice '${input.deviceId}' is not registered in project '${this.projectId}'.`
      );
      this.logger?.record(
        'input',
        'ERROR',
        `input_validation_failed: ${err.message}`
      );
      return {
        success: false,
        event: null,
        droppedEvent: null,
        errors: [err],
      };
    }

    if (!device.connected || !device.enabled) {
      const err = createInputError(
        'INPUT_DEVICE_NOT_FOUND',
        `InputDevice '${input.deviceId}' is disconnected or disabled.`
      );
      return {
        success: false,
        event: null,
        droppedEvent: null,
        errors: [err],
      };
    }

    if (device.deviceType !== input.deviceType) {
      const err = createInputError(
        'INPUT_EVENT_INVALID',
        `InputEvent deviceType '${input.deviceType}' does not match registered device '${device.deviceId}' type '${device.deviceType}'.`
      );
      return {
        success: false,
        event: null,
        droppedEvent: null,
        errors: [err],
      };
    }

    // Enforce honest touch pressure capability at ingestion time
    const normalizedPressure =
      input.deviceType === 'touch' && !device.capabilities.supportsTouchPressure
        ? null
        : input.pressure;

    return this.buffer.push({
      ...input,
      pressure: normalizedPressure,
      simulationTick: input.simulationTick ?? this.currentSimulationTick,
    });
  }

  public registerContext(
    candidate: unknown
  ): InputValidationResult<InputContextDescriptor> {
    const opErr = this.ensureOperational();
    if (opErr) {
      return { valid: false, value: null, errors: [opErr] };
    }

    const val = validateInputContextDescriptor(candidate);
    if (!val.valid || !val.value) {
      this.logger?.record(
        'input',
        'ERROR',
        `input_validation_failed: ${val.errors.map((e) => e.message).join('; ')}`
      );
      return val;
    }

    const ctx = val.value;
    if (ctx.projectId !== this.projectId) {
      const err = createInputError(
        'INPUT_CROSS_PROJECT_ACCESS',
        `Cannot register InputContext from project '${ctx.projectId}' in InputManager for project '${this.projectId}'.`
      );
      return { valid: false, value: null, errors: [err] };
    }

    if (
      !this.contextsById.has(ctx.contextId) &&
      this.contextsById.size >= this.maxContexts
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_BUFFER_FULL',
            `Max InputContexts limit (${this.maxContexts}) reached.`
          ),
        ],
      };
    }

    this.contextsById.set(ctx.contextId, ctx);
    this.contextIdByNameLower.set(ctx.name.toLowerCase(), ctx.contextId);

    this.logger?.record(
      'input',
      'INFO',
      `input_context_registered: contextId=${ctx.contextId} name=${ctx.name} priority=${ctx.priority}`
    );

    return { valid: true, value: ctx, errors: [] };
  }

  public setContextEnabled(
    contextIdOrName: string,
    enabled: boolean
  ): InputValidationResult<InputContextDescriptor> {
    const opErr = this.ensureOperational();
    if (opErr) {
      return { valid: false, value: null, errors: [opErr] };
    }

    const existing = this.getContext(contextIdOrName);
    if (!existing) {
      return {
        valid: false,
        value: null,
        errors: [
          createInputError(
            'INPUT_CONTEXT_INVALID',
            `InputContext '${contextIdOrName}' was not found.`
          ),
        ],
      };
    }

    const updated: InputContextDescriptor = Object.freeze({
      ...existing,
      enabled: Boolean(enabled),
    });
    this.contextsById.set(updated.contextId, updated);
    return { valid: true, value: updated, errors: [] };
  }

  public getContext(
    contextIdOrName: string
  ): InputContextDescriptor | undefined {
    const byId = this.contextsById.get(contextIdOrName as InputContextId);
    if (byId) return byId;
    const mapped = this.contextIdByNameLower.get(
      contextIdOrName.trim().toLowerCase()
    );
    return mapped ? this.contextsById.get(mapped) : undefined;
  }

  public listContexts(): readonly InputContextDescriptor[] {
    return sortInputContextsByPriority(Array.from(this.contextsById.values()));
  }

  public registerAction(
    candidate: unknown
  ): InputValidationResult<InputActionDescriptor> {
    const opErr = this.ensureOperational();
    if (opErr) {
      return { valid: false, value: null, errors: [opErr] };
    }

    const res = this.actionMap.registerAction(candidate);
    if (res.valid && res.value) {
      this.evaluatedActionsById.set(
        res.value.actionId,
        createIdleActionEvaluatedState(res.value)
      );
      this.logger?.record(
        'input',
        'INFO',
        `input_action_registered: actionId=${res.value.actionId} name=${res.value.name} type=${res.value.valueType}`
      );
    } else {
      this.logger?.record(
        'input',
        'ERROR',
        `input_validation_failed: ${res.errors.map((e) => e.message).join('; ')}`
      );
    }
    return res;
  }

  public addBinding(
    candidate: unknown
  ): InputValidationResult<InputBindingDescriptor> {
    const opErr = this.ensureOperational();
    if (opErr) {
      return { valid: false, value: null, errors: [opErr] };
    }

    const res = this.actionMap.addBinding(candidate);
    if (res.valid && res.value) {
      this.logger?.record(
        'input',
        'INFO',
        `input_binding_registered: bindingId=${res.value.bindingId} actionId=${res.value.actionId} control=${res.value.deviceType}:${res.value.control}`
      );
    } else {
      this.logger?.record(
        'input',
        'ERROR',
        `input_validation_failed: ${res.errors.map((e) => e.message).join('; ')}`
      );
    }
    return res;
  }

  public removeBinding(bindingId: InputBindingId): boolean {
    return this.actionMap.removeBinding(bindingId);
  }

  /**
   * Advances the Input System by one deterministic tick (`ready -> processing -> ready`).
   * Frame-rate independent: state transitions depend strictly on tick boundaries and ordered events.
   */
  public update(simulationTick?: number): InputUpdateTickReport {
    if (this.state !== 'ready') {
      const err = createInputError(
        this.state === 'uninitialized' || this.state === 'shutdown'
          ? 'INPUT_NOT_INITIALIZED'
          : 'INPUT_ILLEGAL_STATE_TRANSITION',
        `Cannot call update() when InputManager is in state '${this.state}'.`
      );
      return {
        success: false,
        simulationTick: this.currentSimulationTick,
        processedEventsCount: 0,
        recognizedGesturesCount: 0,
        evaluatedActionsCount: 0,
        errors: [err],
      };
    }

    this.state = 'processing';
    const errors: InputDiagnosticError[] = [];

    if (simulationTick !== undefined) {
      if (!Number.isInteger(simulationTick) || simulationTick < 0) {
        this.state = 'ready';
        const err = createInputError(
          'INPUT_INVALID_VALUE',
          `Invalid simulationTick '${String(simulationTick)}'; must be a non-negative integer.`
        );
        return {
          success: false,
          simulationTick: this.currentSimulationTick,
          processedEventsCount: 0,
          recognizedGesturesCount: 0,
          evaluatedActionsCount: 0,
          errors: [err],
        };
      }
      this.currentSimulationTick = simulationTick;
    } else {
      this.currentSimulationTick += 1;
    }

    // 1. Poll raw samples from PlatformInputBackendContract into InputBuffer
    const backendSamples = this.backend.pollRawSamples();
    for (const sample of backendSamples) {
      const resolvedDevId =
        (sample.deviceId as InputDeviceId) ||
        this.getDefaultDeviceId(sample.deviceType);
      if (resolvedDevId) {
        this.pushEvent({
          projectId: this.projectId,
          deviceId: resolvedDevId,
          deviceType: sample.deviceType,
          eventType: sample.eventType,
          control: sample.control,
          value: sample.value,
          secondaryValue: sample.secondaryValue,
          deltaX: sample.deltaX,
          deltaY: sample.deltaY,
          touchId: sample.touchId,
          pressure: sample.pressure,
          timestampMs: sample.timestampMs ?? 0,
          simulationTick: this.currentSimulationTick,
        });
      }
    }

    // 2. Advance per-device tick states (pressed -> held, released -> idle, reset deltas)
    this.keyboardInput.beginTick();
    this.mouseInput.beginTick();
    this.touchInput.beginTick();
    this.gamepadInput.beginTick();
    this.gestureRecognizer.beginTick();
    this.virtualControlState.beginTick();
    this.derivedControlState.beginTick();

    // 3. Drain buffered events in deterministic order
    this.buffer.clearFrameHistory();
    const drainedEvents = this.buffer.drain();

    for (const ev of drainedEvents) {
      this.recordedEventsHistory.push(ev);
      if (this.recordedEventsHistory.length > this.maxRecordedHistoryEvents) {
        this.recordedEventsHistory.shift();
      }

      switch (ev.deviceType) {
        case 'keyboard': {
          const res = this.keyboardInput.applyEvent(ev);
          if (!res.valid) errors.push(...res.errors);
          break;
        }
        case 'mouse': {
          const res = this.mouseInput.applyEvent(ev);
          if (!res.valid) errors.push(...res.errors);
          break;
        }
        case 'touch': {
          const res = this.touchInput.applyEvent(ev);
          if (!res.valid || !res.value) {
            errors.push(...res.errors);
          } else {
            this.gestureRecognizer.evaluateTouchPoint(res.value);
          }
          break;
        }
        case 'gamepad': {
          const res = this.gamepadInput.applyEvent(ev);
          if (!res.valid) errors.push(...res.errors);
          break;
        }
        case 'virtual': {
          const res = this.virtualControlState.setControlValue(
            ev.control,
            ev.value
          );
          if (!res.valid) errors.push(...res.errors);
          break;
        }
      }
    }

    // Also evaluate stationary touch points for longPress gesture recognition
    for (const point of this.touchInput.listTouches()) {
      if (point.phase === 'stationary') {
        this.gestureRecognizer.evaluateTouchPoint(point);
      }
    }

    // Update derived mouse/touch/gesture controls so bindings to gestures or deltas work deterministically
    this.updateDerivedTouchAndMouseControls();

    // 4. Evaluate InputContexts and Actions in deterministic priority order
    const evaluatedCount = this.evaluateContextsAndActions(drainedEvents);

    this.state = 'ready';

    return Object.freeze({
      success: errors.length === 0,
      simulationTick: this.currentSimulationTick,
      processedEventsCount: drainedEvents.length,
      recognizedGesturesCount:
        this.gestureRecognizer.listRecognizedGestures().length,
      evaluatedActionsCount: evaluatedCount,
      errors: Object.freeze(errors),
    });
  }

  private updateDerivedTouchAndMouseControls(): void {
    const mouseDelta = this.mouseInput.getDelta();
    const mouseWheel = this.mouseInput.getWheel();
    this.derivedControlState.setControlValue(
      'MouseDeltaX',
      clampInputNumber(mouseDelta.x, -1, 1)
    );
    this.derivedControlState.setControlValue(
      'MouseDeltaY',
      clampInputNumber(mouseDelta.y, -1, 1)
    );
    this.derivedControlState.setControlValue(
      'MouseWheelX',
      clampInputNumber(mouseWheel.x, -1, 1)
    );
    this.derivedControlState.setControlValue(
      'MouseWheelY',
      clampInputNumber(mouseWheel.y, -1, 1)
    );

    const activeTouches = this.touchInput.listTouches();
    const primaryTouch = activeTouches.find(
      (t) => t.phase !== 'ended' && t.phase !== 'cancelled'
    );
    this.derivedControlState.setControlValue(
      'TouchPrimary',
      primaryTouch ? 1 : 0
    );
    this.derivedControlState.setControlValue(
      'TouchDeltaX',
      primaryTouch ? clampInputNumber(primaryTouch.delta.x, -1, 1) : 0
    );
    this.derivedControlState.setControlValue(
      'TouchDeltaY',
      primaryTouch ? clampInputNumber(primaryTouch.delta.y, -1, 1) : 0
    );

    for (let i = 0; i < 4; i++) {
      const t = this.touchInput.getTouch(i);
      const isDown = Boolean(
        t && t.phase !== 'ended' && t.phase !== 'cancelled'
      );
      this.derivedControlState.setControlValue(`Touch${i}`, isDown ? 1 : 0);
    }

    const gestures = this.gestureRecognizer.listRecognizedGestures();
    const hasTap = gestures.some((g) => g.gestureType === 'tap');
    const hasDoubleTap = gestures.some((g) => g.gestureType === 'doubleTap');
    const hasLongPress = gestures.some((g) => g.gestureType === 'longPress');
    const hasSwipeLeft = gestures.some(
      (g) => g.gestureType === 'swipe' && g.swipeDirection === 'left'
    );
    const hasSwipeRight = gestures.some(
      (g) => g.gestureType === 'swipe' && g.swipeDirection === 'right'
    );
    const hasSwipeUp = gestures.some(
      (g) => g.gestureType === 'swipe' && g.swipeDirection === 'up'
    );
    const hasSwipeDown = gestures.some(
      (g) => g.gestureType === 'swipe' && g.swipeDirection === 'down'
    );

    this.derivedControlState.setControlValue('GestureTap', hasTap ? 1 : 0);
    this.derivedControlState.setControlValue(
      'GestureDoubleTap',
      hasDoubleTap ? 1 : 0
    );
    this.derivedControlState.setControlValue(
      'GestureLongPress',
      hasLongPress ? 1 : 0
    );
    this.derivedControlState.setControlValue(
      'GestureSwipeLeft',
      hasSwipeLeft ? 1 : 0
    );
    this.derivedControlState.setControlValue(
      'GestureSwipeRight',
      hasSwipeRight ? 1 : 0
    );
    this.derivedControlState.setControlValue(
      'GestureSwipeUp',
      hasSwipeUp ? 1 : 0
    );
    this.derivedControlState.setControlValue(
      'GestureSwipeDown',
      hasSwipeDown ? 1 : 0
    );
  }

  private readControlRawValueAndPhase(
    deviceType: ActiveInputDeviceType,
    control: string
  ): { readonly value: number; readonly phase: DigitalControlPhase } {
    switch (deviceType) {
      case 'keyboard': {
        const snap = this.keyboardInput.getKeyState(control);
        return {
          value: snap ? snap.currentValue : 0,
          phase: snap ? snap.phase : 'idle',
        };
      }
      case 'mouse': {
        if (
          control === 'MouseDeltaX' ||
          control === 'MouseDeltaY' ||
          control === 'MouseWheelX' ||
          control === 'MouseWheelY'
        ) {
          const snap = this.derivedControlState.getControlState(control);
          return { value: snap.currentValue, phase: snap.phase };
        }
        const snap = this.mouseInput.getButtonState(
          control as CanonicalMouseButton
        );
        return {
          value: snap ? snap.currentValue : 0,
          phase: snap ? snap.phase : 'idle',
        };
      }
      case 'gamepad': {
        const axisVal = this.gamepadInput.getAxisValue(
          control as CanonicalGamepadAxis
        );
        const btnPhase = this.gamepadInput.getButtonPhase(
          control as CanonicalGamepadButton
        );
        const btnVal = this.gamepadInput.getButtonValue(
          control as CanonicalGamepadButton
        );
        if (btnPhase !== 'idle' || btnVal !== 0) {
          return { value: btnVal, phase: btnPhase };
        }
        const active = Math.abs(axisVal) >= DIGITAL_PRESS_THRESHOLD;
        return {
          value: axisVal,
          phase: active ? 'held' : 'idle',
        };
      }
      case 'touch': {
        const snap = this.derivedControlState.getControlState(control);
        return { value: snap.currentValue, phase: snap.phase };
      }
      case 'virtual': {
        const snap = this.virtualControlState.getControlState(control);
        return { value: snap.currentValue, phase: snap.phase };
      }
    }
  }

  private evaluateSingleAction(
    action: InputActionDescriptor,
    contextId: string,
    consumeMatchedEvents: boolean,
    consumedControlsInTick: Set<string>,
    drainedEvents: readonly InputEvent[]
  ): InputActionEvaluatedState {
    const stateTrackKey = `${contextId}::${action.actionId}`;
    const prevActive = this.previousActionActiveById.get(stateTrackKey) ?? false;

    if (!action.enabled) {
      this.previousActionActiveById.set(stateTrackKey, false);
      return createIdleActionEvaluatedState(action);
    }

    const bindings = this.actionMap.listBindingsForAction(action.actionId);
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let anyBindingActive = false;

    for (const binding of bindings) {
      const controlKey = `${binding.deviceType}::${binding.control}`;

      // If a higher-priority context already consumed this physical control in this tick, skip it
      if (consumedControlsInTick.has(controlKey)) {
        continue;
      }

      // Check if matching events in this tick were explicitly consumed by another context
      const matchingTickEvents = drainedEvents.filter(
        (ev) =>
          ev.deviceType === binding.deviceType &&
          (ev.control === binding.control ||
            (binding.deviceType === 'touch' && ev.touchId !== null))
      );
      const allConsumedByOther =
        matchingTickEvents.length > 0 &&
        matchingTickEvents.every(
          (ev) =>
            this.buffer.isConsumed(ev.eventId) &&
            this.buffer.getConsumer(ev.eventId) !== contextId
        );
      if (allConsumedByOther) {
        continue;
      }

      const raw = this.readControlRawValueAndPhase(
        binding.deviceType,
        binding.control
      );
      const scaledRaw = raw.value * binding.scale;
      const processed = processAxisValue(scaledRaw, {
        deadZone: binding.deadZone ?? action.deadZone,
        sensitivity: binding.sensitivity ?? action.sensitivity,
        invert: binding.invert,
        min: -1,
        max: 1,
      });

      const val = processed.valid && processed.value !== null ? processed.value : 0;
      const isControlDown =
        raw.phase === 'pressed' ||
        raw.phase === 'held' ||
        Math.abs(val) >= DIGITAL_PRESS_THRESHOLD;

      if (val !== 0 || isControlDown) {
        anyBindingActive = true;
        if (binding.axisComponent === 'x') {
          sumX = clampInputNumber(sumX + val, -1, 1);
        } else if (binding.axisComponent === 'y') {
          sumY = clampInputNumber(sumY + val, -1, 1);
        } else {
          sumZ = clampInputNumber(sumZ + val, -1, 1);
        }

        if (consumeMatchedEvents && binding.consumeEvent) {
          consumedControlsInTick.add(controlKey);
          for (const ev of matchingTickEvents) {
            this.buffer.consume(ev.eventId, contextId);
          }
        }
      }
    }

    const phase = computeDigitalControlPhase(prevActive, anyBindingActive);
    this.previousActionActiveById.set(stateTrackKey, anyBindingActive);

    const buttonValue = phase === 'pressed' || phase === 'held';
    const axis1D = sumX === 0 ? 0 : sumX;
    const axis2D: Vector2 = Object.freeze({
      x: sumX === 0 ? 0 : sumX,
      y: sumY === 0 ? 0 : sumY,
    });
    const axis3D: Vector3 = Object.freeze({
      x: sumX === 0 ? 0 : sumX,
      y: sumY === 0 ? 0 : sumY,
      z: sumZ === 0 ? 0 : sumZ,
    });

    const triggered =
      action.valueType === 'button'
        ? buttonValue
        : axis1D !== 0 || axis2D.x !== 0 || axis2D.y !== 0 || axis3D.z !== 0;

    return Object.freeze({
      actionId: action.actionId,
      name: action.name,
      valueType: action.valueType,
      triggered,
      phase,
      buttonValue,
      axis1D,
      axis2D,
      axis3D,
    });
  }

  private evaluateContextsAndActions(
    drainedEvents: readonly InputEvent[]
  ): number {
    this.evaluatedActionsByContextAndId.clear();
    const consumedControlsInTick = new Set<string>();
    const allActions = this.actionMap.listActions();
    const sortedContexts = this.listContexts();
    const actionsAssignedToAnyContext = new Set<InputActionId>();
    const primaryActionStateSet = new Set<InputActionId>();

    let evaluatedCount = 0;

    // 1. Evaluate all contexts in priority DESC, contextId ASC order
    for (const ctx of sortedContexts) {
      for (const actionId of ctx.actionIds) {
        actionsAssignedToAnyContext.add(actionId);
        const action = this.actionMap.getAction(actionId);
        if (!action) continue;

        if (!ctx.enabled) {
          const idleState = createIdleActionEvaluatedState(action);
          this.previousActionActiveById.set(
            `${ctx.contextId}::${action.actionId}`,
            false
          );
          this.evaluatedActionsByContextAndId.set(
            `${ctx.contextId}::${action.actionId}`,
            idleState
          );
          if (!primaryActionStateSet.has(action.actionId)) {
            this.evaluatedActionsById.set(action.actionId, idleState);
          }
          continue;
        }

        const evalState = this.evaluateSingleAction(
          action,
          ctx.contextId,
          ctx.consumeMatchedEvents,
          consumedControlsInTick,
          drainedEvents
        );
        evaluatedCount += 1;

        this.evaluatedActionsByContextAndId.set(
          `${ctx.contextId}::${action.actionId}`,
          evalState
        );

        // Record the highest-priority enabled context evaluation (or first triggered one) as default
        if (
          !primaryActionStateSet.has(action.actionId) ||
          evalState.triggered ||
          evalState.phase === 'released'
        ) {
          if (!primaryActionStateSet.has(action.actionId)) {
            this.evaluatedActionsById.set(action.actionId, evalState);
            primaryActionStateSet.add(action.actionId);
          }
        }
      }
    }

    // 2. Evaluate standalone actions (not assigned to any context) after prioritized contexts
    for (const action of allActions) {
      if (actionsAssignedToAnyContext.has(action.actionId)) {
        continue;
      }
      const evalState = this.evaluateSingleAction(
        action,
        'default_global_context',
        false,
        consumedControlsInTick,
        drainedEvents
      );
      evaluatedCount += 1;
      this.evaluatedActionsById.set(action.actionId, evalState);
    }

    return evaluatedCount;
  }

  public getActionState(
    actionIdOrName: string,
    contextIdOrName?: string
  ): InputActionEvaluatedState | undefined {
    const action = this.actionMap.getAction(actionIdOrName);
    if (!action) return undefined;

    if (contextIdOrName !== undefined) {
      const ctx = this.getContext(contextIdOrName);
      if (!ctx) return undefined;
      return (
        this.evaluatedActionsByContextAndId.get(
          `${ctx.contextId}::${action.actionId}`
        ) ?? createIdleActionEvaluatedState(action)
      );
    }

    return (
      this.evaluatedActionsById.get(action.actionId) ??
      createIdleActionEvaluatedState(action)
    );
  }

  public isActionPressed(
    actionIdOrName: string,
    contextIdOrName?: string
  ): boolean {
    return (
      this.getActionState(actionIdOrName, contextIdOrName)?.phase === 'pressed'
    );
  }

  public isActionHeld(
    actionIdOrName: string,
    contextIdOrName?: string
  ): boolean {
    return (
      this.getActionState(actionIdOrName, contextIdOrName)?.phase === 'held'
    );
  }

  public isActionReleased(
    actionIdOrName: string,
    contextIdOrName?: string
  ): boolean {
    return (
      this.getActionState(actionIdOrName, contextIdOrName)?.phase === 'released'
    );
  }

  public isActionDown(
    actionIdOrName: string,
    contextIdOrName?: string
  ): boolean {
    return Boolean(
      this.getActionState(actionIdOrName, contextIdOrName)?.buttonValue
    );
  }

  public getActionAxis1D(
    actionIdOrName: string,
    contextIdOrName?: string
  ): number {
    return this.getActionState(actionIdOrName, contextIdOrName)?.axis1D ?? 0;
  }

  public getActionAxis2D(
    actionIdOrName: string,
    contextIdOrName?: string
  ): Vector2 {
    return (
      this.getActionState(actionIdOrName, contextIdOrName)?.axis2D ??
      createDefaultVector2()
    );
  }

  public getActionAxis3D(
    actionIdOrName: string,
    contextIdOrName?: string
  ): Vector3 {
    return (
      this.getActionState(actionIdOrName, contextIdOrName)?.axis3D ??
      createDefaultVector3()
    );
  }

  // Direct read-only device state queries
  public isKeyDown(key: CanonicalKeyCode): boolean {
    return this.keyboardInput.isKeyDown(key);
  }

  public isKeyPressed(key: CanonicalKeyCode): boolean {
    return this.keyboardInput.isKeyPressed(key);
  }

  public isKeyHeld(key: CanonicalKeyCode): boolean {
    return this.keyboardInput.isKeyHeld(key);
  }

  public isKeyReleased(key: CanonicalKeyCode): boolean {
    return this.keyboardInput.isKeyReleased(key);
  }

  public getMouseSnapshot(): MouseStateSnapshot {
    return this.mouseInput.getSnapshot();
  }

  public listTouches(): readonly TouchPointState[] {
    return this.touchInput.listTouches();
  }

  public getTouch(touchId: number): TouchPointState | undefined {
    return this.touchInput.getTouch(touchId);
  }

  public listRecognizedGestures(): readonly GestureEvent[] {
    return this.gestureRecognizer.listRecognizedGestures();
  }

  public getGamepadButtonPhase(
    button: CanonicalGamepadButton
  ): DigitalControlPhase {
    return this.gamepadInput.getButtonPhase(button);
  }

  public getGamepadAxisValue(axis: CanonicalGamepadAxis): number {
    return this.gamepadInput.getAxisValue(axis);
  }

  public getVirtualControlState(control: string): ControlStateSnapshot {
    return this.virtualControlState.getControlState(control);
  }

  /**
   * Consumes a specific `InputEventId` in the current tick's frame history.
   */
  public consumeEvent(
    eventId: InputEventId,
    consumerContextId = 'manual_consumer'
  ): boolean {
    return this.buffer.consume(eventId, consumerContextId);
  }

  /**
   * Exports a deterministic read-only snapshot of recorded `InputEvent` items for replay.
   */
  public exportRecordedEvents(): readonly InputEvent[] {
    return sortInputEventsDeterministically(this.recordedEventsHistory);
  }

  public clearRecordedEvents(): void {
    this.recordedEventsHistory.length = 0;
  }
}

export { computeControlStateSnapshot };
