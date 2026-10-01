import { redactSensitiveData } from '../security/securityFoundation';

/**
 * Hylix Structured Diagnostic Logger
 *
 * Guarantees that every diagnostic or error entry passes through
 * the Security Secret Redaction Engine prior to storage or output.
 */

export type LogSeverity = 'INFO' | 'WARN' | 'ERROR' | 'SECURITY_AUDIT';

export interface DiagnosticLogEntry {
  readonly id: string;
  readonly timestampIso: string;
  readonly subsystem: string;
  readonly severity: LogSeverity;
  readonly redactedMessage: string;
}

export class RedactedDiagnosticLogger {
  private readonly entries: DiagnosticLogEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  public record(
    subsystem: string,
    severity: LogSeverity,
    rawMessage: string
  ): DiagnosticLogEntry {
    const safeMessage = redactSensitiveData(rawMessage);
    const entry: DiagnosticLogEntry = Object.freeze({
      id: `log_${this.entries.length + 1}`,
      timestampIso: new Date().toISOString(),
      subsystem,
      severity,
      redactedMessage: safeMessage,
    });

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    return entry;
  }

  public getEntries(): readonly DiagnosticLogEntry[] {
    return [...this.entries];
  }
}
