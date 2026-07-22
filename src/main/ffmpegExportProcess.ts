import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';

import type { ExportProgress } from '../shared/exportTypes';
import { FfmpegProgressParser } from './ffmpegProgress';

const MAX_DIAGNOSTIC_CHARACTERS = 8_192;
const FORCE_KILL_DELAY_MS = 1_000;

export type SpawnFfmpegProcess = (
  executablePath: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export type StartFfmpegExportProcessInput = {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly durationMs: number;
  readonly onProgress: (progress: ExportProgress) => void;
  readonly spawnProcess?: SpawnFfmpegProcess;
};

export type FfmpegExecution = {
  readonly completion: Promise<void>;
  readonly cancel: () => void;
};

export type FfmpegExportProcessErrorCode = 'SPAWN_FAILED' | 'PROCESS_FAILED' | 'CANCELLED';

export class FfmpegExportProcessError extends Error {
  override readonly name = 'FfmpegExportProcessError';

  constructor(
    readonly code: FfmpegExportProcessErrorCode,
    message: string,
    readonly diagnostics = '',
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

function appendBounded(current: string, chunk: string): string {
  const remaining = MAX_DIAGNOSTIC_CHARACTERS - current.length;
  return remaining > 0 ? current + chunk.slice(0, remaining) : current;
}

export function startFfmpegExportProcess(input: StartFfmpegExportProcessInput): FfmpegExecution {
  const spawnProcess = input.spawnProcess ?? spawn;
  const child = spawnProcess(input.executablePath, input.args, { shell: false, windowsHide: true });
  const progressParser = new FfmpegProgressParser(input.durationMs, input.onProgress);
  let diagnostics = '';
  let cancelled = false;
  let forceKillTimer: NodeJS.Timeout | undefined;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => progressParser.append(chunk));
  child.stderr.on('data', (chunk: string) => {
    diagnostics = appendBounded(diagnostics, chunk);
  });

  const completion = new Promise<void>((resolveCompletion, rejectCompletion) => {
    let settled = false;
    const settle = (operation: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }
      operation();
    };
    child.once('error', (error) => settle(() => rejectCompletion(new FfmpegExportProcessError(
      cancelled ? 'CANCELLED' : 'SPAWN_FAILED',
      cancelled ? 'The export was cancelled.' : 'FFmpeg could not be started.',
      diagnostics.trim(),
      error
    ))));
    child.once('close', (code) => {
      progressParser.finish();
      if (cancelled) {
        settle(() => rejectCompletion(new FfmpegExportProcessError('CANCELLED', 'The export was cancelled.', diagnostics.trim())));
        return;
      }
      if (code !== 0) {
        settle(() => rejectCompletion(new FfmpegExportProcessError(
          'PROCESS_FAILED',
          'FFmpeg failed while exporting the timeline.',
          diagnostics.trim()
        )));
        return;
      }
      settle(resolveCompletion);
    });
  });

  return {
    completion,
    cancel: () => {
      if (cancelled || child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      cancelled = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), FORCE_KILL_DELAY_MS);
    }
  };
}
