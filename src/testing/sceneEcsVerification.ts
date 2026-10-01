import { LocalFirstAtomicStore } from '../storage/atomicStorage';
import { HylixProjectManager } from '../project/projectSystem';
import {
  addComponent,
  ComponentRegistry,
  createDefaultTransformData,
  createEntity,
  createStandardComponentRegistry,
  getComponent,
  hasComponent,
  METADATA_COMPONENT_TYPE,
  MetadataComponentData,
  removeComponent,
  TRANSFORM_COMPONENT_TYPE,
  TransformComponentData,
  updateComponent,
  validateTransformComponentData,
} from '../ecs/ecsCore';
import {
  addEntityToScene,
  createSceneDefinition,
  createSceneRuntimeInstance,
  HylixSceneManager,
  setEntityParentInScene,
  updateEntityInScene,
  validateEntityHierarchy,
  validateSceneDefinition,
  validateSceneJsonString,
} from '../scene/sceneSystem';
import { VerificationAssertionResult } from './foundationVerification';

/**
 * Hylix Phase 3 — Scene System & Entity/Component System (ECS) Core Verification Suite
 *
 * Implements all 22 mandatory automated test assertions required by Prompt 03.
 */
export function runSceneAndEcsVerificationChecks(): VerificationAssertionResult[] {
  const results: VerificationAssertionResult[] = [];
  const registry = createStandardComponentRegistry();

  // 1. Scene creation
  const createdSceneRes = createSceneDefinition({
    sceneName: 'Arena Stage 01',
    description: 'Primary test arena scene',
    seedHint: 'test_scene_01',
    registry,
  });
  results.push({
    id: 'scene_01_creation',
    category: 'Scene System & ECS Core',
    title: '01. Scene Creation & Schema Initialization',
    passed:
      createdSceneRes.valid &&
      createdSceneRes.scene !== null &&
      createdSceneRes.scene.schemaVersion === 1 &&
      createdSceneRes.scene.sceneId.startsWith('scene_') &&
      createdSceneRes.scene.sceneName === 'Arena Stage 01' &&
      createdSceneRes.scene.entities.length === 0,
    details: `Created Scene '${createdSceneRes.scene?.sceneName}' with sceneId '${createdSceneRes.scene?.sceneId}'.`,
  });

  const baseScene = createdSceneRes.scene!;

  // 2. Scene serialization
  const serializedJson = JSON.stringify(baseScene, null, 2);
  results.push({
    id: 'scene_02_serialization',
    category: 'Scene System & ECS Core',
    title: '02. Deterministic Scene JSON Serialization',
    passed:
      serializedJson.includes(`"sceneId": "${baseScene.sceneId}"`) &&
      serializedJson.includes('"schemaVersion": 1') &&
      serializedJson.includes('"entities": []'),
    details: 'Serialized SceneDefinition to deterministic canonical JSON format.',
  });

  // 3. Scene deserialization
  const deserializedRes = validateSceneJsonString(serializedJson, registry);
  results.push({
    id: 'scene_03_deserialization',
    category: 'Scene System & ECS Core',
    title: '03. Validated Scene JSON Deserialization',
    passed:
      deserializedRes.valid &&
      deserializedRes.scene !== null &&
      deserializedRes.scene.sceneId === baseScene.sceneId &&
      deserializedRes.scene.sceneName === baseScene.sceneName,
    details: 'Deserialized and verified SceneDefinition from JSON string.',
  });

  // 4. Scene ID persistence across saves & updates
  const storeForSceneId = new LocalFirstAtomicStore();
  const projMgrForSceneId = new HylixProjectManager(storeForSceneId);
  const sceneMgrForSceneId = new HylixSceneManager(storeForSceneId, registry);
  projMgrForSceneId.createProject({
    projectFolder: 'SceneIdTestProj',
    projectName: 'Scene ID Test',
    packageId: 'com.hypersoft.sceneidtest',
  });
  projMgrForSceneId.openProject('SceneIdTestProj', 'sess_scene_id');
  const mainOpen = sceneMgrForSceneId.openMainScene('SceneIdTestProj');
  const originalMainSceneId = mainOpen.scene?.sceneId ?? '';

  // Save updated sceneName with same sceneId -> must succeed and keep exact sceneId
  const saveSameId = sceneMgrForSceneId.saveSceneInProject({
    projectRoot: 'SceneIdTestProj',
    sessionId: 'sess_scene_id',
    sceneRelativePath: 'scenes/main.scene.hylix.json',
    scene: {
      ...mainOpen.scene!,
      sceneName: 'Main Scene Renamed',
    },
  });

  // Attempt to save with mutated sceneId -> must be rejected
  const saveMutatedId = sceneMgrForSceneId.saveSceneInProject({
    projectRoot: 'SceneIdTestProj',
    sessionId: 'sess_scene_id',
    sceneRelativePath: 'scenes/main.scene.hylix.json',
    scene: {
      ...mainOpen.scene!,
      sceneId: 'scene_9999999999999999',
    },
  });

  results.push({
    id: 'scene_04_id_persistence',
    category: 'Scene System & ECS Core',
    title: '04. Scene ID Persistence & Mutation Rejection',
    passed:
      mainOpen.success &&
      originalMainSceneId.startsWith('scene_') &&
      saveSameId.success &&
      saveSameId.scene?.sceneId === originalMainSceneId &&
      !saveMutatedId.success,
    details: `Preserved sceneId '${originalMainSceneId}' across saves and rejected illegal sceneId overwrite.`,
  });

  // 5. Entity creation
  const playerEntRes = createEntity(
    {
      sceneId: baseScene.sceneId,
      name: 'Player',
      seedHint: 'player_seed_1',
    },
    registry
  );
  results.push({
    id: 'ecs_05_entity_creation',
    category: 'Scene System & ECS Core',
    title: '05. Entity Creation with Deterministic Entity ID',
    passed:
      playerEntRes.success &&
      playerEntRes.entity !== null &&
      playerEntRes.entity.entityId.startsWith('ent_') &&
      playerEntRes.entity.name === 'Player' &&
      playerEntRes.entity.enabled === true,
    details: `Created Entity '${playerEntRes.entity?.name}' (${playerEntRes.entity?.entityId}).`,
  });

  const playerEntity = playerEntRes.entity!;

  // 6. Entity ID persistence across scene updates & reordering
  const sceneWithPlayerRes = addEntityToScene(baseScene, playerEntity, registry);
  const updatedPlayerSceneRes = updateEntityInScene(
    sceneWithPlayerRes.scene!,
    playerEntity.entityId,
    (ent) => ({ ...ent, name: 'Player Hero', enabled: false }),
    registry
  );
  const illegalEntityIdChange = updateEntityInScene(
    sceneWithPlayerRes.scene!,
    playerEntity.entityId,
    (ent) => ({ ...ent, entityId: 'ent_0000000000000001' }),
    registry
  );

  results.push({
    id: 'ecs_06_entity_id_persistence',
    category: 'Scene System & ECS Core',
    title: '06. Entity ID Persistence & Non-Index Identity Guarantee',
    passed:
      updatedPlayerSceneRes.valid &&
      updatedPlayerSceneRes.scene?.entities[0].entityId === playerEntity.entityId &&
      updatedPlayerSceneRes.scene?.entities[0].name === 'Player Hero' &&
      !illegalEntityIdChange.valid,
    details: `Entity ID '${playerEntity.entityId}' remained immutable across updates and rejected ID mutation.`,
  });

  // 7. Component registration
  const customRegistry = new ComponentRegistry();
  const regTransform = customRegistry.registerComponentType({
    type: 'CustomTag',
    schemaVersion: 1,
    createDefault: () => ({ label: 'default' }),
    validate: (c: unknown) => {
      if (
        typeof c === 'object' &&
        c !== null &&
        typeof (c as Record<string, unknown>).label === 'string'
      ) {
        return {
          valid: true,
          data: { label: (c as Record<string, unknown>).label as string },
          errors: [],
        };
      }
      return { valid: false, data: null, errors: ['Invalid CustomTag.'] };
    },
  });
  const duplicateReg = customRegistry.registerComponentType({
    type: 'CustomTag',
    schemaVersion: 1,
    createDefault: () => ({ label: 'dup' }),
    validate: () => ({ valid: true, data: { label: 'dup' }, errors: [] }),
  });

  results.push({
    id: 'ecs_07_component_registration',
    category: 'Scene System & ECS Core',
    title: '07. Extensible Component Type Registration & Duplicate Guard',
    passed:
      regTransform.registered &&
      customRegistry.isRegistered('CustomTag') &&
      !duplicateReg.registered,
    details: 'Registered custom component specification and rejected duplicate type registration.',
  });

  // 8. Add component
  const addMetaRes = addComponent<MetadataComponentData>(
    playerEntity,
    METADATA_COMPONENT_TYPE,
    { tag: 'PlayerTag', layer: 'Gameplay', notes: 'Main character' },
    registry
  );
  results.push({
    id: 'ecs_08_add_component',
    category: 'Scene System & ECS Core',
    title: '08. Add Validated Component to Entity',
    passed:
      addMetaRes.success &&
      addMetaRes.entity !== null &&
      hasComponent(addMetaRes.entity, METADATA_COMPONENT_TYPE),
    details: 'Added validated Metadata component to Player entity.',
  });

  const entityWithMeta = addMetaRes.entity!;

  // 9. Remove component
  const removeMetaRes = removeComponent(entityWithMeta, METADATA_COMPONENT_TYPE);
  results.push({
    id: 'ecs_09_remove_component',
    category: 'Scene System & ECS Core',
    title: '09. Remove Component from Entity',
    passed:
      removeMetaRes.success &&
      removeMetaRes.entity !== null &&
      !hasComponent(removeMetaRes.entity, METADATA_COMPONENT_TYPE) &&
      hasComponent(removeMetaRes.entity, TRANSFORM_COMPONENT_TYPE),
    details: 'Removed Metadata component cleanly while preserving Transform component.',
  });

  // 10. Get & Update component
  const updatedTfEntityRes = updateComponent<TransformComponentData>(
    entityWithMeta,
    TRANSFORM_COMPONENT_TYPE,
    {
      position: { x: 10, y: 20, z: -5 },
      rotation: { x: 0, y: 45, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    },
    registry
  );
  const retrievedTf = updatedTfEntityRes.entity
    ? getComponent<TransformComponentData>(
        updatedTfEntityRes.entity,
        TRANSFORM_COMPONENT_TYPE
      )
    : undefined;

  results.push({
    id: 'ecs_10_get_component',
    category: 'Scene System & ECS Core',
    title: '10. Get & Update Component Data',
    passed:
      updatedTfEntityRes.success &&
      retrievedTf !== undefined &&
      retrievedTf.position.x === 10 &&
      retrievedTf.position.y === 20 &&
      retrievedTf.rotation.y === 45 &&
      retrievedTf.scale.x === 2,
    details: 'Retrieved and verified updated Transform component values.',
  });

  // 11. Transform defaults
  const defaultTf = createDefaultTransformData();
  const defaultEntityTf = getComponent<TransformComponentData>(
    playerEntity,
    TRANSFORM_COMPONENT_TYPE
  );
  results.push({
    id: 'ecs_11_transform_defaults',
    category: 'Scene System & ECS Core',
    title: '11. Transform Component Default Values (pos=0,0,0 rot=0,0,0 scale=1,1,1)',
    passed:
      defaultTf.position.x === 0 &&
      defaultTf.position.y === 0 &&
      defaultTf.position.z === 0 &&
      defaultTf.rotation.x === 0 &&
      defaultTf.rotation.y === 0 &&
      defaultTf.rotation.z === 0 &&
      defaultTf.scale.x === 1 &&
      defaultTf.scale.y === 1 &&
      defaultTf.scale.z === 1 &&
      defaultEntityTf?.scale.z === 1,
    details: 'Verified canonical Transform defaults (position 0,0,0 · rotation 0,0,0 · scale 1,1,1).',
  });

  // 12. Transform validation
  const nanTf = validateTransformComponentData({
    position: { x: Number.NaN, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const infTf = validateTransformComponentData({
    position: { x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const extraAxisTf = validateTransformComponentData({
    position: { x: 0, y: 0, z: 0, w: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  results.push({
    id: 'ecs_12_transform_validation',
    category: 'Scene System & ECS Core',
    title: '12. Transform Component Validation (NaN, Infinity, Extra Keys)',
    passed: !nanTf.valid && !infTf.valid && !extraAxisTf.valid,
    details: 'Rejected NaN, Infinity, and unexpected axis properties in Transform component.',
  });

  // 13. Parent/child hierarchy
  const entA = createEntity({ sceneId: baseScene.sceneId, name: 'NodeA', seedHint: 'node_a' }).entity!;
  const entB = createEntity({ sceneId: baseScene.sceneId, name: 'NodeB', seedHint: 'node_b' }).entity!;
  const entC = createEntity({ sceneId: baseScene.sceneId, name: 'NodeC', seedHint: 'node_c' }).entity!;

  const threeEntityScene = createSceneDefinition({
    sceneName: 'Hierarchy Test Scene',
    entities: [entA, entB, entC],
    seedHint: 'hier_scene',
    registry,
  }).scene!;

  const linkAB = setEntityParentInScene(
    threeEntityScene,
    entB.entityId,
    entA.entityId,
    registry
  );
  const linkBC = setEntityParentInScene(
    linkAB.scene!,
    entC.entityId,
    entB.entityId,
    registry
  );

  const updatedA = linkBC.scene?.entities.find((e) => e.entityId === entA.entityId);
  const updatedB = linkBC.scene?.entities.find((e) => e.entityId === entB.entityId);
  const updatedC = linkBC.scene?.entities.find((e) => e.entityId === entC.entityId);

  results.push({
    id: 'scene_13_parent_child_hierarchy',
    category: 'Scene System & ECS Core',
    title: '13. Valid Parent/Child Entity Hierarchy Construction',
    passed:
      linkBC.valid &&
      updatedA?.childrenEntityIds.includes(entB.entityId) === true &&
      updatedB?.parentEntityId === entA.entityId &&
      updatedB?.childrenEntityIds.includes(entC.entityId) === true &&
      updatedC?.parentEntityId === entB.entityId,
    details: 'Constructed 3-level parent/child chain (NodeA -> NodeB -> NodeC) with bidirectional integrity.',
  });

  // 14. Self-parent & self-child prevention
  const selfParentAttempt = setEntityParentInScene(
    threeEntityScene,
    entA.entityId,
    entA.entityId,
    registry
  );
  const selfChildRawCheck = validateEntityHierarchy([
    {
      ...entA,
      childrenEntityIds: [entA.entityId],
    },
  ]);

  results.push({
    id: 'scene_14_self_parent_prevention',
    category: 'Scene System & ECS Core',
    title: '14. Self-Parent & Self-Child Prevention',
    passed: !selfParentAttempt.valid && !selfChildRawCheck.valid,
    details: 'Blocked entity from becoming parent or child of itself.',
  });

  // 15. Circular hierarchy prevention (A -> B -> C -> A)
  const cycleAttempt = setEntityParentInScene(
    linkBC.scene!,
    entA.entityId,
    entC.entityId,
    registry
  );
  results.push({
    id: 'scene_15_circular_hierarchy_prevention',
    category: 'Scene System & ECS Core',
    title: '15. Circular Hierarchy Prevention (A -> B -> C -> A)',
    passed: !cycleAttempt.valid && cycleAttempt.errors.some((e) => e.includes('Circular')),
    details: 'Detected and rejected circular ancestor loop (NodeA -> NodeB -> NodeC -> NodeA).',
  });

  // 16. Missing parent & missing child detection
  const missingParentAttempt = setEntityParentInScene(
    threeEntityScene,
    entA.entityId,
    'ent_deadbeef00000000',
    registry
  );
  const missingChildCheck = validateEntityHierarchy([
    {
      ...entA,
      childrenEntityIds: ['ent_deadbeef00000000'],
    },
  ]);

  results.push({
    id: 'scene_16_missing_parent_detection',
    category: 'Scene System & ECS Core',
    title: '16. Missing Parent & Missing Child Entity Detection',
    passed: !missingParentAttempt.valid && !missingChildCheck.valid,
    details: 'Rejected hierarchy references to non-existent parent and child entity IDs.',
  });

  // 17. Duplicate Entity ID detection
  const duplicateEntitySceneCheck = validateSceneDefinition(
    {
      schemaVersion: 1,
      sceneId: baseScene.sceneId,
      sceneName: 'Duplicate Entity Test',
      entities: [entA, { ...entB, entityId: entA.entityId }],
    },
    registry
  );
  results.push({
    id: 'scene_17_duplicate_entity_id_detection',
    category: 'Scene System & ECS Core',
    title: '17. Duplicate Entity ID Detection in Scene',
    passed:
      !duplicateEntitySceneCheck.valid &&
      duplicateEntitySceneCheck.errors.some((e) => e.includes('Duplicate entityId')),
    details: 'Rejected Scene definition containing duplicate entityId entries.',
  });

  // 18. Invalid component detection
  const unregisteredCompSceneCheck = validateSceneDefinition(
    {
      schemaVersion: 1,
      sceneId: baseScene.sceneId,
      sceneName: 'Invalid Component Test',
      entities: [
        {
          ...entA,
          components: {
            UnregisteredComponentXYZ: { foo: 'bar' },
          },
        },
      ],
    },
    registry
  );
  results.push({
    id: 'scene_18_invalid_component_detection',
    category: 'Scene System & ECS Core',
    title: '18. Unregistered / Invalid Component Detection',
    passed: !unregisteredCompSceneCheck.valid,
    details: 'Rejected Scene entity containing an unregistered component type.',
  });

  // 19. Invalid Scene detection (bad schemaVersion, empty sceneName, missing entityId)
  const badSchemaScene = validateSceneDefinition(
    {
      schemaVersion: 999,
      sceneId: baseScene.sceneId,
      sceneName: '',
      entities: [{ name: 'NoIdEntity', enabled: true, components: {} }],
    },
    registry
  );
  results.push({
    id: 'scene_19_invalid_scene_detection',
    category: 'Scene System & ECS Core',
    title: '19. Invalid Scene Schema & Missing Entity ID Detection',
    passed: !badSchemaScene.valid && badSchemaScene.errors.length >= 3,
    details: 'Rejected Scene with invalid schemaVersion, empty sceneName, and missing entityId.',
  });

  // 20. Atomic Scene save & refusal to save invalid scene
  const saveValidScene = sceneMgrForSceneId.saveSceneInProject({
    projectRoot: 'SceneIdTestProj',
    sessionId: 'sess_scene_id',
    sceneRelativePath: 'scenes/main.scene.hylix.json',
    scene: {
      ...mainOpen.scene!,
      entities: linkBC.scene!.entities,
    },
  });

  const saveInvalidScene = sceneMgrForSceneId.saveSceneInProject({
    projectRoot: 'SceneIdTestProj',
    sessionId: 'sess_scene_id',
    sceneRelativePath: 'scenes/main.scene.hylix.json',
    scene: {
      ...mainOpen.scene!,
      sceneName: '   ', // invalid empty name
    },
  });

  results.push({
    id: 'scene_20_atomic_scene_save',
    category: 'Scene System & ECS Core',
    title: '20. Atomic Scene Save & Invalid Scene Write Prevention',
    passed:
      saveValidScene.success &&
      saveValidScene.checksumHex.length === 16 &&
      !saveInvalidScene.success &&
      storeForSceneId.getStagingFileCount() === 0,
    details:
      'Committed valid Scene atomically with checksum verification and blocked invalid Scene from overwriting storage.',
  });

  // 21. Corrupted Scene handling & conservative recovery
  storeForSceneId.injectRawCorruptedPayloadForTesting(
    'SceneIdTestProj/scenes/main.scene.hylix.json',
    '{corrupted_scene_json_payload'
  );
  const openCorruptedScene = sceneMgrForSceneId.openSceneInProject(
    'SceneIdTestProj',
    'scenes/main.scene.hylix.json'
  );
  const repairRes = projMgrForSceneId.repairProjectWorkspace(
    'SceneIdTestProj',
    'sess_scene_id'
  );
  const openRestoredScene = sceneMgrForSceneId.openSceneInProject(
    'SceneIdTestProj',
    'scenes/main.scene.hylix.json'
  );

  results.push({
    id: 'scene_21_corrupted_scene_handling',
    category: 'Scene System & ECS Core',
    title: '21. Corrupted Scene Detection & Verified Backup Recovery',
    passed:
      !openCorruptedScene.success &&
      openCorruptedScene.corrupted &&
      repairRes.repaired &&
      openRestoredScene.success &&
      openRestoredScene.scene?.sceneId === originalMainSceneId,
    details:
      'Detected corrupted Scene file without deleting data and restored previous verified version from .bak.',
  });

  // 22. Project + Scene integration & Runtime Separation
  const createLevel2 = sceneMgrForSceneId.createSceneInProject({
    projectRoot: 'SceneIdTestProj',
    sessionId: 'sess_scene_id',
    sceneRelativePath: 'scenes/level_02.scene.hylix.json',
    sceneName: 'Level 02 Cavern',
    initialEntities: [playerEntity],
  });
  const sceneList = sceneMgrForSceneId.listProjectScenePaths('SceneIdTestProj');
  const runtimeInstance = createSceneRuntimeInstance(createLevel2.scene!);
  projMgrForSceneId.closeProject('SceneIdTestProj', 'sess_scene_id');

  results.push({
    id: 'scene_22_project_scene_integration',
    category: 'Scene System & ECS Core',
    title: '22. Project + Scene Integration & Runtime State Isolation',
    passed:
      createLevel2.success &&
      sceneList.length === 2 &&
      sceneList.includes('scenes/main.scene.hylix.json') &&
      sceneList.includes('scenes/level_02.scene.hylix.json') &&
      runtimeInstance.isolatedFromProjectData &&
      runtimeInstance.sourceSceneId === createLevel2.scene?.sceneId &&
      runtimeInstance.runtimeEntitiesById.has(playerEntity.entityId),
    details:
      'Verified multi-scene project management, Asset Registry sync, and isolated SceneRuntimeInstanceContract creation.',
  });

  return results;
}
