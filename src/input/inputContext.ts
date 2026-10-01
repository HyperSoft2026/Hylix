import {
  createInputError,
  createInputId,
  InputActionId,
  InputContextId,
  InputDiagnosticError,
  InputValidationResult,
  isFiniteInputNumber,
  isForbiddenInputString,
  isPlainInputObject,
  isValidInputActionId,
  isValidInputContextId,
} from './inputTypes';

/**
 * Hylix V1.0.0 — Phase 08: Priority-Ordered InputContext System (Section 17)
 *
 * Contexts (`Editor`, `UI`, `Gameplay`, `Console`, `Debug`, etc.) are evaluated in
 * deterministic priority order (`priority DESC, contextId ASC`). Events consumed
 * by a higher-priority context are blocked from triggering lower-priority contexts.
 */

export interface InputContextDescriptor {
  readonly contextId: InputContextId;
  readonly projectId: string;
  readonly name: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly consumeMatchedEvents: boolean;
  readonly actionIds: readonly InputActionId[];
}

const ALLOWED_CONTEXT_KEYS: ReadonlySet<string> = new Set<string>([
  'contextId',
  'projectId',
  'name',
  'priority',
  'enabled',
  'consumeMatchedEvents',
  'actionIds',
]);

export function createDeterministicInputContextId(
  projectId: string,
  contextName: string
): InputContextId {
  return createInputId('context', `${projectId.trim()}::${contextName.trim()}`);
}

export function validateInputContextDescriptor(
  candidate: unknown
): InputValidationResult<InputContextDescriptor> {
  if (!isPlainInputObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createInputError(
          'INPUT_CONTEXT_INVALID',
          'InputContextDescriptor must be a non-null plain object.'
        ),
      ],
    };
  }

  const errors: InputDiagnosticError[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) {
      errors.push(
        createInputError(
          'INPUT_CONTEXT_INVALID',
          `Unexpected property '${key}' in InputContextDescriptor.`
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
        'INPUT_CONTEXT_INVALID',
        'InputContextDescriptor.projectId must be a non-empty string.'
      )
    );
  } else {
    const sec = isForbiddenInputString(candidate.projectId);
    if (sec.forbidden) {
      errors.push(createInputError('INPUT_CONTEXT_INVALID', sec.reason!));
    }
  }

  if (
    typeof candidate.name !== 'string' ||
    candidate.name.trim().length === 0 ||
    candidate.name.trim().length > 64
  ) {
    errors.push(
      createInputError(
        'INPUT_CONTEXT_INVALID',
        'InputContextDescriptor.name must be a non-empty string (1..64 chars).'
      )
    );
  } else {
    const sec = isForbiddenInputString(candidate.name);
    if (sec.forbidden) {
      errors.push(createInputError('INPUT_CONTEXT_INVALID', sec.reason!));
    }
  }

  const resolvedContextId =
    candidate.contextId !== undefined
      ? candidate.contextId
      : typeof candidate.projectId === 'string' &&
          typeof candidate.name === 'string'
        ? createDeterministicInputContextId(candidate.projectId, candidate.name)
        : '';

  if (!isValidInputContextId(resolvedContextId)) {
    errors.push(
      createInputError(
        'INPUT_CONTEXT_INVALID',
        `Invalid InputContextDescriptor.contextId '${String(resolvedContextId)}'. Expected context_<16-hex>.`
      )
    );
  }

  const priority = candidate.priority !== undefined ? candidate.priority : 100;
  if (
    !isFiniteInputNumber(priority) ||
    !Number.isInteger(priority) ||
    priority < -10000 ||
    priority > 10000
  ) {
    errors.push(
      createInputError(
        'INPUT_CONTEXT_INVALID',
        'InputContextDescriptor.priority must be an integer in [-10000, 10000].'
      )
    );
  }

  const enabled = candidate.enabled !== undefined ? candidate.enabled : true;
  if (typeof enabled !== 'boolean') {
    errors.push(
      createInputError(
        'INPUT_CONTEXT_INVALID',
        'InputContextDescriptor.enabled must be a boolean.'
      )
    );
  }

  const consumeMatchedEvents =
    candidate.consumeMatchedEvents !== undefined
      ? candidate.consumeMatchedEvents
      : true;
  if (typeof consumeMatchedEvents !== 'boolean') {
    errors.push(
      createInputError(
        'INPUT_CONTEXT_INVALID',
        'InputContextDescriptor.consumeMatchedEvents must be a boolean.'
      )
    );
  }

  const actionIds: InputActionId[] = [];
  if (candidate.actionIds !== undefined) {
    if (!Array.isArray(candidate.actionIds)) {
      errors.push(
        createInputError(
          'INPUT_CONTEXT_INVALID',
          'InputContextDescriptor.actionIds must be an array of action_<16-hex> IDs.'
        )
      );
    } else {
      const seen = new Set<InputActionId>();
      for (const id of candidate.actionIds) {
        if (!isValidInputActionId(id)) {
          errors.push(
            createInputError(
              'INPUT_ACTION_NOT_FOUND',
              `Invalid actionId '${String(id)}' in InputContextDescriptor.`
            )
          );
        } else if (!seen.has(id)) {
          seen.add(id);
          actionIds.push(id);
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  actionIds.sort((a, b) => a.localeCompare(b));

  return {
    valid: true,
    value: Object.freeze({
      contextId: resolvedContextId as InputContextId,
      projectId: (candidate.projectId as string).trim(),
      name: (candidate.name as string).trim(),
      priority: priority as number,
      enabled: enabled as boolean,
      consumeMatchedEvents: consumeMatchedEvents as boolean,
      actionIds: Object.freeze(actionIds),
    }),
    errors: [],
  };
}

/**
 * Sorts contexts deterministically by `priority DESC`, then `contextId ASC`.
 */
export function sortInputContextsByPriority(
  contexts: readonly InputContextDescriptor[]
): readonly InputContextDescriptor[] {
  return Object.freeze(
    contexts.slice().sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // Higher priority first
      }
      return a.contextId.localeCompare(b.contextId);
    })
  );
}
