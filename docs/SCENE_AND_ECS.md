# Hylix V1.0.0 — Scene System & Entity/Component System (ECS) Core Specification

**Project**: Hylix  
**Organization**: HyperSoft  
**Phase**: Phase 3 — Scene System + ECS Core (`src/scene/sceneSystem.ts` & `src/ecs/ecsCore.ts`)

---

## 1. Scene Definition Schema

Every Hylix scene is stored as a deterministic, human-readable JSON file (`scenes/*.scene.hylix.json`) inside the project workspace:

```json
{
  "schemaVersion": 1,
  "sceneId": "scene_a12926fbdaf920d0",
  "sceneName": "Main Scene",
  "metadata": {
    "description": "Default entry scene",
    "createdAtIso": "2026-01-01T00:00:00.000Z",
    "updatedAtIso": "2026-01-01T00:00:00.000Z"
  },
  "entities": []
}
```

### Scene ID Continuity
- `sceneId` (`^scene_[a-f0-9]{16}$`) is generated once when the scene is created.
- Opening, editing, or saving a scene **never** mutates `sceneId`. Any attempt to overwrite an existing scene file with a different `sceneId` is rejected by `HylixSceneManager.saveSceneInProject()`.

---

## 2. Entity Model

Each entity in `scene.entities` conforms to `HylixEntity`:

```json
{
  "entityId": "ent_d659370ec8853661",
  "name": "Player",
  "enabled": true,
  "parentId": null,
  "children": [],
  "components": [
    {
      "type": "Transform",
      "schemaVersion": 1,
      "data": {
        "position": { "x": 0, "y": 0, "z": 0 },
        "rotation": { "x": 0, "y": 0, "z": 0 },
        "scale": { "x": 1, "y": 1, "z": 1 }
      }
    }
  ]
}
```

- **Non-Index Identity**: `entityId` (`^ent_[a-f0-9]{16}$`) is permanent and completely independent of array index position.

---

## 3. Component System & Transform Contract

`ComponentRegistry` (`src/ecs/ecsCore.ts`) provides extensible, schema-validated component management:
- `registerComponentType()` — Registers component specifications and prevents duplicate type registration.
- `addComponent()`, `removeComponent()`, `getComponent()`, `hasComponent()`, `updateComponent()` — Immutable, validated operations on entity component lists.
- **Core Components in Phase 3**:
  1. `Transform`: `position: {x:0, y:0, z:0}`, `rotation: {x:0, y:0, z:0}`, `scale: {x:1, y:1, z:1}`. Rejects `NaN`, `Infinity`, non-numeric values, and unexpected keys.
  2. `Metadata`: Optional `{ tag, layer, notes }` descriptor.

---

## 4. Entity Hierarchy & Cycle Prevention

`validateEntityHierarchy()` and `setEntityParentInScene()` enforce strict graph invariants:
- No entity may be its own `parentId` or appear in its own `children` list.
- No duplicate child IDs inside `children`.
- All referenced `parentId` and `children` IDs must exist in the same scene.
- Bidirectional parent/child links must be consistent (`parent.children` includes `child.entityId` iff `child.parentId === parent.entityId`).
- **Circular Hierarchy Guard**: Rejects any ancestor cycle (`A -> B -> C -> A`).

---

## 5. Scene Validation & Safe Atomic Serialization

`validateSceneDefinition()` rejects untrusted JSON, unsupported `schemaVersion`, empty `sceneName`, invalid `sceneId`, duplicate `entityId`, invalid/unregistered components, and hierarchy violations.

All scene writes execute through `LocalFirstAtomicStore`:
`Validate Scene -> Write .tmp -> Flush/Close -> Verify Checksum -> Rotate .bak -> Atomic Commit`.
If a scene is invalid, storage is never overwritten. If a primary scene file is corrupted, Hylix detects the checksum mismatch without deleting data and allows conservative restoration from a verified `.bak` snapshot.

---

## 6. Scene Definition vs. Scene Runtime Instance Separation

- **`SceneDefinition`**: Pure, serializable authored asset stored in `scenes/*.scene.hylix.json`.
- **`SceneRuntimeInstanceContract`**: Isolated in-memory runtime instance created via `createSceneRuntimeInstance(scene)` using deep-cloned entity states (`executionState`, `elapsedTimeSeconds`, `tickCount`, `runtimeEntities`). Mutating runtime entities never pollutes the authored `SceneDefinition`.
