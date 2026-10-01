import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  createDeterministicRenderId,
  isFiniteNumber,
  isPlainRenderObject,
  RenderValidationResult,
} from './renderTypes';
import {
  createDefaultVector3,
  createOrthographicProjectionMatrix4,
  createPerspectiveProjectionMatrix4,
  createViewMatrix4,
  Matrix4,
  validateVector3,
  Vector3,
} from './matrices';

/**
 * Hylix V1.0.0 — Phase 05: Camera System (STEP 9)
 *
 * Supports Perspective and Orthographic cameras with strict mathematical validation:
 * - nearPlane > 0
 * - farPlane > nearPlane
 * - Perspective fieldOfView in [1, 179] degrees
 * - Orthographic left < right and bottom < top
 * - Zero NaN or Infinity allowed
 */

export type CameraProjectionType = 'perspective' | 'orthographic';

export interface BaseCameraDescriptor {
  readonly cameraId: string;
  readonly name: string;
  readonly projection: CameraProjectionType;
  readonly position: Vector3;
  readonly rotation: Vector3;
  readonly nearPlane: number;
  readonly farPlane: number;
  readonly aspectRatio: number;
}

export interface PerspectiveCameraDescriptor extends BaseCameraDescriptor {
  readonly projection: 'perspective';
  readonly fieldOfView: number;
}

export interface OrthographicCameraDescriptor extends BaseCameraDescriptor {
  readonly projection: 'orthographic';
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
}

export type CameraDescriptor =
  | PerspectiveCameraDescriptor
  | OrthographicCameraDescriptor;

export const MIN_CAMERA_FOV_DEGREES = 1;
export const MAX_CAMERA_FOV_DEGREES = 179;
export const MAX_CAMERA_PLANE_DISTANCE = 1_000_000;

const VALID_CAMERA_ID_REGEX = /^cam_[a-f0-9]{16}$/i;

export function isValidCameraId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && VALID_CAMERA_ID_REGEX.test(candidate);
}

export function validateCamera(
  candidate: unknown,
  logger?: RedactedDiagnosticLogger
): RenderValidationResult<CameraDescriptor> {
  if (!isPlainRenderObject(candidate)) {
    const msg = 'Camera descriptor must be a non-null object.';
    logger?.record('rendering', 'ERROR', `camera_validation_failed: ${msg}`);
    return { valid: false, value: null, errors: [msg] };
  }

  const errors: string[] = [];
  const rawId =
    candidate.cameraId !== undefined
      ? candidate.cameraId
      : createDeterministicRenderId('cam', String(candidate.name ?? 'MainCamera'));

  if (!isValidCameraId(rawId)) {
    errors.push(
      `Invalid cameraId '${String(rawId)}'; expected deterministic 'cam_<16-hex>'.`
    );
  }

  const name =
    typeof candidate.name === 'string' && candidate.name.trim().length > 0
      ? candidate.name.trim()
      : 'MainCamera';

  if (
    candidate.name !== undefined &&
    (typeof candidate.name !== 'string' || candidate.name.trim().length === 0)
  ) {
    errors.push('Camera.name must be a non-empty string.');
  }

  const posCheck = validateVector3(
    candidate.position ?? createDefaultVector3(),
    'Camera.position'
  );
  const rotCheck = validateVector3(
    candidate.rotation ?? createDefaultVector3(),
    'Camera.rotation'
  );
  errors.push(...posCheck.errors, ...rotCheck.errors);

  const nearPlane = candidate.nearPlane;
  const farPlane = candidate.farPlane;

  if (!isFiniteNumber(nearPlane) || nearPlane <= 0) {
    errors.push(
      `Camera.nearPlane must be a finite number strictly > 0 (received ${String(nearPlane)}).`
    );
  }
  if (!isFiniteNumber(farPlane)) {
    errors.push(
      `Camera.farPlane must be a finite number (received ${String(farPlane)}).`
    );
  } else if (isFiniteNumber(nearPlane) && farPlane <= nearPlane) {
    errors.push(
      `Camera.farPlane (${farPlane}) must be strictly greater than nearPlane (${nearPlane}).`
    );
  } else if (farPlane > MAX_CAMERA_PLANE_DISTANCE) {
    errors.push(
      `Camera.farPlane (${farPlane}) exceeds maximum safe distance (${MAX_CAMERA_PLANE_DISTANCE}).`
    );
  }

  const aspectRatio =
    candidate.aspectRatio !== undefined ? candidate.aspectRatio : 16 / 9;
  if (!isFiniteNumber(aspectRatio) || aspectRatio <= 0) {
    errors.push(
      `Camera.aspectRatio must be a finite positive number (received ${String(aspectRatio)}).`
    );
  }

  const projection = candidate.projection;
  if (projection !== 'perspective' && projection !== 'orthographic') {
    errors.push(
      `Unsupported Camera.projection '${String(projection)}'; expected 'perspective' or 'orthographic'.`
    );
  }

  if (projection === 'perspective') {
    const fov = candidate.fieldOfView;
    if (
      !isFiniteNumber(fov) ||
      fov < MIN_CAMERA_FOV_DEGREES ||
      fov > MAX_CAMERA_FOV_DEGREES
    ) {
      errors.push(
        `Perspective Camera.fieldOfView must be a finite number in [${MIN_CAMERA_FOV_DEGREES}, ${MAX_CAMERA_FOV_DEGREES}] degrees (received ${String(fov)}).`
      );
    }

    if (errors.length === 0 && posCheck.value && rotCheck.value) {
      const cam: PerspectiveCameraDescriptor = Object.freeze({
        cameraId: rawId as string,
        name,
        projection: 'perspective',
        position: posCheck.value,
        rotation: rotCheck.value,
        nearPlane: nearPlane as number,
        farPlane: farPlane as number,
        aspectRatio: aspectRatio as number,
        fieldOfView: fov as number,
      });
      logger?.record(
        'rendering',
        'INFO',
        `camera_created: id=${cam.cameraId} projection=perspective fov=${cam.fieldOfView}`
      );
      return { valid: true, value: cam, errors: [] };
    }
  } else if (projection === 'orthographic') {
    const { left, right, bottom, top } = candidate;
    if (!isFiniteNumber(left)) {
      errors.push(`Orthographic Camera.left must be a finite number.`);
    }
    if (!isFiniteNumber(right)) {
      errors.push(`Orthographic Camera.right must be a finite number.`);
    }
    if (!isFiniteNumber(bottom)) {
      errors.push(`Orthographic Camera.bottom must be a finite number.`);
    }
    if (!isFiniteNumber(top)) {
      errors.push(`Orthographic Camera.top must be a finite number.`);
    }
    if (isFiniteNumber(left) && isFiniteNumber(right) && left >= right) {
      errors.push(
        `Orthographic Camera.left (${left}) must be strictly less than right (${right}).`
      );
    }
    if (isFiniteNumber(bottom) && isFiniteNumber(top) && bottom >= top) {
      errors.push(
        `Orthographic Camera.bottom (${bottom}) must be strictly less than top (${top}).`
      );
    }

    if (errors.length === 0 && posCheck.value && rotCheck.value) {
      const cam: OrthographicCameraDescriptor = Object.freeze({
        cameraId: rawId as string,
        name,
        projection: 'orthographic',
        position: posCheck.value,
        rotation: rotCheck.value,
        nearPlane: nearPlane as number,
        farPlane: farPlane as number,
        aspectRatio: aspectRatio as number,
        left: left as number,
        right: right as number,
        bottom: bottom as number,
        top: top as number,
      });
      logger?.record(
        'rendering',
        'INFO',
        `camera_created: id=${cam.cameraId} projection=orthographic bounds=[${cam.left},${cam.right},${cam.bottom},${cam.top}]`
      );
      return { valid: true, value: cam, errors: [] };
    }
  }

  logger?.record(
    'rendering',
    'ERROR',
    `camera_validation_failed: ${errors.join('; ')}`
  );
  return { valid: false, value: null, errors };
}

export function createPerspectiveCamera(
  options?: {
    readonly cameraId?: string;
    readonly name?: string;
    readonly position?: Vector3;
    readonly rotation?: Vector3;
    readonly fieldOfView?: number;
    readonly nearPlane?: number;
    readonly farPlane?: number;
    readonly aspectRatio?: number;
  },
  logger?: RedactedDiagnosticLogger
): RenderValidationResult<PerspectiveCameraDescriptor> {
  const res = validateCamera(
    {
      cameraId: options?.cameraId,
      name: options?.name ?? 'MainPerspectiveCamera',
      projection: 'perspective',
      position: options?.position ?? createDefaultVector3(),
      rotation: options?.rotation ?? createDefaultVector3(),
      fieldOfView: options?.fieldOfView ?? 60,
      nearPlane: options?.nearPlane ?? 0.1,
      farPlane: options?.farPlane ?? 1000,
      aspectRatio: options?.aspectRatio ?? 16 / 9,
    },
    logger
  );
  return {
    valid: res.valid,
    value: (res.value as PerspectiveCameraDescriptor) ?? null,
    errors: res.errors,
  };
}

export function createOrthographicCamera(
  options?: {
    readonly cameraId?: string;
    readonly name?: string;
    readonly position?: Vector3;
    readonly rotation?: Vector3;
    readonly left?: number;
    readonly right?: number;
    readonly bottom?: number;
    readonly top?: number;
    readonly nearPlane?: number;
    readonly farPlane?: number;
    readonly aspectRatio?: number;
  },
  logger?: RedactedDiagnosticLogger
): RenderValidationResult<OrthographicCameraDescriptor> {
  const res = validateCamera(
    {
      cameraId: options?.cameraId,
      name: options?.name ?? 'MainOrthographicCamera',
      projection: 'orthographic',
      position: options?.position ?? createDefaultVector3(),
      rotation: options?.rotation ?? createDefaultVector3(),
      left: options?.left ?? -10,
      right: options?.right ?? 10,
      bottom: options?.bottom ?? -10,
      top: options?.top ?? 10,
      nearPlane: options?.nearPlane ?? 0.1,
      farPlane: options?.farPlane ?? 100,
      aspectRatio: options?.aspectRatio ?? 1,
    },
    logger
  );
  return {
    valid: res.valid,
    value: (res.value as OrthographicCameraDescriptor) ?? null,
    errors: res.errors,
  };
}

export function computeCameraViewMatrix(camera: CameraDescriptor): Matrix4 {
  return createViewMatrix4(camera.position, camera.rotation);
}

export function computeCameraProjectionMatrix(camera: CameraDescriptor): Matrix4 {
  if (camera.projection === 'perspective') {
    return createPerspectiveProjectionMatrix4(
      camera.fieldOfView,
      camera.aspectRatio,
      camera.nearPlane,
      camera.farPlane
    );
  }
  return createOrthographicProjectionMatrix4(
    camera.left,
    camera.right,
    camera.bottom,
    camera.top,
    camera.nearPlane,
    camera.farPlane
  );
}
