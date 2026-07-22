import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LocalQwenRunner, LocalTtsRunnerError } from '../src/main/localQwenRunner';
import type { LocalTtsRunnerConfig } from '../src/main/localTtsConfig';

const FAKE_RUNNER_SOURCE = `
const { mkdirSync, readFileSync, symlinkSync, writeFileSync } = require('node:fs');
const [modelPath, voiceSamplePath, textPath, outputPath, language, mode] = process.argv.slice(2);
if (mode === 'nonzero') {
  process.stderr.write('runner rejected input');
  process.exit(7);
}
if (mode === 'nonzero-large') {
  process.stderr.write('x'.repeat(20000));
  process.exit(8);
}
if (mode === 'timeout') {
  setInterval(() => {}, 1000);
} else if (mode === 'empty') {
  writeFileSync(outputPath, '');
} else if (mode === 'symlink') {
  symlinkSync(voiceSamplePath, outputPath);
} else if (mode === 'directory') {
  mkdirSync(outputPath);
} else if (mode === 'success') {
  const text = readFileSync(textPath, 'utf8');
  writeFileSync(outputPath, [modelPath, voiceSamplePath, language, text].join('|'));
}
`;

type RunnerFixture = {
  readonly audioRoot: string;
  readonly voiceSamplePath: string;
  readonly config: LocalTtsRunnerConfig;
};

async function createRunnerFixture(mode: string, timeoutMs = 2_000): Promise<RunnerFixture> {
  const root = await mkdtemp(join(tmpdir(), 'local-qwen-runner-'));
  const audioRoot = join(root, 'audio');
  const fakeRunnerPath = join(root, 'fake-runner.cjs');
  const voiceSamplePath = join(root, 'voice sample.wav');
  await writeFile(fakeRunnerPath, FAKE_RUNNER_SOURCE, { mode: 0o600 });
  await writeFile(voiceSamplePath, 'voice', { mode: 0o600 });

  return {
    audioRoot,
    voiceSamplePath,
    config: {
      executablePath: process.execPath,
      modelPath: join(root, 'model'),
      argsTemplate: [
        fakeRunnerPath,
        '{modelPath}',
        '{voiceSamplePath}',
        '{textPath}',
        '{outputPath}',
        '{language}',
        mode
      ],
      outputExtension: '.wav',
      outputMimeType: 'audio/wav',
      timeoutMs,
      modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base'
    }
  };
}

describe('local Qwen runner', () => {
  it('writes narration to a temporary file and verifies a nonempty generated output', async () => {
    const fixture = await createRunnerFixture('success');
    const runner = new LocalQwenRunner(fixture.config, fixture.audioRoot);

    const result = await runner.run({
      voiceSamplePath: fixture.voiceSamplePath,
      script: 'Literal narration; $(touch never)',
      language: 'en-US'
    });

    expect(result.modelId).toBe('Qwen/Qwen3-TTS-12Hz-1.7B-Base');
    expect(result.mimeType).toBe('audio/wav');
    expect(result.byteLength).toBeGreaterThan(0);
    expect(await readFile(result.outputPath, 'utf8')).toContain('Literal narration; $(touch never)');
    expect(await readdir(join(fixture.audioRoot, '.tmp'))).toEqual([]);
  });

  it('reports bounded diagnostics when the runner exits nonzero', async () => {
    const fixture = await createRunnerFixture('nonzero');
    const runner = new LocalQwenRunner(fixture.config, fixture.audioRoot);

    await expect(
      runner.run({ voiceSamplePath: fixture.voiceSamplePath, script: 'Hello', language: 'en-US' })
    ).rejects.toMatchObject({
      name: 'LocalTtsRunnerError',
      code: 'PROCESS_FAILED',
      diagnostics: 'runner rejected input'
    } satisfies Partial<LocalTtsRunnerError>);
  });

  it('caps diagnostics emitted by a noisy failed runner', async () => {
    const fixture = await createRunnerFixture('nonzero-large');
    const runner = new LocalQwenRunner(fixture.config, fixture.audioRoot);

    const error: unknown = await runner
      .run({ voiceSamplePath: fixture.voiceSamplePath, script: 'Hello', language: 'en-US' })
      .then(
        () => null,
        (reason: unknown) => reason
      );

    expect(error).toBeInstanceOf(LocalTtsRunnerError);
    if (!(error instanceof LocalTtsRunnerError)) {
      throw new Error('Expected LocalTtsRunnerError.');
    }
    expect(error.diagnostics).toHaveLength(8_192);
  });

  it('terminates a runner that exceeds its configured timeout', async () => {
    const fixture = await createRunnerFixture('timeout', 50);
    const runner = new LocalQwenRunner(fixture.config, fixture.audioRoot);

    await expect(
      runner.run({ voiceSamplePath: fixture.voiceSamplePath, script: 'Hello', language: 'en-US' })
    ).rejects.toMatchObject({
      name: 'LocalTtsRunnerError',
      code: 'TIMEOUT'
    } satisfies Partial<LocalTtsRunnerError>);
  });

  it.each(['missing', 'empty'])('rejects %s output after a successful process exit', async (mode) => {
    const fixture = await createRunnerFixture(mode);
    const runner = new LocalQwenRunner(fixture.config, fixture.audioRoot);

    await expect(
      runner.run({ voiceSamplePath: fixture.voiceSamplePath, script: 'Hello', language: 'en-US' })
    ).rejects.toMatchObject({
      name: 'LocalTtsRunnerError',
      code: 'OUTPUT_INVALID'
    } satisfies Partial<LocalTtsRunnerError>);
  });

  it.each(['symlink', 'directory'])('rejects a generated %s instead of a regular-file output', async (mode) => {
    const fixture = await createRunnerFixture(mode);
    const runner = new LocalQwenRunner(fixture.config, fixture.audioRoot);

    await expect(
      runner.run({ voiceSamplePath: fixture.voiceSamplePath, script: 'Hello', language: 'en-US' })
    ).rejects.toMatchObject({
      name: 'LocalTtsRunnerError',
      code: 'OUTPUT_INVALID'
    } satisfies Partial<LocalTtsRunnerError>);
  });
});
