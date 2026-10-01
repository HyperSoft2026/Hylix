import { isValidAssetId } from '../assets/assetRegistry';
import {
  createDeterministicRenderId,
  isFiniteNumber,
  isForbiddenRenderInputString,
  isPlainRenderObject,
  RenderValidationResult,
} from './renderTypes';
import {
  ColorRGBA,
  validateColorRGBA,
  validateVector2,
  validateVector3,
  validateVector4,
  Vector2,
  Vector3,
  Vector4,
} from './matrices';

/**
 * Hylix V1.0.0 — Phase 05: GPU-API-Independent Mesh Contract (STEP 13)
 *
 * Defines Vertex, Index, VertexLayout, SubMesh, and MeshBounds without coupling
 * to Vulkan, OpenGL ES, Metal, or DirectX buffers.
 */

export interface Vertex {
  readonly position: Vector3;
  readonly normal?: Vector3;
  readonly uv?: Vector2;
  readonly tangent?: Vector4;
  readonly color?: ColorRGBA;
}

export type VertexAttributeSemantic =
  | 'position'
  | 'normal'
  | 'uv'
  | 'tangent'
  | 'color';

export interface VertexAttributeDescriptor {
  readonly semantic: VertexAttributeSemantic;
  readonly componentCount: 2 | 3 | 4;
  readonly offsetBytes: number;
}

export interface VertexLayout {
  readonly strideBytes: number;
  readonly attributes: readonly VertexAttributeDescriptor[];
}

export interface SubMesh {
  readonly subMeshIndex: number;
  readonly indexOffset: number;
  readonly indexCount: number;
  readonly materialSlot: number;
}

export interface MeshBounds {
  readonly min: Vector3;
  readonly max: Vector3;
  readonly center: Vector3;
  readonly extents: Vector3;
  readonly radius: number;
}

export interface MeshDescriptor {
  readonly meshId: string;
  readonly meshAssetId?: string;
  readonly name: string;
  readonly vertices: readonly Vertex[];
  readonly indices: readonly number[];
  readonly vertexLayout: VertexLayout;
  readonly subMeshes: readonly SubMesh[];
  readonly bounds: MeshBounds;
}

export function createStandardVertexLayout(): VertexLayout {
  return Object.freeze({
    strideBytes: 32,
    attributes: Object.freeze([
      Object.freeze({ semantic: 'position', componentCount: 3, offsetBytes: 0 }),
      Object.freeze({ semantic: 'normal', componentCount: 3, offsetBytes: 12 }),
      Object.freeze({ semantic: 'uv', componentCount: 2, offsetBytes: 24 }),
    ]),
  });
}

export function computeMeshBounds(vertices: readonly Vertex[]): MeshBounds {
  if (vertices.length === 0) {
    const zero: Vector3 = Object.freeze({ x: 0, y: 0, z: 0 });
    return Object.freeze({
      min: zero,
      max: zero,
      center: zero,
      extents: zero,
      radius: 0,
    });
  }

  let minX = vertices[0].position.x;
  let minY = vertices[0].position.y;
  let minZ = vertices[0].position.z;
  let maxX = minX;
  let maxY = minY;
  let maxZ = minZ;

  for (let i = 1; i < vertices.length; i++) {
    const p = vertices[i].position;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const ex = (maxX - minX) * 0.5;
  const ey = (maxY - minY) * 0.5;
  const ez = (maxZ - minZ) * 0.5;

  const radius = Math.sqrt(ex * ex + ey * ey + ez * ez);

  return Object.freeze({
    min: Object.freeze({ x: minX, y: minY, z: minZ }),
    max: Object.freeze({ x: maxX, y: maxY, z: maxZ }),
    center: Object.freeze({ x: cx, y: cy, z: cz }),
    extents: Object.freeze({ x: ex, y: ey, z: ez }),
    radius,
  });
}

export function validateVertex(
  candidate: unknown,
  indexLabel = 'Vertex'
): RenderValidationResult<Vertex> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: [`${indexLabel} must be a non-null object.`],
    };
  }

  const errors: string[] = [];
  const allowedKeys = new Set(['position', 'normal', 'uv', 'tangent', 'color']);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unexpected property '${key}' in ${indexLabel}.`);
    }
  }

  const posCheck = validateVector3(candidate.position, `${indexLabel}.position`);
  errors.push(...posCheck.errors);

  let normal: Vector3 | undefined;
  if (candidate.normal !== undefined) {
    const normCheck = validateVector3(candidate.normal, `${indexLabel}.normal`);
    errors.push(...normCheck.errors);
    if (normCheck.value) normal = normCheck.value;
  }

  let uv: Vector2 | undefined;
  if (candidate.uv !== undefined) {
    const uvCheck = validateVector2(candidate.uv, `${indexLabel}.uv`);
    errors.push(...uvCheck.errors);
    if (uvCheck.value) uv = uvCheck.value;
  }

  let tangent: Vector4 | undefined;
  if (candidate.tangent !== undefined) {
    const tanCheck = validateVector4(candidate.tangent, `${indexLabel}.tangent`);
    errors.push(...tanCheck.errors);
    if (tanCheck.value) tangent = tanCheck.value;
  }

  let color: ColorRGBA | undefined;
  if (candidate.color !== undefined) {
    const colCheck = validateColorRGBA(candidate.color, `${indexLabel}.color`);
    errors.push(...colCheck.errors);
    if (colCheck.value) color = colCheck.value;
  }

  if (errors.length > 0 || !posCheck.value) {
    return { valid: false, value: null, errors };
  }

  const vertex: Vertex = Object.freeze({
    position: posCheck.value,
    ...(normal ? { normal } : {}),
    ...(uv ? { uv } : {}),
    ...(tangent ? { tangent } : {}),
    ...(color ? { color } : {}),
  });

  return { valid: true, value: vertex, errors: [] };
}

export function validateMesh(
  candidate: unknown
): RenderValidationResult<MeshDescriptor> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['Mesh descriptor must be a non-null object.'],
    };
  }

  const errors: string[] = [];

  // Reject any raw path property
  if ('meshPath' in candidate || 'filePath' in candidate || 'path' in candidate) {
    errors.push(
      'Raw filesystem paths (meshPath / filePath / path) are forbidden in MeshDescriptor; use meshAssetId.'
    );
  }

  const meshId =
    typeof candidate.meshId === 'string' && candidate.meshId.trim().length > 0
      ? candidate.meshId.trim()
      : createDeterministicRenderId('mesh', String(candidate.name ?? 'Mesh'));

  let meshAssetId: string | undefined;
  if (candidate.meshAssetId !== undefined) {
    if (!isValidAssetId(candidate.meshAssetId)) {
      errors.push(
        `Invalid meshAssetId '${String(candidate.meshAssetId)}'; expected deterministic 'asset_<16-hex>'.`
      );
    } else {
      meshAssetId = candidate.meshAssetId;
    }
  }

  const name =
    typeof candidate.name === 'string' && candidate.name.trim().length > 0
      ? candidate.name.trim()
      : 'UnnamedMesh';

  if (typeof candidate.name === 'string') {
    const secCheck = isForbiddenRenderInputString(candidate.name);
    if (secCheck.forbidden) {
      errors.push(secCheck.reason!);
    }
  }

  if (!Array.isArray(candidate.vertices) || candidate.vertices.length === 0) {
    errors.push('Mesh.vertices must be a non-empty array of Vertex objects.');
  }

  if (!Array.isArray(candidate.indices) || candidate.indices.length === 0) {
    errors.push('Mesh.indices must be a non-empty array of vertex indices.');
  }

  const validatedVertices: Vertex[] = [];
  if (Array.isArray(candidate.vertices)) {
    for (let i = 0; i < candidate.vertices.length; i++) {
      const vCheck = validateVertex(candidate.vertices[i], `Mesh.vertices[${i}]`);
      if (!vCheck.valid || !vCheck.value) {
        errors.push(...vCheck.errors);
      } else {
        validatedVertices.push(vCheck.value);
      }
    }
  }

  const validatedIndices: number[] = [];
  if (Array.isArray(candidate.indices)) {
    const maxVertexIndex = validatedVertices.length;
    for (let i = 0; i < candidate.indices.length; i++) {
      const idx = candidate.indices[i];
      if (
        typeof idx !== 'number' ||
        !Number.isInteger(idx) ||
        idx < 0 ||
        (maxVertexIndex > 0 && idx >= maxVertexIndex)
      ) {
        errors.push(
          `Mesh.indices[${i}] (${String(idx)}) must be a valid integer index in [0, ${Math.max(0, maxVertexIndex - 1)}].`
        );
      } else {
        validatedIndices.push(idx);
      }
    }
  }

  const layout: VertexLayout = isPlainRenderObject(candidate.vertexLayout)
    ? (candidate.vertexLayout as unknown as VertexLayout)
    : createStandardVertexLayout();

  if (
    !isFiniteNumber(layout.strideBytes) ||
    !Number.isInteger(layout.strideBytes) ||
    layout.strideBytes <= 0 ||
    !Array.isArray(layout.attributes) ||
    layout.attributes.length === 0
  ) {
    errors.push('Mesh.vertexLayout must specify positive integer strideBytes and non-empty attributes.');
  }

  const subMeshes: SubMesh[] = [];
  if (candidate.subMeshes !== undefined) {
    if (!Array.isArray(candidate.subMeshes) || candidate.subMeshes.length === 0) {
      errors.push('Mesh.subMeshes must be a non-empty array when provided.');
    } else {
      for (let i = 0; i < candidate.subMeshes.length; i++) {
        const sm = candidate.subMeshes[i];
        if (
          !isPlainRenderObject(sm) ||
          typeof sm.indexOffset !== 'number' ||
          !Number.isInteger(sm.indexOffset) ||
          sm.indexOffset < 0 ||
          typeof sm.indexCount !== 'number' ||
          !Number.isInteger(sm.indexCount) ||
          sm.indexCount <= 0 ||
          sm.indexOffset + sm.indexCount > validatedIndices.length
        ) {
          errors.push(`Invalid SubMesh[${i}] range or parameters.`);
        } else {
          subMeshes.push(
            Object.freeze({
              subMeshIndex:
                typeof sm.subMeshIndex === 'number' ? sm.subMeshIndex : i,
              indexOffset: sm.indexOffset,
              indexCount: sm.indexCount,
              materialSlot:
                typeof sm.materialSlot === 'number' ? sm.materialSlot : 0,
            })
          );
        }
      }
    }
  } else if (validatedIndices.length > 0) {
    subMeshes.push(
      Object.freeze({
        subMeshIndex: 0,
        indexOffset: 0,
        indexCount: validatedIndices.length,
        materialSlot: 0,
      })
    );
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  const bounds = computeMeshBounds(validatedVertices);

  const mesh: MeshDescriptor = Object.freeze({
    meshId,
    ...(meshAssetId ? { meshAssetId } : {}),
    name,
    vertices: Object.freeze(validatedVertices),
    indices: Object.freeze(validatedIndices),
    vertexLayout: layout,
    subMeshes: Object.freeze(subMeshes),
    bounds,
  });

  return { valid: true, value: mesh, errors: [] };
}

/**
 * Helper to create a canonical 2D/3D Unit Quad Mesh.
 */
export function createUnitQuadMesh(meshAssetId?: string): MeshDescriptor {
  const res = validateMesh({
    name: 'UnitQuad',
    meshAssetId,
    vertices: [
      { position: { x: -0.5, y: -0.5, z: 0 }, normal: { x: 0, y: 0, z: 1 }, uv: { x: 0, y: 0 } },
      { position: { x: 0.5, y: -0.5, z: 0 }, normal: { x: 0, y: 0, z: 1 }, uv: { x: 1, y: 0 } },
      { position: { x: 0.5, y: 0.5, z: 0 }, normal: { x: 0, y: 0, z: 1 }, uv: { x: 1, y: 1 } },
      { position: { x: -0.5, y: 0.5, z: 0 }, normal: { x: 0, y: 0, z: 1 }, uv: { x: 0, y: 1 } },
    ],
    indices: [0, 1, 2, 2, 3, 0],
  });
  return res.value!;
}
