import type { ExportProgress } from '../shared/exportTypes';

export class FfmpegProgressParser {
  private buffer = '';
  private pendingProcessedMs: number | null = null;
  private emittedProcessedMs = 0;

  constructor(
    private readonly durationMs: number,
    private readonly onProgress: (progress: ExportProgress) => void
  ) {}

  append(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      this.consumeLine(line);
    }
  }

  finish(): void {
    if (this.buffer.length > 0) {
      this.consumeLine(this.buffer);
      this.buffer = '';
    }
  }

  private consumeLine(line: string): void {
    const separator = line.indexOf('=');
    if (separator <= 0) {
      return;
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === 'out_time_us' || key === 'out_time_ms') {
      const microseconds = Number(value);
      if (Number.isFinite(microseconds) && microseconds >= 0) {
        this.pendingProcessedMs = Math.min(this.durationMs, Math.floor(microseconds / 1_000));
      }
      return;
    }
    if (key !== 'progress' || this.pendingProcessedMs === null || this.pendingProcessedMs <= this.emittedProcessedMs) {
      return;
    }
    this.emittedProcessedMs = this.pendingProcessedMs;
    this.onProgress({
      processedMs: this.emittedProcessedMs,
      durationMs: this.durationMs,
      ratio: this.durationMs === 0 ? 0 : this.emittedProcessedMs / this.durationMs
    });
  }
}
