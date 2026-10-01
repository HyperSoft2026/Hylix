# Hylix V1.0.0 — Scripting System + Runtime Sandbox Specification

**Project**: Hylix  
**Organization**: HyperSoft  
**Phase**: Phase 09 — Scripting System + Runtime Sandbox (`src/scripting/`)

---

## 1. Architectural & Security Boundary Statement

> **Phase 09 provides the scripting security boundary and runtime contracts; execution of untrusted source requires a dedicated isolated runtime implementation in a future phase.**

Hylix Scripting System (`src/scripting/`) is built **100% from scratch** with **zero external game engines** (`Unity`, `Unreal`, `Godot`, `Three.js`, `Phaser`, etc.) and **zero arbitrary code execution**:
- **Strictly Forbidden**: `eval()`, `Function()`, `new Function()`, `vm.runInThisContext()`, `vm.runInNewContext()`, `child_process`, `exec()`, `spawn()`, dynamic `import()` of user scripts, shell execution, arbitrary filesystem access, or network calls.
- **100% Local-First & Offline**: Does not depend on `server.js`, GitHub, or network connectivity.

---

## 2. Modular Directory Structure (`src/scripting/`)

| Module | Responsibility |
| :--- | :--- |
| `src/scripting/scriptTypes.ts` | Resource limits (`MAX_SCRIPTS_PER_PROJECT`, `MAX_SCRIPT_INSTANCES`, `MAX_SCRIPT_INSTRUCTIONS_PER_FRAME`, etc.), categories, languages, phases, and redacted `HylixScriptError` hierarchy. |
| `src/scripting/scriptIdentity.ts` | Deterministic `<prefix>_<16-hex>` IDs (`script_`, `sinst_`, `sevt_`, `sworld_`) derived from project-scoped canonical seeds. |
| `src/scripting/scriptCapabilities.ts` | Explicit capability system (`ReadEntity`, `WriteEntity`, `ReadTransform`, `WriteTransform`, `ReadInput`, `EmitEvent`, `PlayAudio`, `PhysicsQuery`, `Log`, `ReadTime`, `ReadAsset`, `WriteRenderMetadata`) with least-privilege default (`['ReadTime']`). |
| `src/scripting/scriptPermissions.ts` | `ScriptPermissionPolicy` separating script capability requests from runtime permission policy (`allowedCapabilities`, `deniedCapabilities` with explicit deny precedence, `allowEditorCategoryExecution: false` by default, and resource budgets). |
| `src/scripting/scriptSource.ts` | Validated `ScriptSource` metadata (`relativeSourcePath` strictly inside `scripts/`, SHA-256 `sourceHash`, semver, bounded metadata) and extensible language registry (`TypeScript`, `JavaScript`, `HylixScript`, `FutureNative` reserved). |
| `src/scripting/scriptManifest.ts` | `ScriptManifest` validation, dependency limits (`MAX_SCRIPT_DEPENDENCIES = 16`), and self-dependency rejection. |
| `src/scripting/scriptRegistry.ts` | Project-isolated `ScriptRegistry` with duplicate `scriptId`/`entryPoint` protection and circular dependency detection (`A -> B -> A`). |
| `src/scripting/scriptLifecycle.ts` | Deterministic state machines for `ScriptInstance` (`created -> initialized -> enabled <-> disabled -> destroyed`) and `ScriptRuntime` (`uninitialized -> ready -> updating -> ready -> shutdown`). |
| `src/scripting/scriptInstance.ts` | `ScriptInstanceController` & immutable `ScriptInstanceDescriptor` with per-instance execution statistics. |
| `src/scripting/scriptSandbox.ts` | `ScriptSandbox` enforcing capability/permission checks, project ownership, entity/asset ownership, payload bounds, and per-frame execution budgets. |
| `src/scripting/scriptEvents.ts` | Deterministic `ScriptEvent` validation (`MAX_SCRIPT_EVENT_PAYLOAD_SIZE = 4096`), canonical event types, and sorting (`sequence ASC, eventId ASC`). |
| `src/scripting/scriptScheduler.ts` | Deterministic `ScriptScheduler` ordering eligible instances by `executionPriority ASC, scriptId ASC, instanceId ASC` across `Initialization`, `FixedUpdate`, `Update`, `LateUpdate`, `Event`, and `Shutdown`. |
| `src/scripting/scriptApi.ts` | Controlled engine-facing `ScriptApiContract` (`entity`, `transform`, `input`, `physics`, `audio`, `rendering`, `assets`, `time`, `events`, `log`). |
| `src/scripting/scriptBindings.ts` | Controlled subsystem bridge enforcing read/write separation and project ownership across ECS, Input, Physics, Audio, Rendering metadata, and AssetRegistry. |
| `src/scripting/scriptContext.ts` | `ScriptContext` — the sole capability-gated, budget-accounted bridge between a `ScriptInstance` and `ScriptBindings`. |
| `src/scripting/scriptRuntime.ts` | Project-isolated `ScriptRuntime` (`ScriptWorld`) coordinating registry, sandbox, bindings, scheduler, event queue, and platform backend. |
| `src/scripting/scriptExtraction.ts` | Official ECS `ScriptBehavior` component and one-way `extractSceneScriptingData` / `syncSceneToScriptRuntime` without mutating `SceneDefinition`. |
| `src/scripting/scriptIntegration.ts` | `registerProjectScriptAsset`, `cleanupScriptRuntimeForProjectClose`, and Android/Platform script runtime contracts. |
| `src/scripting/scriptDiagnostics.ts` | Redacted `inspectScriptRuntimeDiagnostics` snapshot with zero secret or source code leakage. |
| `src/scripting/scriptValidation.ts` | Recursive `validateScriptPayloadSecurity` auditor and barrel exports. |

---

## 3. Verification Coverage

`src/testing/scriptingVerification.ts` provides **40 automated assertions** (`script_01` through `script_40`) integrated into `npm test` (`263 / 263` total checks).
