import { isValidEntityId } from '../ecs/ecsCore';
import {
  createDeterministicScriptEventId,
  isValidScriptEventId,
  ScriptEventId,
} from './scriptIdentity';
import {
  createScriptError,
  estimateSerializedByteSize,
  isForbiddenScriptString,
  isPlainScriptObject,
  MAX_SCRIPT_EVENT_PAYLOAD_SIZE,
  ScriptDiagnosticError,
  ScriptValidationResult,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Deterministic Script Events & Bounded Payload Validation
 *
 * Canonical Event Types:
 * `ScriptInitialized | ScriptEnabled | ScriptDisabled | ScriptDestroyed | EntityCreated | EntityDestroyed | InputAction | Collision | Trigger | AudioEvent | Custom`
 *
 * Ordered deterministically by `sequence ASC, eventId ASC`.
 */

export type ScriptEventType =
  | 'ScriptInitialized'
  | 'ScriptEnabled'
  | 'ScriptDisabled'
  | 'ScriptDestroyed'
  | 'EntityCreated'
  | 'EntityDestroyed'
  | 'InputAction'
  | 'Collision'
  | 'Trigger'
  | 'AudioEvent'
  | 'Custom';

export const VALID_SCRIPT_EVENT_TYPES: ReadonlySet<ScriptEventType> =
  new Set<ScriptEventType>([
    'ScriptInitialized',
    'ScriptEnabled',
    'ScriptDisabled',
    'ScriptDestroyed',
    'EntityCreated',
    'EntityDestroyed',
    'InputAction',
    'Collision',
    'Trigger',
    'AudioEvent',
    'Custom',
  ]);

export type ScriptEventPayloadPrimitive = string | number | boolean | null;
export type ScriptEventPayloadValue =
  | ScriptEventPayloadPrimitive
  | readonly ScriptEventPayloadPrimitive[]
  | Readonly<Record<string, ScriptEventPayloadPrimitive>>;

export interface ScriptEvent {
  readonly eventId: ScriptEventId;
  readonly sequence: number;
  readonly source: string;
  readonly projectId: string;
  readonly entityId: string | null;
  readonly eventType: ScriptEventType;
  readonly customEventName: string | null;
  readonly payload: Readonly<Record<string, ScriptEventPayloadValue>>;
}

const ALLOWED_SCRIPT_EVENT_KEYS: ReadonlySet<string> = new Set<string>([
  'eventId',
  'sequence',
  'source',
  'projectId',
  'entityId',
  'eventType',
  'customEventName',
  'payload',
]);

function validateBoundedPayloadObject(
  candidate: unknown,
  maxBytes = MAX_SCRIPT_EVENT_PAYLOAD_SIZE
): ScriptValidationResult<Readonly<Record<string, ScriptEventPayloadValue>>> {
  if (candidate === undefined) {
    return { valid: true, value: Object.freeze({}), errors: [] };
  }

  if (!isPlainScriptObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          'ScriptEvent.payload must be a non-null plain object.'
        ),
      ],
    };
  }

  const byteSize = estimateSerializedByteSize(candidate);
  if (byteSize > maxBytes) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_BUDGET_EXCEEDED_ERROR',
          `ScriptEvent.payload size (${byteSize} bytes) exceeds MAX_SCRIPT_EVENT_PAYLOAD_SIZE (${maxBytes} bytes).`
        ),
      ],
    };
  }

  const errors: ScriptDiagnosticError[] = [];
  const normalized: Record<string, ScriptEventPayloadValue> = {};

  const checkPrimitive = (
    val: unknown,
    fieldPath: string
  ): ScriptEventPayloadPrimitive | undefined => {
    if (val === null || typeof val === 'boolean') return val;
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) {
        errors.push(
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            `${fieldPath} must be a finite number.`
          )
        );
        return undefined;
      }
      return val;
    }
    if (typeof val === 'string') {
      const sec = isForbiddenScriptString(val);
      if (sec.forbidden) {
        errors.push(createScriptError('SCRIPT_VALIDATION_ERROR', sec.reason!));
        return undefined;
      }
      return val;
    }
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        `${fieldPath} contains unsupported value type '${typeof val}'.`
      )
    );
    return undefined;
  };

  for (const [k, v] of Object.entries(candidate)) {
    const keySec = isForbiddenScriptString(k);
    if (keySec.forbidden) {
      errors.push(createScriptError('SCRIPT_VALIDATION_ERROR', keySec.reason!));
      continue;
    }

    if (Array.isArray(v)) {
      const arr: ScriptEventPayloadPrimitive[] = [];
      for (let i = 0; i < v.length; i++) {
        const p = checkPrimitive(v[i], `payload.${k}[${i}]`);
        if (p !== undefined) arr.push(p);
      }
      normalized[k] = Object.freeze(arr);
    } else if (isPlainScriptObject(v)) {
      const sub: Record<string, ScriptEventPayloadPrimitive> = {};
      for (const [sk, sv] of Object.entries(v)) {
        const subKeySec = isForbiddenScriptString(sk);
        if (subKeySec.forbidden) {
          errors.push(
            createScriptError('SCRIPT_VALIDATION_ERROR', subKeySec.reason!)
          );
          continue;
        }
        const p = checkPrimitive(sv, `payload.${k}.${sk}`);
        if (p !== undefined) sub[sk] = p;
      }
      normalized[k] = Object.freeze(sub);
    } else {
      const p = checkPrimitive(v, `payload.${k}`);
      if (p !== undefined) normalized[k] = p;
    }
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze(normalized),
    errors: [],
  };
}

export function createValidatedScriptEvent(
  candidate: unknown,
  maxPayloadBytes = MAX_SCRIPT_EVENT_PAYLOAD_SIZE
): ScriptValidationResult<ScriptEvent> {
  if (!isPlainScriptObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          'ScriptEvent must be a non-null plain object.'
        ),
      ],
    };
  }

  const errors: ScriptDiagnosticError[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_SCRIPT_EVENT_KEYS.has(key)) {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `Unexpected property '${key}' in ScriptEvent.`
        )
      );
    }
  }

  const sequence = candidate.sequence;
  if (
    typeof sequence !== 'number' ||
    !Number.isInteger(sequence) ||
    sequence < 1
  ) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        'ScriptEvent.sequence must be a positive integer >= 1.'
      )
    );
  }

  if (
    typeof candidate.projectId !== 'string' ||
    candidate.projectId.trim().length === 0
  ) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        'ScriptEvent.projectId must be a non-empty string.'
      )
    );
  } else {
    const sec = isForbiddenScriptString(candidate.projectId);
    if (sec.forbidden) {
      errors.push(createScriptError('SCRIPT_VALIDATION_ERROR', sec.reason!));
    }
  }

  if (
    typeof candidate.source !== 'string' ||
    candidate.source.trim().length === 0 ||
    candidate.source.trim().length > 64
  ) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        'ScriptEvent.source must be a non-empty string (1..64 chars).'
      )
    );
  } else {
    const sec = isForbiddenScriptString(candidate.source);
    if (sec.forbidden) {
      errors.push(createScriptError('SCRIPT_VALIDATION_ERROR', sec.reason!));
    }
  }

  if (
    typeof candidate.eventType !== 'string' ||
    !VALID_SCRIPT_EVENT_TYPES.has(candidate.eventType as ScriptEventType)
  ) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        `Invalid ScriptEvent.eventType '${String(candidate.eventType)}'.`
      )
    );
  }

  const entityId =
    candidate.entityId !== undefined && candidate.entityId !== null
      ? candidate.entityId
      : null;
  if (entityId !== null && !isValidEntityId(entityId)) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        `Invalid ScriptEvent.entityId '${String(entityId)}'. Expected 'ent_<16-hex>' or null.`
      )
    );
  }

  const customEventName =
    candidate.customEventName !== undefined &&
    candidate.customEventName !== null
      ? candidate.customEventName
      : null;
  if (customEventName !== null) {
    if (
      typeof customEventName !== 'string' ||
      customEventName.trim().length === 0 ||
      customEventName.trim().length > 64
    ) {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          'ScriptEvent.customEventName must be a non-empty string (1..64 chars) or null.'
        )
      );
    } else {
      const sec = isForbiddenScriptString(customEventName);
      if (sec.forbidden) {
        errors.push(createScriptError('SCRIPT_VALIDATION_ERROR', sec.reason!));
      }
    }
  }

  const payloadCheck = validateBoundedPayloadObject(
    candidate.payload,
    maxPayloadBytes
  );
  if (!payloadCheck.valid || !payloadCheck.value) {
    errors.push(...payloadCheck.errors);
  }

  if (errors.length > 0 || !payloadCheck.value) {
    return { valid: false, value: null, errors };
  }

  const resolvedEventId =
    candidate.eventId !== undefined
      ? candidate.eventId
      : createDeterministicScriptEventId(
          candidate.projectId as string,
          sequence as number,
          candidate.eventType as string,
          candidate.source as string
        );

  if (!isValidScriptEventId(resolvedEventId)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `Invalid ScriptEvent.eventId '${String(resolvedEventId)}'. Expected 'sevt_<16-hex>'.`
        ),
      ],
    };
  }

  return {
    valid: true,
    value: Object.freeze({
      eventId: resolvedEventId.toLowerCase() as ScriptEventId,
      sequence: sequence as number,
      source: (candidate.source as string).trim(),
      projectId: (candidate.projectId as string).trim(),
      entityId: entityId as string | null,
      eventType: candidate.eventType as ScriptEventType,
      customEventName:
        typeof customEventName === 'string' ? customEventName.trim() : null,
      payload: payloadCheck.value,
    }),
    errors: [],
  };
}

/**
 * Sorts `ScriptEvent` records deterministically by `sequence ASC, eventId ASC`.
 */
export function sortScriptEventsDeterministically(
  events: readonly ScriptEvent[]
): readonly ScriptEvent[] {
  return Object.freeze(
    events.slice().sort((a, b) => {
      if (a.sequence !== b.sequence) {
        return a.sequence - b.sequence;
      }
      return a.eventId.localeCompare(b.eventId);
    })
  );
}
