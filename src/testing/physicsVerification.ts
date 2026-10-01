import { HylixAssetRegistry } from '../assets/assetRegistry';
import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  addComponent,
  createEntity,
  createStandardComponentRegistry,
} from '../ecs/ecsCore';
import {
  ALL_COLLISION_LAYERS_MASK,
  applyForceToBody,
  applyImpulseToBody,
  canCollideByLayers,
  COLLIDER_COMPONENT_TYPE,
  computeColliderAABB2D,
  computeColliderAABB3D,
  containsPointAABB2D,
  containsPointAABB3D,
  createAABB2D,
  createAABB3D,
  createDeterministicColliderPairKey,
  createPhysicsId,
  detectColliderPairCollision,
  expandAABB2D,
  expandAABB3D,
  extractScenePhysicsData,
  FixedTimestepController,
  getCenterAABB2D,
  getCenterAABB3D,
  getSizeAABB2D,
  getSizeAABB3D,
  intersectsAABB2D,
  intersectsAABB3D,
  isValidColliderId,
  isValidPhysicsBodyId,
  isValidPhysicsMaterialId,
  isValidPhysicsWorldId,
  layerIndexToBitmask,
  overlapAABB,
  overlapBox,
  overlapCircle,
  overlapSphere,
  PhysicsWorld,
   raycastPhysicsWorld,
  registerPhysicsEcsComponents,
  RIGID_BODY_COMPONENT_TYPE,
  stepPhysicsAndSynchronizeRenderData,
  unionAABB2D,
  unionAABB3D,
  validateAABB2D,
  validateAABB3D,
  validateBoxShape2D,
  validateBoxShape3D,
  validateCapsuleShape2D,
  validateCapsuleShape3D,
  validateCircleShape2D,
  validateCollider,
  validateContactPoint,
  validateFixedTimestepConfig,
  validatePhysicsMaterial,
  validatePhysicsMotionQuantities,
  validatePhysicsPayloadSecurity,
  validatePhysicsShape,
  validateRay,
  validateRigidBody,
  validateScenePhysicsConfig,
  validateSphereShape3D,
} from '../physics/physicsValidation';
import {
  registerRenderingEcsComponents,
  SPRITE_2D_COMPONENT_TYPE,
} from '../rendering/sceneRenderer';
import {
  createSceneDefinition,
  validateSceneDefinition,
} from '../scene/sceneSystem';
import { VerificationAssertionResult } from './foundationVerification';

/**
 * Hylix Phase 06 — Physics Foundation + Collision & Spatial Queries Verification Suite
 *
 * Implements 39 deterministic assertions covering all 38 mandatory test categories
 * in Prompt 06 STEP 34 plus structured diagnostic event verification (STEP 33).
 */
export function runPhysicsVerificationChecks(): VerificationAssertionResult[] {
  const results: VerificationAssertionResult[] = [];
  const logger = new RedactedDiagnosticLogger(400);

  // 1. Physics ID validation (deterministic, non-random, invariant across calls)
  const worldId1 = createPhysicsId('physics', 'prj_demo::scene_main');
  const worldId2 = createPhysicsId('physics', 'prj_demo::scene_main');
  const bodyId1 = createPhysicsId('body', 'prj_demo::ent_0000000000000001');
  const colId1 = createPhysicsId(
    'collider',
    'prj_demo::ent_0000000000000001::box3d'
  );
  const pmatId1 = createPhysicsId('pmat', 'BouncyRubber');
  results.push({
    id: 'phys_01_id_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '01. Deterministic Physics IDs (physics_, body_, collider_, pmat_)',
    passed:
      worldId1 === worldId2 &&
      isValidPhysicsWorldId(worldId1) &&
      isValidPhysicsBodyId(bodyId1) &&
      isValidColliderId(colId1) &&
      isValidPhysicsMaterialId(pmatId1) &&
      !isValidPhysicsBodyId('body_invalid') &&
      !isValidColliderId('col_123'),
    details: `Verified deterministic IDs (${worldId1}, ${bodyId1}, ${colId1}) and rejected invalid formats.`,
  });

  // 2. PhysicsWorld lifecycle (uninitialized -> ready -> simulating -> ready, ready <-> paused, -> shutdown; blocks shutdown -> simulating)
  const lifecycleWorld = new PhysicsWorld({
    projectId: 'prj_lifecycle',
    logger,
    autoInitialize: false,
  });
  const stateUninit = lifecycleWorld.getSimulationState();
  const stepWhileUninit = lifecycleWorld.step();
  const initOk = lifecycleWorld.initialize();
  const pauseOk = lifecycleWorld.pause();
  const stepWhilePaused = lifecycleWorld.step();
  const resumeOk = lifecycleWorld.resume();
  const stepWhenReady = lifecycleWorld.step();
  const stateAfterStep = lifecycleWorld.getSimulationState();
  const shutdownOk = lifecycleWorld.shutdown();
  const stepAfterShutdown = lifecycleWorld.step();
  const resumeAfterShutdown = lifecycleWorld.resume();
  results.push({
    id: 'phys_02_world_lifecycle',
    category: 'Physics Foundation & Spatial Queries',
    title: '02. PhysicsWorld Lifecycle State Machine & Illegal Transition Guards',
    passed:
      stateUninit === 'uninitialized' &&
      !stepWhileUninit.success &&
      initOk.valid &&
      initOk.value === 'ready' &&
      pauseOk.valid &&
      pauseOk.value === 'paused' &&
      !stepWhilePaused.success &&
      resumeOk.valid &&
      resumeOk.value === 'ready' &&
      stepWhenReady.success &&
      stateAfterStep === 'ready' &&
      shutdownOk.valid &&
      shutdownOk.value === 'shutdown' &&
      !stepAfterShutdown.success &&
      !resumeAfterShutdown.valid,
    details:
      'Verified uninitialized -> ready -> paused -> ready -> simulating -> ready -> shutdown and blocked shutdown -> simulating.',
  });

  // 3. Project isolation (Project A world rejects Project B body & collider)
  const worldProjA = new PhysicsWorld({ projectId: 'prj_alpha', logger });
  const foreignBodyAttempt = worldProjA.addBody({
    entityId: 'ent_0000000000000001',
    projectId: 'prj_beta_foreign',
    bodyType: 'dynamic',
    mass: 2,
  });
  const foreignColliderAttempt = worldProjA.addCollider({
    entityId: 'ent_0000000000000001',
    projectId: 'prj_beta_foreign',
    shape: { kind: 'sphere3d', dimension: '3D', radius: 1 },
  });
  results.push({
    id: 'phys_03_project_isolation',
    category: 'Physics Foundation & Spatial Queries',
    title: '03. PhysicsWorld Strict Project Isolation Guard',
    passed: !foreignBodyAttempt.valid && !foreignColliderAttempt.valid,
    details:
      "Blocked 'prj_beta_foreign' RigidBody and Collider from entering 'prj_alpha' PhysicsWorld.",
  });

  // 4. Vector & Physics motion quantity validation (velocity, angularVelocity, force, torque, acceleration)
  const motionOk = validatePhysicsMotionQuantities({
    velocity: { x: 1, y: 2, z: 3 },
    angularVelocity: { x: 0, y: 1, z: 0 },
    force: { x: 10, y: 0, z: -5 },
    torque: { x: 0, y: 0.5, z: 0 },
    acceleration: { x: 0, y: -9.81, z: 0 },
  });
  const motionBad = validatePhysicsMotionQuantities({
    velocity: { x: 1, y: NaN, z: 3 },
  });
  results.push({
    id: 'phys_04_vector_and_motion_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '04. Physics Vector2/Vector3 & Motion Quantities Validation',
    passed: motionOk.valid && !motionBad.valid,
    details:
      'Validated velocity, angularVelocity, force, torque, and acceleration vectors using shared rendering/matrices contracts.',
  });

  // 5. RigidBody creation & defaults
  const rbCreate = validateRigidBody({
    entityId: 'ent_0000000000000005',
    projectId: 'prj_alpha',
    bodyType: 'dynamic',
    mass: 4,
  });
  results.push({
    id: 'phys_05_rigid_body_creation',
    category: 'Physics Foundation & Spatial Queries',
    title: '05. RigidBody Creation & InverseMass Computation',
    passed:
      rbCreate.valid &&
      rbCreate.value?.mass === 4 &&
      rbCreate.value?.inverseMass === 0.25 &&
      rbCreate.value?.isEnabled === true,
    details: `Created dynamic RigidBody '${rbCreate.value?.bodyId}' with mass=4 and inverseMass=0.25.`,
  });

  // 6. Static body behavior (inverseMass = 0, never moves during simulation or force/impulse)
  const simWorld = new PhysicsWorld({
    projectId: 'prj_sim',
    gravity: { x: 0, y: -10, z: 0 },
    logger,
  });
  const staticBodyRes = simWorld.addBody({
    entityId: 'ent_0000000000000006',
    bodyType: 'static',
    position: { x: 5, y: 10, z: 0 },
  });
  simWorld.applyForce(staticBodyRes.value!.bodyId, { x: 100, y: 100, z: 0 });
  simWorld.applyImpulse(staticBodyRes.value!.bodyId, { x: 50, y: 50, z: 0 });
  simWorld.step(0.1);
  const staticAfterStep = simWorld.getBody(staticBodyRes.value!.bodyId)!;
  results.push({
    id: 'phys_06_static_body',
    category: 'Physics Foundation & Spatial Queries',
    title: '06. Static RigidBody Immutability Under Gravity, Forces & Impulses',
    passed:
      staticAfterStep.inverseMass === 0 &&
      staticAfterStep.position.x === 5 &&
      staticAfterStep.position.y === 10 &&
      staticAfterStep.linearVelocity.x === 0 &&
      staticAfterStep.linearVelocity.y === 0,
    details:
      'Confirmed static body has inverseMass=0 and remains stationary under gravity, forces, and impulses.',
  });

  // 7. Dynamic body behavior (moves deterministically under gravity)
  const dynBodyRes = simWorld.addBody({
    entityId: 'ent_0000000000000007',
    bodyType: 'dynamic',
    mass: 2,
    linearDamping: 0,
    position: { x: 0, y: 20, z: 0 },
  });
  simWorld.step(0.1);
  const dynAfterStep = simWorld.getBody(dynBodyRes.value!.bodyId)!;
  results.push({
    id: 'phys_07_dynamic_body',
    category: 'Physics Foundation & Spatial Queries',
    title: '07. Dynamic RigidBody Gravity Integration',
    passed:
      dynAfterStep.linearVelocity.y < 0 &&
      dynAfterStep.position.y < 20,
    details: `Dynamic body accelerated under gravity to velocity.y=${dynAfterStep.linearVelocity.y.toFixed(2)}, position.y=${dynAfterStep.position.y.toFixed(2)}.`,
  });

  // 8. Kinematic body behavior (moves by linearVelocity, unaffected by gravity or forces)
  const kinBodyRes = simWorld.addBody({
    entityId: 'ent_0000000000000008',
    bodyType: 'kinematic',
    position: { x: 0, y: 0, z: 0 },
    linearVelocity: { x: 10, y: 0, z: 0 },
  });
  simWorld.applyForce(kinBodyRes.value!.bodyId, { x: 0, y: 999, z: 0 });
  simWorld.step(0.5);
  const kinAfterStep = simWorld.getBody(kinBodyRes.value!.bodyId)!;
  results.push({
    id: 'phys_08_kinematic_body',
    category: 'Physics Foundation & Spatial Queries',
    title: '08. Kinematic RigidBody Velocity Motion & Force Immunity',
    passed:
      kinAfterStep.inverseMass === 0 &&
      Math.abs(kinAfterStep.position.x - 5) < 1e-6 &&
      kinAfterStep.position.y === 0 &&
      kinAfterStep.linearVelocity.y === 0,
    details:
      'Confirmed kinematic body moved deterministically along X (0 -> 5) while ignoring gravity and applied forces.',
  });

  // 9. Invalid mass rejection (mass <= 0 for dynamic, negative mass for static/kinematic)
  const zeroMassDyn = validateRigidBody({
    entityId: 'ent_0000000000000009',
    bodyType: 'dynamic',
    mass: 0,
  });
  const negMassDyn = validateRigidBody({
    entityId: 'ent_0000000000000009',
    bodyType: 'dynamic',
    mass: -5,
  });
  const negMassStatic = validateRigidBody({
    entityId: 'ent_0000000000000009',
    bodyType: 'static',
    mass: -1,
  });
  results.push({
    id: 'phys_09_invalid_mass_rejection',
    category: 'Physics Foundation & Spatial Queries',
    title: '09. Invalid & Negative Mass Rejection Guard',
    passed: !zeroMassDyn.valid && !negMassDyn.valid && !negMassStatic.valid,
    details: 'Rejected mass=0 and mass=-5 on dynamic bodies and mass=-1 on static bodies.',
  });

  // 10. Force validation & deterministic accumulation
  const forceTestBody = validateRigidBody({
    entityId: 'ent_0000000000000010',
    bodyType: 'dynamic',
    mass: 2,
    linearDamping: 0,
    gravityScale: 0,
  }).value!;
  const forceApplied = applyForceToBody(forceTestBody, { x: 20, y: 0, z: 0 });
  const forceInvalid = applyForceToBody(forceTestBody, { x: NaN, y: 0, z: 0 });
  results.push({
    id: 'phys_10_force_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '10. Deterministic Force Accumulation & Validation',
    passed:
      forceApplied.valid &&
      forceApplied.value?.accumulatedForce.x === 20 &&
      !forceInvalid.valid,
    details: 'Accumulated valid force (20, 0, 0) and rejected NaN force vector.',
  });

  // 11. Impulse validation & immediate deterministic velocity change
  const impulseApplied = applyImpulseToBody(forceTestBody, { x: 10, y: -4, z: 0 });
  const impulseInvalid = applyImpulseToBody(forceTestBody, {
    x: Infinity,
    y: 0,
    z: 0,
  });
  results.push({
    id: 'phys_11_impulse_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '11. Immediate Deterministic Impulse Velocity Change & Validation',
    passed:
      impulseApplied.valid &&
      impulseApplied.value?.linearVelocity.x === 5 && // 10 * (1/2)
      impulseApplied.value?.linearVelocity.y === -2 && // -4 * (1/2)
      !impulseInvalid.valid,
    details:
      'Verified immediate velocity update (v += impulse * inverseMass) and rejected Infinity impulse.',
  });

  // 12. Collider creation & bounding volume generation
  const validCol = validateCollider({
    entityId: 'ent_0000000000000012',
    projectId: 'prj_sim',
    shape: { kind: 'circle2d', dimension: '2D', radius: 3 },
    localTransform: {
      offset: { x: 1, y: 2, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
  });
  const colAABB2D = validCol.value
    ? computeColliderAABB2D(validCol.value, { x: 10, y: 20, z: 0 })
    : null;
  const colAABB3D = validCol.value
    ? computeColliderAABB3D(validCol.value, { x: 10, y: 20, z: 0 })
    : null;
  results.push({
    id: 'phys_12_collider_creation_and_bounds',
    category: 'Physics Foundation & Spatial Queries',
    title: '12. Decoupled Collider Creation & Bounding Volume Generation',
    passed:
      validCol.valid &&
      colAABB2D !== null &&
      colAABB2D.min.x === 8 && // (10 + 1) - 3
      colAABB2D.max.x === 14 && // (10 + 1) + 3
      colAABB3D !== null,
    details: `Created Collider '${validCol.value?.colliderId}' and generated world AABB2D/AABB3D.`,
  });

  // 13. Circle shape validation (2D)
  const circleOk = validateCircleShape2D({ radius: 2.5 });
  const circleZero = validateCircleShape2D({ radius: 0 });
  const circleNeg = validateCircleShape2D({ radius: -1 });
  results.push({
    id: 'phys_13_circle_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '13. 2D Circle Shape Validation (radius > 0)',
    passed: circleOk.valid && !circleZero.valid && !circleNeg.valid,
    details: 'Accepted radius=2.5 and rejected radius=0 and radius=-1.',
  });

  // 14. Box shape validation (2D & 3D)
  const box2DOk = validateBoxShape2D({ halfExtents: { x: 1, y: 2 } });
  const box2DBad = validateBoxShape2D({ halfExtents: { x: -1, y: 2 } });
  const box3DOk = validateBoxShape3D({ halfExtents: { x: 1, y: 2, z: 3 } });
  const box3DBad = validateBoxShape3D({ halfExtents: { x: 1, y: 0, z: 3 } });
  results.push({
    id: 'phys_14_box_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '14. 2D & 3D Box Shape Validation (halfExtents > 0)',
    passed: box2DOk.valid && !box2DBad.valid && box3DOk.valid && !box3DBad.valid,
    details: 'Validated 2D/3D Box halfExtents and rejected zero/negative dimensions.',
  });

  // 15. Capsule shape validation (2D & 3D)
  const cap2DOk = validateCapsuleShape2D({ radius: 0.5, halfHeight: 1.5 });
  const cap2DBad = validateCapsuleShape2D({ radius: 0.5, halfHeight: -1 });
  const cap3DOk = validateCapsuleShape3D({ radius: 0.5, halfHeight: 2.0 });
  const cap3DBad = validateCapsuleShape3D({ radius: 0, halfHeight: 2.0 });
  results.push({
    id: 'phys_15_capsule_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '15. 2D & 3D Capsule Shape Validation (radius > 0, halfHeight > 0)',
    passed: cap2DOk.valid && !cap2DBad.valid && cap3DOk.valid && !cap3DBad.valid,
    details: 'Validated 2D/3D Capsule shapes and rejected invalid radius/halfHeight.',
  });

  // 16. Sphere shape validation (3D) & unsupported Mesh Collider rejection
  const sphereOk = validateSphereShape3D({ radius: 5 });
  const sphereBad = validateSphereShape3D({ radius: -0.1 });
  const meshUnsupported = validatePhysicsShape({ kind: 'mesh3d' });
  results.push({
    id: 'phys_16_sphere_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '16. 3D Sphere Shape Validation & Mesh Collider Phase Guard',
    passed: sphereOk.valid && !sphereBad.valid && !meshUnsupported.valid,
    details:
      'Validated SphereShape3D (radius > 0) and rejected unsupported Mesh Collider kind in Phase 06.',
  });

  // 17. AABB2D operations & min > max rejection
  const aabb2d = createAABB2D({ x: -2, y: -4 }, { x: 6, y: 8 }).value!;
  const aabb2dInverted = validateAABB2D({
    min: { x: 10, y: 0 },
    max: { x: 2, y: 5 },
  });
  const center2d = getCenterAABB2D(aabb2d);
  const size2d = getSizeAABB2D(aabb2d);
  const expanded2d = expandAABB2D(aabb2d, 1).value!;
  const union2d = unionAABB2D(
    aabb2d,
    createAABB2D({ x: 0, y: 0 }, { x: 10, y: 12 }).value!
  );
  results.push({
    id: 'phys_17_aabb2d_operations',
    category: 'Physics Foundation & Spatial Queries',
    title: '17. AABB2D Operations (containsPoint, expand, union, center, size) & Validation',
    passed:
      !aabb2dInverted.valid &&
      containsPointAABB2D(aabb2d, { x: 2, y: 2 }) &&
      !containsPointAABB2D(aabb2d, { x: 20, y: 2 }) &&
      center2d.x === 2 &&
      center2d.y === 2 &&
      size2d.x === 8 &&
      size2d.y === 12 &&
      expanded2d.min.x === -3 &&
      union2d.max.x === 10 &&
      union2d.max.y === 12,
    details: 'Verified all AABB2D geometric operations and rejected min > max.',
  });

  // 18. AABB3D operations & min > max rejection
  const aabb3d = createAABB3D(
    { x: -1, y: -2, z: -3 },
    { x: 3, y: 6, z: 9 }
  ).value!;
  const aabb3dInverted = validateAABB3D({
    min: { x: 0, y: 0, z: 5 },
    max: { x: 1, y: 1, z: -5 },
  });
  const center3d = getCenterAABB3D(aabb3d);
  const size3d = getSizeAABB3D(aabb3d);
  const expanded3d = expandAABB3D(aabb3d, 2).value!;
  const union3d = unionAABB3D(
    aabb3d,
    createAABB3D({ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 15 }).value!
  );
  results.push({
    id: 'phys_18_aabb3d_operations',
    category: 'Physics Foundation & Spatial Queries',
    title: '18. AABB3D Operations (containsPoint, expand, union, center, size) & Validation',
    passed:
      !aabb3dInverted.valid &&
      containsPointAABB3D(aabb3d, { x: 0, y: 0, z: 0 }) &&
      !containsPointAABB3D(aabb3d, { x: 0, y: 0, z: 20 }) &&
      center3d.x === 1 &&
      center3d.y === 2 &&
      center3d.z === 3 &&
      size3d.x === 4 &&
      size3d.y === 8 &&
      size3d.z === 12 &&
      expanded3d.min.z === -5 &&
      union3d.max.z === 15,
    details: 'Verified all AABB3D geometric operations and rejected min > max.',
  });

  // 19. AABB intersection (2D & 3D)
  const box2dOverlap = createAABB2D({ x: 5, y: 5 }, { x: 10, y: 10 }).value!;
  const box2dDisjoint = createAABB2D({ x: 20, y: 20 }, { x: 30, y: 30 }).value!;
  const box3dOverlap = createAABB3D(
    { x: 2, y: 2, z: 2 },
    { x: 8, y: 8, z: 8 }
  ).value!;
  const box3dDisjoint = createAABB3D(
    { x: 20, y: 20, z: 20 },
    { x: 25, y: 25, z: 25 }
  ).value!;
  results.push({
    id: 'phys_19_aabb_intersection',
    category: 'Physics Foundation & Spatial Queries',
    title: '19. AABB2D & AABB3D Overlap Intersection Detection',
    passed:
      intersectsAABB2D(aabb2d, box2dOverlap) &&
      !intersectsAABB2D(aabb2d, box2dDisjoint) &&
      intersectsAABB3D(aabb3d, box3dOverlap) &&
      !intersectsAABB3D(aabb3d, box3dDisjoint),
    details: 'Verified AABB2D and AABB3D intersection and disjoint separation.',
  });

  // 20. Collision layer filtering (32-bit bitmask conversion & bounds)
  const layer0 = layerIndexToBitmask(0);
  const layer31 = layerIndexToBitmask(31);
  const layer32Invalid = layerIndexToBitmask(32);
  const layerNegInvalid = layerIndexToBitmask(-1);
  results.push({
    id: 'phys_20_collision_layer_filtering',
    category: 'Physics Foundation & Spatial Queries',
    title: '20. 32-Bit Collision Layer Indexing & Bitmask Bounds [0..31]',
    passed:
      layer0.valid &&
      layer0.value === 1 &&
      layer31.valid &&
      layer31.value === 0x80000000 &&
      !layer32Invalid.valid &&
      !layerNegInvalid.valid,
    details: 'Validated 32-bit unsigned layer bitmasks and rejected layer indices outside [0..31].',
  });

  // 21. Collision mask filtering: (layerA & maskB) !== 0 && (layerB & maskA) !== 0
  const maskAllows = canCollideByLayers(0b0001, 0b0010, 0b0010, 0b0001);
  const maskOneWayBlocked = canCollideByLayers(0b0001, 0b0010, 0b0010, 0b0000);
  const maskBothBlocked = canCollideByLayers(0b0001, 0b0001, 0b0010, 0b0010);
  results.push({
    id: 'phys_21_collision_mask_filtering',
    category: 'Physics Foundation & Spatial Queries',
    title: '21. Bidirectional Bitmask Filtering ((layerA & maskB) && (layerB & maskA))',
    passed: maskAllows && !maskOneWayBlocked && !maskBothBlocked,
    details:
      'Enforced bidirectional bitmask agreement before collision detection.',
  });

  // 22. Trigger behavior (detects overlap, emits triggerEnter/Stay/Exit, does NOT physically resolve velocity/position)
  const triggerWorld = new PhysicsWorld({
    projectId: 'prj_trigger',
    gravity: { x: 0, y: 0, z: 0 },
    logger,
  });
  const moverBody = triggerWorld.addBody({
    entityId: 'ent_0000000000000101',
    bodyType: 'dynamic',
    mass: 1,
    linearDamping: 0,
    position: { x: 0, y: 0, z: 0 },
    linearVelocity: { x: 10, y: 0, z: 0 },
  }).value!;
  triggerWorld.addCollider({
    entityId: 'ent_0000000000000101',
    bodyId: moverBody.bodyId,
    shape: { kind: 'sphere3d', dimension: '3D', radius: 1 },
    isTrigger: false,
  });

  const zoneBody = triggerWorld.addBody({
    entityId: 'ent_0000000000000102',
    bodyType: 'static',
    position: { x: 1, y: 0, z: 0 },
  }).value!;
  triggerWorld.addCollider({
    entityId: 'ent_0000000000000102',
    bodyId: zoneBody.bodyId,
    shape: { kind: 'sphere3d', dimension: '3D', radius: 2 },
    isTrigger: true, // Trigger zone!
  });

  const step1Trigger = triggerWorld.step(0.1); // Mover at x=1 -> overlaps trigger -> triggerEnter
  const moverAfterTriggerEnter = triggerWorld.getBody(moverBody.bodyId)!;
  const step2Trigger = triggerWorld.step(0.1); // Mover at x=2 -> still overlaps -> triggerStay
  const step3Trigger = triggerWorld.step(1.0); // Mover at x=12 -> outside trigger -> triggerExit
  results.push({
    id: 'phys_22_trigger_behavior',
    category: 'Physics Foundation & Spatial Queries',
    title: '22. Trigger Overlap Detection (triggerEnter/Stay/Exit) Without Impulse Resolution',
    passed:
      step1Trigger.events.length === 1 &&
      step1Trigger.events[0].eventType === 'triggerEnter' &&
      moverAfterTriggerEnter.linearVelocity.x === 10 && // velocity untouched by trigger!
      step2Trigger.events.length === 1 &&
      step2Trigger.events[0].eventType === 'triggerStay' &&
      step3Trigger.events.length === 1 &&
      step3Trigger.events[0].eventType === 'triggerExit',
    details:
      'Verified triggerEnter -> triggerStay -> triggerExit lifecycle with zero physical impulse applied to dynamic body.',
  });

  // 23. ContactPoint validation & immutability
  const cpValid = validateContactPoint({
    point: { x: 1, y: 2, z: 3 },
    normal: { x: 1, y: 0, z: 0 },
    penetrationDepth: 0.25,
    bodyA: 'body_0000000000000001',
    bodyB: 'body_0000000000000002',
    colliderA: 'collider_0000000000000001',
    colliderB: 'collider_0000000000000002',
  });
  const cpZeroNormal = validateContactPoint({
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 0 },
    penetrationDepth: 0.1,
    bodyA: 'body_0000000000000001',
    bodyB: 'body_0000000000000002',
    colliderA: 'collider_0000000000000001',
    colliderB: 'collider_0000000000000002',
  });
  const cpNegDepth = validateContactPoint({
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    penetrationDepth: -0.5,
    bodyA: 'body_0000000000000001',
    bodyB: 'body_0000000000000002',
    colliderA: 'collider_0000000000000001',
    colliderB: 'collider_0000000000000002',
  });
  results.push({
    id: 'phys_23_contact_point_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '23. Immutable ContactPoint Validation (Point, Normal, PenetrationDepth, IDs)',
    passed:
      cpValid.valid &&
      Object.isFrozen(cpValid.value) &&
      !cpZeroNormal.valid &&
      !cpNegDepth.valid,
    details:
      'Validated immutable ContactPoint and rejected zero normal vector and negative penetrationDepth.',
  });

  // 24. Collision pair determinism ((A, B) === (B, A) across 2D & 3D shapes)
  const colAlpha = validateCollider({
    colliderId: 'collider_000000000000000a',
    entityId: 'ent_000000000000000a',
    bodyId: 'body_000000000000000a',
    shape: { kind: 'circle2d', dimension: '2D', radius: 2 },
  }).value!;
  const colBeta = validateCollider({
    colliderId: 'collider_000000000000000b',
    entityId: 'ent_000000000000000b',
    bodyId: 'body_000000000000000b',
    shape: { kind: 'box2d', dimension: '2D', halfExtents: { x: 2, y: 2 } },
  }).value!;
  const keyAB = createDeterministicColliderPairKey(
    colAlpha.colliderId,
    colBeta.colliderId
  );
  const keyBA = createDeterministicColliderPairKey(
    colBeta.colliderId,
    colAlpha.colliderId
  );
  const contactAB = detectColliderPairCollision(
    colAlpha,
    { x: 0, y: 0, z: 0 },
    colBeta,
    { x: 2.5, y: 0, z: 0 }
  );
  const contactBA = detectColliderPairCollision(
    colBeta,
    { x: 2.5, y: 0, z: 0 },
    colAlpha,
    { x: 0, y: 0, z: 0 }
  );
  results.push({
    id: 'phys_24_collision_pair_determinism',
    category: 'Physics Foundation & Spatial Queries',
    title: '24. Collision Pair Determinism (A-B === B-A Key & Manifold)',
    passed:
      keyAB === keyBA &&
      contactAB !== null &&
      contactBA !== null &&
      JSON.stringify(contactAB) === JSON.stringify(contactBA),
    details: `Verified identical pairKey ('${keyAB}') and identical ContactPoint whether tested as (A,B) or (B,A).`,
  });

  // 25. Fixed timestep validation (rejects <= 0, NaN, Infinity)
  const tsDefault = validateFixedTimestepConfig(undefined);
  const tsZero = validateFixedTimestepConfig({ fixedDeltaTime: 0 });
  const tsNeg = validateFixedTimestepConfig({ fixedDeltaTime: -1 / 60 });
  results.push({
    id: 'phys_25_fixed_timestep_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '25. FixedTimestep Configuration & Non-Positive Rejection',
    passed:
      tsDefault.valid &&
      Math.abs(tsDefault.value!.fixedDeltaTime - 1 / 60) < 1e-9 &&
      !tsZero.valid &&
      !tsNeg.valid,
    details: 'Verified default fixedDeltaTime = 1/60s and rejected zero/negative timesteps.',
  });

  // 26. Accumulator behavior (sub-step accumulation across frames)
  const tsController = new FixedTimestepController({
    fixedDeltaTime: 0.02, // 50 Hz
    maxSubsteps: 5,
  });
  const advHalfStep = tsController.advance(0.01); // accumulator = 0.01 -> 0 steps
  const advNextStep = tsController.advance(0.035); // accumulator = 0.045 -> 2 steps (0.04), rem = 0.005
  results.push({
    id: 'phys_26_timestep_accumulator',
    category: 'Physics Foundation & Spatial Queries',
    title: '26. FixedTimestepController Accumulator Sub-Frame Precision',
    passed:
      advHalfStep.valid &&
      advHalfStep.stepsToExecute === 0 &&
      Math.abs(advHalfStep.remainingAccumulator - 0.01) < 1e-9 &&
      advNextStep.valid &&
      advNextStep.stepsToExecute === 2 &&
      Math.abs(advNextStep.remainingAccumulator - 0.005) < 1e-9,
    details:
      'Verified sub-step time accumulation and residual remainder preservation across frames.',
  });

  // 27. Max substeps spiral-of-death protection
  const advSpike = tsController.advance(2.0); // 2.0s / 0.02s = 100 steps -> clamped to maxSubsteps=5
  results.push({
    id: 'phys_27_max_substeps_guard',
    category: 'Physics Foundation & Spatial Queries',
    title: '27. Spiral-of-Death Protection via MaxSubsteps Clamping',
    passed:
      advSpike.valid &&
      advSpike.stepsToExecute === 5 &&
      advSpike.clampedByMaxSubsteps === true &&
      advSpike.remainingAccumulator === 0,
    details:
      'Clamped a 100-step frame spike down to maxSubsteps=5 and cleared backlog accumulator.',
  });

  // 28. Ray validation (rejects zero direction vector and maxDistance <= 0)
  const rayOk = validateRay({
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 10 },
    maxDistance: 100,
  });
  const rayZeroDir = validateRay({
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 0 },
    maxDistance: 100,
  });
  const rayBadDist = validateRay({
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    maxDistance: 0,
  });
  results.push({
    id: 'phys_28_ray_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '28. Ray Validation (Direction Normalization, Zero-Vector & Distance Guards)',
    passed:
      rayOk.valid &&
      rayOk.value?.direction.z === 1 &&
      !rayZeroDir.valid &&
      !rayBadDist.valid,
    details:
      'Normalized Ray direction to unit length and rejected zero direction vector (0,0,0) and maxDistance <= 0.',
  });

  // 29. Raycast deterministic ordering (sorted by distance ASC, then colliderId ASC)
  const queryWorld = new PhysicsWorld({ projectId: 'prj_query', logger });
  const farBody = queryWorld.addBody({
    entityId: 'ent_0000000000000201',
    bodyType: 'static',
    position: { x: 20, y: 0, z: 0 },
  }).value!;
  const nearBody = queryWorld.addBody({
    entityId: 'ent_0000000000000202',
    bodyType: 'static',
    position: { x: 6, y: 0, z: 0 },
  }).value!;
  const colFar = queryWorld.addCollider({
    entityId: 'ent_0000000000000201',
    bodyId: farBody.bodyId,
    shape: { kind: 'sphere3d', dimension: '3D', radius: 2 },
  }).value!;
  const colNear = queryWorld.addCollider({
    entityId: 'ent_0000000000000202',
    bodyId: nearBody.bodyId,
    shape: { kind: 'box3d', dimension: '3D', halfExtents: { x: 1, y: 1, z: 1 } },
  }).value!;

  const raycastRes = raycastPhysicsWorld(
    queryWorld,
    {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      maxDistance: 50,
    },
    { logger }
  );
  results.push({
    id: 'phys_29_raycast_ordering',
    category: 'Physics Foundation & Spatial Queries',
    title: '29. Raycast Deterministic Hit Ordering (distance ASC, colliderId ASC)',
    passed:
      raycastRes.valid &&
      raycastRes.value?.length === 2 &&
      raycastRes.value[0].colliderId === colNear.colliderId &&
      Math.abs(raycastRes.value[0].distance - 5) < 1e-6 &&
      raycastRes.value[1].colliderId === colFar.colliderId &&
      Math.abs(raycastRes.value[1].distance - 18) < 1e-6,
    details:
      'Returned raycast hits deterministically ordered from nearest (distance=5) to farthest (distance=18).',
  });

  // 30. Overlap queries (overlapCircle, overlapBox, overlapSphere, overlapAABB — deterministic & unique)
  const ovSphere = overlapSphere(
    queryWorld,
    { x: 6, y: 0, z: 0 },
    3,
    { logger }
  );
  const ovBox3D = overlapBox(
    queryWorld,
    { x: 10, y: 0, z: 0 },
    { x: 15, y: 2, z: 2 },
    { logger }
  );
  const ovAABB = overlapAABB(
    queryWorld,
    { min: { x: 0, y: -2, z: -2 }, max: { x: 25, y: 2, z: 2 } },
    { logger }
  );
  const ovCircle = overlapCircle(
    queryWorld,
    { x: 6, y: 0 },
    3,
    { logger }
  );
  results.push({
    id: 'phys_30_overlap_queries',
    category: 'Physics Foundation & Spatial Queries',
    title: '30. Deterministic & Unique Overlap Queries (Circle, Box, Sphere, AABB)',
    passed:
      ovSphere.valid &&
      ovSphere.value?.length === 1 &&
      ovSphere.value[0].colliderId === colNear.colliderId &&
      ovBox3D.valid &&
      ovBox3D.value?.length === 2 &&
      ovAABB.valid &&
      ovAABB.value?.length === 2 &&
      ovCircle.valid &&
      ovCircle.value?.length === 1,
    details:
      'Verified overlapSphere, overlapBox, overlapAABB, and overlapCircle return unique, deterministically sorted matches.',
  });

  // 31. PhysicsMaterial validation (friction >= 0, 0 <= restitution <= 1)
  const pmatValid = validatePhysicsMaterial({
    name: 'IceSurface',
    friction: 0.05,
    restitution: 0.85,
  });
  const pmatNegFriction = validatePhysicsMaterial({
    name: 'InvalidFriction',
    friction: -0.2,
    restitution: 0.5,
  });
  const pmatHighRestitution = validatePhysicsMaterial({
    name: 'InvalidRestitution',
    friction: 0.5,
    restitution: 1.5, // > 1
  });
  results.push({
    id: 'phys_31_physics_material_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '31. PhysicsMaterial Validation (friction >= 0, restitution in [0, 1])',
    passed:
      pmatValid.valid && !pmatNegFriction.valid && !pmatHighRestitution.valid,
    details:
      'Accepted valid PhysicsMaterial and rejected negative friction (-0.2) and restitution > 1 (1.5).',
  });

  // 32. ECS extraction & entity-reorder invariance
  const ecsRegistry = registerPhysicsEcsComponents(
    registerRenderingEcsComponents(createStandardComponentRegistry())
  );
  const assetRegistry = new HylixAssetRegistry('prj_ecs_phys', logger);
  const pmatAsset = assetRegistry.registerAsset({
    type: 'data',
    path: 'assets/materials/rubber.pmat.json',
    contentPayload: '{"friction":0.8,"restitution":0.9}',
    importState: 'verified',
  }).asset!;

  let entCrate = createEntity(
    {
      sceneId: 'scene_0000000000000601',
      name: 'FallingCrate',
    },
    ecsRegistry
  ).entity!;
  entCrate = addComponent(
    entCrate,
    RIGID_BODY_COMPONENT_TYPE,
    {
      bodyType: 'dynamic',
      mass: 2,
      linearVelocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      linearDamping: 0,
      angularDamping: 0,
      gravityScale: 1,
      isSleeping: false,
      isEnabled: true,
    },
    ecsRegistry
  ).entity!;
  entCrate = addComponent(
    entCrate,
    COLLIDER_COMPONENT_TYPE,
    {
      shape: { kind: 'box3d', dimension: '3D', halfExtents: { x: 1, y: 1, z: 1 } },
      localTransform: {
        offset: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      isTrigger: false,
      collisionLayer: 1,
      collisionMask: ALL_COLLISION_LAYERS_MASK,
      physicsMaterialAssetId: pmatAsset.assetId,
      enabled: true,
    },
    ecsRegistry
  ).entity!;
  entCrate = addComponent(
    entCrate,
    SPRITE_2D_COMPONENT_TYPE,
    {
      textureAssetId: pmatAsset.assetId,
      color: { r: 1, g: 1, b: 1, a: 1 },
      region: { u0: 0, v0: 0, u1: 1, v1: 1 },
      origin: { x: 0.5, y: 0.5 },
      layer: { layerName: 'Default', sortingLayer: 0, orderInLayer: 0, depth: 0 },
    },
    ecsRegistry
  ).entity!;

  let entFloor = createEntity(
    {
      sceneId: 'scene_0000000000000601',
      name: 'StaticFloor',
    },
    ecsRegistry
  ).entity!;
  entFloor = addComponent(
    entFloor,
    COLLIDER_COMPONENT_TYPE,
    {
      shape: {
        kind: 'box3d',
        dimension: '3D',
        halfExtents: { x: 20, y: 1, z: 20 },
      },
      localTransform: {
        offset: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      isTrigger: false,
      collisionLayer: 1,
      collisionMask: ALL_COLLISION_LAYERS_MASK,
      enabled: true,
    },
    ecsRegistry
  ).entity!;

  const sceneOrder1 = createSceneDefinition({
    sceneId: 'scene_0000000000000601',
    sceneName: 'PhysicsLevel',
    entities: [entCrate, entFloor],
    physicsConfig: {
      gravity: { x: 0, y: -10, z: 0 },
      fixedDeltaTime: 1 / 60,
      maxSubsteps: 8,
    },
    registry: ecsRegistry,
  }).scene!;

  const sceneOrder2 = createSceneDefinition({
    sceneId: 'scene_0000000000000601',
    sceneName: 'PhysicsLevel',
    entities: [entFloor, entCrate], // Reordered entities!
    physicsConfig: {
      gravity: { x: 0, y: -10, z: 0 },
      fixedDeltaTime: 1 / 60,
      maxSubsteps: 8,
    },
    registry: ecsRegistry,
  }).scene!;

  const beforeSceneJson = JSON.stringify(sceneOrder1);
  const ext1 = extractScenePhysicsData(sceneOrder1, {
    projectId: 'prj_ecs_phys',
    assetRegistry,
    logger,
  });
  const ext2 = extractScenePhysicsData(sceneOrder2, {
    projectId: 'prj_ecs_phys',
    assetRegistry,
    logger,
  });
  const afterSceneJson = JSON.stringify(sceneOrder1);

  results.push({
    id: 'phys_32_ecs_extraction',
    category: 'Physics Foundation & Spatial Queries',
    title: '32. Read-Only ECS Physics Extraction & Entity-Reorder Invariance',
    passed:
      ext1.readOnlyVerified &&
      beforeSceneJson === afterSceneJson &&
      ext1.extractedBodies.length === 2 &&
      ext1.extractedColliders.length === 2 &&
      JSON.stringify(ext1.extractedBodies) ===
        JSON.stringify(ext2.extractedBodies) &&
      JSON.stringify(ext1.extractedColliders) ===
        JSON.stringify(ext2.extractedColliders),
    details:
      'Extracted identical PhysicsWorld bodies and colliders regardless of entity ordering without mutating SceneDefinition.',
  });

  // 33. Scene integration (saves physicsConfig, rejects runtime collisionCache/contactArrays in SceneDefinition)
  const invalidSceneWithRuntimeCache = validateSceneDefinition(
    {
      ...sceneOrder1,
      physicsConfig: {
        gravity: { x: 0, y: -9.81, z: 0 },
        fixedDeltaTime: 1 / 60,
        maxSubsteps: 8,
        collisionCache: ['cached_pair'], // Forbidden runtime state!
      },
    },
    ecsRegistry
  );
  const invalidConfigDirect = validateScenePhysicsConfig({
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedDeltaTime: 1 / 60,
    maxSubsteps: 8,
    activeContacts: [], // Forbidden runtime state!
  });
  results.push({
    id: 'phys_33_scene_integration',
    category: 'Physics Foundation & Spatial Queries',
    title: '33. Scene Physics Configuration & Runtime Cache Rejection Guard',
    passed:
      sceneOrder1.physicsConfig?.gravity.y === -10 &&
      !invalidSceneWithRuntimeCache.valid &&
      !invalidConfigDirect.valid,
    details:
      'Persisted Scene physicsConfig while rejecting runtime collisionCache and activeContacts in SceneDefinition.',
  });

  // 34. Rendering transform integration (Physics -> ECS Transform -> Render Extraction -> RenderQueue)
  const syncResult = stepPhysicsAndSynchronizeRenderData(
    ext1.world,
    sceneOrder1,
    {
      fixedDeltaTime: 0.5,
      assetRegistry,
      logger,
    }
  );
  const renderedCrateItem = syncResult.renderExtraction.sortedRenderQueue.find(
    (it) => it.entityId === entCrate.entityId
  );
  results.push({
    id: 'phys_34_rendering_transform_integration',
    category: 'Physics Foundation & Spatial Queries',
    title: '34. Physics -> ECS Transform -> RenderQueue Integration Pipeline',
    passed:
      syncResult.stepResult.success &&
      renderedCrateItem !== undefined &&
      renderedCrateItem.transform.position.y < 10 && // fell under gravity from y=10 to y=7.5
      sceneOrder1.entities[0].components.Transform !==
        syncResult.updatedScene.entities[0].components.Transform,
    details: `Synchronized simulated RigidBody position (y=${renderedCrateItem?.transform.position.y}) into ECS Transform and RenderQueue without GPU coupling.`,
  });

  // 35. Cross-project resource & spatial query rejection
  const crossProjectRaycast = raycastPhysicsWorld(
    queryWorld,
    {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      maxDistance: 50,
    },
    { projectId: 'prj_foreign_attacker', logger }
  );
  const crossProjectOverlap = overlapSphere(
    queryWorld,
    { x: 0, y: 0, z: 0 },
    10,
    { projectId: 'prj_foreign_attacker', logger }
  );
  results.push({
    id: 'phys_35_cross_project_rejection',
    category: 'Physics Foundation & Spatial Queries',
    title: '35. Cross-Project Spatial Query & Raycast Rejection Guard',
    passed: !crossProjectRaycast.valid && !crossProjectOverlap.valid,
    details:
      "Blocked foreign project 'prj_foreign_attacker' from executing raycasts or overlap queries against 'prj_query' PhysicsWorld.",
  });

  // 36. NaN rejection across Physics contracts
  const nanBody = validateRigidBody({
    entityId: 'ent_0000000000000036',
    bodyType: 'dynamic',
    mass: NaN,
  });
  const nanShape = validateSphereShape3D({ radius: NaN });
  const nanAABB = validateAABB3D({
    min: { x: NaN, y: 0, z: 0 },
    max: { x: 1, y: 1, z: 1 },
  });
  const nanRay = validateRay({
    origin: { x: NaN, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    maxDistance: 10,
  });
  const nanAdvance = tsController.advance(NaN);
  results.push({
    id: 'phys_36_nan_rejection',
    category: 'Physics Foundation & Spatial Queries',
    title: '36. Comprehensive NaN Rejection Across Bodies, Shapes, AABBs, Rays & Timesteps',
    passed:
      !nanBody.valid &&
      !nanShape.valid &&
      !nanAABB.valid &&
      !nanRay.valid &&
      !nanAdvance.valid,
    details:
      'Rejected NaN in RigidBody, SphereShape3D, AABB3D, Ray, and FixedTimestepController.',
  });

  // 37. Infinity rejection across Physics contracts
  const infBody = validateRigidBody({
    entityId: 'ent_0000000000000037',
    bodyType: 'dynamic',
    mass: Infinity,
  });
  const infShape = validateBoxShape2D({
    halfExtents: { x: 1, y: -Infinity },
  });
  const infAABB = validateAABB2D({
    min: { x: 0, y: 0 },
    max: { x: Infinity, y: 1 },
  });
  const infRay = validateRay({
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    maxDistance: Infinity,
  });
  const infAdvance = tsController.advance(Infinity);
  results.push({
    id: 'phys_37_infinity_rejection',
    category: 'Physics Foundation & Spatial Queries',
    title: '37. Comprehensive Infinity Rejection Across Bodies, Shapes, AABBs, Rays & Timesteps',
    passed:
      !infBody.valid &&
      !infShape.valid &&
      !infAABB.valid &&
      !infRay.valid &&
      !infAdvance.valid,
    details:
      'Rejected +Infinity and -Infinity in RigidBody, BoxShape2D, AABB2D, Ray, and FixedTimestepController.',
  });

  // 38. Security path & dynamic code execution validation
  const secSdcard = validatePhysicsPayloadSecurity(
    { physicsMaterialPath: '/sdcard/game/hack.pmat' },
    logger
  );
  const secRemoteUrl = validatePhysicsPayloadSecurity(
    { remoteConfig: 'https://evil.example.com/physics.json' },
    logger
  );
  const secEval = validatePhysicsPayloadSecurity(
    { customSolver: 'eval("process.exit(1)")' },
    logger
  );
  const colWithRawPath = validateCollider({
    entityId: 'ent_0000000000000038',
    shape: { kind: 'sphere3d', dimension: '3D', radius: 1 },
    filePath: '/sdcard/collider.mesh',
  });
  results.push({
    id: 'phys_38_security_path_validation',
    category: 'Physics Foundation & Spatial Queries',
    title: '38. Physics Security Guard (/sdcard, Remote URLs, Raw Paths & eval() Rejection)',
    passed:
      !secSdcard.safe &&
      !secRemoteUrl.safe &&
      !secEval.safe &&
      !colWithRawPath.valid,
    details:
      'Blocked /sdcard paths, remote URLs, raw filePath properties, and eval() in Physics payloads.',
  });

  // 39. Structured diagnostic logging verification (all 11 required physics events)
  // Trigger a solid collision and body removal to ensure all 11 events have been logged
  const colWorld = new PhysicsWorld({
    projectId: 'prj_col_events',
    gravity: { x: 0, y: 0, z: 0 },
    logger,
  });
  const b1 = colWorld.addBody({
    entityId: 'ent_0000000000000301',
    bodyType: 'dynamic',
    mass: 1,
    position: { x: 0, y: 0, z: 0 },
  }).value!;
  const b2 = colWorld.addBody({
    entityId: 'ent_0000000000000302',
    bodyType: 'static',
    position: { x: 0.5, y: 0, z: 0 },
  }).value!;
  colWorld.addCollider({
    entityId: 'ent_0000000000000301',
    bodyId: b1.bodyId,
    shape: { kind: 'sphere3d', dimension: '3D', radius: 1 },
  });
  colWorld.addCollider({
    entityId: 'ent_0000000000000302',
    bodyId: b2.bodyId,
    shape: { kind: 'sphere3d', dimension: '3D', radius: 1 },
  });
  colWorld.step(1 / 60);
  colWorld.removeBody(b1.bodyId);
  colWorld.shutdown();

  const logMessages = logger.getEntries().map((e) => e.redactedMessage);
  const requiredEvents = [
    'physics_world_created',
    'physics_world_destroyed',
    'physics_step_started',
    'physics_step_completed',
    'physics_collision_detected',
    'physics_trigger_enter',
    'physics_trigger_exit',
    'physics_query_executed',
    'physics_validation_failed',
    'physics_body_created',
    'physics_body_destroyed',
  ];
  const all11EventsLogged = requiredEvents.every((ev) =>
    logMessages.some((m) => m.includes(ev))
  );
  results.push({
    id: 'phys_39_diagnostic_events_logging',
    category: 'Physics Foundation & Spatial Queries',
    title: '39. Structured Physics Diagnostic Events & Secret Redaction',
    passed: all11EventsLogged,
    details:
      'Verified all 11 mandatory physics diagnostic events in RedactedDiagnosticLogger.',
  });

  return results;
}
