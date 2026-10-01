import { HYLIX_IDENTITY } from '../core/engineIdentity';

/**
 * Hylix Security Foundation
 *
 * Implements:
 * 1. Path Traversal & Workspace Confinement Guard
 * 2. Command Execution Allowlist & Privilege Separation Guard
 * 3. Secret & Credential Redaction Engine
 * 4. Android Release Signing Identity & Certificate Continuity Guard
 */

export interface PathValidationResult {
  readonly safe: boolean;
  readonly normalizedPath: string;
  readonly reason?: string;
}

const FORBIDDEN_PATH_PATTERNS = [
  /\0/, // Null byte injection
  /(^|[\\/])\.\.([\\/]|$)/, // Parent directory traversal (.. or ../ or ..\ )
  /^[a-zA-Z]:([\\/]|$)/, // Windows drive root path (C:\, D:/, etc.)
  /^\\\\/, // UNC network path
  /^~([\\/]|$)/, // User home shortcut
  /^\/(system|etc|data|proc|dev|sdcard|storage|mnt|root|var|tmp|usr|bin|sbin)(\/|$)/i, // Android/Linux system roots
  /(^|[\\/])\.git([\\/]|$)/i, // Git repository internals
  /\.(jks|keystore|p12|pfx|pem|key)$/i, // Private signing key files
  /signing\.properties$/i, // Signing credentials file
];

export function validateWorkspaceRelativePath(candidatePath: string): PathValidationResult {
  if (typeof candidatePath !== 'string') {
    return { safe: false, normalizedPath: '', reason: 'Path must be a string.' };
  }

  const trimmed = candidatePath.trim();

  if (!trimmed) {
    return { safe: false, normalizedPath: '', reason: 'Path must not be empty.' };
  }

  for (const pattern of FORBIDDEN_PATH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        safe: false,
        normalizedPath: trimmed,
        reason: `Path violates sandbox confinement or protected file rule (${pattern.source}).`,
      };
    }
  }

  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    return {
      safe: false,
      normalizedPath: trimmed,
      reason: 'Absolute paths are forbidden; paths must be relative to the project sandbox.',
    };
  }

  const normalizedSlashes = trimmed.replace(/\\/g, '/');
  if (normalizedSlashes.includes('//')) {
    return {
      safe: false,
      normalizedPath: trimmed,
      reason: 'Empty or redundant path segments (//) are forbidden.',
    };
  }

  const segments = normalizedSlashes.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { safe: false, normalizedPath: '', reason: 'Path must contain at least one valid segment.' };
  }

  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      return {
        safe: false,
        normalizedPath: trimmed,
        reason: 'Relative traversal segments (. or ..) are forbidden.',
      };
    }
    if (/[:*?"<>|]/.test(seg)) {
      return {
        safe: false,
        normalizedPath: trimmed,
        reason: `Segment '${seg}' contains illegal filesystem characters.`,
      };
    }
  }

  return {
    safe: true,
    normalizedPath: segments.join('/'),
  };
}

/**
 * Verifies that a project-internal path stays strictly confined inside `<projectRoot>/...`
 * and cannot escape to sibling projects or parent directories.
 */
export function validateProjectScopedPath(
  projectRoot: string,
  relativeSubPath: string
): PathValidationResult {
  const rootCheck = validateWorkspaceRelativePath(projectRoot);
  if (!rootCheck.safe) {
    return {
      safe: false,
      normalizedPath: '',
      reason: `Invalid project root: ${rootCheck.reason}`,
    };
  }

  if (rootCheck.normalizedPath.includes('/')) {
    return {
      safe: false,
      normalizedPath: '',
      reason: 'Project root must be a single top-level directory name inside the workspace.',
    };
  }

  const subCheck = validateWorkspaceRelativePath(relativeSubPath);
  if (!subCheck.safe) {
    return {
      safe: false,
      normalizedPath: '',
      reason: `Unsafe project file path: ${subCheck.reason}`,
    };
  }

  const combined = `${rootCheck.normalizedPath}/${subCheck.normalizedPath}`;
  if (!combined.startsWith(`${rootCheck.normalizedPath}/`)) {
    return {
      safe: false,
      normalizedPath: '',
      reason: 'Path escaped the target project workspace boundary.',
    };
  }

  return {
    safe: true,
    normalizedPath: combined,
  };
}

/**
 * Privilege Separation: Editor vs Build/Tooling Execution
 * Rejects direct shell interpolation (`sh -c`, `;`, `&&`, `|`, backticks)
 * and permits only structured, allowlisted build tool invocations.
 */
export type AllowedBuildToolId =
  | 'aapt2_package'
  | 'd8_dex'
  | 'zipalign_archive'
  | 'apksigner_verify';

export interface BuildToolCommandRequest {
  readonly callerContext: 'editor_ui' | 'project_system' | 'isolated_build_worker';
  readonly toolId: string;
  readonly arguments: readonly string[];
}

export interface CommandValidationResult {
  readonly permitted: boolean;
  readonly reason?: string;
}

const ALLOWED_BUILD_TOOLS: ReadonlySet<string> = new Set<AllowedBuildToolId>([
  'aapt2_package',
  'd8_dex',
  'zipalign_archive',
  'apksigner_verify',
]);

const SHELL_METACHARACTER_PATTERN = /[;&|`$<>\\!\n\r]/;

export function validateBuildCommandExecution(
  request: BuildToolCommandRequest
): CommandValidationResult {
  if (request.callerContext !== 'isolated_build_worker') {
    return {
      permitted: false,
      reason: `Privilege Violation: Context '${request.callerContext}' is forbidden from invoking system/build tools directly; must dispatch to isolated_build_worker.`,
    };
  }

  if (!ALLOWED_BUILD_TOOLS.has(request.toolId)) {
    return {
      permitted: false,
      reason: `Untrusted binary or command '${request.toolId}' is not in the Build System allowlist.`,
    };
  }

  for (const arg of request.arguments) {
    if (SHELL_METACHARACTER_PATTERN.test(arg)) {
      return {
        permitted: false,
        reason: `Argument '${arg}' contains forbidden shell metacharacters.`,
      };
    }
    if (arg.includes('..')) {
      return {
        permitted: false,
        reason: `Argument '${arg}' contains forbidden path traversal sequence.`,
      };
    }
  }

  return { permitted: true };
}

/**
 * Secret Redaction Engine for Safe Logging & Crash Diagnostics
 */
const SECRET_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY_BLOCK]',
  },
  {
    pattern:
      /\b(storePassword|keyPassword|password|secret|token|apiKey|privateKey)\s*[:=]\s*([^\s,;'"&]+)/gi,
    replacement: '$1=[REDACTED_SECRET]',
  },
  {
    pattern: /\b(HYLIX_RELEASE_STORE_PASSWORD|HYLIX_RELEASE_KEY_PASSWORD)\s*=\s*([^\s]+)/gi,
    replacement: '$1=[REDACTED_ENV_SECRET]',
  },
  {
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: '$1 [REDACTED_AUTH_TOKEN]',
  },
];

export function redactSensitiveData(input: string): string {
  let sanitized = input;
  for (const rule of SECRET_PATTERNS) {
    sanitized = sanitized.replace(rule.pattern, rule.replacement);
  }
  return sanitized;
}

/**
 * Android Signing Identity & Certificate Continuity Policy Validator
 */
export interface AndroidSigningPolicyInput {
  readonly applicationId: string;
  readonly buildVariant: 'debug' | 'release';
  readonly autoGenerateKeystoreOnBuild: boolean;
  readonly keystoreStoredInGitRepo: boolean;
  readonly keystoreBundledInApk: boolean;
  readonly externalKeystoreConfigured: boolean;
  readonly expectedCertificateSha1?: string;
  readonly activeCertificateSha1?: string;
}

export interface SigningPolicyEvaluation {
  readonly valid: boolean;
  readonly status:
    | 'READY_FOR_RELEASE_SIGNING'
    | 'AWAITING_INITIAL_PRODUCTION_CERTIFICATE'
    | 'DEBUG_BUILD_PERMITTED'
    | 'POLICY_VIOLATION';
  readonly errors: readonly string[];
}

const VALID_SHA1_FINGERPRINT_REGEX = /^([0-9A-F]{2}:){19}[0-9A-F]{2}$/i;
const BANNED_FAKE_SHA1_VALUES = new Set([
  '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00',
  'FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF',
  'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD',
  '11:22:33:44:55:66:77:88:99:00:11:22:33:44:55:66:77:88:99:00',
]);

export function evaluateAndroidSigningPolicy(
  input: AndroidSigningPolicyInput
): SigningPolicyEvaluation {
  const errors: string[] = [];

  if (input.applicationId !== HYLIX_IDENTITY.androidApplicationId) {
    errors.push(
      `Application ID mismatch: expected '${HYLIX_IDENTITY.androidApplicationId}', received '${input.applicationId}'.`
    );
  }

  if (input.autoGenerateKeystoreOnBuild) {
    errors.push(
      'Critical Signing Violation: Automatic keystore generation during builds is strictly prohibited.'
    );
  }

  if (input.keystoreStoredInGitRepo) {
    errors.push(
      'Critical Security Violation: Private signing keys must never be stored inside the Git repository.'
    );
  }

  if (input.keystoreBundledInApk) {
    errors.push(
      'Critical Security Violation: Private signing keys or production secrets must never be bundled inside the APK.'
    );
  }

  const checkSha1Format = (label: string, sha1?: string) => {
    if (!sha1) return;
    const normalized = sha1.trim().toUpperCase();
    if (!VALID_SHA1_FINGERPRINT_REGEX.test(normalized)) {
      errors.push(
        `${label} must be a valid 20-byte colon-separated hexadecimal SHA-1 fingerprint.`
      );
    } else if (BANNED_FAKE_SHA1_VALUES.has(normalized)) {
      errors.push(
        `${label} matches a banned placeholder/dummy SHA-1 value. Never use fabricated SHA-1 fingerprints.`
      );
    }
  };

  checkSha1Format('expectedCertificateSha1', input.expectedCertificateSha1);
  checkSha1Format('activeCertificateSha1', input.activeCertificateSha1);

  if (
    input.expectedCertificateSha1 &&
    input.activeCertificateSha1 &&
    input.expectedCertificateSha1.trim().toUpperCase() !==
      input.activeCertificateSha1.trim().toUpperCase()
  ) {
    errors.push(
      'Certificate Continuity Violation: Active signing certificate SHA-1 does not match the pinned production certificate SHA-1. Release signing aborted to prevent accidental key replacement.'
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      status: 'POLICY_VIOLATION',
      errors,
    };
  }

  if (input.buildVariant === 'debug') {
    return {
      valid: true,
      status: 'DEBUG_BUILD_PERMITTED',
      errors: [],
    };
  }

  if (!input.externalKeystoreConfigured || !input.expectedCertificateSha1) {
    return {
      valid: true,
      status: 'AWAITING_INITIAL_PRODUCTION_CERTIFICATE',
      errors: [],
    };
  }

  return {
    valid: true,
    status: 'READY_FOR_RELEASE_SIGNING',
    errors: [],
  };
}
