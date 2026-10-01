import {
  ScriptCapability,
  validateScriptCapabilityList,
} from './scriptCapabilities';
import {
  createDeterministicScriptId,
  isValidScriptId,
  ScriptId,
} from './scriptIdentity';
import {
  validateScriptLanguage,
  validateScriptRelativePath,
} from './scriptSource';
import {
  createScriptError,
  CURRENT_SCRIPT_MANIFEST_SCHEMA_VERSION,
  isForbiddenScriptString,
  isPlainScriptObject,
  MAX_SCRIPT_DEPENDENCIES,
  MAX_SCRIPT_NAME_LENGTH,
  MAX_SCRIPT_VERSION_LENGTH,
  ScriptCategory,
  ScriptDiagnosticError,
  ScriptLanguage,
  ScriptValidationResult,
  VALID_SCRIPT_CATEGORIES,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: Validated Script Manifest Contract
 *
 * Schema:
 * - `schemaVersion`
 * - `scriptId` (`script_<16-hex>`)
 * - `projectId`
 * - `name`
 * - `category` (`Gameplay | Component | System | Editor | Utility`)
 * - `language` (`TypeScript | JavaScript | HylixScript`)
 * - `entryPoint` (must reside in `scripts/` inside project workspace)
 * - `capabilities` (explicit least-privilege declaration)
 * - `dependencies` (array of `script_<16-hex>`, max `MAX_SCRIPT_DEPENDENCIES`, no self-dependency)
 * - `version` (semver)
 */

export interface ScriptManifest {
  readonly schemaVersion: number;
  readonly scriptId: ScriptId;
  readonly projectId: string;
  readonly name: string;
  readonly category: ScriptCategory;
  readonly language: ScriptLanguage;
  readonly entryPoint: string;
  readonly capabilities: readonly ScriptCapability[];
  readonly dependencies: readonly ScriptId[];
  readonly version: string;
}

const ALLOWED_MANIFEST_KEYS: ReadonlySet<string> = new Set<string>([
  'schemaVersion',
  'scriptId',
  'projectId',
  'name',
  'category',
  'language',
  'entryPoint',
  'capabilities',
  'dependencies',
  'version',
]);

export function validateScriptManifest(
  candidate: unknown
): ScriptValidationResult<ScriptManifest> {
  if (!isPlainScriptObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          'ScriptManifest must be a non-null plain object.'
        ),
      ],
    };
  }

  const errors: ScriptDiagnosticError[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_MANIFEST_KEYS.has(key)) {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `Unexpected or forbidden property '${key}' in ScriptManifest.`
        )
      );
    }
  }

  const schemaVersion =
    candidate.schemaVersion !== undefined
      ? candidate.schemaVersion
      : CURRENT_SCRIPT_MANIFEST_SCHEMA_VERSION;
  if (schemaVersion !== CURRENT_SCRIPT_MANIFEST_SCHEMA_VERSION) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        `Unsupported ScriptManifest.schemaVersion '${String(schemaVersion)}'. Expected ${CURRENT_SCRIPT_MANIFEST_SCHEMA_VERSION}.`
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
        'ScriptManifest.projectId must be a non-empty string.'
      )
    );
  } else {
    const sec = isForbiddenScriptString(candidate.projectId);
    if (sec.forbidden) {
      errors.push(createScriptError('SCRIPT_VALIDATION_ERROR', sec.reason!));
    }
  }

  if (
    typeof candidate.name !== 'string' ||
    candidate.name.trim().length === 0 ||
    candidate.name.trim().length > MAX_SCRIPT_NAME_LENGTH
  ) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        `ScriptManifest.name must be a non-empty string (1..${MAX_SCRIPT_NAME_LENGTH} chars).`
      )
    );
  } else {
    const sec = isForbiddenScriptString(candidate.name);
    if (sec.forbidden) {
      errors.push(createScriptError('SCRIPT_VALIDATION_ERROR', sec.reason!));
    } else if (!/^[A-Za-z][A-Za-z0-9_ -]{0,63}$/.test(candidate.name.trim())) {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `Invalid ScriptManifest.name '${candidate.name}'. Must start with a letter and contain only alphanumeric, underscore, hyphen, or space characters.`
        )
      );
    }
  }

  const category =
    candidate.category !== undefined ? candidate.category : 'Gameplay';
  if (
    typeof category !== 'string' ||
    !VALID_SCRIPT_CATEGORIES.has(category as ScriptCategory)
  ) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        `Invalid ScriptManifest.category '${String(category)}'. Expected Gameplay, Component, System, Editor, or Utility.`
      )
    );
  }

  const langCheck = validateScriptLanguage(candidate.language);
  if (!langCheck.valid || !langCheck.value) {
    errors.push(...langCheck.errors);
  }

  const entryCheck = validateScriptRelativePath(candidate.entryPoint);
  if (!entryCheck.valid || !entryCheck.value) {
    errors.push(...entryCheck.errors);
  }

  const resolvedScriptId =
    candidate.scriptId !== undefined
      ? candidate.scriptId
      : typeof candidate.projectId === 'string' && entryCheck.value
        ? createDeterministicScriptId(candidate.projectId, entryCheck.value)
        : '';

  if (!isValidScriptId(resolvedScriptId)) {
    errors.push(
      createScriptError(
        'SCRIPT_VALIDATION_ERROR',
        `Invalid ScriptManifest.scriptId '${String(resolvedScriptId)}'. Expected 'script_<16-hex>'.`
      )
    );
  }

  const capCheck = validateScriptCapabilityList(candidate.capabilities, true);
  if (!capCheck.valid || !capCheck.value) {
    errors.push(...capCheck.errors);
  }

  const dependencies: ScriptId[] = [];
  if (candidate.dependencies !== undefined) {
    if (!Array.isArray(candidate.dependencies)) {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          'ScriptManifest.dependencies must be an array of script_<16-hex> IDs.'
        )
      );
    } else if (candidate.dependencies.length > MAX_SCRIPT_DEPENDENCIES) {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `ScriptManifest.dependencies count (${candidate.dependencies.length}) exceeds MAX_SCRIPT_DEPENDENCIES (${MAX_SCRIPT_DEPENDENCIES}).`
        )
      );
    } else {
      const seenDeps = new Set<ScriptId>();
      const normSelfId =
        typeof resolvedScriptId === 'string'
          ? resolvedScriptId.toLowerCase()
          : '';
      for (const dep of candidate.dependencies) {
        if (!isValidScriptId(dep)) {
          errors.push(
            createScriptError(
              'SCRIPT_VALIDATION_ERROR',
              `Invalid dependency ScriptId '${String(dep)}' in ScriptManifest.`
            )
          );
          continue;
        }
        const lowerDep = dep.toLowerCase() as ScriptId;
        if (lowerDep === normSelfId) {
          errors.push(
            createScriptError(
              'SCRIPT_VALIDATION_ERROR',
              `Script '${normSelfId}' cannot declare a self-dependency.`
            )
          );
          continue;
        }
        if (seenDeps.has(lowerDep)) {
          errors.push(
            createScriptError(
              'SCRIPT_VALIDATION_ERROR',
              `Duplicate dependency '${lowerDep}' in ScriptManifest.`
            )
          );
          continue;
        }
        seenDeps.add(lowerDep);
        dependencies.push(lowerDep);
      }
    }
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
        `Invalid ScriptManifest.version '${String(version)}'. Expected semver format (e.g. '1.0.0').`
      )
    );
  }

  if (
    errors.length > 0 ||
    !langCheck.value ||
    !entryCheck.value ||
    !capCheck.value
  ) {
    return { valid: false, value: null, errors };
  }

  dependencies.sort((a, b) => a.localeCompare(b));

  return {
    valid: true,
    value: Object.freeze({
      schemaVersion: CURRENT_SCRIPT_MANIFEST_SCHEMA_VERSION,
      scriptId: (resolvedScriptId as string).toLowerCase() as ScriptId,
      projectId: (candidate.projectId as string).trim(),
      name: (candidate.name as string).trim(),
      category: category as ScriptCategory,
      language: langCheck.value,
      entryPoint: entryCheck.value,
      capabilities: capCheck.value,
      dependencies: Object.freeze(dependencies),
      version: (version as string).trim(),
    }),
    errors: [],
  };
}
