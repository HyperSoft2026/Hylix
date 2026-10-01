import {
  isFinitePhysicsNumber,
  isPlainPhysicsObject,
  PhysicsValidationResult,
} from './physicsTypes';

/**
 * Hylix V1.0.0 — Phase 06: Fixed Timestep & Spiral-of-Death Protection (STEP 19, STEP 20, STEP 21)
 *
 * Physics never depends on `requestAnimationFrame`, render FPS, or UI FPS.
 * It steps deterministically via a fixed delta time (default `1 / 60` second)
 * and enforces `maxSubsteps` to prevent spiral-of-death when frame deltas spike.
 */

export const DEFAULT_FIXED_DELTA_TIME = 1 / 60;
export const DEFAULT_MAX_SUBSTEPS = 8;
export const MAX_ALLOWED_SUBSTEPS = 120;

export interface FixedTimestepConfig {
  readonly fixedDeltaTime: number;
  readonly maxSubsteps: number;
}

export interface FixedTimestepAdvanceResult {
  readonly valid: boolean;
  readonly stepsToExecute: number;
  readonly fixedDeltaTime: number;
  readonly remainingAccumulator: number;
  readonly clampedByMaxSubsteps: boolean;
  readonly errors: readonly string[];
}

export function validateFixedTimestepConfig(
  candidate: unknown
): PhysicsValidationResult<FixedTimestepConfig> {
  if (candidate === undefined) {
    return {
      valid: true,
      value: Object.freeze({
        fixedDeltaTime: DEFAULT_FIXED_DELTA_TIME,
        maxSubsteps: DEFAULT_MAX_SUBSTEPS,
      }),
      errors: [],
    };
  }

  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['FixedTimestepConfig must be a non-null object.'],
    };
  }

  const errors: string[] = [];
  const dt =
    candidate.fixedDeltaTime !== undefined
      ? candidate.fixedDeltaTime
      : DEFAULT_FIXED_DELTA_TIME;

  if (!isFinitePhysicsNumber(dt) || dt <= 0) {
    errors.push(
      `FixedTimestepConfig.fixedDeltaTime must be a finite number > 0 (received ${String(dt)}).`
    );
  }

  const maxSubsteps =
    candidate.maxSubsteps !== undefined
      ? candidate.maxSubsteps
      : DEFAULT_MAX_SUBSTEPS;

  if (
    !isFinitePhysicsNumber(maxSubsteps) ||
    !Number.isInteger(maxSubsteps) ||
    maxSubsteps < 1 ||
    maxSubsteps > MAX_ALLOWED_SUBSTEPS
  ) {
    errors.push(
      `FixedTimestepConfig.maxSubsteps must be an integer in [1, ${MAX_ALLOWED_SUBSTEPS}] (received ${String(maxSubsteps)}).`
    );
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      fixedDeltaTime: dt as number,
      maxSubsteps: maxSubsteps as number,
    }),
    errors: [],
  };
}

export class FixedTimestepController {
  private fixedDeltaTime: number;
  private maxSubsteps: number;
  private accumulator = 0;
  private totalStepsExecuted = 0;

  constructor(config?: Partial<FixedTimestepConfig>) {
    const check = validateFixedTimestepConfig(config);
    if (!check.valid || !check.value) {
      throw new Error(check.errors.join('; '));
    }
    this.fixedDeltaTime = check.value.fixedDeltaTime;
    this.maxSubsteps = check.value.maxSubsteps;
  }

  public getConfig(): FixedTimestepConfig {
    return Object.freeze({
      fixedDeltaTime: this.fixedDeltaTime,
      maxSubsteps: this.maxSubsteps,
    });
  }

  public getAccumulator(): number {
    return this.accumulator;
  }

  public getTotalStepsExecuted(): number {
    return this.totalStepsExecuted;
  }

  public reset(): void {
    this.accumulator = 0;
    this.totalStepsExecuted = 0;
  }

  public configure(
    newConfig: Partial<FixedTimestepConfig>
  ): PhysicsValidationResult<FixedTimestepConfig> {
    const merged = {
      fixedDeltaTime: newConfig.fixedDeltaTime ?? this.fixedDeltaTime,
      maxSubsteps: newConfig.maxSubsteps ?? this.maxSubsteps,
    };
    const check = validateFixedTimestepConfig(merged);
    if (!check.valid || !check.value) {
      return check;
    }
    this.fixedDeltaTime = check.value.fixedDeltaTime;
    this.maxSubsteps = check.value.maxSubsteps;
    return check;
  }

  /**
   * Feeds elapsed frame delta time into the accumulator and returns how many
   * fixed physics substeps should be executed (capped at `maxSubsteps`).
   */
  public advance(elapsedSeconds: unknown): FixedTimestepAdvanceResult {
    if (!isFinitePhysicsNumber(elapsedSeconds) || elapsedSeconds < 0) {
      return Object.freeze({
        valid: false,
        stepsToExecute: 0,
        fixedDeltaTime: this.fixedDeltaTime,
        remainingAccumulator: this.accumulator,
        clampedByMaxSubsteps: false,
        errors: [
          `Elapsed time for FixedTimestepController.advance must be a finite number >= 0 (received ${String(elapsedSeconds)}).`,
        ],
      });
    }

    this.accumulator += elapsedSeconds;

    const rawSteps = Math.floor((this.accumulator + 1e-12) / this.fixedDeltaTime);
    let stepsToExecute = rawSteps;
    let clampedByMaxSubsteps = false;

    if (rawSteps > this.maxSubsteps) {
      stepsToExecute = this.maxSubsteps;
      clampedByMaxSubsteps = true;
      // Prevent infinite backlog accumulation (spiral-of-death protection)
      this.accumulator = 0;
    } else if (stepsToExecute > 0) {
      this.accumulator = Math.max(
        0,
        this.accumulator - stepsToExecute * this.fixedDeltaTime
      );
      if (this.accumulator < 1e-12) {
        this.accumulator = 0;
      }
    }

    this.totalStepsExecuted += stepsToExecute;

    return Object.freeze({
      valid: true,
      stepsToExecute,
      fixedDeltaTime: this.fixedDeltaTime,
      remainingAccumulator: this.accumulator,
      clampedByMaxSubsteps,
      errors: [],
    });
  }
}
