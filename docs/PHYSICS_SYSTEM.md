# Hylix V1.0.0 — Physics Foundation + Collision & Spatial Queries Specification

**Project**: Hylix  
**Organization**: HyperSoft  
**Phase**: Phase 06 — Physics Foundation + Collision & Spatial Queries (`src/physics/`)

---

## 1. Physics Architecture Overview

Hylix Physics is built from scratch by HyperSoft as a **platform-independent, deterministic, Local-First 2D/3D Physics Foundation**. It does not wrap or depend on Box2D, Bullet, PhysX, Havok, Jolt, Rapier, Chipmunk, Matter.js, Cannon.js, or Ammo.js.

### End-to-End Physics, ECS & Rendering Pipeline

```text
SceneDefinition / ECS Entities (Read-Only)
  ↓
Physics Extraction (src/physics/physicsExtraction.ts)
  ↓
Project-Isolated PhysicsWorld (src/physics/physicsWorld.ts)
  ↓
FixedTimestepController (accumulator + maxSubsteps spiral-of-death guard)
  ↓
Deterministic Simulation Step (Integrate -> Detect -> Events -> Solve Solid Contacts)
  ↓
Physics Results -> ECS Transform Update (src/physics/physicsIntegration.ts)
  ↓
Scene Render Extraction -> Deterministic RenderQueue (src/rendering/)
```

---

## 2. Module Structure (`src/physics/`)

| File | Responsibility |
| :--- | :--- |
| `physicsTypes.ts` | Deterministic IDs (`physics_`, `body_`, `collider_`, `pmat_`), state transitions, security filters, and shared `Vector2`/`Vector3` math. |
| `bounds.ts` | `AABB2D` and `AABB3D` (`containsPoint`, `intersects`, `expand`, `union`, `getCenter`, `getSize`) with `min <= max` validation. |
| `shapes.ts` | 2D Shapes (`CircleShape2D`, `BoxShape2D`, `CapsuleShape2D`), 3D Shapes (`SphereShape3D`, `BoxShape3D`, `CapsuleShape3D`), and bounding volume generation. |
| `collisionLayers.ts` | 32-bit unsigned bitmask layers (`0..31`) and bidirectional mask filtering (`(layerA & maskB) !== 0 && (layerB & maskA) !== 0`). |
| `physicsMaterial.ts` | `PhysicsMaterialDescriptor` (`friction >= 0`, `0 <= restitution <= 1`, optional `physicsMaterialAssetId`). |
| `physicsBody.ts` | `RigidBodyDescriptor` (`static`, `dynamic`, `kinematic`), `applyForceToBody`, `applyImpulseToBody`, and `applyTorqueToBody`. |
| `collider.ts` | `ColliderDescriptor` decoupled from `RigidBody`, local offset/rotation, `isTrigger`, and world-space `AABB2D`/`AABB3D` computation. |
| `collision.ts` | 2D & 3D collision manifolds, immutable `ContactPoint`, canonical `createDeterministicColliderPairKey`, and `collisionEnter/Stay/Exit` + `triggerEnter/Stay/Exit` events. |
| `fixedTimestep.ts` | `FixedTimestepController` (default `1/60s`), sub-frame `accumulator`, and `maxSubsteps` spiral-of-death protection. |
| `raycast.ts` | `Ray` validation (rejects zero direction and `maxDistance <= 0`), `RaycastHit`, and deterministic hit sorting (`distance ASC, colliderId ASC`). |
| `spatialQueries.ts` | Deterministic, unique, project-isolated `AABB`, `point`, and `overlap` query engines. |
| `physicsQueries.ts` | High-level query facade (`raycastPhysicsWorld`, `overlapCircle`, `overlapBox`, `overlapSphere`, `overlapAABB`) with diagnostic logging. |
| `physicsWorld.ts` | `PhysicsWorld` state machine, project isolation, `PhysicsSolverContract`, and `FoundationPhysicsSolver`. |
| `physicsExtraction.ts` | ECS component specs (`RigidBody`, `Collider`), `ScenePhysicsConfig`, and read-only `extractScenePhysicsData`. |
| `physicsIntegration.ts` | Immutable synchronization from `PhysicsWorld` -> ECS `Transform` -> `RenderQueue`. |
| `physicsValidation.ts` | Security policy auditor (`validatePhysicsPayloadSecurity`) and barrel exports. |

---

## 3. Deterministic Identity & Project Isolation

- **Deterministic IDs**: Every world (`physics_<16-hex>`), rigid body (`body_<16-hex>`), collider (`collider_<16-hex>`), and material (`pmat_<16-hex>`) derives its identity deterministically from canonical project/entity seeds without `Math.random()` or array indices. IDs remain invariant across save, load, scene reorder, and entity reorder.
- **Project Isolation**: Each `PhysicsWorld` is bound to a single `projectId`. Any attempt to add a `RigidBody`, register a `Collider`, or execute a spatial/raycast query with a foreign `projectId` is immediately rejected and logged.

---

## 4. PhysicsWorld Lifecycle & Fixed Timestep

### Simulation States (`PhysicsSimulationState`)
```text
uninitialized -> ready -> simulating -> ready
ready <-> paused
uninitialized | ready | paused -> shutdown
```
Transitions out of `shutdown` (such as `shutdown -> simulating`) are strictly forbidden.

### Fixed Timestep & Spiral-of-Death Protection (`FixedTimestepController`)
- Physics simulation never depends on `requestAnimationFrame`, render FPS, or UI FPS.
- Default `fixedDeltaTime = 1 / 60` second.
- `maxSubsteps` (default `8`, max `120`) clamps frame spikes so the engine never enters an unbounded simulation loop.

---

## 5. RigidBody, Forces, Impulses & Colliders

- **RigidBody Types**:
  - `static`: `inverseMass = 0`; never moved by gravity, forces, impulses, or collisions.
  - `dynamic`: `mass > 0` (`inverseMass = 1 / mass`); accumulates forces/torques and responds to impulses and contacts.
  - `kinematic`: `inverseMass = 0`; moves deterministically by `linearVelocity`/`angularVelocity` without being affected by forces or gravity.
- **Collider**:
  - Decoupled from `RigidBody` so entities can combine `Transform + RigidBody + Collider` or attach a standalone `Collider` (which binds to a deterministic static body).
  - Supports 2D shapes (`Circle`, `Box`, `Capsule`) and 3D shapes (`Sphere`, `Box`, `Capsule`). Mesh Colliders are intentionally deferred to a future dedicated phase.

---

## 6. Collision Detection, Contacts & Triggers

- **Collision Layers & Masks**: 32-bit unsigned integer bitmasks (`(layerA & maskB) !== 0 && (layerB & maskA) !== 0`).
- **Deterministic Pair Keys**: `createDeterministicColliderPairKey(A, B)` orders collider IDs lexicographically so `(A, B)` and `(B, A)` always produce identical keys and contact manifolds.
- **Triggers (`isTrigger = true`)**:
  - Detect overlaps and emit `triggerEnter`, `triggerStay`, and `triggerExit`.
  - Never apply physical impulses or positional depenetration.

---

## 7. Spatial Queries, Raycast & Overlap Queries

- **Raycast (`raycastPhysicsWorld`)**: Validates `Ray` (`direction != (0,0,0)`, `maxDistance > 0`) and returns `RaycastHit[]` sorted deterministically by `distance ASC`, then `colliderId ASC`.
- **Overlap & Spatial Queries (`overlapCircle`, `overlapBox`, `overlapSphere`, `overlapAABB`, `queryWorldPoint2D/3D`)**: Return unique, project-isolated matches sorted deterministically by `colliderId ASC`.

---

## 8. ECS, Scene & Rendering Integration

- **Scene Configuration vs. Runtime State**: `SceneDefinition.physicsConfig` stores only authored configuration (`gravity`, `fixedDeltaTime`, `maxSubsteps`). Runtime collision caches, contact arrays, and broadphase state are strictly forbidden inside `SceneDefinition`.
- **Rendering Decoupling**: Physics updates ECS `Transform` via `applyPhysicsWorldToScene()`, and Phase 05 `extractSceneRenderData()` reads those updated transforms into `RenderQueue`. Physics never depends on GPU APIs, and the Renderer never executes Physics.

---

## 9. Security & Future Solver/Backend Architecture

- **Security**: Zero `eval`, `Function()`, `child_process`, shell calls, network URLs, or `/sdcard`/`/system` file paths. All asset references (`physicsMaterialAssetId`) use `asset_<16-hex>` verified via `HylixAssetRegistry`.
- **Future Solver & Broadphase Expansion**: `PhysicsSolverContract` and bounding volume (`AABB2D`/`AABB3D`) abstractions allow future phases to plug in Spatial Hash / BVH broadphases, constraint solvers, and platform-optimized native backends without breaking Phase 06 contracts.
