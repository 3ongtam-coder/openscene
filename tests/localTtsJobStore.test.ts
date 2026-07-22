import { describe, expect, it } from 'vitest';

import { LocalTtsJobStore } from '../src/main/localTtsJobStore';
import type { LocalTtsConfigLoadResult, LocalTtsRunnerConfig } from '../src/main/localTtsConfig';

const CONFIG: LocalTtsRunnerConfig = {
  executablePath: '/opt/qwen/bin/qwen-tts',
  modelPath: '/opt/qwen/model',
  argsTemplate: ['{modelPath}', '{voiceSamplePath}', '{textPath}', '{outputPath}'],
  outputExtension: '.wav',
  outputMimeType: 'audio/wav',
  timeoutMs: 120_000,
  modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base'
};

const CONFIGURED: LocalTtsConfigLoadResult = { kind: 'configured', config: CONFIG };

describe('local TTS job store', () => {
  it('retains queued, running, and completed lifecycle states without filesystem paths', () => {
    let nowMs = Date.parse('2026-07-20T10:00:00.000Z');
    const store = new LocalTtsJobStore({
      createId: () => 'job_01',
      now: () => new Date(nowMs)
    });
    const job = store.create(
      {
        voiceProfileId: 'profile_01',
        script: 'Hello from the job store.',
        language: 'en-US',
        mimeType: 'audio/wav'
      },
      CONFIG.modelId
    );

    expect(job.state.kind).toBe('queued');
    expect(store.getRuntimeStatus(CONFIGURED, 'en-US')).toMatchObject({ kind: 'ready', queuedJobs: 1 });

    nowMs += 1_000;
    expect(store.markRunning(job.id).state.kind).toBe('running');
    expect(store.getRuntimeStatus(CONFIGURED, 'en-US')).toMatchObject({ kind: 'busy', queuedJobs: 0 });

    nowMs += 1_000;
    const completed = store.markCompleted(job.id, 'asset_01');
    expect(completed.state).toEqual({
      kind: 'completed',
      completedAt: '2026-07-20T10:00:02.000Z',
      outputAssetId: 'asset_01'
    });
    expect(JSON.stringify(completed)).not.toContain('outputPath');
    expect(store.get(job.id)).toEqual(completed);
  });

  it('retains a failed terminal state and rejects invalid transitions', () => {
    const store = new LocalTtsJobStore({
      createId: () => 'job_02',
      now: () => new Date('2026-07-20T10:00:00.000Z')
    });
    const job = store.create(
      {
        voiceProfileId: 'profile_02',
        script: 'Hello',
        language: 'en-US',
        mimeType: 'audio/wav'
      },
      CONFIG.modelId
    );

    store.markRunning(job.id);
    expect(store.markFailed(job.id, 'Runner failed.').state).toEqual({
      kind: 'failed',
      failedAt: '2026-07-20T10:00:00.000Z',
      reason: 'Runner failed.'
    });
    expect(() => store.markCompleted(job.id, 'asset_02')).toThrow('cannot transition');
  });

  it('reports unavailable status when runtime configuration is absent or invalid', () => {
    const store = new LocalTtsJobStore();

    expect(
      store.getRuntimeStatus({ kind: 'unavailable', reason: 'Local TTS is not configured.' }, 'en-US')
    ).toEqual({
      kind: 'unavailable',
      provider: 'local_qwen',
      reason: 'Local TTS is not configured.'
    });
  });
});
