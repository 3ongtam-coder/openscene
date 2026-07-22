import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import type { AllowedAudioMimeType } from '../shared/models';
import { expandLocalTtsArgs, type LocalTtsRunnerConfig } from './localTtsConfig';
import { LocalTtsRunnerError, runLocalTtsProcess, type SpawnProcess } from './localTtsProcess';

export { LocalTtsRunnerError } from './localTtsProcess';

export type LocalQwenRunInput = {
  readonly voiceSamplePath: string;
  readonly script: string;
  readonly language: string;
};

export type LocalQwenRunResult = {
  readonly assetId: string;
  readonly outputPath: string;
  readonly modelId: string;
  readonly mimeType: AllowedAudioMimeType;
  readonly byteLength: number;
};

interface RunnerFileSystem {
  createDirectory(path: string): Promise<void>;
  createTempDirectory(prefix: string): Promise<string>;
  writePrivateTextFile(path: string, content: string): Promise<void>;
  getRegularFileSize(path: string): Promise<number | null>;
  removeDirectory(path: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}

type LocalQwenRunnerDependencies = {
  readonly spawnProcess?: SpawnProcess;
  readonly fileSystem?: RunnerFileSystem;
  readonly createId?: () => string;
};

const nodeFileSystem: RunnerFileSystem = {
  async createDirectory(path) {
    await mkdir(path, { recursive: true });
  },
  createTempDirectory(prefix) {
    return mkdtemp(prefix);
  },
  async writePrivateTextFile(path, content) {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  },
  async getRegularFileSize(path) {
    const fileStats = await lstat(path);
    return fileStats.isFile() && !fileStats.isSymbolicLink() ? fileStats.size : null;
  },
  async removeDirectory(path) {
    await rm(path, { recursive: true, force: true });
  },
  async removeFile(path) {
    await rm(path, { recursive: true, force: true });
  }
};

function assertSafeAssetId(value: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new LocalTtsRunnerError({
      code: 'INVALID_REQUEST',
      message: 'The generated audio asset ID was not safe.'
    });
  }
}

export class LocalQwenRunner {
  private readonly spawnProcess: SpawnProcess;
  private readonly fileSystem: RunnerFileSystem;
  private readonly createId: () => string;

  constructor(
    private readonly config: LocalTtsRunnerConfig,
    private readonly audioRoot: string,
    dependencies: LocalQwenRunnerDependencies = {}
  ) {
    if (!isAbsolute(audioRoot)) {
      throw new LocalTtsRunnerError({ code: 'INVALID_REQUEST', message: 'The local audio root must be absolute.' });
    }
    this.spawnProcess = dependencies.spawnProcess ?? spawn;
    this.fileSystem = dependencies.fileSystem ?? nodeFileSystem;
    this.createId = dependencies.createId ?? randomUUID;
  }

  async run(input: LocalQwenRunInput): Promise<LocalQwenRunResult> {
    if (!isAbsolute(input.voiceSamplePath)) {
      throw new LocalTtsRunnerError({
        code: 'INVALID_REQUEST',
        message: 'The voice sample path supplied by the profile store must be absolute.'
      });
    }

    const assetId = this.createId();
    assertSafeAssetId(assetId);
    const resolvedAudioRoot = resolve(this.audioRoot);
    const outputPath = join(resolvedAudioRoot, `${assetId}${this.config.outputExtension}`);
    const temporaryRoot = join(resolvedAudioRoot, '.tmp');
    await this.fileSystem.createDirectory(resolvedAudioRoot);
    await this.fileSystem.createDirectory(temporaryRoot);
    const temporaryDirectory = await this.fileSystem.createTempDirectory(join(temporaryRoot, 'tts-'));
    const textPath = join(temporaryDirectory, 'narration.txt');
    let completed = false;

    try {
      await this.fileSystem.writePrivateTextFile(textPath, input.script);
      const args = expandLocalTtsArgs(this.config.argsTemplate, {
        modelPath: this.config.modelPath,
        voiceSamplePath: input.voiceSamplePath,
        textPath,
        outputPath,
        language: input.language
      });
      const exit = await runLocalTtsProcess({
        spawnProcess: this.spawnProcess,
        executablePath: this.config.executablePath,
        args,
        timeoutMs: this.config.timeoutMs,
        ...(this.config.workingDirectory === undefined ? {} : { workingDirectory: this.config.workingDirectory })
      });
      if (exit.code !== 0) {
        throw new LocalTtsRunnerError({
          code: 'PROCESS_FAILED',
          message: `The local TTS runner exited unsuccessfully with code ${exit.code ?? 'null'} and signal ${exit.signal ?? 'none'}.`,
          diagnostics: exit.diagnostics
        });
      }

      let regularFileSize: number | null;
      try {
        regularFileSize = await this.fileSystem.getRegularFileSize(outputPath);
      } catch (error: unknown) {
        throw new LocalTtsRunnerError({
          code: 'OUTPUT_INVALID',
          message: 'The local TTS runner did not create its expected audio output.',
          cause: error
        });
      }
      if (regularFileSize === null) {
        throw new LocalTtsRunnerError({
          code: 'OUTPUT_INVALID',
          message: 'The local TTS runner output was not a regular file.'
        });
      }
      if (regularFileSize <= 0) {
        throw new LocalTtsRunnerError({
          code: 'OUTPUT_INVALID',
          message: 'The local TTS runner created an empty audio output.'
        });
      }

      completed = true;
      return {
        assetId,
        outputPath,
        modelId: this.config.modelId,
        mimeType: this.config.outputMimeType,
        byteLength: regularFileSize
      };
    } finally {
      await this.fileSystem.removeDirectory(temporaryDirectory);
      if (!completed) {
        await this.fileSystem.removeFile(outputPath);
      }
    }
  }
}
