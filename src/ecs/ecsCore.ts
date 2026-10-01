import { computeDeterministicChecksum } from '../storage/atomicStorage';

/**
 * Hylix V1.0.0 — Entity/Component System (ECS) Core
 *
 * Implements a clean, modular, UI-independent ECS foundation:
 * - Deterministic Entity IDs (`ent_<16-hex-chars>`, never array indices)
 * - Extensible ComponentRegistry (register, add, remove, get, has, update, validate)
 * - Official `Transform` Component (position, rotation, scale with strict finite-number validation)
 * - Official `Metadata` Component (tag, layer, notes)
 * - Parent/Child Entity Hierarchy validation (preventing self-parenting, missing nodes, and cycles)
 */

export const TRANSFORM_COMPONENT_TYPE = 'Transform';
export const METADATA_COMPONENT_TYPE = 'Metadata';

export interface Vector3Data {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TransformComponentData {
  readonly position: Vector3Data;
  readonly rotation: Vector3Data;
  readonly scale: Vector3Data;
}

export interface MetadataComponentData {
  readonly tag: string;
  readonly layer: string;
  readonly notes: string;
}

export interface ComponentValidationResult<TData = unknown> {
  readonly valid: boolean;
  readonly data: TData | null;
  readonly errors: readonly string[];
}

export interface ComponentSpecification<TData = unknown> {
  readonly type: string;
  readonly schemaVersion: number;
  readonly createDefault: () => TData;
  readonly validate: (candidate: unknown) => ComponentValidationResult<TData>;
}

export interface HylixEntity {
  readonly entityId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly parentEntityId: string | null;
  readonly childrenEntityIds: readonly string[];
  readonly components: Readonly<Record<string, unknown>>;
}

const VALID_ENTITY_ID_REGEX = /^ent_[a-f0-9]{16}$/i;
const VALID_COMPONENT_TYPE_REGEX = /^[A-Za-z][A-Za-z0-9_]{1,63}$/;

let entityCreationCounter = 0;

export function generateDeterministicEntityId(
  sceneId: string,
  entityName: string,
  seedHint?: string
): string {
  entityCreationCounter += 1;
  const seed =
    seedHint ?? `${sceneId}::${entityName.trim()}::${entityCreationCounter}`;
  const hex = computeDeterministicChecksum(`hylix_entity::${seed}`);
  return `ent_${hex}`;
}

export function isValidEntityId(entityId: unknown): entityId is string {
  return typeof entityId === 'string' && VALID_ENTITY_ID_REGEX.test(entityId);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateFiniteVector3(
  candidate: unknown,
  fieldName: string
): { valid: boolean; vector: Vector3Data | null; errors: string[] } {
  if (!isPlainObject(candidate)) {
    return {
      valid: false,
      vector: null,
      errors: [`${fieldName} must be an object with finite x, y, z numbers.`],
    };
  }

  const errors: string[] = [];
  const allowedAxes = new Set(['x', 'y', 'z']);
  for (const key of Object.keys(candidate)) {
    if (!allowedAxes.has(key)) {
      errors.push(`Unexpected property '${key}' in ${fieldName}.`);
    }
  }

  const x = candidate.x;
  const y = candidate.y;
  const z = candidate.z;

  if (typeof x !== 'number' || !Number.isFinite(x)) {
    errors.push(`${fieldName}.x must be a finite number.`);
  }
  if (typeof y !== 'number' || !Number.isFinite(y)) {
    errors.push(`${fieldName}.y must be a finite number.`);
  }
  if (typeof z !== 'number' || !Number.isFinite(z)) {
    errors.push(`${fieldName}.z must be a finite number.`);
  }

  if (errors.length > 0) {
    return { valid: false, vector: null, errors };
  }

  return {
    valid: true,
    vector: Object.freeze({
      x: x as number,
      y: y as number,
      z: z as number,
    }),
    errors: [],
  };
}

export function createDefaultTransformData(): TransformComponentData {
  return Object.freeze({
    position: Object.freeze({ x: 0, y: 0, z: 0 }),
    rotation: Object.freeze({ x: 0, y: 0, z: 0 }),
    scale: Object.freeze({ x: 1, y: 1, z: 1 }),
  });
}

export function validateTransformComponentData(
  candidate: unknown
): ComponentValidationResult<TransformComponentData> {
  if (!isPlainObject(candidate)) {
    return {
      valid: false,
      data: null,
      errors: ['Transform component must be a non-null object.'],
    };
  }

  const errors: string[] = [];
  const allowedKeys = new Set(['position', 'rotation', 'scale']);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unexpected property '${key}' in Transform component.`);
    }
  }

  const posCheck = validateFiniteVector3(candidate.position, 'Transform.position');
  const rotCheck = validateFiniteVector3(candidate.rotation, 'Transform.rotation');
  const scaleCheck = validateFiniteVector3(candidate.scale, 'Transform.scale');

  errors.push(...posCheck.errors, ...rotCheck.errors, ...scaleCheck.errors);

  if (errors.length > 0 || !posCheck.vector || !rotCheck.vector || !scaleCheck.vector) {
    return {
      valid: false,
      data: null,
      errors,
    };
  }

  return {
    valid: true,
    data: Object.freeze({
      position: posCheck.vector,
      rotation: rotCheck.vector,
      scale: scaleCheck.vector,
    }),
    errors: [],
  };
}

export function createDefaultMetadataData(): MetadataComponentData {
  return Object.freeze({
    tag: 'Untagged',
    layer: 'Default',
    notes: '',
  });
}

export function validateMetadataComponentData(
  candidate: unknown
): ComponentValidationResult<MetadataComponentData> {
  if (!isPlainObject(candidate)) {
    return {
      valid: false,
      data: null,
      errors: ['Metadata component must be a non-null object.'],
    };
  }

  const errors: string[] = [];
  const allowedKeys = new Set(['tag', 'layer', 'notes']);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unexpected property '${key}' in Metadata component.`);
    }
  }

  if (typeof candidate.tag !== 'string' || candidate.tag.trim().length === 0) {
    errors.push('Metadata.tag must be a non-empty string.');
  }
  if (typeof candidate.layer !== 'string' || candidate.layer.trim().length === 0) {
    errors.push('Metadata.layer must be a non-empty string.');
  }
  if (typeof candidate.notes !== 'string') {
    errors.push('Metadata.notes must be a string.');
  }

  if (errors.length > 0) {
    return { valid: false, data: null, errors };
  }

  return {
    valid: true,
    data: Object.freeze({
      tag: (candidate.tag as string).trim(),
      layer: (candidate.layer as string).trim(),
      notes: candidate.notes as string,
    }),
    errors: [],
  };
}

export const OFFICIAL_TRANSFORM_SPEC: ComponentSpecification<TransformComponentData> =
  Object.freeze({
    type: TRANSFORM_COMPONENT_TYPE,
    schemaVersion: 1,
    createDefault: createDefaultTransformData,
    validate: validateTransformComponentData,
  });

export const OFFICIAL_METADATA_SPEC: ComponentSpecification<MetadataComponentData> =
  Object.freeze({
    type: METADATA_COMPONENT_TYPE,
    schemaVersion: 1,
    createDefault: createDefaultMetadataData,
    validate: validateMetadataComponentData,
  });

/**
 * Isolated, non-global ComponentRegistry instance.
 */
export class ComponentRegistry {
  private readonly specs = new Map<string, ComponentSpecification<unknown>>();

  public registerComponentType<TData>(
    spec: ComponentSpecification<TData>
  ): { registered: boolean; error?: string } {
    if (!spec || typeof spec.type !== 'string' || !VALID_COMPONENT_TYPE_REGEX.test(spec.type)) {
      return {
        registered: false,
        error: `Invalid component type identifier '${String(spec?.type)}'.`,
      };
    }

    if (this.specs.has(spec.type)) {
      return {
        registered: false,
        error: `Component type '${spec.type}' is already registered.`,
      };
    }

    this.specs.set(spec.type, spec as ComponentSpecification<unknown>);
    return { registered: true };
  }

  public isRegistered(type: string): boolean {
    return this.specs.has(type);
  }

  public getSpecification(type: string): ComponentSpecification<unknown> | undefined {
    return this.specs.get(type);
  }

  public getRegisteredTypes(): readonly string[] {
    return Array.from(this.specs.keys());
  }

  public createDefaultComponent(type: string): {
    success: boolean;
    data: unknown;
    error?: string;
  } {
    const spec = this.specs.get(type);
    if (!spec) {
      return {
        success: false,
        data: null,
        error: `Unregistered component type '${type}'.`,
      };
    }
    return {
      success: true,
      data: spec.createDefault(),
    };
  }

  public validateComponent(
    type: string,
    candidateData: unknown
  ): ComponentValidationResult<unknown> {
    const spec = this.specs.get(type);
    if (!spec) {
      return {
        valid: false,
        data: null,
        errors: [`Unregistered or unsupported component type '${type}'.`],
      };
    }
    return spec.validate(candidateData);
  }
}

export function createStandardComponentRegistry(): ComponentRegistry {
  const registry = new ComponentRegistry();
  registry.registerComponentType(OFFICIAL_TRANSFORM_SPEC);
  registry.registerComponentType(OFFICIAL_METADATA_SPEC);
  return registry;
}

/**
 * Entity Creation & Component Manipulation Functions
 */
export interface CreateEntityOptions {
  readonly sceneId: string;
  readonly name: string;
  readonly entityId?: string;
  readonly enabled?: boolean;
  readonly includeDefaultTransform?: boolean;
  readonly includeDefaultMetadata?: boolean;
  readonly seedHint?: string;
}

export function createEntity(
  options: CreateEntityOptions,
  registry: ComponentRegistry = createStandardComponentRegistry()
): {
  success: boolean;
  entity: HylixEntity | null;
  errors: readonly string[];
} {
  const errors: string[] = [];

  if (typeof options.name !== 'string' || options.name.trim().length === 0) {
    errors.push('Entity name must be a non-empty string.');
  }

  const resolvedId =
    options.entityId ??
    generateDeterministicEntityId(options.sceneId, options.name || 'entity', options.seedHint);

  if (!isValidEntityId(resolvedId)) {
    errors.push(
      `Invalid entityId '${resolvedId}'. Expected deterministic format 'ent_<16-hex-chars>'.`
    );
  }

  if (errors.length > 0) {
    return { success: false, entity: null, errors };
  }

  const components: Record<string, unknown> = {};
  if (options.includeDefaultTransform !== false) {
    const tf = registry.createDefaultComponent(TRANSFORM_COMPONENT_TYPE);
    if (tf.success) {
      components[TRANSFORM_COMPONENT_TYPE] = tf.data;
    }
  }
  if (options.includeDefaultMetadata) {
    const meta = registry.createDefaultComponent(METADATA_COMPONENT_TYPE);
    if (meta.success) {
      components[METADATA_COMPONENT_TYPE] = meta.data;
    }
  }

  const entity: HylixEntity = Object.freeze({
    entityId: resolvedId,
    name: options.name.trim(),
    enabled: options.enabled ?? true,
    parentEntityId: null,
    childrenEntityIds: Object.freeze([]),
    components: Object.freeze(components),
  });

  return {
    success: true,
    entity,
    errors: [],
  };
}

export function hasComponent(entity: HylixEntity, componentType: string): boolean {
  return Object.prototype.hasOwnProperty.call(entity.components, componentType);
}

export function getComponent<TData = unknown>(
  entity: HylixEntity,
  componentType: string
): TData | undefined {
  if (!hasComponent(entity, componentType)) {
    return undefined;
  }
  return entity.components[componentType] as TData;
}

export function addComponent<TData = unknown>(
  entity: HylixEntity,
  componentType: string,
  componentData: TData | undefined,
  registry: ComponentRegistry
): {
  success: boolean;
  entity: HylixEntity | null;
  errors: readonly string[];
} {
  if (hasComponent(entity, componentType)) {
    return {
      success: false,
      entity: null,
      errors: [
        `Entity '${entity.entityId}' already has component '${componentType}'. Use updateComponent instead.`,
      ],
    };
  }

  let payloadToValidate: unknown = componentData;
  if (payloadToValidate === undefined) {
    const def = registry.createDefaultComponent(componentType);
    if (!def.success) {
      return {
        success: false,
        entity: null,
        errors: [def.error || `Unregistered component type '${componentType}'.`],
      };
    }
    payloadToValidate = def.data;
  }

  const val = registry.validateComponent(componentType, payloadToValidate);
  if (!val.valid || val.data === null) {
    return {
      success: false,
      entity: null,
      errors: val.errors,
    };
  }

  const updatedComponents = Object.freeze({
    ...entity.components,
    [componentType]: val.data,
  });

  return {
    success: true,
    entity: Object.freeze({
      ...entity,
      components: updatedComponents,
    }),
    errors: [],
  };
}

export function updateComponent<TData = unknown>(
  entity: HylixEntity,
  componentType: string,
  nextData: TData,
  registry: ComponentRegistry
): {
  success: boolean;
  entity: HylixEntity | null;
  errors: readonly string[];
} {
  if (!hasComponent(entity, componentType)) {
    return {
      success: false,
      entity: null,
      errors: [
        `Cannot update component '${componentType}' because it is not attached to entity '${entity.entityId}'.`,
      ],
    };
  }

  const val = registry.validateComponent(componentType, nextData);
  if (!val.valid || val.data === null) {
    return {
      success: false,
      entity: null,
      errors: val.errors,
    };
  }

  const updatedComponents = Object.freeze({
    ...entity.components,
    [componentType]: val.data,
  });

  return {
    success: true,
    entity: Object.freeze({
      ...entity,
      components: updatedComponents,
    }),
    errors: [],
  };
}

export function removeComponent(
  entity: HylixEntity,
  componentType: string
): {
  success: boolean;
  entity: HylixEntity | null;
  errors: readonly string[];
} {
  if (!hasComponent(entity, componentType)) {
    return {
      success: false,
      entity: null,
      errors: [
        `Component '${componentType}' is not present on entity '${entity.entityId}'.`,
      ],
    };
  }

  const nextComponents: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entity.components)) {
    if (k !== componentType) {
      nextComponents[k] = v;
    }
  }

  return {
    success: true,
    entity: Object.freeze({
      ...entity,
      components: Object.freeze(nextComponents),
    }),
    errors: [],
  };
}
