import {
  isFiniteNumber,
  isPlainRenderObject,
  RenderValidationResult,
} from './renderTypes';

/**
 * Hylix V1.0.0 — Phase 05: Viewport Abstraction & Validation (STEP 8)
 *
 * Enforces finite x, y, positive width/height, and logical overflow bounds.
 */

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const MAX_SAFE_VIEWPORT_DIMENSION = 32768;
export const MAX_SAFE_VIEWPORT_OFFSET = 32768;

export function validateViewport(
  candidate: unknown
): RenderValidationResult<Viewport> {
  if (!isPlainRenderObject(candidate)) {
    return {
      valid: false,
      value: null,
      errors: ['Viewport must be a non-null object with finite x, y, width, height.'],
    };
  }

  const errors: string[] = [];
  const allowedKeys = new Set(['x', 'y', 'width', 'height']);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unexpected property '${key}' in Viewport.`);
    }
  }

  const { x, y, width, height } = candidate;

  if (!isFiniteNumber(x)) {
    errors.push(`Viewport.x must be a finite number (received ${String(x)}).`);
  } else if (Math.abs(x) > MAX_SAFE_VIEWPORT_OFFSET) {
    errors.push(
      `Viewport.x (${x}) exceeds maximum safe offset (±${MAX_SAFE_VIEWPORT_OFFSET}).`
    );
  }

  if (!isFiniteNumber(y)) {
    errors.push(`Viewport.y must be a finite number (received ${String(y)}).`);
  } else if (Math.abs(y) > MAX_SAFE_VIEWPORT_OFFSET) {
    errors.push(
      `Viewport.y (${y}) exceeds maximum safe offset (±${MAX_SAFE_VIEWPORT_OFFSET}).`
    );
  }

  if (!isFiniteNumber(width)) {
    errors.push(`Viewport.width must be a finite number (received ${String(width)}).`);
  } else if (width <= 0) {
    errors.push(`Viewport.width must be strictly positive (> 0); received ${width}.`);
  } else if (width > MAX_SAFE_VIEWPORT_DIMENSION) {
    errors.push(
      `Viewport.width (${width}) exceeds maximum safe dimension (${MAX_SAFE_VIEWPORT_DIMENSION}).`
    );
  }

  if (!isFiniteNumber(height)) {
    errors.push(`Viewport.height must be a finite number (received ${String(height)}).`);
  } else if (height <= 0) {
    errors.push(`Viewport.height must be strictly positive (> 0); received ${height}.`);
  } else if (height > MAX_SAFE_VIEWPORT_DIMENSION) {
    errors.push(
      `Viewport.height (${height}) exceeds maximum safe dimension (${MAX_SAFE_VIEWPORT_DIMENSION}).`
    );
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: Object.freeze({
      x: (x as number) === 0 ? 0 : (x as number),
      y: (y as number) === 0 ? 0 : (y as number),
      width: width as number,
      height: height as number,
    }),
    errors: [],
  };
}

export function createViewport(
  width = 1280,
  height = 720,
  x = 0,
  y = 0
): RenderValidationResult<Viewport> {
  return validateViewport({ x, y, width, height });
}
