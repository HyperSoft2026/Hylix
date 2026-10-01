import { RedactedDiagnosticLogger } from '../debugging/diagnosticLogger';
import {
  CreateInputEventInput,
  createValidatedInputEvent,
  InputEvent,
  sortInputEventsDeterministically,
} from './inputEvent';
import {
  createInputError,
  DEFAULT_MAX_INPUT_EVENTS,
  InputBufferOverflowPolicy,
  InputDiagnosticError,
  InputEventId,
  MAX_SAFE_INPUT_EVENTS,
  MIN_SAFE_INPUT_EVENTS,
} from './inputTypes';

/**
 * Hylix V1.0.0 — Phase 08: Bounded Deterministic InputBuffer & Event Consumption (Sections 12 & 24)
 *
 * Pipeline:
 * Platform Input -> Raw Input Events -> InputBuffer -> InputState -> Action Mapping -> Gameplay/ECS
 *
 * Enforces `MAX_INPUT_EVENTS` memory ceiling and deterministic per-event `consume()` tracking
 * without deleting events from internal frame history prior to tick completion.
 */

export type BufferedInputEventInput = Omit<CreateInputEventInput, 'sequence'> & {
  readonly sequence?: number;
};

export interface InputBufferPushResult {
  readonly success: boolean;
  readonly event: InputEvent | null;
  readonly droppedEvent: InputEvent | null;
  readonly errors: readonly InputDiagnosticError[];
}

export class InputBuffer {
  private readonly projectId: string;
  private readonly maxEvents: number;
  private readonly overflowPolicy: InputBufferOverflowPolicy;
  private readonly logger?: RedactedDiagnosticLogger;

  private readonly queue: InputEvent[] = [];
  private readonly frameHistoryById = new Map<InputEventId, InputEvent>();
  private readonly consumedByContextMap = new Map<InputEventId, string>();
  private sequenceCounter = 0;

  constructor(options: {
    readonly projectId: string;
    readonly maxEvents?: number;
    readonly overflowPolicy?: InputBufferOverflowPolicy;
    readonly logger?: RedactedDiagnosticLogger;
  }) {
    this.projectId = options.projectId.trim();
    const requestedMax = options.maxEvents ?? DEFAULT_MAX_INPUT_EVENTS;
    this.maxEvents = Math.max(
      MIN_SAFE_INPUT_EVENTS,
      Math.min(MAX_SAFE_INPUT_EVENTS, Math.floor(requestedMax))
    );
    this.overflowPolicy = options.overflowPolicy ?? 'rejectNewest';
    this.logger = options.logger;
  }

  public getProjectId(): string {
    return this.projectId;
  }

  public getMaxEvents(): number {
    return this.maxEvents;
  }

  public getOverflowPolicy(): InputBufferOverflowPolicy {
    return this.overflowPolicy;
  }

  public size(): number {
    return this.queue.length;
  }

  public getNextSequenceNumber(): number {
    return this.sequenceCounter + 1;
  }

  /**
   * Validates and pushes an `InputEvent` into the bounded buffer.
   */
  public push(input: BufferedInputEventInput): InputBufferPushResult {
    if (
      typeof input === 'object' &&
      input !== null &&
      'projectId' in input &&
      input.projectId !== this.projectId
    ) {
      const err = createInputError(
        'INPUT_CROSS_PROJECT_ACCESS',
        `Cannot push InputEvent from project '${String(input.projectId)}' into InputBuffer for project '${this.projectId}'.`
      );
      this.logger?.record(
        'input',
        'ERROR',
        `input_validation_failed: ${err.message}`
      );
      return {
        success: false,
        event: null,
        droppedEvent: null,
        errors: [err],
      };
    }

    const assignedSequence =
      input.sequence !== undefined ? input.sequence : this.sequenceCounter + 1;

    const validation = createValidatedInputEvent({
      ...input,
      sequence: assignedSequence,
    });

    if (!validation.valid || !validation.value) {
      this.logger?.record(
        'input',
        'ERROR',
        `input_validation_failed: ${validation.errors.map((e) => e.message).join('; ')}`
      );
      return {
        success: false,
        event: null,
        droppedEvent: null,
        errors: validation.errors,
      };
    }

    let droppedEvent: InputEvent | null = null;

    if (this.queue.length >= this.maxEvents) {
      if (this.overflowPolicy === 'rejectNewest') {
        const overflowErr = createInputError(
          'INPUT_BUFFER_FULL',
          `InputBuffer limit (${this.maxEvents}) reached under 'rejectNewest' policy; event '${validation.value.eventId}' dropped.`
        );
        this.logger?.record(
          'input',
          'WARN',
          `input_buffer_overflow: ${overflowErr.message}`
        );
        this.logger?.record(
          'input',
          'WARN',
          `input_event_dropped: eventId=${validation.value.eventId} control=${validation.value.control}`
        );
        return {
          success: false,
          event: null,
          droppedEvent: validation.value,
          errors: [overflowErr],
        };
      } else {
        // 'dropOldest' deterministic eviction: sort and remove the lowest-sequence event
        const sorted = sortInputEventsDeterministically(this.queue);
        droppedEvent = sorted[0] ?? null;
        if (droppedEvent) {
          const idx = this.queue.findIndex(
            (e) => e.eventId === droppedEvent!.eventId
          );
          if (idx >= 0) {
            this.queue.splice(idx, 1);
          }
          this.logger?.record(
            'input',
            'WARN',
            `input_buffer_overflow: evicted oldest eventId=${droppedEvent.eventId} (seq=${droppedEvent.sequence})`
          );
          this.logger?.record(
            'input',
            'WARN',
            `input_event_dropped: eventId=${droppedEvent.eventId}`
          );
        }
      }
    }

    if (assignedSequence > this.sequenceCounter) {
      this.sequenceCounter = assignedSequence;
    }

    const event = validation.value;
    this.queue.push(event);
    this.frameHistoryById.set(event.eventId, event);

    this.logger?.record(
      'input',
      'INFO',
      `input_event_received: eventId=${event.eventId} seq=${event.sequence} type=${event.eventType} control=${event.control}`
    );

    return {
      success: true,
      event,
      droppedEvent,
      errors: [],
    };
  }

  /**
   * Returns a read-only deterministically sorted snapshot of buffered events without removing them.
   */
  public peek(): readonly InputEvent[] {
    return sortInputEventsDeterministically(this.queue);
  }

  /**
   * Drains all buffered events in deterministic order (`sequence ASC, deviceId ASC, eventId ASC`).
   * Retains drained events in `frameHistoryById` for the current processing cycle so `consume()`
   * does not delete events from internal history prematurely.
   */
  public drain(): readonly InputEvent[] {
    const ordered = sortInputEventsDeterministically(this.queue);
    this.queue.length = 0;
    for (const ev of ordered) {
      this.frameHistoryById.set(ev.eventId, ev);
    }
    return ordered;
  }

  /**
   * Marks an event as consumed by a specific `consumerContextId` (Section 24).
   * Once consumed, lower-priority contexts cannot consume or trigger actions from the same event.
   * Does NOT delete the event from `frameHistoryById`.
   */
  public consume(
    eventId: InputEventId,
    consumerContextId = 'default_consumer'
  ): boolean {
    if (!this.frameHistoryById.has(eventId)) {
      return false;
    }
    if (this.consumedByContextMap.has(eventId)) {
      return false; // Already consumed by an equal or higher-priority consumer
    }
    this.consumedByContextMap.set(eventId, consumerContextId.trim());
    return true;
  }

  public isConsumed(eventId: InputEventId): boolean {
    return this.consumedByContextMap.has(eventId);
  }

  public getConsumer(eventId: InputEventId): string | null {
    return this.consumedByContextMap.get(eventId) ?? null;
  }

  public getFrameHistoryEvent(eventId: InputEventId): InputEvent | undefined {
    return this.frameHistoryById.get(eventId);
  }

  public listFrameHistoryEvents(): readonly InputEvent[] {
    return sortInputEventsDeterministically(
      Array.from(this.frameHistoryById.values())
    );
  }

  public clearFrameHistory(): void {
    this.frameHistoryById.clear();
    this.consumedByContextMap.clear();
  }

  public clear(): void {
    this.queue.length = 0;
    this.frameHistoryById.clear();
    this.consumedByContextMap.clear();
  }
}
