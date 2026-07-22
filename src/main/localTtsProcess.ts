import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';

const MAX_DIAGNOSTIC_CHARACTERS = 8_192;
const FORCE_KILL_DELAY_MS = 100;

export type LocalTtsRunnerErrorCode =
  | 'INVALID_REQUEST'
  | 'SPAWN_FAILED'
  | 'PROCESS_FAILED'
  | 'TIMEOUT'
  | 'OUTPUT_INVALID';

type LocalTtsRunnerErrorDetails = {
  readonly code: LocalTtsRunnerErrorCode;
  readonly message: string;
  readonly diagnostics?: string;
  readonly cause?: unknown;
};

export class LocalTtsRunnerError extends Error {
  override readonly name = 'LocalTtsRunnerError';
  readonly code: LocalTtsRunnerErrorCode;
  readonly diagnostics: string;

  constructor(details: LocalTtsRunnerErrorDetails) {
    super(details.message, details.cause === undefined ? undefined : { cause: details.cause });
    this.code = details.code;
    this.diagnostics = details.diagnostics ?? '';
  }
}

export type SpawnProcess = (
  executablePath: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export type LocalTtsProcessInput = {
  readonly spawnProcess: SpawnProcess;
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly workingDirectory?: string;
};

export type LocalTtsProcessExit = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly diagnostics: string;
};

function appendBounded(current: string, chunk: string): string {
  const remaining = MAX_DIAGNOSTIC_CHARACTERS - current.length;
  return remaining > 0 ? current + chunk.slice(0, remaining) : current;
}

function waitForProcess(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<LocalTtsProcessExit> {
  return new Promise((resolveExit, rejectExit) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = appendBounded(stderr, chunk);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), FORCE_KILL_DELAY_MS);
    }, timeoutMs);

    const clearTimers = (): void => {
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }
    };

    child.once('error', (error) => {
      clearTimers();
      rejectExit(
        new LocalTtsRunnerError({
          code: 'SPAWN_FAILED',
          message: 'The local TTS runner could not be started.',
          cause: error
        })
      );
    });
    child.once('close', (code, signal) => {
      clearTimers();
      const diagnostics = stderr.trim().length > 0 ? stderr.trim() : stdout.trim();
      if (timedOut) {
        rejectExit(
          new LocalTtsRunnerError({
            code: 'TIMEOUT',
            message: `The local TTS runner exceeded its ${timeoutMs} millisecond timeout.`,
            diagnostics
          })
        );
        return;
      }
      resolveExit({ code, signal, diagnostics });
    });
  });
}

export function runLocalTtsProcess(input: LocalTtsProcessInput): Promise<LocalTtsProcessExit> {
  const spawnOptions: SpawnOptionsWithoutStdio = {
    shell: false,
    windowsHide: true,
    ...(input.workingDirectory === undefined ? {} : { cwd: input.workingDirectory })
  };
  const child = input.spawnProcess(input.executablePath, input.args, spawnOptions);
  return waitForProcess(child, input.timeoutMs);
}
