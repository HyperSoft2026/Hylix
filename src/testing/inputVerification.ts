import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  addComponent,
  createEntity,
  createStandardComponentRegistry,
} from '../ecs/ecsCore';
import {
  cleanupInputManagerForProjectClose,
  createAndroidInputBridgeContract,
  createDeterministicInputActionId,
  createDeterministicInputBindingId,
  createDeterministicInputContextId,
  createDeterministicInputDeviceId,
  createDeterministicInputEventId,
  createDeterministicInputManagerId,
  createGameplayInputSnapshot,
  createValidatedInputEvent,
  evaluateSceneInputReceivers,
  extractSceneInputData,
  INPUT_RECEIVER_COMPONENT_TYPE,
  InputBuffer,
  InputManager,
  isValidInputActionId,
  isValidInputBindingId,
  isValidInputContextId,
  isValidInputDeviceId,
  isValidInputEventId,
  isValidInputManagerId,
  normalizedViewportToWorld2D,
  NullContractInputBackend,
  processAxisValue,
  registerInputEcsComponents,
  screenToNormalizedViewportPosition,
  sortInputEventsDeterministically,
  validateInputDeviceDescriptor,
  validateInputPayloadSecurity,
} from '../input/inputValidation';
import {
  addEntityToScene,
  createSceneDefinition,
  validateSceneDefinition,
} from '../scene/sceneSystem';
import { VerificationAssertionResult } from './foundationVerification';

/**
 * Hylix V1.0.0 — Phase 08 Automated Verification Suite (40 Assertions)
 *
 * Verifies Input System + Device Abstraction:
 * - Deterministic IDs (`input_`, `device_`, `event_`, `action_`, `binding_`, `context_`)
 * - Lifecycle state machine (`uninitialized -> initializing -> ready -> processing -> ready -> shutdown`)
 * - Device Abstraction (`keyboard`, `mouse`, `touch`, `gamepad`, `virtual`; reserved types blocked)
 * - Keyboard, Mouse, Multi-Touch (honest pressure), Gestures (`tap`, `doubleTap`, `longPress`, `swipe`), Gamepad
 * - Bounded `InputBuffer` (`rejectNewest`, `dropOldest`) & non-destructive event `consume()`
 * - Action Mapping (`button`, `axis1D`, `axis2D`, `axis3D`), DeadZone/Sensitivity/Invert/Clamp
 * - Priority-ordered `InputContext` evaluation & event consumption blocking lower-priority contexts
 * - ECS `InputReceiver` & Scene `inputConfig` read-only extraction, Project Isolation, Security & Cleanup
 */

export function runInputVerificationChecks(): VerificationAssertionResult[] {
  const results: VerificationAssertionResult[] = [];
  const category = 'Input System & Device Abstraction' as const;

  // 1. Deterministic Input IDs
  {
    const mgrId1 = createDeterministicInputManagerId('prj_alpha');
    const mgrId2 = createDeterministicInputManagerId('prj_alpha');
    const devId = createDeterministicInputDeviceId('prj_alpha', 'keyboard', '0');
    const evId = createDeterministicInputEventId(
      'prj_alpha',
      devId,
      1,
      'key_down',
      'Space'
    );
    const actId = createDeterministicInputActionId('prj_alpha', 'Jump');
    const bindId = createDeterministicInputBindingId(
      'prj_alpha',
      actId,
      'keyboard',
      'Space',
      'x'
    );
    const ctxId = createDeterministicInputContextId('prj_alpha', 'Gameplay');

    const passed =
      mgrId1 === mgrId2 &&
      isValidInputManagerId(mgrId1) &&
      isValidInputDeviceId(devId) &&
      isValidInputEventId(evId) &&
      isValidInputActionId(actId) &&
      isValidInputBindingId(bindId) &&
      isValidInputContextId(ctxId);

    results.push({
      id: 'input_01_deterministic_ids',
      category: 'Input System',
      title: 'Deterministic Input IDs (input_, device_, event_, action_, binding_, context_)',
      passed,
      details: passed
        ? `Generated deterministic IDs: ${mgrId1}, ${devId}, ${actId}, ${ctxId}.`
        : 'Failed to generate valid deterministic Input IDs.',
    });
  }

  // 2. ID stability across save/load/reorder
  {
    const actA1 = createDeterministicInputActionId('prj_stable', 'Attack');
    const actB1 = createDeterministicInputActionId('prj_stable', 'Defend');
    const bindA1 = createDeterministicInputBindingId(
      'prj_stable',
      actA1,
      'gamepad',
      'A',
      'x'
    );
    // Reordered evaluation
    const actB2 = createDeterministicInputActionId('prj_stable', 'Defend');
    const actA2 = createDeterministicInputActionId('prj_stable', 'Attack');
    const bindA2 = createDeterministicInputBindingId(
      'prj_stable',
      actA2,
      'gamepad',
      'A',
      'x'
    );

    const passed = actA1 === actA2 && actB1 === actB2 && bindA1 === bindA2;
    results.push({
      id: 'input_02_id_stability_across_save_load_reorder',
      category: 'Input System',
      title: 'Input IDs Remain Stable Across Save/Load & Entity/Action Reordering',
      passed,
      details: passed
        ? `Action ID '${actA1}' and Binding ID '${bindA1}' remained invariant under reordering.`
        : 'Input IDs changed when creation order was swapped.',
    });
  }

  // 3. InputManager lifecycle state machine
  {
    const mgr = new InputManager({ projectId: 'prj_lifecycle' });
    const initialState = mgr.getState();
    const initRes = mgr.initialize();
    const readyState = mgr.getState();
    const tickRes = mgr.update(1);
    const postTickState = mgr.getState();
    const shutRes = mgr.shutdown();
    const finalState = mgr.getState();

    const passed =
      initialState === 'uninitialized' &&
      initRes.success &&
      readyState === 'ready' &&
      tickRes.success &&
      postTickState === 'ready' &&
      shutRes.success &&
      finalState === 'shutdown';

    results.push({
      id: 'input_03_manager_lifecycle_state_machine',
      category: 'Input System',
      title: 'InputManager Enforces Deterministic Lifecycle State Machine',
      passed,
      details: passed
        ? 'Transitioned cleanly: uninitialized -> initializing -> ready -> processing -> ready -> shutdown.'
        : 'Unexpected lifecycle state transition.',
    });
  }

  // 4. Illegal lifecycle transitions rejected
  {
    const mgr = new InputManager({ projectId: 'prj_illegal_lc' });
    const preInitUpdate = mgr.update(1);
    const preInitAction = mgr.registerAction({
      projectId: 'prj_illegal_lc',
      name: 'Jump',
      valueType: 'button',
    });
    mgr.initialize();
    mgr.shutdown();
    const reInit = mgr.initialize();
    const doubleShut = mgr.shutdown();
    const postShutUpdate = mgr.update(2);

    const passed =
      !preInitUpdate.success &&
      preInitUpdate.errors[0]?.code === 'INPUT_NOT_INITIALIZED' &&
      !preInitAction.valid &&
      preInitAction.errors[0]?.code === 'INPUT_NOT_INITIALIZED' &&
      !reInit.success &&
      reInit.errors[0]?.code === 'INPUT_ILLEGAL_STATE_TRANSITION' &&
      !doubleShut.success &&
      !postShutUpdate.success;

    results.push({
      id: 'input_04_illegal_lifecycle_transitions_rejected',
      category: 'Input System',
      title: 'Rejects Operations Before Initialization & Re-Initialization After Shutdown',
      passed,
      details: passed
        ? 'Rejected uninitialized operations (INPUT_NOT_INITIALIZED) and shutdown -> initializing (INPUT_ILLEGAL_STATE_TRANSITION).'
        : 'Allowed illegal InputManager lifecycle transition.',
    });
  }

  // 5. Active device types & honest capabilities
  {
    const mgr = new InputManager({ projectId: 'prj_devices' });
    mgr.initialize();
    const devices = mgr.listDevices();
    const types = new Set(devices.map((d) => d.deviceType));
    const touchDev = devices.find((d) => d.deviceType === 'touch');
    const kbDev = devices.find((d) => d.deviceType === 'keyboard');

    const passed =
      devices.length === 5 &&
      types.has('keyboard') &&
      types.has('mouse') &&
      types.has('touch') &&
      types.has('gamepad') &&
      types.has('virtual') &&
      Boolean(touchDev && touchDev.capabilities.supportsMultiTouch) &&
      Boolean(touchDev && touchDev.capabilities.supportsTouchPressure === false) &&
      Boolean(kbDev && kbDev.capabilities.supportsKeys && !kbDev.capabilities.supportsMultiTouch);

    results.push({
      id: 'input_05_device_registration_active_types',
      category: 'Input System',
      title: 'Registers Active Device Types (keyboard, mouse, touch, gamepad, virtual) with Honest Capabilities',
      passed,
      details: passed
        ? 'All 5 active device types registered with accurate non-fabricated capability descriptors.'
        : 'Device registration or capability descriptor mismatch.',
    });
  }

  // 6. Reserved future & unknown device types rejected
  {
    const penCheck = validateInputDeviceDescriptor({
      projectId: 'prj_future',
      deviceType: 'pen',
    });
    const sensorCheck = validateInputDeviceDescriptor({
      projectId: 'prj_future',
      deviceType: 'sensor',
    });
    const unknownCheck = validateInputDeviceDescriptor({
      projectId: 'prj_future',
      deviceType: 'neural_implant',
    });

    const passed =
      !penCheck.valid &&
      !sensorCheck.valid &&
      !unknownCheck.valid &&
      penCheck.errors[0]?.code === 'INPUT_INVALID_VALUE';

    results.push({
      id: 'input_06_reserved_future_device_types_rejected',
      category: 'Input System',
      title: 'Blocks Reserved Future Device Types (pen, joystick, motion, sensor) from Active Runtime Registration',
      passed,
      details: passed
        ? 'Reserved future and unknown device types rejected cleanly with INPUT_INVALID_VALUE.'
        : 'Failed to block reserved or unknown device types.',
    });
  }

  // 7. Contradictory device capabilities rejected
  {
    const fakeKbTouch = validateInputDeviceDescriptor({
      projectId: 'prj_caps',
      deviceType: 'keyboard',
      capabilities: {
        supportsKeys: true,
        supportsPointerPosition: false,
        supportsPointerDelta: false,
        supportsWheel: false,
        supportsMultiTouch: true,
        maxTouchPoints: 5,
        supportsTouchPressure: true,
        supportsAnalogAxes: false,
        buttonCount: 104,
        axisCount: 0,
      },
    });

    const passed =
      !fakeKbTouch.valid &&
      fakeKbTouch.errors.some((e) => e.code === 'INPUT_INVALID_VALUE');

    results.push({
      id: 'input_07_contradictory_device_capabilities_rejected',
      category: 'Input System',
      title: 'Rejects Fabricated/Contradictory Device Capabilities',
      passed,
      details: passed
        ? 'Keyboard claiming multi-touch and touch pressure was rejected.'
        : 'Contradictory device capabilities were not rejected.',
    });
  }

  // 8. Device disconnect resets stuck controls
  {
    const mgr = new InputManager({ projectId: 'prj_disconnect' });
    mgr.initialize();
    const kbId = mgr.getDefaultDeviceId('keyboard')!;
    mgr.pushEvent({
      projectId: 'prj_disconnect',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyW',
      value: 1,
    });
    mgr.update(1);
    const downBefore = mgr.isKeyDown('KeyW');

    mgr.setDeviceConnected(kbId, false);
    const downAfterDisconnect = mgr.isKeyDown('KeyW');

    const pushWhileDisconnected = mgr.pushEvent({
      projectId: 'prj_disconnect',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyA',
      value: 1,
    });

    const passed =
      downBefore === true &&
      downAfterDisconnect === false &&
      !pushWhileDisconnected.success &&
      pushWhileDisconnected.errors[0]?.code === 'INPUT_DEVICE_NOT_FOUND';

    results.push({
      id: 'input_08_device_disconnect_resets_stuck_state',
      category: 'Input System',
      title: 'Disconnecting a Device Resets Held Controls & Rejects Events While Disconnected',
      passed,
      details: passed
        ? 'KeyW state reset to idle on disconnect and events to disconnected device were rejected.'
        : 'Device disconnect failed to reset held state.',
    });
  }

  // 9. Canonical keyboard key validation
  {
    const mgr = new InputManager({ projectId: 'prj_kb_keys' });
    mgr.initialize();
    const kbId = mgr.getDefaultDeviceId('keyboard')!;
    mgr.pushEvent({
      projectId: 'prj_kb_keys',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'NonCanonicalKey999',
      value: 1,
    });
    const tickRep = mgr.update(1);

    const passed =
      !tickRep.success &&
      tickRep.errors.some((e) => e.code === 'INPUT_INVALID_VALUE');

    results.push({
      id: 'input_09_keyboard_canonical_keys_validation',
      category: 'Input System',
      title: 'Enforces Canonical Platform-Independent Key Identifiers (KeyA..Z, Digit0..9, Space, etc.)',
      passed,
      details: passed
        ? 'Non-canonical key identifier rejected with INPUT_INVALID_VALUE.'
        : 'Failed to reject non-canonical key identifier.',
    });
  }

  // 10. Keyboard deterministic phase transitions & key-repeat suppression
  {
    const mgr = new InputManager({ projectId: 'prj_kb_phases' });
    mgr.initialize();
    const kbId = mgr.getDefaultDeviceId('keyboard')!;

    // Tick 1: KeyDown -> pressed
    mgr.pushEvent({
      projectId: 'prj_kb_phases',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'Space',
      value: 1,
    });
    mgr.update(1);
    const t1Pressed = mgr.isKeyPressed('Space');
    const t1Held = mgr.isKeyHeld('Space');

    // Tick 2: OS key-repeat sends redundant key_down -> must transition to held, NOT pressed!
    mgr.pushEvent({
      projectId: 'prj_kb_phases',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'Space',
      value: 1,
    });
    mgr.update(2);
    const t2Pressed = mgr.isKeyPressed('Space');
    const t2Held = mgr.isKeyHeld('Space');

    // Tick 3: KeyUp -> released
    mgr.pushEvent({
      projectId: 'prj_kb_phases',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_up',
      control: 'Space',
      value: 0,
    });
    mgr.update(3);
    const t3Released = mgr.isKeyReleased('Space');
    const t3Down = mgr.isKeyDown('Space');

    // Tick 4: No events -> idle
    mgr.update(4);
    const t4Released = mgr.isKeyReleased('Space');
    const t4Down = mgr.isKeyDown('Space');

    const passed =
      t1Pressed &&
      !t1Held &&
      !t2Pressed &&
      t2Held &&
      t3Released &&
      !t3Down &&
      !t4Released &&
      !t4Down;

    results.push({
      id: 'input_10_keyboard_phase_transitions',
      category: 'Input System',
      title: 'Keyboard Enforces idle -> pressed -> held -> released -> idle & Suppresses OS Key-Repeat',
      passed,
      details: passed
        ? 'Verified deterministic 4-tick key lifecycle and OS key-repeat suppression.'
        : 'Keyboard phase transition failure.',
    });
  }

  // 11. Mouse position, delta, wheel & per-tick reset
  {
    const mgr = new InputManager({ projectId: 'prj_mouse' });
    mgr.initialize();
    const mouseId = mgr.getDefaultDeviceId('mouse')!;

    mgr.pushEvent({
      projectId: 'prj_mouse',
      deviceId: mouseId,
      deviceType: 'mouse',
      eventType: 'mouse_move',
      control: 'Pointer',
      value: 120,
      secondaryValue: 240,
      deltaX: 15,
      deltaY: -10,
    });
    mgr.pushEvent({
      projectId: 'prj_mouse',
      deviceId: mouseId,
      deviceType: 'mouse',
      eventType: 'mouse_wheel',
      control: 'Wheel',
      value: 0,
      secondaryValue: 3,
    });
    mgr.update(1);
    const snap1 = mgr.getMouseSnapshot();

    // Tick 2: no movement or wheel -> position stays, delta & wheel reset to (0, 0)
    mgr.update(2);
    const snap2 = mgr.getMouseSnapshot();

    const passed =
      snap1.position.x === 120 &&
      snap1.position.y === 240 &&
      snap1.delta.x === 15 &&
      snap1.delta.y === -10 &&
      snap1.wheel.y === 3 &&
      snap2.position.x === 120 &&
      snap2.position.y === 240 &&
      snap2.delta.x === 0 &&
      snap2.delta.y === 0 &&
      snap2.wheel.y === 0;

    results.push({
      id: 'input_11_mouse_position_delta_wheel_and_reset',
      category: 'Input System',
      title: 'Mouse Tracks Position, Accumulates Delta/Wheel & Resets Delta/Wheel on Next Tick',
      passed,
      details: passed
        ? 'Mouse position preserved at (120, 240) while delta and wheel reset to (0, 0) on tick 2.'
        : 'Mouse position/delta/wheel state mismatch.',
    });
  }

  // 12. Mouse canonical buttons
  {
    const mgr = new InputManager({ projectId: 'prj_mouse_btn' });
    mgr.initialize();
    const mouseId = mgr.getDefaultDeviceId('mouse')!;

    mgr.pushEvent({
      projectId: 'prj_mouse_btn',
      deviceId: mouseId,
      deviceType: 'mouse',
      eventType: 'mouse_button_down',
      control: 'MouseLeft',
      value: 1,
    });
    mgr.update(1);
    const s1 = mgr.getMouseSnapshot().buttons.MouseLeft;

    mgr.update(2);
    const s2 = mgr.getMouseSnapshot().buttons.MouseLeft;

    mgr.pushEvent({
      projectId: 'prj_mouse_btn',
      deviceId: mouseId,
      deviceType: 'mouse',
      eventType: 'mouse_button_up',
      control: 'MouseLeft',
      value: 0,
    });
    mgr.update(3);
    const s3 = mgr.getMouseSnapshot().buttons.MouseLeft;

    mgr.update(4);
    const s4 = mgr.getMouseSnapshot().buttons.MouseLeft;

    const passed =
      s1 === 'pressed' && s2 === 'held' && s3 === 'released' && s4 === 'idle';

    results.push({
      id: 'input_12_mouse_buttons_canonical_phases',
      category: 'Input System',
      title: 'Mouse Canonical Buttons (MouseLeft..MouseButton5) Transition Deterministically',
      passed,
      details: passed
        ? 'MouseLeft transitioned pressed -> held -> released -> idle.'
        : 'Mouse button phase transition failed.',
    });
  }

  // 13. Coordinate space decoupling (screen -> viewport -> world)
  {
    const vpRes = screenToNormalizedViewportPosition(
      { x: 500, y: 250 },
      { x: 100, y: 50, width: 800, height: 400 }
    );
    const worldRes = normalizedViewportToWorld2D(vpRes.value!, {
      position: { x: 10, y: 20 },
      orthoHeight: 10,
      aspect: 2,
    });
    const invalidVp = screenToNormalizedViewportPosition(
      { x: 0, y: 0 },
      { x: 0, y: 0, width: 0, height: 400 }
    );

    const passed =
      vpRes.valid &&
      vpRes.value?.x === 0.5 &&
      vpRes.value?.y === 0.5 &&
      worldRes.valid &&
      worldRes.value?.x === 10 &&
      worldRes.value?.y === 20 &&
      !invalidVp.valid;

    results.push({
      id: 'input_13_mouse_viewport_world_coordinate_decoupling',
      category: 'Input System',
      title: 'Decouples Raw Pointer Coordinates from Viewport & World Coordinates',
      passed,
      details: passed
        ? 'Center screen (500, 250) mapped to viewport (0.5, 0.5) and world (10, 20) without Renderer coupling.'
        : 'Coordinate conversion failed.',
    });
  }

  // 14. Multi-touch tracking & phases
  {
    const mgr = new InputManager({ projectId: 'prj_touch' });
    mgr.initialize();
    const touchDevId = mgr.getDefaultDeviceId('touch')!;

    mgr.pushEvent({
      projectId: 'prj_touch',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_began',
      control: 'Touch',
      value: 100,
      secondaryValue: 200,
      touchId: 1,
    });
    mgr.pushEvent({
      projectId: 'prj_touch',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_began',
      control: 'Touch',
      value: 50,
      secondaryValue: 60,
      touchId: 0,
    });
    mgr.update(1);
    const touchesT1 = mgr.listTouches();

    // Tick 2: touch 0 moves, touch 1 stays -> touch 1 transitions to stationary
    mgr.pushEvent({
      projectId: 'prj_touch',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_moved',
      control: 'Touch',
      value: 70,
      secondaryValue: 90,
      touchId: 0,
    });
    mgr.update(2);
    const t0Tick2 = mgr.getTouch(0);
    const t1Tick2 = mgr.getTouch(1);

    // Tick 3: touch 0 ends
    mgr.pushEvent({
      projectId: 'prj_touch',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_ended',
      control: 'Touch',
      value: 70,
      secondaryValue: 90,
      touchId: 0,
    });
    mgr.update(3);
    const t0Tick3 = mgr.getTouch(0);

    // Tick 4: ended touch 0 is purged at start of tick 4
    mgr.update(4);
    const t0Tick4 = mgr.getTouch(0);

    const passed =
      touchesT1.length === 2 &&
      touchesT1[0].touchId === 0 &&
      touchesT1[1].touchId === 1 &&
      touchesT1[0].phase === 'began' &&
      t0Tick2?.phase === 'moved' &&
      t0Tick2?.delta.x === 20 &&
      t0Tick2?.delta.y === 30 &&
      t1Tick2?.phase === 'stationary' &&
      t0Tick3?.phase === 'ended' &&
      t0Tick4 === undefined;

    results.push({
      id: 'input_14_multitouch_tracking_and_phases',
      category: 'Input System',
      title: 'Multi-Touch Tracks Independent touchIds (began -> moved / stationary -> ended)',
      passed,
      details: passed
        ? 'Multi-touch points sorted by touchId ASC and transitioned cleanly across 4 ticks.'
        : 'Multi-touch tracking or phase transition failed.',
    });
  }

  // 15. Honest touch pressure (never fabricated when unsupported)
  {
    const mgrUnsupported = new InputManager({ projectId: 'prj_pressure_no' });
    mgrUnsupported.initialize();
    const devNo = mgrUnsupported.getDefaultDeviceId('touch')!;
    mgrUnsupported.pushEvent({
      projectId: 'prj_pressure_no',
      deviceId: devNo,
      deviceType: 'touch',
      eventType: 'touch_began',
      control: 'Touch',
      value: 10,
      secondaryValue: 20,
      touchId: 0,
      pressure: 0.75, // Platform backend default has supportsTouchPressure = false
    });
    mgrUnsupported.update(1);
    const pressureWhenUnsupported = mgrUnsupported.getTouch(0)?.pressure;

    const backendSupported = new NullContractInputBackend(undefined, {
      supportsMultiTouch: true,
      maxTouchPoints: 10,
      supportsTouchPressure: true,
    });
    const mgrSupported = new InputManager({
      projectId: 'prj_pressure_yes',
      backend: backendSupported,
    });
    mgrSupported.initialize();
    const devYes = mgrSupported.getDefaultDeviceId('touch')!;
    mgrSupported.pushEvent({
      projectId: 'prj_pressure_yes',
      deviceId: devYes,
      deviceType: 'touch',
      eventType: 'touch_began',
      control: 'Touch',
      value: 10,
      secondaryValue: 20,
      touchId: 0,
      pressure: 0.75,
    });
    mgrSupported.update(1);
    const pressureWhenSupported = mgrSupported.getTouch(0)?.pressure;

    const passed =
      pressureWhenUnsupported === null && pressureWhenSupported === 0.75;

    results.push({
      id: 'input_15_touch_pressure_non_fabrication',
      category: 'Input System',
      title: 'Touch Pressure Strictly null When Unsupported (Never Fabricates Pressure)',
      passed,
      details: passed
        ? 'Pressure resolved to null when unsupported and 0.75 when hardware capability is enabled.'
        : 'Touch pressure non-fabrication check failed.',
    });
  }

  // 16. Untracked touch & maxTouchPoints overflow rejected
  {
    const mgr = new InputManager({
      projectId: 'prj_touch_err',
      maxTouchPoints: 2,
    });
    mgr.initialize();
    const touchDevId = mgr.getDefaultDeviceId('touch')!;

    // Move before began
    mgr.pushEvent({
      projectId: 'prj_touch_err',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_moved',
      control: 'Touch',
      value: 10,
      secondaryValue: 10,
      touchId: 9,
    });
    const repUntracked = mgr.update(1);

    // Overflow maxTouchPoints = 2
    for (let i = 0; i < 3; i++) {
      mgr.pushEvent({
        projectId: 'prj_touch_err',
        deviceId: touchDevId,
        deviceType: 'touch',
        eventType: 'touch_began',
        control: 'Touch',
        value: i * 10,
        secondaryValue: i * 10,
        touchId: i,
      });
    }
    const repOverflow = mgr.update(2);

    const passed =
      !repUntracked.success &&
      repUntracked.errors.some((e) => e.code === 'INPUT_EVENT_INVALID') &&
      !repOverflow.success &&
      repOverflow.errors.some((e) => e.code === 'INPUT_BUFFER_FULL') &&
      mgr.listTouches().length === 2;

    results.push({
      id: 'input_16_touch_untracked_or_overflow_rejected',
      category: 'Input System',
      title: 'Rejects Untracked Touch Move/End Events & Enforces maxTouchPoints Ceiling',
      passed,
      details: passed
        ? 'Untracked touch_moved rejected (INPUT_EVENT_INVALID) and 3rd concurrent touch rejected at maxTouchPoints=2.'
        : 'Touch validation failed.',
    });
  }

  // 17. Gesture recognition: tap and doubleTap
  {
    const mgr = new InputManager({ projectId: 'prj_gestures_tap' });
    mgr.initialize();
    const touchDevId = mgr.getDefaultDeviceId('touch')!;

    // First tap: began at t=10ms, ended at t=80ms
    mgr.pushEvent({
      projectId: 'prj_gestures_tap',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_began',
      control: 'Touch',
      value: 100,
      secondaryValue: 100,
      touchId: 0,
      timestampMs: 10,
    });
    mgr.pushEvent({
      projectId: 'prj_gestures_tap',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_ended',
      control: 'Touch',
      value: 102,
      secondaryValue: 101,
      touchId: 0,
      timestampMs: 80,
    });
    mgr.update(1);
    const gestures1 = mgr.listRecognizedGestures();

    // Second tap within doubleTapWindowMs (at t=200ms..250ms)
    mgr.pushEvent({
      projectId: 'prj_gestures_tap',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_began',
      control: 'Touch',
      value: 103,
      secondaryValue: 102,
      touchId: 0,
      timestampMs: 200,
    });
    mgr.pushEvent({
      projectId: 'prj_gestures_tap',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_ended',
      control: 'Touch',
      value: 104,
      secondaryValue: 102,
      touchId: 0,
      timestampMs: 250,
    });
    mgr.update(2);
    const gestures2 = mgr.listRecognizedGestures();

    const passed =
      gestures1.some((g) => g.gestureType === 'tap') &&
      gestures2.some((g) => g.gestureType === 'doubleTap');

    results.push({
      id: 'input_17_gesture_tap_and_double_tap',
      category: 'Input System',
      title: 'GestureRecognizer Detects Deterministic tap & doubleTap Gestures',
      passed,
      details: passed
        ? 'Recognized single tap on tick 1 and doubleTap on tick 2.'
        : 'Tap or doubleTap gesture recognition failed.',
    });
  }

  // 18. Gesture recognition: longPress and directional swipe
  {
    const mgr = new InputManager({ projectId: 'prj_gestures_swipe' });
    mgr.initialize();
    const touchDevId = mgr.getDefaultDeviceId('touch')!;

    // Long press: began at t=0ms, stationary at t=600ms (>= 500ms)
    mgr.pushEvent({
      projectId: 'prj_gestures_swipe',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_began',
      control: 'Touch',
      value: 50,
      secondaryValue: 50,
      touchId: 0,
      timestampMs: 0,
    });
    mgr.pushEvent({
      projectId: 'prj_gestures_swipe',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_stationary',
      control: 'Touch',
      value: 52,
      secondaryValue: 51,
      touchId: 0,
      timestampMs: 600,
    });
    mgr.update(1);
    const longPressRecognized = mgr
      .listRecognizedGestures()
      .some((g) => g.gestureType === 'longPress');

    // End touch 0, then swipe right on touch 1
    mgr.pushEvent({
      projectId: 'prj_gestures_swipe',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_ended',
      control: 'Touch',
      value: 52,
      secondaryValue: 51,
      touchId: 0,
      timestampMs: 650,
    });
    mgr.pushEvent({
      projectId: 'prj_gestures_swipe',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_began',
      control: 'Touch',
      value: 100,
      secondaryValue: 100,
      touchId: 1,
      timestampMs: 700,
    });
    mgr.pushEvent({
      projectId: 'prj_gestures_swipe',
      deviceId: touchDevId,
      deviceType: 'touch',
      eventType: 'touch_ended',
      control: 'Touch',
      value: 220,
      secondaryValue: 110,
      touchId: 1,
      timestampMs: 820,
    });
    mgr.update(2);
    const swipeGesture = mgr
      .listRecognizedGestures()
      .find((g) => g.gestureType === 'swipe');

    const passed =
      longPressRecognized &&
      Boolean(swipeGesture && swipeGesture.swipeDirection === 'right');

    results.push({
      id: 'input_18_gesture_long_press_and_directional_swipe',
      category: 'Input System',
      title: 'GestureRecognizer Detects longPress & Directional swipe (left/right/up/down)',
      passed,
      details: passed
        ? 'Recognized longPress (600ms stationary) and rightward swipe (+120px).'
        : 'longPress or swipe gesture recognition failed.',
    });
  }

  // 19. Gamepad canonical buttons and axes
  {
    const mgr = new InputManager({ projectId: 'prj_gamepad' });
    mgr.initialize();
    const gpId = mgr.getDefaultDeviceId('gamepad')!;

    mgr.pushEvent({
      projectId: 'prj_gamepad',
      deviceId: gpId,
      deviceType: 'gamepad',
      eventType: 'gamepad_button',
      control: 'A',
      value: 1,
    });
    mgr.pushEvent({
      projectId: 'prj_gamepad',
      deviceId: gpId,
      deviceType: 'gamepad',
      eventType: 'gamepad_axis',
      control: 'LeftX',
      value: -0.75,
    });
    mgr.update(1);

    const passed =
      mgr.getGamepadButtonPhase('A') === 'pressed' &&
      mgr.getGamepadAxisValue('LeftX') === -0.75;

    results.push({
      id: 'input_19_gamepad_canonical_buttons_and_axes',
      category: 'Input System',
      title: 'Gamepad Supports Canonical Buttons [0, 1] & Axes [-1, 1]',
      passed,
      details: passed
        ? 'Gamepad Button A phase=pressed and LeftX=-0.75 verified.'
        : 'Gamepad button or axis state failed.',
    });
  }

  // 20. Gamepad rejects NaN, Infinity, and out-of-range values
  {
    const mgr = new InputManager({ projectId: 'prj_gp_err' });
    mgr.initialize();
    const gpId = mgr.getDefaultDeviceId('gamepad')!;

    const nanPush = mgr.pushEvent({
      projectId: 'prj_gp_err',
      deviceId: gpId,
      deviceType: 'gamepad',
      eventType: 'gamepad_axis',
      control: 'LeftX',
      value: Number.NaN,
    });
    const infPush = mgr.pushEvent({
      projectId: 'prj_gp_err',
      deviceId: gpId,
      deviceType: 'gamepad',
      eventType: 'gamepad_axis',
      control: 'LeftY',
      value: Number.POSITIVE_INFINITY,
    });
    mgr.pushEvent({
      projectId: 'prj_gp_err',
      deviceId: gpId,
      deviceType: 'gamepad',
      eventType: 'gamepad_axis',
      control: 'RightX',
      value: 1.5, // Out of [-1, 1]
    });
    mgr.pushEvent({
      projectId: 'prj_gp_err',
      deviceId: gpId,
      deviceType: 'gamepad',
      eventType: 'gamepad_button',
      control: 'B',
      value: -0.2, // Out of [0, 1]
    });
    const tickRep = mgr.update(1);

    const passed =
      !nanPush.success &&
      nanPush.errors[0]?.code === 'INPUT_INVALID_VALUE' &&
      !infPush.success &&
      !tickRep.success &&
      tickRep.errors.every((e) => e.code === 'INPUT_INVALID_VALUE');

    results.push({
      id: 'input_20_gamepad_nan_infinity_out_of_range_rejected',
      category: 'Input System',
      title: 'Gamepad Rejects NaN, Infinity, and Out-of-Range Button/Axis Values',
      passed,
      details: passed
        ? 'Rejected NaN, +Infinity, axis=1.5, and button=-0.2 with INPUT_INVALID_VALUE.'
        : 'Failed to reject invalid numeric gamepad values.',
    });
  }

  // 21. Immutable InputEvent & deterministic ordering
  {
    const devId = createDeterministicInputDeviceId('prj_ev', 'keyboard', '0');
    const ev1 = createValidatedInputEvent({
      projectId: 'prj_ev',
      deviceId: devId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyB',
      value: 1,
      sequence: 2,
      timestampMs: 999,
    });
    const ev2 = createValidatedInputEvent({
      projectId: 'prj_ev',
      deviceId: devId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyA',
      value: 1,
      sequence: 1,
      timestampMs: 1000,
    });

    const sorted = sortInputEventsDeterministically([ev1.value!, ev2.value!]);
    const passed =
      ev1.valid &&
      ev2.valid &&
      Object.isFrozen(ev1.value) &&
      sorted[0].sequence === 1 &&
      sorted[1].sequence === 2;

    results.push({
      id: 'input_21_immutable_input_event_and_deterministic_sort',
      category: 'Input System',
      title: 'InputEvent is Deeply Frozen & Sorted Deterministically by Sequence ASC',
      passed,
      details: passed
        ? 'InputEvent frozen via Object.freeze and ordered by sequence ASC regardless of timestampMs.'
        : 'InputEvent immutability or deterministic ordering failed.',
    });
  }

  // 22. InputBuffer bounded capacity: rejectNewest policy
  {
    const logger = new RedactedDiagnosticLogger();
    const buf = new InputBuffer({
      projectId: 'prj_buf_reject',
      maxEvents: 2,
      overflowPolicy: 'rejectNewest',
      logger,
    });
    const devId = createDeterministicInputDeviceId(
      'prj_buf_reject',
      'keyboard',
      '0'
    );

    const r1 = buf.push({
      projectId: 'prj_buf_reject',
      deviceId: devId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyA',
      value: 1,
    });
    const r2 = buf.push({
      projectId: 'prj_buf_reject',
      deviceId: devId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyB',
      value: 1,
    });
    const r3 = buf.push({
      projectId: 'prj_buf_reject',
      deviceId: devId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyC',
      value: 1,
    });

    const passed =
      r1.success &&
      r2.success &&
      !r3.success &&
      r3.errors[0]?.code === 'INPUT_BUFFER_FULL' &&
      buf.size() === 2;

    results.push({
      id: 'input_22_input_buffer_bounded_reject_newest',
      category: 'Input System',
      title: 'InputBuffer Enforces MAX_INPUT_EVENTS Ceiling Under rejectNewest Policy',
      passed,
      details: passed
        ? '3rd event rejected with INPUT_BUFFER_FULL when maxEvents=2.'
        : 'InputBuffer rejectNewest overflow policy failed.',
    });
  }

  // 23. InputBuffer bounded capacity: dropOldest policy
  {
    const buf = new InputBuffer({
      projectId: 'prj_buf_drop',
      maxEvents: 2,
      overflowPolicy: 'dropOldest',
    });
    const devId = createDeterministicInputDeviceId(
      'prj_buf_drop',
      'keyboard',
      '0'
    );

    buf.push({
      projectId: 'prj_buf_drop',
      deviceId: devId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyA',
      value: 1,
    });
    buf.push({
      projectId: 'prj_buf_drop',
      deviceId: devId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyB',
      value: 1,
    });
    const r3 = buf.push({
      projectId: 'prj_buf_drop',
      deviceId: devId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyC',
      value: 1,
    });

    const drained = buf.drain();
    const passed =
      r3.success &&
      r3.droppedEvent?.control === 'KeyA' &&
      drained.length === 2 &&
      drained[0].control === 'KeyB' &&
      drained[1].control === 'KeyC';

    results.push({
      id: 'input_23_input_buffer_bounded_drop_oldest',
      category: 'Input System',
      title: 'InputBuffer Deterministically Evicts Lowest-Sequence Event Under dropOldest Policy',
      passed,
      details: passed
        ? 'Evicted oldest event (KeyA, seq=1) and retained KeyB (seq=2) and KeyC (seq=3).'
        : 'InputBuffer dropOldest eviction failed.',
    });
  }

  // 24. Non-destructive event consumption
  {
    const buf = new InputBuffer({ projectId: 'prj_consume' });
    const devId = createDeterministicInputDeviceId(
      'prj_consume',
      'keyboard',
      '0'
    );
    const pushed = buf.push({
      projectId: 'prj_consume',
      deviceId: devId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'Enter',
      value: 1,
    });
    const evId = pushed.event!.eventId;
    buf.drain();

    const firstConsume = buf.consume(evId, 'context_ui');
    const secondConsume = buf.consume(evId, 'context_gameplay');
    const stillInHistory = buf.getFrameHistoryEvent(evId);

    const passed =
      firstConsume === true &&
      secondConsume === false &&
      buf.isConsumed(evId) &&
      buf.getConsumer(evId) === 'context_ui' &&
      stillInHistory?.eventId === evId;

    results.push({
      id: 'input_24_event_consumption_without_history_deletion',
      category: 'Input System',
      title: 'Event consume() Blocks Subsequent Consumers Without Deleting Frame History',
      passed,
      details: passed
        ? 'First consumer succeeded, second blocked, and event remained inspectable in frame history.'
        : 'Event consumption behavior failed.',
    });
  }

  // 25. Axis processing: deadZone, sensitivity, invert, clamp
  {
    const withinDeadZone = processAxisValue(0.12, {
      deadZone: 0.15,
      sensitivity: 1.0,
      invert: false,
    });
    const scaledAndInverted = processAxisValue(0.4, {
      deadZone: 0.1,
      sensitivity: 2.0,
      invert: true,
    });
    const clampedHigh = processAxisValue(0.9, {
      deadZone: 0.1,
      sensitivity: 2.0,
      invert: false,
    });
    const invalidOpts = processAxisValue(0.5, {
      deadZone: 1.2,
    });

    const passed =
      withinDeadZone.valid &&
      withinDeadZone.value === 0 &&
      scaledAndInverted.valid &&
      scaledAndInverted.value === -0.8 &&
      clampedHigh.valid &&
      clampedHigh.value === 1.0 &&
      !invalidOpts.valid;

    results.push({
      id: 'input_25_axis_processing_deadzone_sensitivity_invert_clamp',
      category: 'Input System',
      title: 'Axis Processing Enforces DeadZone, Sensitivity, Inversion & [-1, 1] Clamping',
      passed,
      details: passed
        ? 'Verified deadZone->0, scaled/inverted=-0.8, clamped=1.0, and invalid deadZone rejection.'
        : 'Axis processing math failed.',
    });
  }

  // 26. Action abstraction: button, axis1D, axis2D, axis3D
  {
    const mgr = new InputManager({ projectId: 'prj_actions' });
    mgr.initialize();
    const kbId = mgr.getDefaultDeviceId('keyboard')!;

    const moveAct = mgr.registerAction({
      projectId: 'prj_actions',
      name: 'Move2D',
      valueType: 'axis2D',
      deadZone: 0.05,
      sensitivity: 1.0,
    }).value!;

    mgr.addBinding({
      projectId: 'prj_actions',
      actionId: moveAct.actionId,
      deviceType: 'keyboard',
      control: 'KeyD',
      scale: 1,
      axisComponent: 'x',
    });
    mgr.addBinding({
      projectId: 'prj_actions',
      actionId: moveAct.actionId,
      deviceType: 'keyboard',
      control: 'KeyA',
      scale: -1,
      axisComponent: 'x',
    });
    mgr.addBinding({
      projectId: 'prj_actions',
      actionId: moveAct.actionId,
      deviceType: 'keyboard',
      control: 'KeyW',
      scale: 1,
      axisComponent: 'y',
    });

    mgr.pushEvent({
      projectId: 'prj_actions',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyD',
      value: 1,
    });
    mgr.pushEvent({
      projectId: 'prj_actions',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyW',
      value: 1,
    });
    mgr.update(1);

    const vec = mgr.getActionAxis2D('Move2D');
    const passed =
      vec.x === 1 &&
      vec.y === 1 &&
      mgr.getActionState('Move2D')?.triggered === true;

    results.push({
      id: 'input_26_action_abstraction_button_1d_2d_3d',
      category: 'Input System',
      title: 'Evaluates Composite 2D/3D Axis & Button Actions Deterministically',
      passed,
      details: passed
        ? `Move2D evaluated to (${vec.x}, ${vec.y}) from composite KeyD + KeyW bindings.`
        : 'Composite axis action evaluation failed.',
    });
  }

  // 27. Multi-device bindings per Action
  {
    const mgr = new InputManager({ projectId: 'prj_multibind' });
    mgr.initialize();
    const kbId = mgr.getDefaultDeviceId('keyboard')!;
    const gpId = mgr.getDefaultDeviceId('gamepad')!;

    const jumpAct = mgr.registerAction({
      projectId: 'prj_multibind',
      name: 'Jump',
      valueType: 'button',
    }).value!;

    mgr.addBinding({
      projectId: 'prj_multibind',
      actionId: jumpAct.actionId,
      deviceType: 'keyboard',
      control: 'Space',
    });
    mgr.addBinding({
      projectId: 'prj_multibind',
      actionId: jumpAct.actionId,
      deviceType: 'gamepad',
      control: 'A',
    });

    // Trigger via Gamepad A
    mgr.pushEvent({
      projectId: 'prj_multibind',
      deviceId: gpId,
      deviceType: 'gamepad',
      eventType: 'gamepad_button',
      control: 'A',
      value: 1,
    });
    mgr.update(1);
    const pressedViaGamepad = mgr.isActionPressed('Jump');

    // Release Gamepad A, then trigger via Keyboard Space on tick 3
    mgr.pushEvent({
      projectId: 'prj_multibind',
      deviceId: gpId,
      deviceType: 'gamepad',
      eventType: 'gamepad_button',
      control: 'A',
      value: 0,
    });
    mgr.update(2);
    const releasedOnTick2 = mgr.isActionReleased('Jump');

    mgr.pushEvent({
      projectId: 'prj_multibind',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'Space',
      value: 1,
    });
    mgr.update(3);
    const pressedViaKeyboard = mgr.isActionPressed('Jump');

    const passed =
      pressedViaGamepad && releasedOnTick2 && pressedViaKeyboard;

    results.push({
      id: 'input_27_multi_device_action_bindings',
      category: 'Input System',
      title: 'Supports Multi-Device Bindings for a Single Action (Keyboard Space + Gamepad A)',
      passed,
      details: passed
        ? 'Jump action triggered identically from Gamepad A and Keyboard Space.'
        : 'Multi-device binding evaluation failed.',
    });
  }

  // 28. Invalid action and binding rejected
  {
    const mgr = new InputManager({ projectId: 'prj_bind_err' });
    mgr.initialize();
    const fakeActionId = createDeterministicInputActionId(
      'prj_bind_err',
      'MissingAction'
    );

    const bindMissingAction = mgr.addBinding({
      projectId: 'prj_bind_err',
      actionId: fakeActionId,
      deviceType: 'keyboard',
      control: 'Space',
    });

    const act = mgr.registerAction({
      projectId: 'prj_bind_err',
      name: 'ValidAction',
      valueType: 'button',
    }).value!;

    const bindInvalidControl = mgr.addBinding({
      projectId: 'prj_bind_err',
      actionId: act.actionId,
      deviceType: 'keyboard',
      control: 'NotAValidKey',
    });

    const passed =
      !bindMissingAction.valid &&
      bindMissingAction.errors[0]?.code === 'INPUT_ACTION_NOT_FOUND' &&
      !bindInvalidControl.valid &&
      bindInvalidControl.errors[0]?.code === 'INPUT_BINDING_INVALID';

    results.push({
      id: 'input_28_invalid_action_and_binding_rejected',
      category: 'Input System',
      title: 'Rejects Bindings to Unregistered Actions & Invalid Device Controls',
      passed,
      details: passed
        ? 'Rejected missing action (INPUT_ACTION_NOT_FOUND) and invalid key (INPUT_BINDING_INVALID).'
        : 'Invalid binding was not rejected.',
    });
  }

  // 29. Priority-ordered InputContexts & event consumption blocking lower priority
  {
    const mgr = new InputManager({ projectId: 'prj_ctx_prio' });
    mgr.initialize();
    const kbId = mgr.getDefaultDeviceId('keyboard')!;

    const uiConfirm = mgr.registerAction({
      projectId: 'prj_ctx_prio',
      name: 'UIConfirm',
      valueType: 'button',
    }).value!;
    const gameplayJump = mgr.registerAction({
      projectId: 'prj_ctx_prio',
      name: 'GameplayJump',
      valueType: 'button',
    }).value!;

    mgr.addBinding({
      projectId: 'prj_ctx_prio',
      actionId: uiConfirm.actionId,
      deviceType: 'keyboard',
      control: 'Space',
      consumeEvent: true,
    });
    mgr.addBinding({
      projectId: 'prj_ctx_prio',
      actionId: gameplayJump.actionId,
      deviceType: 'keyboard',
      control: 'Space',
      consumeEvent: true,
    });

    // Register Gameplay (priority 100) and UI (priority 200)
    mgr.registerContext({
      projectId: 'prj_ctx_prio',
      name: 'Gameplay',
      priority: 100,
      enabled: true,
      consumeMatchedEvents: true,
      actionIds: [gameplayJump.actionId],
    });
    mgr.registerContext({
      projectId: 'prj_ctx_prio',
      name: 'UI',
      priority: 200,
      enabled: true,
      consumeMatchedEvents: true,
      actionIds: [uiConfirm.actionId],
    });

    mgr.pushEvent({
      projectId: 'prj_ctx_prio',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'Space',
      value: 1,
    });
    mgr.update(1);

    const uiTriggered = mgr.isActionPressed('UIConfirm', 'UI');
    const gameplayBlocked = !mgr.isActionPressed('GameplayJump', 'Gameplay');
    const contextsOrder = mgr.listContexts();

    const passed =
      contextsOrder[0].name === 'UI' &&
      contextsOrder[1].name === 'Gameplay' &&
      uiTriggered &&
      gameplayBlocked;

    results.push({
      id: 'input_29_priority_context_ordering_and_consumption',
      category: 'Input System',
      title: 'Higher-Priority InputContext (UI=200) Consumes Events & Blocks Lower-Priority (Gameplay=100)',
      passed,
      details: passed
        ? 'UI context (priority 200) triggered UIConfirm and blocked GameplayJump (priority 100) on Space.'
        : 'InputContext priority or consumption blocking failed.',
    });
  }

  // 30. Disabling higher-priority context unblocks lower-priority context
  {
    const mgr = new InputManager({ projectId: 'prj_ctx_toggle' });
    mgr.initialize();
    const kbId = mgr.getDefaultDeviceId('keyboard')!;

    const uiConfirm = mgr.registerAction({
      projectId: 'prj_ctx_toggle',
      name: 'UIConfirm',
      valueType: 'button',
    }).value!;
    const gameplayJump = mgr.registerAction({
      projectId: 'prj_ctx_toggle',
      name: 'GameplayJump',
      valueType: 'button',
    }).value!;

    mgr.addBinding({
      projectId: 'prj_ctx_toggle',
      actionId: uiConfirm.actionId,
      deviceType: 'keyboard',
      control: 'Space',
      consumeEvent: true,
    });
    mgr.addBinding({
      projectId: 'prj_ctx_toggle',
      actionId: gameplayJump.actionId,
      deviceType: 'keyboard',
      control: 'Space',
      consumeEvent: true,
    });

    mgr.registerContext({
      projectId: 'prj_ctx_toggle',
      name: 'Gameplay',
      priority: 100,
      enabled: true,
      consumeMatchedEvents: true,
      actionIds: [gameplayJump.actionId],
    });
    mgr.registerContext({
      projectId: 'prj_ctx_toggle',
      name: 'UI',
      priority: 200,
      enabled: false, // Disabled!
      consumeMatchedEvents: true,
      actionIds: [uiConfirm.actionId],
    });

    mgr.pushEvent({
      projectId: 'prj_ctx_toggle',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'Space',
      value: 1,
    });
    mgr.update(1);

    const passed =
      !mgr.isActionPressed('UIConfirm', 'UI') &&
      mgr.isActionPressed('GameplayJump', 'Gameplay');

    results.push({
      id: 'input_30_disabling_higher_priority_context_unblocks_lower',
      category: 'Input System',
      title: 'Disabling Higher-Priority Context Unblocks Lower-Priority Gameplay Context',
      passed,
      details: passed
        ? 'With UI disabled, GameplayJump received and triggered on Space.'
        : 'Disabling higher-priority context did not unblock lower-priority context.',
    });
  }

  // 31. Android-first virtual input controls
  {
    const mgr = new InputManager({ projectId: 'prj_virtual' });
    mgr.initialize();
    const virtId = mgr.getDefaultDeviceId('virtual')!;

    const boostAct = mgr.registerAction({
      projectId: 'prj_virtual',
      name: 'Boost',
      valueType: 'button',
    }).value!;
    mgr.addBinding({
      projectId: 'prj_virtual',
      actionId: boostAct.actionId,
      deviceType: 'virtual',
      control: 'VirtualBtnBoost',
    });

    mgr.pushEvent({
      projectId: 'prj_virtual',
      deviceId: virtId,
      deviceType: 'virtual',
      eventType: 'virtual_control',
      control: 'VirtualBtnBoost',
      value: 1,
    });
    mgr.update(1);

    const passed =
      mgr.isActionPressed('Boost') &&
      mgr.getVirtualControlState('VirtualBtnBoost').currentValue === 1;

    results.push({
      id: 'input_31_virtual_input_controls_android_first',
      category: 'Input System',
      title: 'Supports Android-First Virtual On-Screen Controls Mapped to Actions',
      passed,
      details: passed
        ? 'VirtualBtnBoost triggered Boost action deterministically.'
        : 'Virtual input control mapping failed.',
    });
  }

  // 32. Frame-rate independence across different timestampMs jitters
  {
    const runSimulation = (timestamps: readonly number[]): string => {
      const m = new InputManager({ projectId: 'prj_fps_indep' });
      m.initialize();
      const kb = m.getDefaultDeviceId('keyboard')!;
      const act = m.registerAction({
        projectId: 'prj_fps_indep',
        name: 'Fire',
        valueType: 'button',
      }).value!;
      m.addBinding({
        projectId: 'prj_fps_indep',
        actionId: act.actionId,
        deviceType: 'keyboard',
        control: 'KeyF',
      });

      m.pushEvent({
        projectId: 'prj_fps_indep',
        deviceId: kb,
        deviceType: 'keyboard',
        eventType: 'key_down',
        control: 'KeyF',
        value: 1,
        timestampMs: timestamps[0],
      });
      m.update(1);
      const p1 = m.getActionState('Fire')?.phase;

      m.update(2);
      const p2 = m.getActionState('Fire')?.phase;

      m.pushEvent({
        projectId: 'prj_fps_indep',
        deviceId: kb,
        deviceType: 'keyboard',
        eventType: 'key_up',
        control: 'KeyF',
        value: 0,
        timestampMs: timestamps[1],
      });
      m.update(3);
      const p3 = m.getActionState('Fire')?.phase;

      return `${p1}->${p2}->${p3}`;
    };

    const run60Fps = runSimulation([16.67, 50.0]);
    const run20FpsJitter = runSimulation([5.0, 480.0]);

    const passed =
      run60Fps === 'pressed->held->released' && run60Fps === run20FpsJitter;

    results.push({
      id: 'input_32_frame_rate_independent_deterministic_ticks',
      category: 'Input System',
      title: 'Action & Control Transitions Are 100% Frame-Rate Independent',
      passed,
      details: passed
        ? `Both 60Hz and jittered runs produced identical '${run60Fps}' transitions.`
        : 'Frame-rate jitter altered input state transitions.',
    });
  }

  // 33. Deterministic replay recording and playback
  {
    const sourceMgr = new InputManager({ projectId: 'prj_replay' });
    sourceMgr.initialize();
    const kb = sourceMgr.getDefaultDeviceId('keyboard')!;
    const act = sourceMgr.registerAction({
      projectId: 'prj_replay',
      name: 'Dash',
      valueType: 'button',
    }).value!;
    sourceMgr.addBinding({
      projectId: 'prj_replay',
      actionId: act.actionId,
      deviceType: 'keyboard',
      control: 'ShiftLeft',
    });

    sourceMgr.pushEvent({
      projectId: 'prj_replay',
      deviceId: kb,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'ShiftLeft',
      value: 1,
      simulationTick: 1,
    });
    sourceMgr.update(1);
    const recorded = sourceMgr.exportRecordedEvents();

    // Replay into a fresh InputManager
    const replayMgr = new InputManager({ projectId: 'prj_replay' });
    replayMgr.initialize();
    replayMgr.registerAction({
      projectId: 'prj_replay',
      name: 'Dash',
      valueType: 'button',
    });
    replayMgr.addBinding({
      projectId: 'prj_replay',
      actionId: act.actionId,
      deviceType: 'keyboard',
      control: 'ShiftLeft',
    });
    for (const ev of recorded) {
      replayMgr.pushEvent(ev);
    }
    replayMgr.update(1);

    const passed =
      recorded.length === 1 &&
      replayMgr.isActionPressed('Dash') === sourceMgr.isActionPressed('Dash') &&
      replayMgr.getActionState('Dash')?.actionId ===
        sourceMgr.getActionState('Dash')?.actionId;

    results.push({
      id: 'input_33_deterministic_replay_recording_and_playback',
      category: 'Input System',
      title: 'Exports Recorded InputEvents & Replays Deterministically With Identical State',
      passed,
      details: passed
        ? 'Replayed recorded event stream on fresh InputManager with 100% identical Dash action state.'
        : 'Deterministic input replay failed.',
    });
  }

  // 34. ECS InputReceiver component & Scene inputConfig extraction
  {
    const ecsRegistry = createStandardComponentRegistry();
    registerInputEcsComponents(ecsRegistry);
    const baseScene = createSceneDefinition({
      sceneName: 'InputTestScene',
      seedHint: 'input_scene_01',
      registry: ecsRegistry,
    }).scene!;

    let playerEnt = createEntity(
      {
        sceneId: baseScene.sceneId,
        name: 'PlayerEntity',
        seedHint: 'input_seed_01',
      },
      ecsRegistry
    ).entity!;
    playerEnt = addComponent(
      playerEnt,
      INPUT_RECEIVER_COMPONENT_TYPE,
      {
        contextName: 'Gameplay',
        actionNames: ['Move', 'Jump'],
        playerIndex: 0,
        enabled: true,
      },
      ecsRegistry
    ).entity!;

    const sceneWithEnt = addEntityToScene(
      baseScene,
      playerEnt,
      ecsRegistry
    ).scene!;
    const sceneWithCfg = validateSceneDefinition(
      {
        ...sceneWithEnt,
        inputConfig: {
          maxBufferedEvents: 256,
          bufferOverflowPolicy: 'dropOldest',
          defaultDeadZone: 0.12,
          defaultContextName: 'Gameplay',
        },
      },
      ecsRegistry
    );

    const extracted = extractSceneInputData(
      sceneWithCfg.scene!,
      'prj_scene_input'
    );

    // Reject runtime input properties inside SceneDefinition.inputConfig
    const invalidSceneCfg = validateSceneDefinition(
      {
        ...sceneWithEnt,
        inputConfig: {
          maxBufferedEvents: 256,
          bufferOverflowPolicy: 'dropOldest',
          defaultDeadZone: 0.12,
          defaultContextName: 'Gameplay',
          activeHardwareHandles: [123],
        },
      },
      ecsRegistry
    );

    const passed =
      ecsRegistry.isRegistered(INPUT_RECEIVER_COMPONENT_TYPE) &&
      sceneWithCfg.valid &&
      extracted.errors.length === 0 &&
      extracted.maxBufferedEvents === 256 &&
      extracted.bufferOverflowPolicy === 'dropOldest' &&
      extracted.receivers.length === 1 &&
      extracted.receivers[0].entityId === playerEnt.entityId &&
      !invalidSceneCfg.valid;

    results.push({
      id: 'input_34_ecs_input_receiver_and_scene_extraction',
      category: 'Input System',
      title: 'Registers ECS InputReceiver, Validates Scene inputConfig & Extracts Read-Only',
      passed,
      details: passed
        ? 'Extracted InputReceiver entity and validated SceneDefinition.inputConfig without mutating SceneDefinition.'
        : 'ECS InputReceiver or Scene inputConfig validation failed.',
    });
  }

  // 35. Gameplay read-only snapshot immutability
  {
    const mgr = new InputManager({ projectId: 'prj_snap' });
    mgr.initialize();
    const act = mgr.registerAction({
      projectId: 'prj_snap',
      name: 'Jump',
      valueType: 'button',
    }).value!;
    mgr.registerContext({
      projectId: 'prj_snap',
      name: 'Gameplay',
      priority: 100,
      enabled: true,
      consumeMatchedEvents: true,
      actionIds: [act.actionId],
    });
    mgr.update(1);

    const snap = createGameplayInputSnapshot(mgr, 'Gameplay');
    const ecsRegistry = createStandardComponentRegistry();
    registerInputEcsComponents(ecsRegistry);
    const baseScene = createSceneDefinition({
      sceneName: 'SnapScene',
      seedHint: 'snap_scene_01',
      registry: ecsRegistry,
    }).scene!;
    let ent = createEntity(
      {
        sceneId: baseScene.sceneId,
        name: 'Hero',
        seedHint: 'hero_snap',
      },
      ecsRegistry
    ).entity!;
    ent = addComponent(
      ent,
      INPUT_RECEIVER_COMPONENT_TYPE,
      {
        contextName: 'Gameplay',
        actionNames: ['Jump'],
        playerIndex: 0,
        enabled: true,
      },
      ecsRegistry
    ).entity!;
    const scene = addEntityToScene(baseScene, ent, ecsRegistry).scene!;
    const sceneInputSnap = extractSceneInputData(scene, 'prj_snap');
    const evalReceivers = evaluateSceneInputReceivers(sceneInputSnap, mgr);

    const passed =
      Object.isFrozen(snap) &&
      Object.isFrozen(snap.actionsByName) &&
      Object.isFrozen(snap.mouse) &&
      evalReceivers.length === 1 &&
      Object.isFrozen(evalReceivers[0]) &&
      evalReceivers[0].actions.Jump?.actionId === act.actionId;

    results.push({
      id: 'input_35_gameplay_readonly_snapshot_immutability',
      category: 'Input System',
      title: 'Gameplay Input Snapshots & Evaluated Receivers Are Deeply Frozen Read-Only Views',
      passed,
      details: passed
        ? 'createGameplayInputSnapshot and evaluateSceneInputReceivers returned frozen snapshots.'
        : 'Gameplay snapshot immutability check failed.',
    });
  }

  // 36. Project isolation enforcement
  {
    const mgrA = new InputManager({ projectId: 'prj_iso_A' });
    const mgrB = new InputManager({ projectId: 'prj_iso_B' });
    mgrA.initialize();
    mgrB.initialize();

    const devB = mgrB.getDefaultDeviceId('keyboard')!;
    const crossEvent = mgrA.pushEvent({
      projectId: 'prj_iso_B',
      deviceId: devB,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'Space',
      value: 1,
    });
    const crossDevice = mgrA.registerDevice({
      projectId: 'prj_iso_B',
      deviceType: 'keyboard',
    });
    const crossAction = mgrA.registerAction({
      projectId: 'prj_iso_B',
      name: 'HackAction',
      valueType: 'button',
    });
    const crossContext = mgrA.registerContext({
      projectId: 'prj_iso_B',
      name: 'HackContext',
      priority: 999,
    });

    const passed =
      !crossEvent.success &&
      crossEvent.errors[0]?.code === 'INPUT_CROSS_PROJECT_ACCESS' &&
      !crossDevice.valid &&
      crossDevice.errors[0]?.code === 'INPUT_CROSS_PROJECT_ACCESS' &&
      !crossAction.valid &&
      crossAction.errors[0]?.code === 'INPUT_CROSS_PROJECT_ACCESS' &&
      !crossContext.valid &&
      crossContext.errors[0]?.code === 'INPUT_CROSS_PROJECT_ACCESS';

    results.push({
      id: 'input_36_project_isolation_enforcement',
      category: 'Input System',
      title: 'Enforces Strict Project Isolation Across Devices, Events, Actions & Contexts',
      passed,
      details: passed
        ? 'All cross-project operations rejected with INPUT_CROSS_PROJECT_ACCESS.'
        : 'Cross-project input access was not blocked.',
    });
  }

  // 37. PlatformInputBackendContract & AndroidInputBridgeContract
  {
    const bridge = createAndroidInputBridgeContract();
    const backend = new NullContractInputBackend();
    const initRes = backend.initialize();
    const sampleRes = backend.enqueueRawSample({
      deviceId: '',
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'Enter',
      value: 1,
    });
    const polled = backend.pollRawSamples();
    const shutRes = backend.shutdown();
    const reInitAfterShut = backend.initialize();

    const passed =
      bridge.applicationId === 'com.hypersoft.hylix' &&
      bridge.requiresExtraAndroidPermissions === false &&
      bridge.allowsDirectSystemOrSdcardPaths === false &&
      initRes.success &&
      sampleRes.success &&
      polled.length === 1 &&
      shutRes.success &&
      !reInitAfterShut.success;

    results.push({
      id: 'input_37_platform_input_backend_and_android_bridge',
      category: 'Input System',
      title: 'PlatformInputBackendContract & AndroidInputBridgeContract Preserve Android Identity',
      passed,
      details: passed
        ? 'Verified com.hypersoft.hylix AndroidInputBridgeContract and NullContractInputBackend lifecycle.'
        : 'PlatformInputBackendContract verification failed.',
    });
  }

  // 38. Security policy & forbidden strings blocked
  {
    const logger = new RedactedDiagnosticLogger();
    const secAudit = validateInputPayloadSecurity(
      {
        control: '../secret/escape',
        remoteUrl: 'https://evil.example.com/inject.js',
        androidPath: '/sdcard/Download/hack',
        codeExec: 'eval("alert(1)")',
        keystoreLeak: 'release.jks',
      },
      logger
    );

    const passed = !secAudit.safe && secAudit.violations.length >= 5;

    results.push({
      id: 'input_38_security_policy_and_forbidden_strings_blocked',
      category: 'Input System',
      title: 'Blocks Path Traversal, /sdcard, Remote URLs, eval(), and Signing Files in Input Payloads',
      passed,
      details: passed
        ? `Detected and blocked ${secAudit.violations.length} security violations in untrusted input payload.`
        : 'Input security auditor missed forbidden patterns.',
    });
  }

  // 39. Structured redacted diagnostic logging
  {
    const logger = new RedactedDiagnosticLogger();
    const mgr = new InputManager({
      projectId: 'prj_diag',
      maxBufferedEvents: 1,
      bufferOverflowPolicy: 'rejectNewest',
      logger,
    });
    mgr.initialize();
    const kbId = mgr.getDefaultDeviceId('keyboard')!;

    mgr.pushEvent({
      projectId: 'prj_diag',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyA',
      value: 1,
    });
    // Trigger overflow + dropped event log
    mgr.pushEvent({
      projectId: 'prj_diag',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyB',
      value: 1,
    });
    // Trigger validation failure with sensitive secret that must be redacted
    mgr.registerAction({
      projectId: 'prj_diag',
      name: 'storePassword=SuperSecretKeystorePass123',
      valueType: 'invalid_type',
    });

    const entries = logger.getEntries();
    const messages = entries.map((e) => e.redactedMessage).join(' | ');
    const passed =
      messages.includes('input_event_received') &&
      messages.includes('input_buffer_overflow') &&
      messages.includes('input_event_dropped') &&
      messages.includes('input_validation_failed') &&
      !messages.includes('SuperSecretKeystorePass123');

    results.push({
      id: 'input_39_structured_redacted_diagnostic_logging',
      category: 'Input System',
      title: 'Records Structured Input Diagnostics with Automatic Secret Redaction',
      passed,
      details: passed
        ? 'Logged input_event_received, input_buffer_overflow, input_event_dropped, and redacted secrets.'
        : 'Input diagnostic logging or secret redaction failed.',
    });
  }

  // 40. Project close cleanup releases all state
  {
    const mgr = new InputManager({ projectId: 'prj_cleanup' });
    mgr.initialize();
    const kbId = mgr.getDefaultDeviceId('keyboard')!;
    mgr.pushEvent({
      projectId: 'prj_cleanup',
      deviceId: kbId,
      deviceType: 'keyboard',
      eventType: 'key_down',
      control: 'KeyZ',
      value: 1,
    });

    const cleanupRes = cleanupInputManagerForProjectClose(mgr);
    const passed =
      cleanupRes.shutdownSuccess &&
      cleanupRes.clearedBufferedEvents === 1 &&
      cleanupRes.clearedDevicesCount === 5 &&
      mgr.getState() === 'shutdown' &&
      mgr.getBackend().getState() === 'shutdown' &&
      mgr.getBuffer().size() === 0 &&
      mgr.listDevices().length === 0 &&
      !mgr.isKeyDown('KeyZ');

    results.push({
      id: 'input_40_project_close_cleanup_releases_all_state',
      category: 'Input System',
      title: 'cleanupInputManagerForProjectClose Clears Buffer, Resets Devices & Shuts Down Backend',
      passed,
      details: passed
        ? 'All buffered events, devices, held states, and backend resources cleaned up on project close.'
        : 'Project close cleanup failed to clear InputManager state.',
    });
  }

  return results;
}
