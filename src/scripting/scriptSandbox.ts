import {
  HylixAssetRegistry,
  isValidAssetId,
} from '../assets/assetRegistry';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import { isValidEntityId } from '../ecs/ecsCore';
import { ScriptCapability } from './scriptCapabilities';
import { ScriptInstanceDescriptor } from './scriptInstance';
import {
  createDefaultScriptPermissionPolicy,
  evaluateCapabilityPermission,
  ScriptPermissionPolicy,
  validateScriptPermissionPolicy,
} from './scriptPermissions';
import {
  createScriptError,
  estimateSerializedByteSize,
  isFiniteScriptNumber,
  isPlainScriptObject,
  MAX_SCRIPT_AUDIO_COMMANDS_PER_FRAME,
  MAX_SCRIPT_ENTITY_OPERATIONS_PER_FRAME,
  MAX_SCRIPT_EVENT_PAYLOAD_SIZE,
  MAX_SCRIPT_EVENTS_PER_FRAME,
  MAX_SCRIPT_INSTRUCTIONS_PER_FRAME,
  MAX_SCRIPT_OPERATIONS_PER_FRAME,
  MAX_SCRIPT_PHYSICS_QUERIES_PER_FRAME,
  ScriptDiagnosticError,
  ScriptValidationResult,
} from './scriptTypes';

/**
 * Hylix V1.0.0 — Phase 09: ScriptSandbox & Execution Budget Accounting
 *
 * ARCHITECTURAL & SECURITY BOUNDARY STATEMENT:
 * "Phase 09 provides the scripting security boundary and runtime contracts;
 * execution of untrusted source requires a dedicated isolated runtime implementation
 * in a future phase."
 *
 * Responsibilities:
 * - Capability & Permission enforcement (default-deny)
 * - Project isolation enforcement
 * - Entity & Asset ownership validation
 * - Per-frame execution budget accounting (`maxInstructions`, `maxEvents`,
 *   `maxEntityOperations`, `maxPhysicsQueries`, `maxAudioCommands`, `maxOperations`)
 * - API boundary & payload validation
 */

export const PHASE_09_SANDBOX_BOUNDARY_STATEMENT =
  'Phase 09 provides the scripting security boundary and runtime contracts; execution of untrusted source requires a dedicated isolated runtime implementation in a future phase.' as const;

export interface ScriptExecutionBudget {
  readonly maxInstructions: number;
  readonly maxEvents: number;
  readonly maxEntityOperations: number;
  readonly maxPhysicsQueries: number;
  readonly maxAudioCommands: number;
  readonly maxTotalOperations: number;
}

export interface ScriptExecutionBudgetUsage {
  readonly usedInstructions: number;
  readonly usedEvents: number;
  readonly usedEntityOperations: number;
  readonly usedPhysicsQueries: number;
  readonly usedAudioCommands: number;
  readonly usedTotalOperations: number;
}

const ALLOWED_BUDGET_KEYS: ReadonlySet<string> = new Set<string>([
  'maxInstructions',
  'maxEvents',
  'maxEntityOperations',
  'maxPhysicsQueries',
  'maxAudioCommands',
  'maxTotalOperations',
]);

export function createDefaultScriptExecutionBudget(
  policy?: ScriptPermissionPolicy
): ScriptExecutionBudget {
  return Object.freeze({
    maxInstructions:
      policy?.maxInstructions ?? MAX_SCRIPT_INSTRUCTIONS_PER_FRAME,
    maxEvents: policy?.maxEventsPerFrame ?? MAX_SCRIPT_EVENTS_PER_FRAME,
    maxEntityOperations:
      policy?.maxEntityOperations ?? MAX_SCRIPT_ENTITY_OPERATIONS_PER_FRAME,
    maxPhysicsQueries:
      policy?.maxPhysicsQueries ?? MAX_SCRIPT_PHYSICS_QUERIES_PER_FRAME,
    maxAudioCommands:
      policy?.maxAudioCommands ?? MAX_SCRIPT_AUDIO_COMMANDS_PER_FRAME,
    maxTotalOperations: MAX_SCRIPT_OPERATIONS_PER_FRAME,
  });
}

export function validateScriptExecutionBudget(
  candidate: unknown
): ScriptValidationResult<ScriptExecutionBudget> {
  if (!isPlainScriptObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          'ScriptExecutionBudget must be a non-null plain object.'
        ),
      ],
    };
  }

  const errors: ScriptDiagnosticError[] = [];

  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_BUDGET_KEYS.has(key)) {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `Unexpected property '${key}' in ScriptExecutionBudget.`
        )
      );
    }
  }

  const checkLimit = (
    raw: unknown,
    defaultVal: number,
    maxCap: number,
    name: string
  ): number => {
    const val = raw !== undefined ? raw : defaultVal;
    if (
      !isFiniteScriptNumber(val) ||
      !Number.isInteger(val) ||
      val < 1 ||
      val > maxCap
    ) {
      errors.push(
        createScriptError(
          'SCRIPT_VALIDATION_ERROR',
          `ScriptExecutionBudget.${name} must be an integer in [1, ${maxCap}].`
        )
      );
      return defaultVal;
    }
    return val;
  };

  const maxInstructions = checkLimit(
    candidate.maxInstructions,
    MAX_SCRIPT_INSTRUCTIONS_PER_FRAME,
    MAX_SCRIPT_INSTRUCTIONS_PER_FRAME * 10,
    'maxInstructions'
  );
  const maxEvents = checkLimit(
    candidate.maxEvents,
    MAX_SCRIPT_EVENTS_PER_FRAME,
    MAX_SCRIPT_EVENTS_PER_FRAME * 4,
    'maxEvents'
  );
  const maxEntityOperations = checkLimit(
    candidate.maxEntityOperations,
    MAX_SCRIPT_ENTITY_OPERATIONS_PER_FRAME,
    MAX_SCRIPT_ENTITY_OPERATIONS_PER_FRAME * 4,
    'maxEntityOperations'
  );
  const maxPhysicsQueries = checkLimit(
    candidate.maxPhysicsQueries,
    MAX_SCRIPT_PHYSICS_QUERIES_PER_FRAME,
    MAX_SCRIPT_PHYSICS_QUERIES_PER_FRAME * 4,
    'maxPhysicsQueries'
  );
  const maxAudioCommands = checkLimit(
    candidate.maxAudioCommands,
    MAX_SCRIPT_AUDIO_COMMANDS_PER_FRAME,
    MAX_SCRIPT_AUDIO_COMMANDS_PER_FRAME * 4,
    'maxAudioCommands'
  );
  const maxTotalOperations = checkLimit(
    candidate.maxTotalOperations,
    MAX_SCRIPT_OPERATIONS_PER_FRAME,
    MAX_SCRIPT_OPERATIONS_PER_FRAME * 10,
    'maxTotalOperations'
  );

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      maxInstructions,
      maxEvents,
      maxEntityOperations,
      maxPhysicsQueries,
      maxAudioCommands,
      maxTotalOperations,
    }),
    errors: [],
  };
}

export class ScriptSandbox {
  private readonly projectId: string;
  private policy: ScriptPermissionPolicy;
  private budget: ScriptExecutionBudget;
  private readonly logger?: RedactedDiagnosticLogger;

  private usedInstructions = 0;
  private usedEvents = 0;
  private usedEntityOperations = 0;
  private usedPhysicsQueries = 0;
  private usedAudioCommands = 0;
  private usedTotalOperations = 0;

  constructor(options: {
    readonly projectId: string;
    readonly policy?: ScriptPermissionPolicy;
    readonly budget?: ScriptExecutionBudget;
    readonly logger?: RedactedDiagnosticLogger;
  }) {
    this.projectId = options.projectId.trim();
    this.policy = options.policy ?? createDefaultScriptPermissionPolicy();
    this.budget =
      options.budget ?? createDefaultScriptExecutionBudget(this.policy);
    this.logger = options.logger;
  }

  public getProjectId(): string {
    return this.projectId;
  }

  public getBoundaryStatement(): string {
    return PHASE_09_SANDBOX_BOUNDARY_STATEMENT;
  }

  public getPermissionPolicy(): ScriptPermissionPolicy {
    return this.policy;
  }

  public setPermissionPolicy(
    candidate: unknown
  ): ScriptValidationResult<ScriptPermissionPolicy> {
    const val = validateScriptPermissionPolicy(candidate);
    if (!val.valid || !val.value) {
      return val;
    }
    this.policy = val.value;
    this.budget = createDefaultScriptExecutionBudget(this.policy);
    return val;
  }

  public getExecutionBudget(): ScriptExecutionBudget {
    return this.budget;
  }

  public setExecutionBudget(
    candidate: unknown
  ): ScriptValidationResult<ScriptExecutionBudget> {
    const val = validateScriptExecutionBudget(candidate);
    if (!val.valid || !val.value) {
      return val;
    }
    this.budget = val.value;
    return val;
  }

  public getBudgetUsage(): ScriptExecutionBudgetUsage {
    return Object.freeze({
      usedInstructions: this.usedInstructions,
      usedEvents: this.usedEvents,
      usedEntityOperations: this.usedEntityOperations,
      usedPhysicsQueries: this.usedPhysicsQueries,
      usedAudioCommands: this.usedAudioCommands,
      usedTotalOperations: this.usedTotalOperations,
    });
  }

  public resetFrameBudget(): void {
    this.usedInstructions = 0;
    this.usedEvents = 0;
    this.usedEntityOperations = 0;
    this.usedPhysicsQueries = 0;
    this.usedAudioCommands = 0;
    this.usedTotalOperations = 0;
  }

  public verifyProjectOwnership(
    candidateProjectId: string,
    contextDescription = 'operation'
  ): ScriptValidationResult<true> {
    if (candidateProjectId.trim() !== this.projectId) {
      const err = createScriptError(
        'SCRIPT_PROJECT_ISOLATION_ERROR',
        `Cross-project access denied during ${contextDescription}: target belongs to '${candidateProjectId}', sandbox is bound to '${this.projectId}'.`
      );
      this.logger?.record(
        'scripting',
        'SECURITY_AUDIT',
        `script_project_isolation_violation: ${err.message}`
      );
      return { valid: false, value: null, errors: [err] };
    }
    return { valid: true, value: true, errors: [] };
  }

  public verifyInstanceOperational(
    instance: ScriptInstanceDescriptor
  ): ScriptValidationResult<true> {
    const projCheck = this.verifyProjectOwnership(
      instance.projectId,
      `instance '${instance.instanceId}'`
    );
    if (!projCheck.valid) return projCheck;

    if (
      instance.category === 'Editor' &&
      !this.policy.allowEditorCategoryExecution
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_PERMISSION_ERROR',
            `ScriptInstance '${instance.instanceId}' has category 'Editor', which is disabled for runtime execution in Phase 09.`
          ),
        ],
      };
    }

    if (
      instance.lifecycleState !== 'enabled' &&
      instance.lifecycleState !== 'initialized'
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_LIFECYCLE_ERROR',
            `ScriptInstance '${instance.instanceId}' is in state '${instance.lifecycleState}' and cannot execute API operations.`
          ),
        ],
      };
    }

    return { valid: true, value: true, errors: [] };
  }

  public authorizeOperation(
    instance: ScriptInstanceDescriptor,
    requiredCapability: ScriptCapability,
    budgetCategory:
      | 'instruction'
      | 'event'
      | 'entity'
      | 'physics'
      | 'audio'
      | 'general',
    cost = 1
  ): ScriptValidationResult<true> {
    const opCheck = this.verifyInstanceOperational(instance);
    if (!opCheck.valid) return opCheck;

    const capPermCheck = evaluateCapabilityPermission(
      instance.scriptId,
      instance.capabilities,
      this.policy,
      requiredCapability
    );
    if (!capPermCheck.valid) {
      this.logger?.record(
        'scripting',
        'WARN',
        `script_authorization_denied: ${capPermCheck.errors.map((e) => e.message).join('; ')}`
      );
      return capPermCheck;
    }

    return this.consumeBudget(budgetCategory, cost);
  }

  public consumeBudget(
    category:
      | 'instruction'
      | 'event'
      | 'entity'
      | 'physics'
      | 'audio'
      | 'general',
    amount = 1
  ): ScriptValidationResult<true> {
    if (!Number.isInteger(amount) || amount < 1) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_VALIDATION_ERROR',
            'Budget consumption amount must be a positive integer.'
          ),
        ],
      };
    }

    if (this.usedTotalOperations + 1 > this.budget.maxTotalOperations) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BUDGET_EXCEEDED_ERROR',
            `Total script operations per frame exceeded limit (${this.budget.maxTotalOperations}).`
          ),
        ],
      };
    }

    switch (category) {
      case 'instruction':
        if (this.usedInstructions + amount > this.budget.maxInstructions) {
          return {
            valid: false,
            value: null,
            errors: [
              createScriptError(
                'SCRIPT_BUDGET_EXCEEDED_ERROR',
                `Script instruction budget exceeded (${this.usedInstructions + amount} > ${this.budget.maxInstructions}).`
              ),
            ],
          };
        }
        this.usedInstructions += amount;
        break;
      case 'event':
        if (this.usedEvents + amount > this.budget.maxEvents) {
          return {
            valid: false,
            value: null,
            errors: [
              createScriptError(
                'SCRIPT_BUDGET_EXCEEDED_ERROR',
                `Script event emission budget exceeded (${this.usedEvents + amount} > ${this.budget.maxEvents}).`
              ),
            ],
          };
        }
        this.usedEvents += amount;
        break;
      case 'entity':
        if (
          this.usedEntityOperations + amount >
          this.budget.maxEntityOperations
        ) {
          return {
            valid: false,
            value: null,
            errors: [
              createScriptError(
                'SCRIPT_BUDGET_EXCEEDED_ERROR',
                `Script entity operation budget exceeded (${this.usedEntityOperations + amount} > ${this.budget.maxEntityOperations}).`
              ),
            ],
          };
        }
        this.usedEntityOperations += amount;
        break;
      case 'physics':
        if (
          this.usedPhysicsQueries + amount >
          this.budget.maxPhysicsQueries
        ) {
          return {
            valid: false,
            value: null,
            errors: [
              createScriptError(
                'SCRIPT_BUDGET_EXCEEDED_ERROR',
                `Script physics query budget exceeded (${this.usedPhysicsQueries + amount} > ${this.budget.maxPhysicsQueries}).`
              ),
            ],
          };
        }
        this.usedPhysicsQueries += amount;
        break;
      case 'audio':
        if (this.usedAudioCommands + amount > this.budget.maxAudioCommands) {
          return {
            valid: false,
            value: null,
            errors: [
              createScriptError(
                'SCRIPT_BUDGET_EXCEEDED_ERROR',
                `Script audio command budget exceeded (${this.usedAudioCommands + amount} > ${this.budget.maxAudioCommands}).`
              ),
            ],
          };
        }
        this.usedAudioCommands += amount;
        break;
      case 'general':
        break;
    }

    this.usedTotalOperations += 1;
    return { valid: true, value: true, errors: [] };
  }

  public verifyEntityOwnership(
    entityId: unknown,
    projectEntitiesById: ReadonlyMap<string, unknown>,
    targetEntityProjectId?: string
  ): ScriptValidationResult<string> {
    if (typeof targetEntityProjectId === 'string') {
      const projCheck = this.verifyProjectOwnership(
        targetEntityProjectId,
        `entity '${String(entityId)}'`
      );
      if (!projCheck.valid) {
        return { valid: false, value: null, errors: projCheck.errors };
      }
    }

    if (!isValidEntityId(entityId)) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            `Invalid entityId '${String(entityId)}'. Expected 'ent_<16-hex>'.`
          ),
        ],
      };
    }

    if (!projectEntitiesById.has(entityId)) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            `Entity '${entityId}' does not exist in project '${this.projectId}'.`
          ),
        ],
      };
    }

    return { valid: true, value: entityId, errors: [] };
  }

  public verifyAssetOwnership(
    assetId: unknown,
    assetRegistry: HylixAssetRegistry
  ): ScriptValidationResult<string> {
    const projCheck = this.verifyProjectOwnership(
      assetRegistry.getProjectId(),
      `asset '${String(assetId)}'`
    );
    if (!projCheck.valid) {
      return { valid: false, value: null, errors: projCheck.errors };
    }

    if (!isValidAssetId(assetId)) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            `Invalid AssetId '${String(assetId)}'. Scripts must reference assets by 'asset_<16-hex>', never raw paths.`
          ),
        ],
      };
    }

    const record = assetRegistry.getAsset(assetId);
    if (!record) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BINDING_ERROR',
            `Asset '${assetId}' does not exist in project '${this.projectId}' AssetRegistry.`
          ),
        ],
      };
    }

    if (
      record.path.startsWith('cache/') ||
      record.path.startsWith('build/') ||
      record.path.startsWith('.hylix/')
    ) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_PERMISSION_ERROR',
            `Asset '${assetId}' resides in restricted directory '${record.path}'.`
          ),
        ],
      };
    }

    return { valid: true, value: assetId, errors: [] };
  }

  public validatePayloadSize(payload: unknown): ScriptValidationResult<true> {
    const bytes = estimateSerializedByteSize(payload);
    if (bytes > MAX_SCRIPT_EVENT_PAYLOAD_SIZE) {
      return {
        valid: false,
        value: null,
        errors: [
          createScriptError(
            'SCRIPT_BUDGET_EXCEEDED_ERROR',
            `Payload size (${bytes} bytes) exceeds MAX_SCRIPT_EVENT_PAYLOAD_SIZE (${MAX_SCRIPT_EVENT_PAYLOAD_SIZE} bytes).`
          ),
        ],
      };
    }
    return { valid: true, value: true, errors: [] };
  }
}
