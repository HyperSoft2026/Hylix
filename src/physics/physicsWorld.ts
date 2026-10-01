import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import { ColliderDescriptor, validateCollider } from './collider';
import {
  ContactPoint,
  createDeterministicColliderPairKey,
  detectColliderPairCollision,
  PhysicsCollisionEvent,
} from './collision';
import {
  DEFAULT_FIXED_DELTA_TIME,
  DEFAULT_MAX_SUBSTEPS,
  FixedTimestepConfig,
  FixedTimestepController,
} from './fixedTimestep';
import {
  applyForceToBody,
  applyImpulseToBody,
  applyTorqueToBody,
  clearBodyAccumulators,
  RigidBodyDescriptor,
  validateRigidBody,
} from './physicsBody';
import {
  combinePhysicsMaterials,
  createDefaultPhysicsMaterial,
  PhysicsMaterialDescriptor,
  validatePhysicsMaterial,
} from './physicsMaterial';
import {
  addVector3,
  ColliderId,
  createPhysicsId,
  dotVector3,
  isValidPhysicsStateTransition,
  PhysicsBodyId,
  PhysicsMaterialId,
  PhysicsSimulationState,
  PhysicsValidationResult,
  PhysicsWorldId,
  scaleVector3,
  subVector3,
  validateVector3,
  Vector3,
} from './physicsTypes';

/**
 * Hylix V1.0.0 — Phase 06: PhysicsWorld, Reference Foundation Solver & Lifecycle State Machine
 * (STEP 4, STEP 5, STEP 17, STEP 18, STEP 21, STEP 26, STEP 33)
 *
 * Strictly enforces:
 * - State machine: `uninitialized -> ready -> simulating -> ready`, `ready <-> paused`, `-> shutdown`
 *   (blocks `shutdown -> simulating` and all illegal transitions)
 * - Project Isolation (`projectId`): rejects any body/collider belonging to another project
 * - Deterministic Fixed-Timestep Simulation
 * - Trigger vs Solid Collision Separation:
 *   - Triggers detect overlap and emit `triggerEnter / triggerStay / triggerExit`,
 *     and NEVER apply physical impulses or positional resolution.
 *   - Solid Colliders emit `collisionEnter / collisionStay / collisionExit` and invoke `PhysicsSolver.solveContacts`.
 */

export const DEFAULT_WORLD_GRAVITY: Vector3 = Object.freeze({
  x: 0,
  y: -9.81,
  z: 0,
});

export interface PhysicsSolverContract {
  readonly solverName: string;
  integrateBodies(
    bodies: readonly RigidBodyDescriptor[],
    gravity: Vector3,
    fixedDeltaTime: number
  ): readonly RigidBodyDescriptor[];
  solveContacts(
    bodiesById: ReadonlyMap<PhysicsBodyId, RigidBodyDescriptor>,
    collidersById: ReadonlyMap<ColliderId, ColliderDescriptor>,
    materialsById: ReadonlyMap<PhysicsMaterialId, PhysicsMaterialDescriptor>,
    solidContacts: readonly ContactPoint[],
    fixedDeltaTime: number
  ): ReadonlyMap<PhysicsBodyId, RigidBodyDescriptor>;
}

/**
 * Reference Foundation Physics Solver (STEP 26).
 *
 * Provides deterministic semi-implicit Euler integration for `dynamic` and `kinematic`
 * bodies and basic linear impulse + positional depenetration along contact normals
 * for non-trigger solid contacts.
 */
export class FoundationPhysicsSolver implements PhysicsSolverContract {
  public readonly solverName = 'HylixFoundationPhysicsSolverV1';

  public integrateBodies(
    bodies: readonly RigidBodyDescriptor[],
    gravity: Vector3,
    fixedDeltaTime: number
  ): readonly RigidBodyDescriptor[] {
    const out: RigidBodyDescriptor[] = [];

    // Sort bodies deterministically by bodyId before integration
    const sorted = [...bodies].sort((a, b) =>
      a.bodyId < b.bodyId ? -1 : a.bodyId > b.bodyId ? 1 : 0
    );

    for (const body of sorted) {
      if (!body.isEnabled || body.bodyType === 'static') {
        out.push(clearBodyAccumulators(body));
        continue;
      }

      if (body.bodyType === 'kinematic') {
        const nextPos = addVector3(
          body.position,
          scaleVector3(body.linearVelocity, fixedDeltaTime)
        );
        const nextRot = addVector3(
          body.rotation,
          scaleVector3(body.angularVelocity, fixedDeltaTime)
        );
        out.push(
          Object.freeze({
            ...clearBodyAccumulators(body),
            position: nextPos,
            rotation: nextRot,
          })
        );
        continue;
      }

      // Dynamic body
      if (body.isSleeping) {
        out.push(clearBodyAccumulators(body));
        continue;
      }

      // Acceleration: a = gravity * gravityScale + accumulatedForce * inverseMass
      const gravAccel = scaleVector3(gravity, body.gravityScale);
      const forceAccel = scaleVector3(body.accumulatedForce, body.inverseMass);
      const totalAccel = addVector3(gravAccel, forceAccel);

      // Update linear velocity with acceleration and damping
      const rawLinVel = addVector3(
        body.linearVelocity,
        scaleVector3(totalAccel, fixedDeltaTime)
      );
      const linDampingFactor = Math.max(
        0,
        1 - body.linearDamping * fixedDeltaTime
      );
      const nextLinVel = scaleVector3(rawLinVel, linDampingFactor);

      // Update angular velocity with torque and angular damping
      const rawAngVel = addVector3(
        body.angularVelocity,
        scaleVector3(
          scaleVector3(body.accumulatedTorque, body.inverseMass),
          fixedDeltaTime
        )
      );
      const angDampingFactor = Math.max(
        0,
        1 - body.angularDamping * fixedDeltaTime
      );
      const nextAngVel = scaleVector3(rawAngVel, angDampingFactor);

      // Integrate position & rotation
      const nextPos = addVector3(
        body.position,
        scaleVector3(nextLinVel, fixedDeltaTime)
      );
      const nextRot = addVector3(
        body.rotation,
        scaleVector3(nextAngVel, fixedDeltaTime)
      );

      out.push(
        Object.freeze({
          ...clearBodyAccumulators(body),
          position: nextPos,
          rotation: nextRot,
          linearVelocity: nextLinVel,
          angularVelocity: nextAngVel,
        })
      );
    }

    return Object.freeze(out);
  }

  public solveContacts(
    bodiesById: ReadonlyMap<PhysicsBodyId, RigidBodyDescriptor>,
    collidersById: ReadonlyMap<ColliderId, ColliderDescriptor>,
    materialsById: ReadonlyMap<PhysicsMaterialId, PhysicsMaterialDescriptor>,
    solidContacts: readonly ContactPoint[]
  ): ReadonlyMap<PhysicsBodyId, RigidBodyDescriptor> {
    const updated = new Map<PhysicsBodyId, RigidBodyDescriptor>(bodiesById);
    const defaultMat = createDefaultPhysicsMaterial();

    for (const contact of solidContacts) {
      const colA = collidersById.get(contact.colliderA);
      const colB = collidersById.get(contact.colliderB);
      if (!colA || !colB) continue;

      // Never resolve triggers physically (STEP 18)
      if (colA.isTrigger || colB.isTrigger) continue;

      const bodyA = updated.get(contact.bodyA);
      const bodyB = updated.get(contact.bodyB);
      if (!bodyA || !bodyB) continue;

      const invMassA =
        bodyA.bodyType === 'dynamic' && bodyA.isEnabled ? bodyA.inverseMass : 0;
      const invMassB =
        bodyB.bodyType === 'dynamic' && bodyB.isEnabled ? bodyB.inverseMass : 0;
      const totalInvMass = invMassA + invMassB;

      if (totalInvMass <= 0) continue;

      const matA =
        (colA.physicsMaterialId
          ? materialsById.get(colA.physicsMaterialId)
          : undefined) ?? defaultMat;
      const matB =
        (colB.physicsMaterialId
          ? materialsById.get(colB.physicsMaterialId)
          : undefined) ?? defaultMat;
      const { restitution } = combinePhysicsMaterials(matA, matB);

      // Positional correction along contact normal (from A to B)
      const correctionMag = contact.penetrationDepth / totalInvMass;
      const correctionVec = scaleVector3(contact.normal, correctionMag);

      let nextPosA = bodyA.position;
      let nextPosB = bodyB.position;
      if (invMassA > 0) {
        nextPosA = subVector3(bodyA.position, scaleVector3(correctionVec, invMassA));
      }
      if (invMassB > 0) {
        nextPosB = addVector3(bodyB.position, scaleVector3(correctionVec, invMassB));
      }

      // Relative velocity along normal
      const relVel = subVector3(bodyB.linearVelocity, bodyA.linearVelocity);
      const velAlongNormal = dotVector3(relVel, contact.normal);

      let nextVelA = bodyA.linearVelocity;
      let nextVelB = bodyB.linearVelocity;

      if (velAlongNormal < 0) {
        const j = (-(1 + restitution) * velAlongNormal) / totalInvMass;
        const impulse = scaleVector3(contact.normal, j);

        if (invMassA > 0) {
          nextVelA = subVector3(nextVelA, scaleVector3(impulse, invMassA));
        }
        if (invMassB > 0) {
          nextVelB = addVector3(nextVelB, scaleVector3(impulse, invMassB));
        }
      }

      if (invMassA > 0) {
        updated.set(
          bodyA.bodyId,
          Object.freeze({
            ...bodyA,
            position: nextPosA,
            linearVelocity: nextVelA,
          })
        );
      }
      if (invMassB > 0) {
        updated.set(
          bodyB.bodyId,
          Object.freeze({
            ...bodyB,
            position: nextPosB,
            linearVelocity: nextVelB,
          })
        );
      }
    }

    return updated;
  }
}

export interface PhysicsStepResult {
  readonly success: boolean;
  readonly stepNumber: number;
  readonly fixedDeltaTime: number;
  readonly contacts: readonly ContactPoint[];
  readonly events: readonly PhysicsCollisionEvent[];
  readonly error?: string;
}

interface ActivePairRecord {
  readonly pairKey: string;
  readonly colliderA: ColliderId;
  readonly colliderB: ColliderId;
  readonly bodyA: PhysicsBodyId;
  readonly bodyB: PhysicsBodyId;
  readonly entityA: string;
  readonly entityB: string;
  readonly isTrigger: boolean;
}

export class PhysicsWorld {
  public readonly worldId: PhysicsWorldId;
  public readonly projectId: string;

  private simulationState: PhysicsSimulationState = 'uninitialized';
  private gravity: Vector3;
  private readonly timestepController: FixedTimestepController;
  private readonly solver: PhysicsSolverContract;
  private readonly logger?: RedactedDiagnosticLogger;

  private readonly bodies = new Map<PhysicsBodyId, RigidBodyDescriptor>();
  private readonly colliders = new Map<ColliderId, ColliderDescriptor>();
  private readonly materials = new Map<
    PhysicsMaterialId,
    PhysicsMaterialDescriptor
  >();

  private activePairs = new Map<string, ActivePairRecord>();
  private lastStepContacts: readonly ContactPoint[] = Object.freeze([]);
  private lastStepEvents: readonly PhysicsCollisionEvent[] = Object.freeze([]);
  private stepCounter = 0;

  constructor(options: {
    readonly projectId: string;
    readonly worldId?: PhysicsWorldId;
    readonly gravity?: Vector3;
    readonly fixedTimestep?: Partial<FixedTimestepConfig>;
    readonly solver?: PhysicsSolverContract;
    readonly logger?: RedactedDiagnosticLogger;
    readonly autoInitialize?: boolean;
  }) {
    const cleanProjectId =
      typeof options.projectId === 'string' && options.projectId.trim().length > 0
        ? options.projectId.trim()
        : 'prj_default';

    this.projectId = cleanProjectId;
    this.worldId =
      options.worldId ?? createPhysicsId('physics', cleanProjectId);

    const gravCheck = validateVector3(
      options.gravity ?? DEFAULT_WORLD_GRAVITY,
      'PhysicsWorld.gravity'
    );
    this.gravity = gravCheck.value ?? DEFAULT_WORLD_GRAVITY;

    this.timestepController = new FixedTimestepController({
      fixedDeltaTime:
        options.fixedTimestep?.fixedDeltaTime ?? DEFAULT_FIXED_DELTA_TIME,
      maxSubsteps: options.fixedTimestep?.maxSubsteps ?? DEFAULT_MAX_SUBSTEPS,
    });

    this.solver = options.solver ?? new FoundationPhysicsSolver();
    this.logger = options.logger;

    const defaultMat = createDefaultPhysicsMaterial();
    this.materials.set(defaultMat.materialId, defaultMat);

    this.logger?.record(
      'physics',
      'INFO',
      `physics_world_created: worldId=${this.worldId} projectId=${this.projectId}`
    );

    if (options.autoInitialize !== false) {
      this.initialize();
    }
  }

  public getSimulationState(): PhysicsSimulationState {
    return this.simulationState;
  }

  public getGravity(): Vector3 {
    return this.gravity;
  }

  public setGravity(candidate: unknown): PhysicsValidationResult<Vector3> {
    const check = validateVector3(candidate, 'PhysicsWorld.gravity');
    if (!check.valid || !check.value) {
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: invalid gravity (${check.errors.join('; ')})`
      );
      return check;
    }
    this.gravity = check.value;
    return check;
  }

  public getFixedTimestepController(): FixedTimestepController {
    return this.timestepController;
  }

  private transitionTo(
    targetState: PhysicsSimulationState
  ): PhysicsValidationResult<PhysicsSimulationState> {
    if (!isValidPhysicsStateTransition(this.simulationState, targetState)) {
      const msg = `Illegal PhysicsWorld state transition '${this.simulationState}' -> '${targetState}' on world '${this.worldId}'.`;
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${msg}`
      );
      return { valid: false, value: null, errors: [msg] };
    }
    this.simulationState = targetState;
    return { valid: true, value: this.simulationState, errors: [] };
  }

  public initialize(): PhysicsValidationResult<PhysicsSimulationState> {
    if (this.simulationState === 'ready') {
      return { valid: true, value: 'ready', errors: [] };
    }
    return this.transitionTo('ready');
  }

  public pause(): PhysicsValidationResult<PhysicsSimulationState> {
    return this.transitionTo('paused');
  }

  public resume(): PhysicsValidationResult<PhysicsSimulationState> {
    return this.transitionTo('ready');
  }

  public shutdown(): PhysicsValidationResult<PhysicsSimulationState> {
    const res = this.transitionTo('shutdown');
    if (res.valid) {
      this.bodies.clear();
      this.colliders.clear();
      this.activePairs.clear();
      this.lastStepContacts = Object.freeze([]);
      this.lastStepEvents = Object.freeze([]);
      this.logger?.record(
        'physics',
        'INFO',
        `physics_world_destroyed: worldId=${this.worldId} projectId=${this.projectId}`
      );
    }
    return res;
  }

  /**
   * Registers a PhysicsMaterial in the world.
   */
  public registerMaterial(
    candidate: unknown
  ): PhysicsValidationResult<PhysicsMaterialDescriptor> {
    const check = validatePhysicsMaterial(candidate);
    if (!check.valid || !check.value) {
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${check.errors.join('; ')}`
      );
      return check;
    }
    this.materials.set(check.value.materialId, check.value);
    return check;
  }

  /**
   * Adds or updates a RigidBody in the world, enforcing strict Project Isolation (STEP 5).
   */
  public addBody(
    candidate: unknown
  ): PhysicsValidationResult<RigidBodyDescriptor> {
    if (this.simulationState === 'shutdown') {
      const msg = `Cannot add RigidBody to shutdown PhysicsWorld '${this.worldId}'.`;
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${msg}`
      );
      return { valid: false, value: null, errors: [msg] };
    }

    const check = validateRigidBody({
      ...(typeof candidate === 'object' && candidate !== null ? candidate : {}),
      projectId:
        typeof candidate === 'object' &&
        candidate !== null &&
        'projectId' in candidate
          ? (candidate as { projectId: unknown }).projectId
          : this.projectId,
    });

    if (!check.valid || !check.value) {
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${check.errors.join('; ')}`
      );
      return check;
    }

    if (check.value.projectId !== this.projectId) {
      const msg = `Cross-Project Physics Isolation Violation: RigidBody '${check.value.bodyId}' belongs to project '${check.value.projectId}', cannot enter PhysicsWorld of project '${this.projectId}'.`;
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${msg}`
      );
      return { valid: false, value: null, errors: [msg] };
    }

    this.bodies.set(check.value.bodyId, check.value);
    this.logger?.record(
      'physics',
      'INFO',
      `physics_body_created: bodyId=${check.value.bodyId} entityId=${check.value.entityId} type=${check.value.bodyType}`
    );
    return check;
  }

  public removeBody(bodyId: PhysicsBodyId): boolean {
    const existing = this.bodies.get(bodyId);
    if (!existing) return false;
    this.bodies.delete(bodyId);

    // Also remove colliders attached to this body
    for (const [colId, col] of this.colliders.entries()) {
      if (col.bodyId === bodyId) {
        this.colliders.delete(colId);
      }
    }

    this.logger?.record(
      'physics',
      'INFO',
      `physics_body_destroyed: bodyId=${bodyId} entityId=${existing.entityId}`
    );
    return true;
  }

  public getBody(bodyId: PhysicsBodyId): RigidBodyDescriptor | null {
    return this.bodies.get(bodyId) ?? null;
  }

  public getBodyByEntityId(entityId: string): RigidBodyDescriptor | null {
    for (const body of this.bodies.values()) {
      if (body.entityId === entityId) return body;
    }
    return null;
  }

  public listBodies(): readonly RigidBodyDescriptor[] {
    return Object.freeze(
      Array.from(this.bodies.values()).sort((a, b) =>
        a.bodyId < b.bodyId ? -1 : a.bodyId > b.bodyId ? 1 : 0
      )
    );
  }

  /**
   * Applies a deterministic force to a RigidBody inside this world.
   */
  public applyForce(
    bodyId: PhysicsBodyId,
    force: unknown
  ): PhysicsValidationResult<RigidBodyDescriptor> {
    const body = this.bodies.get(bodyId);
    if (!body) {
      const msg = `RigidBody '${bodyId}' not found in PhysicsWorld '${this.worldId}'.`;
      return { valid: false, value: null, errors: [msg] };
    }
    const res = applyForceToBody(body, force);
    if (!res.valid || !res.value) {
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${res.errors.join('; ')}`
      );
      return res;
    }
    this.bodies.set(bodyId, res.value);
    return res;
  }

  /**
   * Applies a deterministic immediate impulse to a RigidBody inside this world.
   */
  public applyImpulse(
    bodyId: PhysicsBodyId,
    impulse: unknown
  ): PhysicsValidationResult<RigidBodyDescriptor> {
    const body = this.bodies.get(bodyId);
    if (!body) {
      const msg = `RigidBody '${bodyId}' not found in PhysicsWorld '${this.worldId}'.`;
      return { valid: false, value: null, errors: [msg] };
    }
    const res = applyImpulseToBody(body, impulse);
    if (!res.valid || !res.value) {
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${res.errors.join('; ')}`
      );
      return res;
    }
    this.bodies.set(bodyId, res.value);
    return res;
  }

  /**
   * Applies a deterministic torque to a RigidBody inside this world.
   */
  public applyTorque(
    bodyId: PhysicsBodyId,
    torque: unknown
  ): PhysicsValidationResult<RigidBodyDescriptor> {
    const body = this.bodies.get(bodyId);
    if (!body) {
      const msg = `RigidBody '${bodyId}' not found in PhysicsWorld '${this.worldId}'.`;
      return { valid: false, value: null, errors: [msg] };
    }
    const res = applyTorqueToBody(body, torque);
    if (!res.valid || !res.value) {
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${res.errors.join('; ')}`
      );
      return res;
    }
    this.bodies.set(bodyId, res.value);
    return res;
  }

  /**
   * Adds a Collider to the world, enforcing strict Project Isolation (STEP 5 & STEP 9).
   */
  public addCollider(
    candidate: unknown
  ): PhysicsValidationResult<ColliderDescriptor> {
    if (this.simulationState === 'shutdown') {
      const msg = `Cannot add Collider to shutdown PhysicsWorld '${this.worldId}'.`;
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${msg}`
      );
      return { valid: false, value: null, errors: [msg] };
    }

    const check = validateCollider({
      ...(typeof candidate === 'object' && candidate !== null ? candidate : {}),
      projectId:
        typeof candidate === 'object' &&
        candidate !== null &&
        'projectId' in candidate
          ? (candidate as { projectId: unknown }).projectId
          : this.projectId,
    });

    if (!check.valid || !check.value) {
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${check.errors.join('; ')}`
      );
      return check;
    }

    if (check.value.projectId !== this.projectId) {
      const msg = `Cross-Project Physics Isolation Violation: Collider '${check.value.colliderId}' belongs to project '${check.value.projectId}', cannot enter PhysicsWorld of project '${this.projectId}'.`;
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${msg}`
      );
      return { valid: false, value: null, errors: [msg] };
    }

    if (!this.bodies.has(check.value.bodyId)) {
      // Auto-create an implicit static RigidBody for standalone colliders on the same entity
      const implicitStaticBody = validateRigidBody({
        bodyId: check.value.bodyId,
        entityId: check.value.entityId,
        projectId: this.projectId,
        bodyType: 'static',
      });
      if (implicitStaticBody.valid && implicitStaticBody.value) {
        this.bodies.set(
          implicitStaticBody.value.bodyId,
          implicitStaticBody.value
        );
      }
    }

    this.colliders.set(check.value.colliderId, check.value);
    return check;
  }

  public getCollider(colliderId: ColliderId): ColliderDescriptor | null {
    return this.colliders.get(colliderId) ?? null;
  }

  public listColliders(): readonly ColliderDescriptor[] {
    return Object.freeze(
      Array.from(this.colliders.values()).sort((a, b) =>
        a.colliderId < b.colliderId ? -1 : a.colliderId > b.colliderId ? 1 : 0
      )
    );
  }

  public getLastStepContacts(): readonly ContactPoint[] {
    return this.lastStepContacts;
  }

  public getLastStepEvents(): readonly PhysicsCollisionEvent[] {
    return this.lastStepEvents;
  }

  /**
   * Executes a single deterministic fixed-timestep simulation step (STEP 21).
   */
  public step(customFixedDeltaTime?: number): PhysicsStepResult {
    if (this.simulationState !== 'ready') {
      const msg = `Cannot step PhysicsWorld '${this.worldId}' while in state '${this.simulationState}' (expected 'ready').`;
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${msg}`
      );
      return Object.freeze({
        success: false,
        stepNumber: this.stepCounter,
        fixedDeltaTime: 0,
        contacts: Object.freeze([]),
        events: Object.freeze([]),
        error: msg,
      });
    }

    const dt =
      customFixedDeltaTime ??
      this.timestepController.getConfig().fixedDeltaTime;

    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) {
      const msg = `Invalid step deltaTime '${String(dt)}'; must be finite > 0.`;
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${msg}`
      );
      return Object.freeze({
        success: false,
        stepNumber: this.stepCounter,
        fixedDeltaTime: 0,
        contacts: Object.freeze([]),
        events: Object.freeze([]),
        error: msg,
      });
    }

    this.transitionTo('simulating');
    this.stepCounter += 1;

    this.logger?.record(
      'physics',
      'INFO',
      `physics_step_started: worldId=${this.worldId} step=${this.stepCounter} dt=${dt.toFixed(6)}`
    );

    // 1. Integrate bodies deterministically
    const integratedBodies = this.solver.integrateBodies(
      this.listBodies(),
      this.gravity,
      dt
    );
    for (const b of integratedBodies) {
      this.bodies.set(b.bodyId, b);
    }

    // 2. Deterministic Collision & Trigger Detection across sorted colliders
    const sortedColliders = this.listColliders();
    const currentStepPairs = new Map<
      string,
      { record: ActivePairRecord; contact: ContactPoint }
    >();
    const allContacts: ContactPoint[] = [];
    const solidContacts: ContactPoint[] = [];

    for (let i = 0; i < sortedColliders.length; i++) {
      const colA = sortedColliders[i];
      if (!colA.enabled) continue;
      const bodyA = this.bodies.get(colA.bodyId);
      if (!bodyA || !bodyA.isEnabled) continue;

      for (let j = i + 1; j < sortedColliders.length; j++) {
        const colB = sortedColliders[j];
        if (!colB.enabled) continue;
        // Skip self-collision on the exact same body
        if (colA.bodyId === colB.bodyId) continue;

        const bodyB = this.bodies.get(colB.bodyId);
        if (!bodyB || !bodyB.isEnabled) continue;

        // Skip static-vs-static pairs
        if (bodyA.bodyType === 'static' && bodyB.bodyType === 'static') {
          continue;
        }

        const contact = detectColliderPairCollision(
          colA,
          bodyA.position,
          colB,
          bodyB.position
        );

        if (contact) {
          const pairKey = createDeterministicColliderPairKey(
            colA.colliderId,
            colB.colliderId
          );
          const isTrigger = colA.isTrigger || colB.isTrigger;

          allContacts.push(contact);
          if (!isTrigger) {
            solidContacts.push(contact);
          }

          currentStepPairs.set(pairKey, {
            record: {
              pairKey,
              colliderA: contact.colliderA,
              colliderB: contact.colliderB,
              bodyA: contact.bodyA,
              bodyB: contact.bodyB,
              entityA: colA.entityId,
              entityB: colB.entityId,
              isTrigger,
            },
            contact,
          });
        }
      }
    }

    // 3. Emit deterministic Enter / Stay / Exit events
    const events: PhysicsCollisionEvent[] = [];

    // Check current active pairs for Enter / Stay
    const sortedCurrentKeys = Array.from(currentStepPairs.keys()).sort();
    for (const pairKey of sortedCurrentKeys) {
      const { record, contact } = currentStepPairs.get(pairKey)!;
      const wasActive = this.activePairs.has(pairKey);

      if (record.isTrigger) {
        const eventType = wasActive ? 'triggerStay' : 'triggerEnter';
        events.push(
          Object.freeze({
            eventType,
            pairKey,
            colliderA: record.colliderA,
            colliderB: record.colliderB,
            bodyA: record.bodyA,
            bodyB: record.bodyB,
            entityA: record.entityA,
            entityB: record.entityB,
            isTriggerEvent: true,
            contact,
          })
        );
        if (!wasActive) {
          this.logger?.record(
            'physics',
            'INFO',
            `physics_trigger_enter: pairKey=${pairKey} colliderA=${record.colliderA} colliderB=${record.colliderB}`
          );
        }
      } else {
        const eventType = wasActive ? 'collisionStay' : 'collisionEnter';
        events.push(
          Object.freeze({
            eventType,
            pairKey,
            colliderA: record.colliderA,
            colliderB: record.colliderB,
            bodyA: record.bodyA,
            bodyB: record.bodyB,
            entityA: record.entityA,
            entityB: record.entityB,
            isTriggerEvent: false,
            contact,
          })
        );
        this.logger?.record(
          'physics',
          'INFO',
          `physics_collision_detected: pairKey=${pairKey} event=${eventType} depth=${contact.penetrationDepth.toFixed(4)}`
        );
      }
    }

    // Check previous active pairs for Exit
    const sortedPrevKeys = Array.from(this.activePairs.keys()).sort();
    for (const prevKey of sortedPrevKeys) {
      if (!currentStepPairs.has(prevKey)) {
        const prevRec = this.activePairs.get(prevKey)!;
        const eventType = prevRec.isTrigger ? 'triggerExit' : 'collisionExit';
        events.push(
          Object.freeze({
            eventType,
            pairKey: prevKey,
            colliderA: prevRec.colliderA,
            colliderB: prevRec.colliderB,
            bodyA: prevRec.bodyA,
            bodyB: prevRec.bodyB,
            entityA: prevRec.entityA,
            entityB: prevRec.entityB,
            isTriggerEvent: prevRec.isTrigger,
            contact: null,
          })
        );
        if (prevRec.isTrigger) {
          this.logger?.record(
            'physics',
            'INFO',
            `physics_trigger_exit: pairKey=${prevKey} colliderA=${prevRec.colliderA} colliderB=${prevRec.colliderB}`
          );
        }
      }
    }

    // Update active pairs map for next step
    this.activePairs = new Map();
    for (const [k, v] of currentStepPairs.entries()) {
      this.activePairs.set(k, v.record);
    }

    // 4. Solve solid contacts (Triggers are never passed to solver)
    if (solidContacts.length > 0) {
      const solvedBodies = this.solver.solveContacts(
        this.bodies,
        this.colliders,
        this.materials,
        solidContacts,
        dt
      );
      for (const [bId, bDesc] of solvedBodies.entries()) {
        this.bodies.set(bId, bDesc);
      }
    }

    this.lastStepContacts = Object.freeze(allContacts);
    this.lastStepEvents = Object.freeze(events);

    this.transitionTo('ready');

    this.logger?.record(
      'physics',
      'INFO',
      `physics_step_completed: worldId=${this.worldId} step=${this.stepCounter} contacts=${allContacts.length} events=${events.length}`
    );

    return Object.freeze({
      success: true,
      stepNumber: this.stepCounter,
      fixedDeltaTime: dt,
      contacts: this.lastStepContacts,
      events: this.lastStepEvents,
    });
  }

  /**
   * Advances simulation using `FixedTimestepController` with accumulator and `maxSubsteps` protection.
   */
  public advanceSimulation(elapsedSeconds: unknown): {
    readonly valid: boolean;
    readonly stepsExecuted: number;
    readonly clampedByMaxSubsteps: boolean;
    readonly remainingAccumulator: number;
    readonly stepResults: readonly PhysicsStepResult[];
    readonly errors: readonly string[];
  } {
    if (this.simulationState !== 'ready') {
      const msg = `Cannot advance PhysicsWorld '${this.worldId}' while in state '${this.simulationState}'.`;
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${msg}`
      );
      return Object.freeze({
        valid: false,
        stepsExecuted: 0,
        clampedByMaxSubsteps: false,
        remainingAccumulator: this.timestepController.getAccumulator(),
        stepResults: Object.freeze([]),
        errors: [msg],
      });
    }

    const adv = this.timestepController.advance(elapsedSeconds);
    if (!adv.valid) {
      this.logger?.record(
        'physics',
        'ERROR',
        `physics_validation_failed: ${adv.errors.join('; ')}`
      );
      return Object.freeze({
        valid: false,
        stepsExecuted: 0,
        clampedByMaxSubsteps: false,
        remainingAccumulator: adv.remainingAccumulator,
        stepResults: Object.freeze([]),
        errors: adv.errors,
      });
    }

    const stepResults: PhysicsStepResult[] = [];
    for (let i = 0; i < adv.stepsToExecute; i++) {
      stepResults.push(this.step(adv.fixedDeltaTime));
    }

    return Object.freeze({
      valid: true,
      stepsExecuted: adv.stepsToExecute,
      clampedByMaxSubsteps: adv.clampedByMaxSubsteps,
      remainingAccumulator: adv.remainingAccumulator,
      stepResults: Object.freeze(stepResults),
      errors: Object.freeze([]),
    });
  }
}
