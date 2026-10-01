import {
  computeAssetContentHash,
  isValidContentHash,
} from '../assets/contentHash';
import { validateWorkspaceRelativePath } from '../security/securityFoundation';
import {
  createDeterministicScriptId,
  isValidScriptId,
  ScriptId,
} from './scriptIdentity';
import {
  createScriptError,
  estimateSerializedByteSize,
  isForbiddenScriptString,
  isPlainScriptObject,
  MAX_SCRIPT_METADATA_SIZE,
  MAX_SCRIPT_VERSION_LENGTH,
  RESERVED_SCRIPT_LANGUAGES,
  ScriptDiagnosticError,
  ScriptLanguage,
  ScriptValidationResult,
  SUPPORTED_SCRIPT_LANGUAGES,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Safe ScriptSource & Extensible Language Registry
 *
 * Represents validated script source metadata (`scriptId`, `projectId`, `relativeSourcePath`,
 * `language`, `sourceHash`, `version`, `metadata`) without executing any source code.
 */

export interface ScriptLanguageDescriptor {
  readonly language: ScriptLanguage;
  readonly supportedInFoundation: boolean;
  readonly reservedForFuture: boolean;
  readonly allowedExtensions: readonly string[];
  readonly executesDynamicallyInPhase09: false;
}

export const SCRIPT_LANGUAGE_REGISTRY: Readonly<
  Record<ScriptLanguage, ScriptLanguageDescriptor>
> = Object.freeze({
  TypeScript: Object.freeze({
    language: 'TypeScript',
    supportedInFoundation: true,
    reservedForFuture: false,
    allowedExtensions: Object.freeze(['.ts'] as const),
    executesDynamicallyInPhase09: false,
  }),
  JavaScript: Object.freeze({
    language: 'JavaScript',
    supportedInFoundation: true,
    reservedForFuture: false,
    allowedExtensions: Object.freeze(['.js', '.mjs'] as const),
    executesDynamicallyInPhase09: false,
  }),
  HylixScript: Object.freeze({
    language: 'HylixScript',
    supportedInFoundation: true,
    reservedForFuture: false,
    allowedExtensions: Object.freeze(['.hylixscript', '.hx'] as const),
    executesDynamicallyInPhase09: false,
  }),
  FutureNative: Object.freeze({
    language: 'FutureNative',
    supportedInFoundation: false,
    reservedForFuture: true,
    allowedExtensions: Object.freeze(['.hylixnative'] as const),
    executesDynamicallyInPhase09: false,
  }),
  Unknown: Object.freeze({
    language: 'Unknown',
    supportedInFoundation: false,
    reservedForFuture: false,
    allowedExtensions: Object.freeze([] as const),
    executesDynamicallyInPhase09: false,
  }),
});

export function isSupportedScriptLanguage(
  candidate: unknown
): candidate is ScriptLanguage {
  return (
    typeof candidate === 'string' &&
    SUPPORTED_SCRIPT_LANGUAGES.has(candidate as ScriptLanguage)
  );
}

export function validateScriptLanguage(
  candidate: unknown
): ScriptValidationResult<ScriptLanguage> {
  if (typeof candidate !== 'string') {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          'Script language must be a string.'
        ),
      ],
    };
  }

  if (RESERVED_SCRIPT_LANGUAGES.has(candidate as ScriptLanguage)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `Script language '${candidate}' is reserved for a future phase and cannot be registered as an active script in Phase 09.`
        ),
      ],
    };
  }

  if (!isSupportedScriptLanguage(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `Unsupported script language '${candidate}'. Supported languages: TypeScript, JavaScript, HylixScript.`
        ),
      ],
    };
  }

  return {
    valid: true,
    value: candidate,
    errors: [],
  };
}

export interface ScriptSource {
  readonly scriptId: ScriptId;
  readonly projectId: string;
  readonly relativeSourcePath: string;
  readonly language: ScriptLanguage;
  readonly sourceHash: string;
  readonly version: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

const ALLOWED_SCRIPT_SOURCE_KEYS: ReadonlySet<string> = new Set<string>([
  'scriptId',
  'projectId',
  'relativeSourcePath',
  'language',
  'sourceHash',
  'sourceTextForHashingOnly',
  'version',
  'metadata',
]);

export function validateScriptRelativePath(
  rawPath: unknown
): ScriptValidationResult<string> {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          'Script source/entryPoint path must be a non-empty string.'
        ),
      ],
    };
  }

  const sec = isForbiddenScriptString(rawPath);
  if (sec.forbidden) {
    return {
      valid: false,
      value: null,
      errors: [createScriptError('SCRIPT_VALIDATION_ERROR', sec.reason!)],
    };
  }

  const wsCheck = validateWorkspaceRelativePath(rawPath);
  if (!wsCheck.safe) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          wsCheck.reason ?? `Unsafe script path '${rawPath}'.`
        ),
      ],
    };
  }

  const norm = wsCheck.normalizedPath;
  if (
    norm.startsWith('cache/') ||
    norm.startsWith('build/') ||
    norm.startsWith('.hylix/') ||
    !norm.startsWith('scripts/')
  ) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `Script path '${norm}' must reside inside 'scripts/' and never inside 'cache/', 'build/', or '.hylix/'.`
        ),
      ],
    };
  }

  return {
    valid: true,
    value: norm,
    errors: [],
  };
}

export function createValidatedScriptSource(
  candidate: unknown
): ScriptValidationResult<ScriptSource> {
  if (!isPlainScriptObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          'ScriptSource must be a non-null plain object.'
        ),
      ],
    };
  }

  const errors: ScriptDiagnosticError[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_SCRIPT_SOURCE_KEYS.has(key)) {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `Unexpected property '${key}' in ScriptSource.`
        )
      );
    }
  }

  if (
    typeof candidate.projectId !== 'string' ||
    candidate.projectId.trim().length === 0
  ) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        'ScriptSource.projectId must be a non-empty string.'
      )
    );
  } else {
    const sec = isForbiddenScriptString(candidate.projectId);
    if (sec.forbidden) {
      errors.push(createScriptError('SCRIPT_VALIDATION_ERROR', sec.reason!));
    }
  }

  const pathCheck = validateScriptRelativePath(candidate.relativeSourcePath);
  if (!pathCheck.valid || !pathCheck.value) {
    errors.push(...pathCheck.errors);
  }

  const langCheck = validateScriptLanguage(candidate.language);
  if (!langCheck.valid || !langCheck.value) {
    errors.push(...langCheck.errors);
  }

  const resolvedScriptId =
    candidate.scriptId !== undefined
      ? candidate.scriptId
      : typeof candidate.projectId === 'string' && pathCheck.value
        ? createDeterministicScriptId(candidate.projectId, pathCheck.value)
        : '';

  if (!isValidScriptId(resolvedScriptId)) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        `Invalid ScriptSource.scriptId '${String(resolvedScriptId)}'. Expected 'script_<16-hex>'.`
      )
    );
  }

  const resolvedHash =
    typeof candidate.sourceHash === 'string'
      ? candidate.sourceHash
      : typeof candidate.sourceTextForHashingOnly === 'string'
        ? computeAssetContentHash(candidate.sourceTextForHashingOnly)
        : '';

  if (!isValidContentHash(resolvedHash)) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        `Invalid ScriptSource.sourceHash '${String(resolvedHash)}'. Expected 'sha256:<64-lowercase-hex>'.`
      )
    );
  }

  const version =
    candidate.version !== undefined ? candidate.version : '1.0.0';
  if (
    typeof version !== 'string' ||
    version.trim().length === 0 ||
    version.trim().length > MAX_SCRIPT_VERSION_LENGTH ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9._-]+)?$/.test(version.trim())
  ) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        `Invalid ScriptSource.version '${String(version)}'. Expected semver format (e.g. '1.0.0').`
      )
    );
  }

  const validatedMeta: Record<string, string | number | boolean> = {};
  if (candidate.metadata !== undefined) {
    if (!isPlainScriptObject(candidate.metadata)) {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          'ScriptSource.metadata must be a plain object.'
        )
      );
    } else if (
      estimateSerializedByteSize(candidate.metadata) > MAX_SCRIPT_METADATA_SIZE
    ) {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `ScriptSource.metadata exceeds MAX_SCRIPT_METADATA_SIZE (${MAX_SCRIPT_METADATA_SIZE} bytes).`
        )
      );
    } else {
      for (const [k, v] of Object.entries(candidate.metadata)) {
        const keySec = isForbiddenScriptString(k);
        if (keySec.forbidden) {
          errors.push(
            createScriptError('SCRIPT_VALIDATION_ERROR', keySec.reason!)
          );
          continue;
        }
        if (typeof v === 'string') {
          const valSec = isForbiddenScriptString(v);
          if (valSec.forbidden) {
            errors.push(
              createScriptError('SCRIPT_VALIDATION_ERROR', valSec.reason!)
            );
            continue;
          }
          validatedMeta[k] = v;
        } else if (
          (typeof v === 'number' && Number.isFinite(v)) ||
          typeof v === 'boolean'
        ) {
          validatedMeta[k] = v;
        } else {
          errors.push(
            createScriptError(
              'SCRIPT_VALIDATION_ERROR',
              `Metadata field '${k}' must be a finite number, boolean, or safe string.`
            )
          );
        }
      }
    }
  }

  if (errors.length > 0 || !pathCheck.value || !langCheck.value) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      scriptId: (resolvedScriptId as string).toLowerCase() as ScriptId,
      projectId: (candidate.projectId as string).trim(),
      relativeSourcePath: pathCheck.value,
      language: langCheck.value,
      sourceHash: resolvedHash,
      version: (version as string).trim(),
      metadata: Object.freeze(validatedMeta),
    }),
    errors: [],
  };
}
