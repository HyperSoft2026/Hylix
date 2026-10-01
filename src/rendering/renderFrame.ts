import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  createDeterministicRenderId,
  FrameLifecycleState,
  isForbiddenRenderInputString,
} from './renderTypes';

/**
 * Hylix V1.0.0 — Phase 05: Frame Lifecycle State Machine (STEP 7)
 *
 * Enforces deterministic progression:
 *   FrameCreated -> FrameBegun -> CommandsRecorded -> FrameSubmitted -> FrameCompleted
 *
 * Strictly prevents:
 * - Calling beginFrame() twice on the same frame
 * - Calling endFrame() / submitFrame() before beginFrame()
 * - Recording render commands before beginFrame() or after endFrame()
 * - Reusing an old Frame after its lifecycle reaches FrameCompleted
 */

export interface RecordedRenderCommand {
  readonly commandIndex: number;
  readonly commandType: 'draw_2d_sprite' | 'draw_3d_mesh' | 'set_viewport' | 'set_camera';
  readonly targetId: string;
}

const VALID_FRAME_TRANSITIONS: Readonly<
  Record<FrameLifecycleState, ReadonlySet<FrameLifecycleState>>
> = Object.freeze({
  FrameCreated: new Set<FrameLifecycleState>(['FrameBegun']),
  FrameBegun: new Set<FrameLifecycleState>(['CommandsRecorded', 'FrameSubmitted']),
  CommandsRecorded: new Set<FrameLifecycleState>(['CommandsRecorded', 'FrameSubmitted']),
  FrameSubmitted: new Set<FrameLifecycleState>(['FrameCompleted']),
  FrameCompleted: new Set<FrameLifecycleState>([]),
});

export function isValidFrameLifecycleTransition(
  fromState: FrameLifecycleState,
  toState: FrameLifecycleState
): boolean {
  const allowed = VALID_FRAME_TRANSITIONS[fromState];
  return Boolean(allowed && allowed.has(toState));
}

export class RenderFrame {
  public readonly frameId: string;
  public readonly frameNumber: number;
  private state: FrameLifecycleState = 'FrameCreated';
  private readonly commands: RecordedRenderCommand[] = [];
  private readonly logger?: RedactedDiagnosticLogger;

  constructor(frameNumber: number, logger?: RedactedDiagnosticLogger) {
    this.frameNumber = frameNumber;
    this.frameId = createDeterministicRenderId('frm', `frame_${frameNumber}`);
    this.logger = logger;
  }

  public getState(): FrameLifecycleState {
    return this.state;
  }

  public getRecordedCommands(): readonly RecordedRenderCommand[] {
    return [...this.commands];
  }

  public isCompleted(): boolean {
    return this.state === 'FrameCompleted';
  }

  public beginFrame(): {
    readonly success: boolean;
    readonly state: FrameLifecycleState;
    readonly error?: string;
  } {
    if (!isValidFrameLifecycleTransition(this.state, 'FrameBegun')) {
      const err = `Illegal Frame transition: cannot call beginFrame() when frame '${this.frameId}' is in state '${this.state}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${err}`);
      return { success: false, state: this.state, error: err };
    }

    this.state = 'FrameBegun';
    this.logger?.record(
      'rendering',
      'INFO',
      `frame_started: frameId=${this.frameId} number=${this.frameNumber}`
    );
    return { success: true, state: this.state };
  }

  public recordCommand(
    commandType: RecordedRenderCommand['commandType'],
    targetId: string
  ): {
    readonly success: boolean;
    readonly state: FrameLifecycleState;
    readonly error?: string;
  } {
    if (this.state !== 'FrameBegun' && this.state !== 'CommandsRecorded') {
      const err = `Illegal Frame operation: cannot record command '${commandType}' while frame '${this.frameId}' is in state '${this.state}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${err}`);
      return { success: false, state: this.state, error: err };
    }

    const secCheck = isForbiddenRenderInputString(targetId);
    if (secCheck.forbidden) {
      this.logger?.record(
        'rendering',
        'ERROR',
        `render_validation_failed: ${secCheck.reason}`
      );
      return { success: false, state: this.state, error: secCheck.reason };
    }

    this.commands.push(
      Object.freeze({
        commandIndex: this.commands.length,
        commandType,
        targetId,
      })
    );
    this.state = 'CommandsRecorded';
    return { success: true, state: this.state };
  }

  /**
   * Submits and completes the frame (`FrameBegun | CommandsRecorded -> FrameSubmitted -> FrameCompleted`).
   */
  public endFrame(): {
    readonly success: boolean;
    readonly state: FrameLifecycleState;
    readonly submittedCommandCount: number;
    readonly error?: string;
  } {
    if (!isValidFrameLifecycleTransition(this.state, 'FrameSubmitted')) {
      const err = `Illegal Frame transition: cannot call endFrame() when frame '${this.frameId}' is in state '${this.state}'.`;
      this.logger?.record('rendering', 'ERROR', `render_validation_failed: ${err}`);
      return {
        success: false,
        state: this.state,
        submittedCommandCount: 0,
        error: err,
      };
    }

    this.state = 'FrameSubmitted';
    this.logger?.record(
      'rendering',
      'INFO',
      `frame_submitted: frameId=${this.frameId} commands=${this.commands.length}`
    );

    this.state = 'FrameCompleted';
    this.logger?.record(
      'rendering',
      'INFO',
      `frame_completed: frameId=${this.frameId} number=${this.frameNumber}`
    );

    return {
      success: true,
      state: this.state,
      submittedCommandCount: this.commands.length,
    };
  }
}
