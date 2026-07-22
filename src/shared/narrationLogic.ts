import type { AllowedAudioMimeType, LocalTtsJob, LocalTtsRuntimeStatus, VoiceProfile } from './models';
import { ALLOWED_AUDIO_MIME_TYPES } from './models';

export const CONSENT_TEXT_VERSION = '2026-07' as const;

export const NARRATION_SAMPLE_LIMITS = {
  minimumDurationMs: 10_000,
  maximumDurationMs: 30_000
} as const;

export const DEFAULT_NARRATION_SCRIPT =
  'This is my local narration reference for Window Loom. I consent to storing this sample on this device for local voice generation.';

export type NarrationProfileDraft = {
  readonly displayName: string;
  readonly explicitConsent: boolean;
  readonly language: string;
  readonly narrationScript: string;
};

export type AssessedNarrationProfileDraft = {
  readonly canStart: boolean;
  readonly displayName: string;
  readonly language: string;
  readonly narrationScript: string;
};

export type TtsReadinessInput = {
  readonly runtimeStatus: LocalTtsRuntimeStatus | null;
  readonly selectedProfile: VoiceProfile | null;
  readonly script: string;
};

export function parseAllowedAudioMimeType(value: string): AllowedAudioMimeType | null {
  for (const mimeType of ALLOWED_AUDIO_MIME_TYPES) {
    if (value === mimeType) {
      return mimeType;
    }
  }

  return null;
}

export function assessNarrationProfileDraft(draft: NarrationProfileDraft): AssessedNarrationProfileDraft {
  const displayName = draft.displayName.trim();
  const language = draft.language.trim();
  const narrationScript = draft.narrationScript.trim();

  return {
    canStart: draft.explicitConsent && displayName.length > 0 && language.length > 0 && narrationScript.length > 0,
    displayName,
    language,
    narrationScript
  };
}

export function isNarrationSampleDurationValid(durationMs: number): boolean {
  return durationMs >= NARRATION_SAMPLE_LIMITS.minimumDurationMs && durationMs <= NARRATION_SAMPLE_LIMITS.maximumDurationMs;
}

export function canStartTtsJob(input: TtsReadinessInput): boolean {
  return input.runtimeStatus?.kind === 'ready' && input.selectedProfile !== null && input.script.trim().length > 0;
}

export function publicRuntimeStatusText(status: LocalTtsRuntimeStatus | null): string {
  if (status === null) {
    return 'Checking local Qwen narration runtime.';
  }

  switch (status.kind) {
    case 'ready':
      return `Local Qwen narration is ready with ${status.modelId}.`;
    case 'busy':
      return `Local Qwen narration is busy with ${status.queuedJobs} queued job${status.queuedJobs === 1 ? '' : 's'}.`;
    case 'unavailable':
      return 'Local Qwen narration is not configured. Set up the local wrapper configuration, then refresh runtime status.';
    case 'error':
      return 'Local Qwen narration reported a setup error. Review the local wrapper configuration outside the app, then refresh.';
  }
}

export function isCompletedTtsJob(job: LocalTtsJob | null): boolean {
  return job?.state.kind === 'completed';
}

export function ttsJobStatusText(job: LocalTtsJob | null): string {
  if (job === null) {
    return 'No narration job has been started.';
  }

  switch (job.state.kind) {
    case 'queued':
      return 'Narration job is queued.';
    case 'running':
      return 'Narration audio is generating locally.';
    case 'completed':
      return 'Generated audio is ready.';
    case 'failed':
      return job.state.reason;
  }
}
