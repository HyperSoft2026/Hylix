# Hylix

Hylix — A free and open-source game engine and editor, built from scratch by **HyperSoft** for modern 2D, 3D, and cross-platform game development.

---

## Architectural Status: V1.0.0 Foundation (Android-First)

This repository currently implements the **Phase 1 Architecture Foundation** of Hylix:

- **Application Identity**: `com.hypersoft.hylix`
- **Target Platform (V1.0.0)**: Android First (`minSdk 26`, `targetSdk 35`), with a Platform Abstraction Layer prepared for future Windows, Linux, macOS, and iOS expansion.
- **Operating Model**: 100% Local-First (no cloud backend, no mandatory user accounts, no telemetry).
- **Official Branding**: [`branding/logo/hylix-logo.png`](./branding/logo/hylix-logo.png)

## Documentation

- [**Technical Architecture Specification (`docs/ARCHITECTURE.md`)**](./docs/ARCHITECTURE.md) — Module boundaries, 5-layer DAG rules, Android-first & cross-platform strategy, security model, atomic storage model, and dangerous-change prevention rules.
- [**Project System & Local Storage Specification (`docs/PROJECT_SYSTEM.md`)**](./docs/PROJECT_SYSTEM.md) — Project lifecycle, `project.hylix.json` schema, workspace lock & crash recovery, conservative repair, schema migration, asset registry, and cache/build isolation.
- [**Scene System & ECS Core Specification (`docs/SCENE_AND_ECS.md`)**](./docs/SCENE_AND_ECS.md) — Scene schema, deterministic entity/scene IDs, extensible component registry, Transform contract, hierarchy cycle prevention, and runtime instance isolation.
- [**Asset System & Resource Management Specification (`docs/ASSET_SYSTEM.md`)**](./docs/ASSET_SYSTEM.md) — Path-independent Asset IDs, 13 canonical asset types, SHA-256 content hashing, dependency cycle detection, Resource Manager reference counting, bounded cache, and automatic cache invalidation.
- [**Rendering Foundation & 2D/3D Render Abstraction (`docs/RENDERING_SYSTEM.md`)**](./docs/RENDERING_SYSTEM.md) — Platform-independent RenderBackend & RenderDevice, Frame lifecycle, Camera & Viewport, Matrix4/Transform math, 2D Sprite & 3D Mesh/Material/Shader contracts, deterministic RenderQueue, and read-only Scene/ECS extraction.
- [**Physics Foundation + Collision & Spatial Queries (`docs/PHYSICS_SYSTEM.md`)**](./docs/PHYSICS_SYSTEM.md) — Project-isolated PhysicsWorld, RigidBody & Collider contracts, 2D/3D shapes & AABBs, 32-bit collision layers/masks, deterministic contacts & triggers, FixedTimestepController, Raycast & Overlap queries, and ECS/Scene/Rendering integration.
- [**Android Signing & Continuity Policy (`docs/SIGNING_POLICY.md`)**](./docs/SIGNING_POLICY.md) — Production key protection, SHA-1 continuity verification, and release build safeguards.

## Verification & Development Commands

```bash
# Run the automated 147-point Architecture, Project, Scene/ECS, Asset, Rendering, and Physics verification suite
npm test

# Run static TypeScript type and contract verification
npm run lint

# Build the Architecture Foundation Inspector bundle
npm run build

# Start the interactive Architecture Foundation Inspector on port 3000
npm run dev

# Start the standalone GitHub Repository Relay Server (51.75.118.169:20040 -> HyperSoft2026/Hylix)
node server.js
```

## License

Licensed under the [MIT License](./LICENSE). Copyright (c) 2026 HyperSoft.
