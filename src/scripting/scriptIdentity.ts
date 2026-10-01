import { computeDeterministicChecksum } from '../storage/atomicStorage';
import {
  createScriptError,
  isForbiddenScriptString,
  ScriptValidationResult,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Deterministic Script Identity System
 *
 * Every Script, ScriptInstance, ScriptEvent, and ScriptWorld has a deterministic
 * `<prefix>_<16-hex>` identifier derived from canonical project-scoped seeds.
 * Never uses `Math.random()`, `Date.now()`, machine-specific paths, or network state.
 */

export type ScriptIdPrefix = 'script' | 'sinst' | 'sevt' | 'sworld';

export type ScriptId = `script_${string}`;
export type ScriptInstanceId = `sinst_${string}`;
export type ScriptEventId = `sevt_${string}`;
export type ScriptWorldId = `sworld_${string}`;

const SCRIPT_ID_REGEX_BY_PREFIX: Readonly<Record<ScriptIdPrefix, RegExp>> =
  Object.freeze({
    script: /^script_[a-f0-9]{16}$/i,
    sinst: /^sinst_[a-f0-9]{16}$/i,
    sevt: /^sevt_[a-f0-9]{16}$/i,
    sworld: /^sworld_[a-f0-9]{16}$/i,
  });

export function createDeterministicScriptPrefixedId<
  TPrefix extends ScriptIdPrefix,
>(prefix: TPrefix, canonicalSeed: string): `${TPrefix}_${string}` {
  const normalizedSeed = canonicalSeed.trim().replace(/\\/g, '/');
  const hex = computeDeterministicChecksum(
    `hylix_scripting_id::${prefix}::${normalizedSeed}`
  );
  return `${prefix}_${hex}` as `${TPrefix}_${string}`;
}

export function createDeterministicScriptId(
  projectId: string,
  entryPointOrCanonicalName: string
): ScriptId {
  const normEntry = entryPointOrCanonicalName.trim().replace(/\\/g, '/');
  return createDeterministicScriptPrefixedId(
    'script',
    `${projectId.trim()}::${normEntry}`
  );
}

export function createDeterministicScriptInstanceId(
  projectId: string,
  scriptId: ScriptId,
  entityIdOrSlot: string | null = 'global_0'
): ScriptInstanceId {
  const ownerKey =
    entityIdOrSlot && entityIdOrSlot.trim().length > 0
      ? entityIdOrSlot.trim()
      : 'global_0';
  return createDeterministicScriptPrefixedId(
    'sinst',
    `${projectId.trim()}::${scriptId}::${ownerKey}`
  );
}

export function createDeterministicScriptEventId(
  projectId: string,
  sequence: number,
  eventType: string,
  source: string
): ScriptEventId {
  return createDeterministicScriptPrefixedId(
    'sevt',
    `${projectId.trim()}::seq_${sequence}::${eventType.trim()}::${source.trim()}`
  );
}

export function createDeterministicScriptWorldId(
  projectId: string
): ScriptWorldId {
  return createDeterministicScriptPrefixedId(
    'sworld',
    `world::${projectId.trim()}`
  );
}

export function isValidScriptPrefixedId<TPrefix extends ScriptIdPrefix>(
  prefix: TPrefix,
  candidate: unknown
): candidate is `${TPrefix}_${string}` {
  if (typeof candidate !== 'string') return false;
  const regex = SCRIPT_ID_REGEX_BY_PREFIX[prefix];
  return Boolean(regex && regex.test(candidate));
}

export function isValidScriptId(candidate: unknown): candidate is ScriptId {
  return isValidScriptPrefixedId('script', candidate);
}

export function isValidScriptInstanceId(
  candidate: unknown
): candidate is ScriptInstanceId {
  return isValidScriptPrefixedId('sinst', candidate);
}

export function isValidScriptEventId(
  candidate: unknown
): candidate is ScriptEventId {
  return isValidScriptPrefixedId('sevt', candidate);
}

export function isValidScriptWorldId(
  candidate: unknown
): candidate is ScriptWorldId {
  return isValidScriptPrefixedId('sworld', candidate);
}

export function validateScriptId(
  candidate: unknown
): ScriptValidationResult<ScriptId> {
  if (typeof candidate !== 'string') {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `Script ID must be a string; received '${typeof candidate}'.`
        ),
      ],
    };
  }

  const sec = isForbiddenScriptString(candidate);
  if (sec.forbidden) {
    return {
      valid: false,
      value: null,
      errors: [createScriptError('SCRIPT_VALIDATION_ERROR', sec.reason!)],
    };
  }

  if (!isValidScriptId(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `Invalid ScriptId '${candidate}'. Expected format 'script_<16-hex>'.`
        ),
      ],
    };
  }

  return {
    valid: true,
    value: candidate.toLowerCase() as ScriptId,
    errors: [],
  };
}
