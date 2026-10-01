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
- [**Android Signing & Continuity Policy (`docs/SIGNING_POLICY.md`)**](./docs/SIGNING_POLICY.md) — Production key protection, SHA-1 continuity verification, and release build safeguards.

## Verification & Development Commands

```bash
# Run the automated 10-point Architecture Foundation verification suite
npm test

# Run static TypeScript type and contract verification
npm run lint

# Build the Architecture Foundation Inspector bundle
npm run build

# Start the interactive Architecture Foundation Inspector on port 3000
npm run dev
```

## License

Licensed under the [MIT License](./LICENSE). Copyright (c) 2026 HyperSoft.
