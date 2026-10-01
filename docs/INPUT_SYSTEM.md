# Hylix V1.0.0 — Input System + Device Abstraction Specification

**Project**: Hylix  
**Organization**: HyperSoft  
**Phase**: Phase 08 — Input System + Device Abstraction (`src/input/`)

---

## 1. Input Architecture Overview

Hylix Input is built from scratch by HyperSoft as a **platform-independent, deterministic, Local-First Input System & Device Abstraction**. It does not wrap or depend on Unity Input System, Unreal Enhanced Input, Godot Input, SDL, GLFW, libinput, Phaser Input, or React DOM event systems.

### End-to-End Deterministic Input Pipeline

```text
PlatformInputBackendContract (AndroidMotionAndKeyEventContract / NullContractInputBackend)
  ↓
Bounded InputBuffer (MAX_INPUT_EVENTS + Sequence Ordering + Non-Destructive consume())
  ↓
Device State Trackers (KeyboardInput, MouseInput, TouchInput, GamepadInput, Virtual)
  ↓
Touch GestureRecognizer (tap, doubleTap, longPress, swipe)
  ↓
Priority-Ordered InputContext Evaluation (Editor, UI, Gameplay, Console, Debug)
  ↓
InputActionMap & Axis Processing (deadZone, sensitivity, invert, scale, [-1, 1] clamp)
  ↓
Read-Only GameplayInputSnapshot & ECS InputReceiver Evaluation
```

---

## 2. Module Structure (`src/input/`)

| File | Responsibility |
| :--- | :--- |
| `inputTypes.ts` | Deterministic IDs (`input_`, `device_`, `event_`, `action_`, `binding_`, `context_`), lifecycle states, error codes, digital phase transitions, and `processAxisValue`. |
| `inputDevice.ts` | Active device types (`keyboard`, `mouse`, `touch`, `gamepad`, `virtual`), reserved future types (`pen`, `joystick`, `motion`, `sensor`), and honest `InputDeviceCapabilities`. |
| `inputEvent.ts` | Deeply frozen `InputEvent` validation and deterministic sorting (`sequence ASC, deviceId ASC, eventId ASC`). |
| `inputBuffer.ts` | Bounded `InputBuffer` enforcing `MAX_INPUT_EVENTS` (`rejectNewest`, `dropOldest`) and per-event `consume()` tracking without deleting frame history. |
| `inputState.ts` | Frame-rate independent `InputState` tracking `currentValue`, `previousValue`, `pressed`, `held`, `released`, and `phase`. |
| `keyboardInput.ts` | Canonical platform-independent key codes (`KeyA`..`KeyZ`, `Digit0`..`Digit9`, `ArrowUp`, `Space`, `Escape`, `F1`..`F12`) and OS key-repeat suppression. |
| `mouseInput.ts` | Pointer `position`, per-tick `delta`, scroll `wheel`, and canonical buttons (`MouseLeft`..`MouseButton5`) decoupled from viewport/world space. |
| `touchInput.ts` | Multi-touch point tracking (`touchId = 0, 1, 2...`), phases (`began`, `moved`, `stationary`, `ended`, `cancelled`), and honest `pressure: number \| null`. |
| `gamepadInput.ts` | Canonical Gamepad buttons (`A, B, X, Y, Start, Select, L1, R1, L2, R2, DPad*`) in `[0, 1]` and axes (`LeftX/Y`, `RightX/Y`, `TriggerL/R`) in `[-1, 1]`. |
| `gestureInput.ts` | Deterministic `GestureRecognizer` detecting `tap`, `doubleTap`, `longPress`, and directional `swipe` (`left`, `right`, `up`, `down`). |
| `inputAction.ts` | `InputActionDescriptor` and `InputActionEvaluatedState` supporting `button`, `axis1D`, `axis2D`, and `axis3D` actions. |
| `inputMap.ts` | `InputBindingDescriptor` and `InputActionMap` supporting multi-device bindings per action (`Keyboard + Gamepad + Touch + Virtual`). |
| `inputContext.ts` | `InputContextDescriptor` and deterministic priority sorting (`priority DESC, contextId ASC`). |
| `inputManager.ts` | Project-isolated `InputManager` state machine, deterministic tick `update()`, priority context consumption, and replay recording/playback. |
| `inputExtraction.ts` | Official ECS `InputReceiver` component, `SceneDefinition.inputConfig` contract, and read-only `extractSceneInputData`. |
| `inputIntegration.ts` | Pure coordinate conversion (`screenToNormalizedViewportPosition`, `normalizedViewportToWorld2D`), `createGameplayInputSnapshot`, `evaluateSceneInputReceivers`, and `cleanupInputManagerForProjectClose`. |
| `inputValidation.ts` | Security policy auditor (`validateInputPayloadSecurity`) and barrel exports. |

---

## 3. InputManager Lifecycle & Digital Control Phases

### `InputLifecycleState`
```text
uninitialized -> initializing -> ready -> processing -> ready
uninitialized | initializing | ready | processing -> shutdown
```
Transitions out of `shutdown` (`shutdown -> initializing`, `shutdown -> ready`) are strictly rejected with `INPUT_ILLEGAL_STATE_TRANSITION`.

### `DigitalControlPhase`
```text
idle -> pressed -> held -> released -> idle
```
- Transitions depend exclusively on deterministic simulation ticks and ordered events, never on rendering FPS or `timestampMs` jitter.
- Disconnecting or disabling any device immediately resets its held controls to `idle` so keys/buttons never remain stuck down.

---

## 4. Priority-Ordered InputContext & Event Consumption

- Contexts (`Editor`, `UI`, `Gameplay`, `Console`, `Debug`) are evaluated in deterministic priority order: **`priority DESC, contextId ASC`**.
- When a higher-priority enabled context (`UI`, `priority: 200`) triggers an action with `consumeMatchedEvents: true` and `binding.consumeEvent: true`, the underlying control and `InputEvent` are marked consumed for the current tick.
- Lower-priority contexts (`Gameplay`, `priority: 100`) bound to the same physical control (`Keyboard::Space`) are automatically blocked from triggering on that consumed event.
- Calling `InputBuffer.consume(eventId, contextId)` marks the event as consumed without deleting it from internal frame history.

---

## 5. Multi-Touch, Gestures & Android-First Platform Contract

- **Honest Touch Pressure**: When `supportsTouchPressure === false` on the active device/backend, `TouchPointState.pressure` is strictly `null` (never fabricated).
- **Virtual Controls**: Supports Android on-screen virtual buttons and joysticks (`deviceType: 'virtual'`) mapped directly into `InputActionMap`.
- **Platform Input Backend (`src/platform/platformAbstraction.ts`)**: `PlatformInputBackendContract`, `NullContractInputBackend`, and `AndroidInputBridgeContract` (`com.hypersoft.hylix`, zero extra Android permissions, zero direct `/sdcard` paths).
