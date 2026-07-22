import { describe, expect, it } from 'vitest';

import {
  NARRATION_SAMPLE_LIMITS,
  assessNarrationProfileDraft,
  canStartTtsJob,
  isCompletedTtsJob,
  isNarrationSampleDurationValid,
  publicRuntimeStatusText,
  ttsJobStatusText
} from '../src/shared/narrationLogic';
import type { LocalTtsJob, LocalTtsRuntimeStatus, VoiceProfile } from '../src/shared/models';

const profile: VoiceProfile = {
  id: 'profile_01',
  displayName: 'Narrator',
  language: 'en-US',
  sampleCount: 1,
  totalDurationMs: 12_000,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z'
};

describe('narration profile draft assessment', () => {
  it('requires consent and trimmed identity fields before microphone start', () => {
    expect(
      assessNarrationProfileDraft({
        displayName: ' Narrator ',
        explicitConsent: true,
        language: ' en-US ',
        narrationScript: ' Read this aloud. '
      })
    ).toEqual({
      canStart: true,
      displayName: 'Narrator',
      language: 'en-US',
      narrationScript: 'Read this aloud.'
    });

    expect(
      assessNarrationProfileDraft({
        displayName: 'Narrator',
        explicitConsent: false,
        language: 'en-US',
        narrationScript: 'Read this aloud.'
      }).canStart
    ).toBe(false);
    expect(
      assessNarrationProfileDraft({
        displayName: '',
        explicitConsent: true,
        language: 'en-US',
        narrationScript: 'Read this aloud.'
      }).canStart
    ).toBe(false);
  });

  it('validates local sample duration between ten and thirty seconds', () => {
    expect(isNarrationSampleDurationValid(NARRATION_SAMPLE_LIMITS.minimumDurationMs - 1)).toBe(false);
    expect(isNarrationSampleDurationValid(NARRATION_SAMPLE_LIMITS.minimumDurationMs)).toBe(true);
    expect(isNarrationSampleDurationValid(NARRATION_SAMPLE_LIMITS.maximumDurationMs)).toBe(true);
    expect(isNarrationSampleDurationValid(NARRATION_SAMPLE_LIMITS.maximumDurationMs + 1)).toBe(false);
  });
});

describe('local TTS state helpers', () => {
  it('allows TTS only when runtime is ready with a selected profile and script', () => {
    const ready: LocalTtsRuntimeStatus = {
      kind: 'ready',
      provider: 'local_qwen',
      modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base',
      language: 'en-US',
      queuedJobs: 0
    };
    const busy: LocalTtsRuntimeStatus = {
      kind: 'busy',
      provider: 'local_qwen',
      modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base',
      queuedJobs: 1
    };

    expect(canStartTtsJob({ runtimeStatus: ready, selectedProfile: profile, script: ' Say this. ' })).toBe(true);
    expect(canStartTtsJob({ runtimeStatus: busy, selectedProfile: profile, script: 'Say this.' })).toBe(false);
    expect(canStartTtsJob({ runtimeStatus: ready, selectedProfile: null, script: 'Say this.' })).toBe(false);
    expect(canStartTtsJob({ runtimeStatus: ready, selectedProfile: profile, script: '' })).toBe(false);
  });

  it('maps runtime and job states to safe user-facing text', () => {
    expect(publicRuntimeStatusText({ kind: 'unavailable', provider: 'local_qwen', reason: '/secret/path.json missing' })).toBe(
      'Local Qwen narration is not configured. Set up the local wrapper configuration, then refresh runtime status.'
    );
    expect(publicRuntimeStatusText({ kind: 'error', provider: 'local_qwen', message: 'spawn /secret failed' })).toBe(
      'Local Qwen narration reported a setup error. Review the local wrapper configuration outside the app, then refresh.'
    );

    const completed: LocalTtsJob = {
      id: 'job_01',
      provider: 'local_qwen',
      voiceProfileId: profile.id,
      script: 'Done.',
      language: 'en-US',
      mimeType: 'audio/wav',
      state: { kind: 'completed', completedAt: '2026-07-20T00:00:00.000Z', outputAssetId: 'asset_01' },
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z'
    };

    expect(isCompletedTtsJob(completed)).toBe(true);
    expect(ttsJobStatusText(completed)).toBe('Generated audio is ready.');
  });
});
