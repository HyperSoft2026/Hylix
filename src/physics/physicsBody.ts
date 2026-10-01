import { isValidEntityId } from '../ecs/ecsCore';
import {
  addVector3,
  createDefaultVector3,
  createPhysicsId,
  isFinitePhysicsNumber,
  isPlainPhysicsObject,
  isValidPhysicsBodyId,
  PhysicsBodyId,
  PhysicsValidationResult,
  scaleVector3,
  validateVector3,
  Vector3,
} from './physicsTypes';

/**
 * Hylix V1.0.0 — Phase 06: RigidBody & Force/Impulse Foundation (STEP 7 & STEP 8)
 *
 * Body Types:
 * - `static`: Infinite mass (`inverseMass = 0`); never moved by simulation or forces.
 * - `dynamic`: Finite positive mass (`mass > 0`, `inverseMass = 1 / mass`); moved by gravity, forces, impulses, and collisions.
 * - `kinematic`: Infinite mass (`inverseMass = 0`); moved deterministically by its `linearVelocity`/`angularVelocity`, unaffected by forces or impulses.
 */

export type RigidBodyType = 'static' | 'dynamic' | 'kinematic';

export interface RigidBodyDescriptor {
  readonly bodyId: PhysicsBodyId;
  readonly entityId: string;
  readonly projectId: string;
  readonly bodyType: RigidBodyType;
  readonly position: Vector3;
  readonly rotation: Vector3;
  readonly linearVelocity: Vector3;
  readonly angularVelocity: Vector3;
  readonly accumulatedForce: Vector3;
  readonly accumulatedTorque: Vector3;
  readonly mass: number;
  readonly inverseMass: number;
  readonly linearDamping: number;
  readonly angularDamping: number;
  readonly gravityScale: number;
  readonly isSleeping: boolean;
  readonly isEnabled: boolean;
}

export function validateRigidBody(
  candidate: unknown
): PhysicsValidationResult<RigidBodyDescriptor> {
  if (!isPlainPhysicsObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['RigidBody must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  if (!isValidEntityId(candidate.entityId)) {
    errors.push(
      `Invalid RigidBody.entityId '${String(candidate.entityId)}'; expected 'ent_<16-hex>'.`
    );
  }

  const projectId =
    typeof candidate.projectId === 'string' && candidate.projectId.trim().length > 0
      ? candidate.projectId.trim()
      : 'prj_default';

  const bodyType = candidate.bodyType;
  if (bodyType !== 'static' && bodyType !== 'dynamic' && bodyType !== 'kinematic') {
    errors.push(
      `Invalid RigidBody.bodyType '${String(bodyType)}'; expected 'static' | 'dynamic' | 'kinematic'.`
    );
  }

  const bodyId: PhysicsBodyId =
    candidate.bodyId !== undefined
      ? (candidate.bodyId as PhysicsBodyId)
      : createPhysicsId('body', `${projectId}::${String(candidate.entityId)}`);

  if (!isValidPhysicsBodyId(bodyId)) {
    errors.push(
      `Invalid RigidBody.bodyId '${String(bodyId)}'; expected 'body_<16-hex>'.`
    );
  }

  const posRes = validateVector3(
    candidate.position ?? createDefaultVector3(),
    'RigidBody.position'
  );
  const rotRes = validateVector3(
    candidate.rotation ?? createDefaultVector3(),
    'RigidBody.rotation'
  );
  const linVelRes = validateVector3(
    candidate.linearVelocity ?? createDefaultVector3(),
    'RigidBody.linearVelocity'
  );
  const angVelRes = validateVector3(
    candidate.angularVelocity ?? createDefaultVector3(),
    'RigidBody.angularVelocity'
  );
  const forceRes = validateVector3(
    candidate.accumulatedForce ?? createDefaultVector3(),
    'RigidBody.accumulatedForce'
  );
  const torqueRes = validateVector3(
    candidate.accumulatedTorque ?? createDefaultVector3(),
    'RigidBody.accumulatedTorque'
  );

  errors.push(
    ...posRes.errors,
    ...rotRes.errors,
    ...linVelRes.errors,
    ...angVelRes.errors,
    ...forceRes.errors,
    ...torqueRes.errors
  );

  const rawMass =
    candidate.mass !== undefined
      ? candidate.mass
      : bodyType === 'dynamic'
      ? 1
      : 0;

  let normalizedMass = 0;
  let inverseMass = 0;

  if (!isFinitePhysicsNumber(rawMass)) {
    errors.push(
      `RigidBody.mass must be a finite number (received ${String(rawMass)}).`
    );
  } else if (rawMass < 0) {
    errors.push(`RigidBody.mass cannot be negative (received ${rawMass}).`);
  } else if (bodyType === 'dynamic') {
    if (rawMass <= 0) {
      errors.push(
        `Dynamic RigidBody must have mass > 0 (received ${rawMass}).`
      );
    } else {
      normalizedMass = rawMass;
      inverseMass = 1 / rawMass;
    }
  } else {
    normalizedMass = rawMass === 0 ? 0 : rawMass;
    inverseMass = 0;
  }

  const linearDamping =
    candidate.linearDamping !== undefined ? candidate.linearDamping : 0.01;
  if (!isFinitePhysicsNumber(linearDamping) || linearDamping < 0) {
    errors.push(
      `RigidBody.linearDamping must be a finite number >= 0 (received ${String(linearDamping)}).`
    );
  }

  const angularDamping =
    candidate.angularDamping !== undefined ? candidate.angularDamping : 0.05;
  if (!isFinitePhysicsNumber(angularDamping) || angularDamping < 0) {
    errors.push(
      `RigidBody.angularDamping must be a finite number >= 0 (received ${String(angularDamping)}).`
    );
  }

  const gravityScale =
    candidate.gravityScale !== undefined ? candidate.gravityScale : 1;
  if (!isFinitePhysicsNumber(gravityScale)) {
    errors.push(
      `RigidBody.gravityScale must be a finite number (received ${String(gravityScale)}).`
    );
  }

  const isSleeping =
    candidate.isSleeping !== undefined ? Boolean(candidate.isSleeping) : false;
  const isEnabled =
    candidate.isEnabled !== undefined ? Boolean(candidate.isEnabled) : true;

  if (
    errors.length > 0 ||
    !posRes.value ||
    !rotRes.value ||
    !linVelRes.value ||
    !angVelRes.value ||
    !forceRes.value ||
    !torqueRes.value
  ) {
    return { valid: false, value: null, errors };
  }

  // Static bodies always have zero linear/angular velocity and zero accumulated force/torque
  const finalLinVel =
    bodyType === 'static' ? createDefaultVector3() : linVelRes.value;
  const finalAngVel =
    bodyType === 'static' ? createDefaultVector3() : angVelRes.value;
  const finalForce =
    bodyType === 'dynamic' ? forceRes.value : createDefaultVector3();
  const finalTorque =
    bodyType === 'dynamic' ? torqueRes.value : createDefaultVector3();

  return {
    valid: true,
    value: Object.freeze({
      bodyId,
      entityId: candidate.entityId as string,
      projectId,
      bodyType: bodyType as RigidBodyType,
      position: posRes.value,
      rotation: rotRes.value,
      linearVelocity: finalLinVel,
      angularVelocity: finalAngVel,
      accumulatedForce: finalForce,
      accumulatedTorque: finalTorque,
      mass: normalizedMass,
      inverseMass,
      linearDamping: linearDamping as number,
      angularDamping: angularDamping as number,
      gravityScale: (gravityScale as number) === 0 ? 0 : (gravityScale as number),
      isSleeping,
      isEnabled,
    }),
    errors: [],
  };
}

/**
 * Deterministically accumulates force on a RigidBody (STEP 8):
 *   Force -> accumulatedForce -> fixed simulation step -> velocity update
 * Static and kinematic bodies ignore applied forces.
 */
export function applyForceToBody(
  body: RigidBodyDescriptor,
  force: unknown
): PhysicsValidationResult<RigidBodyDescriptor> {
  const forceCheck = validateVector3(force, 'applyForce.force');
  if (!forceCheck.valid || !forceCheck.value) {
    return { valid: false, value: null, errors: forceCheck.errors };
  }

  if (!body.isEnabled || body.bodyType !== 'dynamic' || body.inverseMass <= 0) {
    return { valid: true, value: body, errors: [] };
  }

  const f = forceCheck.value;
  const nonZero = Math.abs(f.x) > 0 || Math.abs(f.y) > 0 || Math.abs(f.z) > 0;

  return {
    valid: true,
    value: Object.freeze({
      ...body,
      accumulatedForce: addVector3(body.accumulatedForce, f),
      isSleeping: nonZero ? false : body.isSleeping,
    }),
    errors: [],
  };
}

/**
 * Deterministically applies an immediate impulse to a RigidBody (STEP 8):
 *   Impulse -> immediate linearVelocity change (`v += impulse * inverseMass`)
 * Static and kinematic bodies ignore impulses.
 */
export function applyImpulseToBody(
  body: RigidBodyDescriptor,
  impulse: unknown
): PhysicsValidationResult<RigidBodyDescriptor> {
  const impulseCheck = validateVector3(impulse, 'applyImpulse.impulse');
  if (!impulseCheck.valid || !impulseCheck.value) {
    return { valid: false, value: null, errors: impulseCheck.errors };
  }

  if (!body.isEnabled || body.bodyType !== 'dynamic' || body.inverseMass <= 0) {
    return { valid: true, value: body, errors: [] };
  }

  const imp = impulseCheck.value;
  const deltaV = scaleVector3(imp, body.inverseMass);
  const nonZero =
    Math.abs(imp.x) > 0 || Math.abs(imp.y) > 0 || Math.abs(imp.z) > 0;

  return {
    valid: true,
    value: Object.freeze({
      ...body,
      linearVelocity: addVector3(body.linearVelocity, deltaV),
      isSleeping: nonZero ? false : body.isSleeping,
    }),
    errors: [],
  };
}

/**
 * Deterministically accumulates torque on a RigidBody (STEP 8).
 */
export function applyTorqueToBody(
  body: RigidBodyDescriptor,
  torque: unknown
): PhysicsValidationResult<RigidBodyDescriptor> {
  const torqueCheck = validateVector3(torque, 'applyTorque.torque');
  if (!torqueCheck.valid || !torqueCheck.value) {
    return { valid: false, value: null, errors: torqueCheck.errors };
  }

  if (!body.isEnabled || body.bodyType !== 'dynamic' || body.inverseMass <= 0) {
    return { valid: true, value: body, errors: [] };
  }

  const t = torqueCheck.value;
  const nonZero = Math.abs(t.x) > 0 || Math.abs(t.y) > 0 || Math.abs(t.z) > 0;

  return {
    valid: true,
    value: Object.freeze({
      ...body,
      accumulatedTorque: addVector3(body.accumulatedTorque, t),
      isSleeping: nonZero ? false : body.isSleeping,
    }),
    errors: [],
  };
}

export function clearBodyAccumulators(
  body: RigidBodyDescriptor
): RigidBodyDescriptor {
  return Object.freeze({
    ...body,
    accumulatedForce: createDefaultVector3(),
    accumulatedTorque: createDefaultVector3(),
  });
}
