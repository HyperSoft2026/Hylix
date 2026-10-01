import {
  createScriptError,
  ScriptValidationResult,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Deterministic Script Instance & Runtime Lifecycle State Machines
 *
 * Instance Lifecycle:
 *   created -> initialized -> enabled <-> disabled -> destroyed
 *   created | initialized | enabled | disabled -> destroyed
 *
 * Runtime Lifecycle:
 *   uninitialized -> ready -> updating -> ready -> shutdown
 */

export type ScriptInstanceLifecycleState =
  | 'created'
  | 'initialized'
  | 'enabled'
  | 'disabled'
  | 'destroyed';

export type ScriptRuntimeLifecycleState =
  | 'uninitialized'
  | 'ready'
  | 'updating'
  | 'shutdown';

const ALLOWED_INSTANCE_TRANSITIONS: Readonly<
  Record<
    ScriptInstanceLifecycleState,
    readonly ScriptInstanceLifecycleState[]
  >
> = Object.freeze({
  created: Object.freeze(['initialized', 'destroyed'] as const),
  initialized: Object.freeze(['enabled', 'disabled', 'destroyed'] as const),
  enabled: Object.freeze(['disabled', 'destroyed'] as const),
  disabled: Object.freeze(['enabled', 'destroyed'] as const),
  destroyed: Object.freeze([] as const),
});

const ALLOWED_RUNTIME_TRANSITIONS: Readonly<
  Record<ScriptRuntimeLifecycleState, readonly ScriptRuntimeLifecycleState[]>
> = Object.freeze({
  uninitialized: Object.freeze(['ready', 'shutdown'] as const),
  ready: Object.freeze(['updating', 'shutdown'] as const),
  updating: Object.freeze(['ready', 'shutdown'] as const),
  shutdown: Object.freeze([] as const),
});

export function isValidScriptInstanceLifecycleTransition(
  from: ScriptInstanceLifecycleState,
  to: ScriptInstanceLifecycleState
): boolean {
  const allowed = ALLOWED_INSTANCE_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

export function validateScriptInstanceLifecycleTransition(
  instanceId: string,
  from: ScriptInstanceLifecycleState,
  to: ScriptInstanceLifecycleState
): ScriptValidationResult<ScriptInstanceLifecycleState> {
  if (!isValidScriptInstanceLifecycleTransition(from, to)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_LIFECYCLE_ERROR',
          `Illegal ScriptInstance '${instanceId}' lifecycle transition '${from}' -> '${to}'.`
        ),
      ],
    };
  }
  return { valid: true, value: to, errors: [] };
}

export function isValidScriptRuntimeLifecycleTransition(
  from: ScriptRuntimeLifecycleState,
  to: ScriptRuntimeLifecycleState
): boolean {
  const allowed = ALLOWED_RUNTIME_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

export function validateScriptRuntimeLifecycleTransition(
  from: ScriptRuntimeLifecycleState,
  to: ScriptRuntimeLifecycleState
): ScriptValidationResult<ScriptRuntimeLifecycleState> {
  if (!isValidScriptRuntimeLifecycleTransition(from, to)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_LIFECYCLE_ERROR',
          `Illegal ScriptRuntime lifecycle transition '${from}' -> '${to}'.`
        ),
      ],
    };
  }
  return { valid: true, value: to, errors: [] };
}
