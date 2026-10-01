import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import { CameraDescriptor, createPerspectiveCamera, validateCamera } from './camera';
import { RenderDevice } from './renderDevice';
import { RenderFrame } from './renderFrame';
import { RenderItem, RenderQueue } from './renderQueue';
import { createViewport, validateViewport, Viewport } from './viewport';

/**
 * Hylix V1.0.0 — Phase 05: RenderContext Orchestrator
 *
 * Coordinates `RenderDevice`, active `Viewport`, active `Camera`, and `RenderQueue`
 * submission into a `RenderFrame` for an isolated project workspace.
 */

export class RenderContext {
  private readonly device: RenderDevice;
  private readonly logger?: RedactedDiagnosticLogger;
  private viewport: Viewport;
  private activeCamera: CameraDescriptor;

  constructor(options: {
    readonly device: RenderDevice;
    readonly initialViewport?: Viewport;
    readonly initialCamera?: CameraDescriptor;
    readonly logger?: RedactedDiagnosticLogger;
  }) {
    this.device = options.device;
    this.logger = options.logger;
    this.viewport =
      options.initialViewport ?? createViewport(1280, 720, 0, 0).value!;
    this.activeCamera =
      options.initialCamera ??
      createPerspectiveCamera({ name: 'DefaultCamera' }, this.logger).value!;
  }

  public getDevice(): RenderDevice {
    return this.device;
  }

  public getViewport(): Viewport {
    return this.viewport;
  }

  public setViewport(candidate: Viewport): {
    readonly success: boolean;
    readonly error?: string;
  } {
    const check = validateViewport(candidate);
    if (!check.valid || !check.value) {
      return { success: false, error: check.errors.join('; ') };
    }
    const resizeRes = this.device.getBackend().resize(check.value);
    if (!resizeRes.success) {
      return { success: false, error: resizeRes.error };
    }
    this.viewport = check.value;
    return { success: true };
  }

  public getActiveCamera(): CameraDescriptor {
    return this.activeCamera;
  }

  public setActiveCamera(candidate: CameraDescriptor): {
    readonly success: boolean;
    readonly error?: string;
  } {
    const check = validateCamera(candidate, this.logger);
    if (!check.valid || !check.value) {
      return { success: false, error: check.errors.join('; ') };
    }
    this.activeCamera = check.value;
    return { success: true };
  }

  /**
   * Executes a full deterministic frame pass for the given `RenderQueue`:
   * `beginFrame -> set_viewport -> set_camera -> draw sorted items -> endFrame`
   */
  public executeFrameWithQueue(queue: RenderQueue): {
    readonly success: boolean;
    readonly frame: RenderFrame | null;
    readonly sortedItems: readonly RenderItem[];
    readonly error?: string;
  } {
    const beginRes = this.device.beginFrame();
    if (!beginRes.valid || !beginRes.value) {
      return {
        success: false,
        frame: null,
        sortedItems: [],
        error: beginRes.errors.join('; '),
      };
    }

    const frame = beginRes.value;
    frame.recordCommand(
      'set_viewport',
      `${this.viewport.x},${this.viewport.y},${this.viewport.width},${this.viewport.height}`
    );
    frame.recordCommand('set_camera', this.activeCamera.cameraId);

    const sortedItems = queue.buildSortedQueue();
    for (const item of sortedItems) {
      const cmdType =
        item.dimension === '2D' ? 'draw_2d_sprite' : 'draw_3d_mesh';
      frame.recordCommand(cmdType, item.itemId);
    }

    const endRes = this.device.endFrame();
    if (!endRes.success) {
      return {
        success: false,
        frame,
        sortedItems,
        error: endRes.error,
      };
    }

    return {
      success: true,
      frame: endRes.completedFrame,
      sortedItems,
    };
  }
}
