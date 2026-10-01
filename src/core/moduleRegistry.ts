import { SubsystemId } from './engineIdentity';

/**
 * Architectural Layers enforce a strict Directed Acyclic Graph (DAG).
 * A module in Layer N may ONLY depend on modules in Layer <= N (and never create cycles).
 */
export enum ArchitecturalLayer {
  LAYER_0_FOUNDATION = 0, // Security, Debugging
  LAYER_1_PLATFORM_STORAGE = 1, // Android Platform Abstraction, Storage
  LAYER_2_ENGINE_CORE = 2, // Engine Core, Project System, Asset System, ECS
  LAYER_3_RUNTIME_DOMAINS = 3, // Scene, Rendering, Physics, Audio, Input, Scripting
  LAYER_4_TOOLING_EDITOR = 4, // Editor, Build System, Testing
}

export interface ModuleBoundaryDescriptor {
  readonly id: SubsystemId;
  readonly displayName: string;
  readonly layer: ArchitecturalLayer;
  readonly responsibility: string;
  readonly allowedDependencies: readonly SubsystemId[];
  readonly isolatedFromEditorUi: boolean;
}

export const HYLIX_MODULE_BOUNDARIES: readonly ModuleBoundaryDescriptor[] = Object.freeze([
  {
    id: SubsystemId.SECURITY,
    displayName: 'Security',
    layer: ArchitecturalLayer.LAYER_0_FOUNDATION,
    responsibility:
      'Least-privilege enforcement, path traversal prevention, command allowlisting, secret redaction, and Android signing continuity verification.',
    allowedDependencies: [],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.DEBUGGING,
    displayName: 'Debugging',
    layer: ArchitecturalLayer.LAYER_0_FOUNDATION,
    responsibility:
      'Structured diagnostic event logging and profiling hooks with mandatory secret and path redaction.',
    allowedDependencies: [SubsystemId.SECURITY],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.PLATFORM_ANDROID,
    displayName: 'Android Platform Layer',
    layer: ArchitecturalLayer.LAYER_1_PLATFORM_STORAGE,
    responsibility:
      'Platform abstraction implementation for Android (com.hypersoft.hylix), sandboxed directory layout, lifecycle, and SAF storage bridges.',
    allowedDependencies: [SubsystemId.SECURITY, SubsystemId.DEBUGGING],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.STORAGE,
    displayName: 'Storage',
    layer: ArchitecturalLayer.LAYER_1_PLATFORM_STORAGE,
    responsibility:
      'Local-first file persistence, atomic write transactions (.tmp -> fsync -> rename), backup snapshots (.bak), corruption detection, and safe build workspace cleanup.',
    allowedDependencies: [
      SubsystemId.SECURITY,
      SubsystemId.DEBUGGING,
      SubsystemId.PLATFORM_ANDROID,
    ],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.ENGINE_CORE,
    displayName: 'Engine Core',
    layer: ArchitecturalLayer.LAYER_2_ENGINE_CORE,
    responsibility:
      'Deterministic subsystem lifecycle orchestration, module boundary registration, version invariants, and event bus.',
    allowedDependencies: [
      SubsystemId.SECURITY,
      SubsystemId.DEBUGGING,
      SubsystemId.PLATFORM_ANDROID,
      SubsystemId.STORAGE,
    ],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.PROJECT_SYSTEM,
    displayName: 'Project System',
    layer: ArchitecturalLayer.LAYER_2_ENGINE_CORE,
    responsibility:
      'Local project manifest validation, schema versioning, safe project migration, and workspace lock management.',
    allowedDependencies: [
      SubsystemId.SECURITY,
      SubsystemId.DEBUGGING,
      SubsystemId.STORAGE,
      SubsystemId.ENGINE_CORE,
    ],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.ASSET_SYSTEM,
    displayName: 'Asset System',
    layer: ArchitecturalLayer.LAYER_2_ENGINE_CORE,
    responsibility:
      'Content-addressed local asset registry, SHA-256 integrity verification, import validation, and streaming handles.',
    allowedDependencies: [
      SubsystemId.SECURITY,
      SubsystemId.DEBUGGING,
      SubsystemId.STORAGE,
      SubsystemId.ENGINE_CORE,
      SubsystemId.PROJECT_SYSTEM,
    ],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.ECS,
    displayName: 'Entity/Component System',
    layer: ArchitecturalLayer.LAYER_2_ENGINE_CORE,
    responsibility:
      'Data-oriented entity identifiers, deterministic component storage archetypes, and system query execution contracts.',
    allowedDependencies: [SubsystemId.DEBUGGING, SubsystemId.ENGINE_CORE],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.SCENE_SYSTEM,
    displayName: 'Scene System',
    layer: ArchitecturalLayer.LAYER_3_RUNTIME_DOMAINS,
    responsibility:
      'Hierarchical scene graph serialization, deterministic entity instantiation, and spatial transform propagation.',
    allowedDependencies: [
      SubsystemId.SECURITY,
      SubsystemId.STORAGE,
      SubsystemId.ENGINE_CORE,
      SubsystemId.ECS,
      SubsystemId.ASSET_SYSTEM,
    ],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.RENDERING,
    displayName: 'Rendering',
    layer: ArchitecturalLayer.LAYER_3_RUNTIME_DOMAINS,
    responsibility:
      'Hardware-agnostic 2D/3D render command queue, surface lifecycle abstraction, and shader resource descriptors.',
    allowedDependencies: [
      SubsystemId.DEBUGGING,
      SubsystemId.PLATFORM_ANDROID,
      SubsystemId.ENGINE_CORE,
      SubsystemId.ASSET_SYSTEM,
      SubsystemId.SCENE_SYSTEM,
    ],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.PHYSICS,
    displayName: 'Physics',
    layer: ArchitecturalLayer.LAYER_3_RUNTIME_DOMAINS,
    responsibility:
      'Fixed-timestep 2D/3D collision detection and rigid-body simulation boundary contracts.',
    allowedDependencies: [
      SubsystemId.DEBUGGING,
      SubsystemId.ENGINE_CORE,
      SubsystemId.ECS,
      SubsystemId.SCENE_SYSTEM,
    ],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.AUDIO,
    displayName: 'Audio',
    layer: ArchitecturalLayer.LAYER_3_RUNTIME_DOMAINS,
    responsibility:
      'Low-latency audio mixer bus, spatial emitter descriptors, and local audio asset decoding contracts.',
    allowedDependencies: [
      SubsystemId.DEBUGGING,
      SubsystemId.PLATFORM_ANDROID,
      SubsystemId.ENGINE_CORE,
      SubsystemId.ASSET_SYSTEM,
    ],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.INPUT,
    displayName: 'Input',
    layer: ArchitecturalLayer.LAYER_3_RUNTIME_DOMAINS,
    responsibility:
      'Multi-touch gesture, virtual gamepad, sensor, and keyboard/pointer action mapping abstraction.',
    allowedDependencies: [
      SubsystemId.DEBUGGING,
      SubsystemId.PLATFORM_ANDROID,
      SubsystemId.ENGINE_CORE,
    ],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.SCRIPTING,
    displayName: 'Scripting',
    layer: ArchitecturalLayer.LAYER_3_RUNTIME_DOMAINS,
    responsibility:
      'Sandboxed gameplay script host boundary with capability-restricted API bindings and deterministic execution quotas.',
    allowedDependencies: [
      SubsystemId.SECURITY,
      SubsystemId.DEBUGGING,
      SubsystemId.ENGINE_CORE,
      SubsystemId.ECS,
      SubsystemId.SCENE_SYSTEM,
      SubsystemId.INPUT,
    ],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.BUILD_SYSTEM,
    displayName: 'Build System',
    layer: ArchitecturalLayer.LAYER_4_TOOLING_EDITOR,
    responsibility:
      'Isolated build pipeline orchestration, ephemeral build workspace provisioning, asset packaging, and future on-device APK generation with strict privilege separation from the Editor UI.',
    allowedDependencies: [
      SubsystemId.SECURITY,
      SubsystemId.DEBUGGING,
      SubsystemId.PLATFORM_ANDROID,
      SubsystemId.STORAGE,
      SubsystemId.PROJECT_SYSTEM,
      SubsystemId.ASSET_SYSTEM,
      SubsystemId.SCENE_SYSTEM,
    ],
    isolatedFromEditorUi: true,
  },
  {
    id: SubsystemId.EDITOR,
    displayName: 'Editor',
    layer: ArchitecturalLayer.LAYER_4_TOOLING_EDITOR,
    responsibility:
      'Local-first visual authoring shell, project inspector, undo/redo command stack, and read-only build job dispatch interface.',
    allowedDependencies: [
      SubsystemId.SECURITY,
      SubsystemId.DEBUGGING,
      SubsystemId.STORAGE,
      SubsystemId.ENGINE_CORE,
      SubsystemId.PROJECT_SYSTEM,
      SubsystemId.ASSET_SYSTEM,
      SubsystemId.ECS,
      SubsystemId.SCENE_SYSTEM,
      SubsystemId.RENDERING,
      SubsystemId.PHYSICS,
      SubsystemId.AUDIO,
      SubsystemId.INPUT,
      SubsystemId.SCRIPTING,
      SubsystemId.BUILD_SYSTEM,
    ],
    isolatedFromEditorUi: false,
  },
  {
    id: SubsystemId.TESTING,
    displayName: 'Testing',
    layer: ArchitecturalLayer.LAYER_4_TOOLING_EDITOR,
    responsibility:
      'Deterministic architectural boundary verification, security policy assertions, atomic storage fault-injection tests, and signing guard checks.',
    allowedDependencies: [
      SubsystemId.SECURITY,
      SubsystemId.DEBUGGING,
      SubsystemId.PLATFORM_ANDROID,
      SubsystemId.STORAGE,
      SubsystemId.ENGINE_CORE,
      SubsystemId.PROJECT_SYSTEM,
      SubsystemId.ASSET_SYSTEM,
      SubsystemId.ECS,
      SubsystemId.SCENE_SYSTEM,
      SubsystemId.RENDERING,
      SubsystemId.PHYSICS,
      SubsystemId.AUDIO,
      SubsystemId.INPUT,
      SubsystemId.SCRIPTING,
      SubsystemId.BUILD_SYSTEM,
      SubsystemId.EDITOR,
    ],
    isolatedFromEditorUi: true,
  },
]);

export interface DependencyValidationResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

/**
 * Verifies that all registered modules obey the architectural layer hierarchy
 * and form a strict Directed Acyclic Graph (DAG) with no circular dependencies.
 */
export function verifyModuleBoundaries(
  modules: readonly ModuleBoundaryDescriptor[] = HYLIX_MODULE_BOUNDARIES
): DependencyValidationResult {
  const violations: string[] = [];
  const map = new Map<SubsystemId, ModuleBoundaryDescriptor>();

  for (const mod of modules) {
    if (map.has(mod.id)) {
      violations.push(`Duplicate module registration detected: ${mod.id}`);
    }
    map.set(mod.id, mod);
  }

  // 1. Check layer ordering and self-dependency
  for (const mod of modules) {
    for (const depId of mod.allowedDependencies) {
      if (depId === mod.id) {
        violations.push(`Module '${mod.id}' cannot depend on itself.`);
        continue;
      }
      const target = map.get(depId);
      if (!target) {
        violations.push(`Module '${mod.id}' declares unknown dependency '${depId}'.`);
        continue;
      }
      if (target.layer > mod.layer) {
        violations.push(
          `Layer Violation: '${mod.id}' (Layer ${mod.layer}) cannot depend on higher-layer module '${target.id}' (Layer ${target.layer}).`
        );
      }
    }
  }

  // 2. Detect cycles via DFS coloring (0 = unvisited, 1 = visiting, 2 = visited)
  const state = new Map<SubsystemId, number>();
  const dfs = (currentId: SubsystemId, trail: SubsystemId[]) => {
    state.set(currentId, 1);
    const mod = map.get(currentId);
    if (mod) {
      for (const depId of mod.allowedDependencies) {
        const depState = state.get(depId) ?? 0;
        if (depState === 1) {
          violations.push(
            `Circular dependency detected: ${[...trail, currentId, depId].join(' -> ')}`
          );
        } else if (depState === 0) {
          dfs(depId, [...trail, currentId]);
        }
      }
    }
    state.set(currentId, 2);
  };

  for (const mod of modules) {
    if ((state.get(mod.id) ?? 0) === 0) {
      dfs(mod.id, []);
    }
  }

  // 3. Verify that Engine Core and Build System do not depend on Editor UI
  const buildMod = map.get(SubsystemId.BUILD_SYSTEM);
  if (buildMod && buildMod.allowedDependencies.includes(SubsystemId.EDITOR)) {
    violations.push(
      'Privilege Isolation Violation: Build System must never depend on Editor.'
    );
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
