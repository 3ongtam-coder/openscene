import type { TextToSpeechProviderId } from './providerSeams';

export type AppErrorCode =
  | 'SOURCE_STALE'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_UNAVAILABLE'
  | 'PROFILE_NOT_FOUND'
  | 'JOB_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'TTS_UNAVAILABLE'
  | 'TTS_RESULT_UNAVAILABLE' | 'EXPORT_RESULT_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'PERMISSION_DENIED'
  | 'RECORDER_UNAVAILABLE' | 'EXPORT_UNAVAILABLE'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'FILE_WRITE_FAILED'
  | 'UNKNOWN_ERROR';

export interface AppError {
  code: AppErrorCode;
  message: string;
}

export type ApiResponse<T> = { ok: true; value: T } | { ok: false; error: AppError };

export interface CaptureSource {
  id: string;
  name: string;
  appName: string;
  generation: number;
  thumbnailDataUrl?: string;
  displayId?: string;
}

export type RecordingStatus = 'idle' | 'source_selected' | 'recording' | 'paused' | 'finalizing' | 'completed' | 'error';

export interface RecordingSession {
  id: string;
  sourceId: string;
  sourceName: string;
  status: Exclude<RecordingStatus, 'idle' | 'source_selected' | 'completed' | 'error'>;
  startedAt: string;
  outputPath: string;
}

export interface RecordingResult {
  sessionId: string;
  outputPath: string;
  fileName: string;
  directory: string;
  fileSizeBytes: number;
  durationMs: number;
  createdAt: string;
}

export interface AppSettings {
  recordingsPath: string;
  screenPermission: string;
  platform: NodeJS.Platform;
}

export interface SelectSourceInput {
  sourceId: string;
  generation: number;
}

export interface StartRecordingInput {
  sourceId: string;
  generation: number;
}

export interface AppendRecordingChunkInput {
  sessionId: string;
  sequence: number;
  chunk: ArrayBuffer;
}

export interface FinishRecordingInput {
  sessionId: string;
  durationMs: number;
}

export interface AbortRecordingInput {
  sessionId: string;
  reason: string;
}

export interface ResultActionInput {
  sessionId: string;
}

export interface SourceAvailabilityInput {
  sessionId: string;
}

export interface ChunkAck {
  sequence: number;
  totalBytes: number;
}

export interface SourceAvailability {
  available: boolean;
  reason?: string;
}

export const ALLOWED_AUDIO_MIME_TYPES = ['audio/webm', 'audio/webm;codecs=opus', 'audio/wav', 'audio/mpeg'] as const;

export type AllowedAudioMimeType = (typeof ALLOWED_AUDIO_MIME_TYPES)[number];

export type VoiceProfileSampleConsent = {
  readonly explicitConsent: true;
  readonly consentTextVersion: string;
  readonly consentedAt: string;
};

export type VoiceProfileSample = {
  readonly id: string;
  readonly voiceProfileId: string;
  readonly displayName: string;
  readonly narrationScript: string;
  readonly language: string;
  readonly mimeType: AllowedAudioMimeType;
  readonly byteLength: number;
  readonly durationMs: number;
  readonly consent: VoiceProfileSampleConsent;
  readonly createdAt: string;
};

export type VoiceProfile = {
  readonly id: string;
  readonly displayName: string;
  readonly language: string;
  readonly sampleCount: number;
  readonly totalDurationMs: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type LocalTtsRuntimeStatus =
  | {
      readonly kind: 'unavailable';
      readonly provider: 'local_qwen';
      readonly reason: string;
    }
  | {
      readonly kind: 'ready';
      readonly provider: 'local_qwen';
      readonly modelId: string;
      readonly language: string;
      readonly queuedJobs: number;
    }
  | {
      readonly kind: 'busy';
      readonly provider: 'local_qwen';
      readonly modelId: string;
      readonly queuedJobs: number;
    }
  | {
      readonly kind: 'error';
      readonly provider: 'local_qwen';
      readonly message: string;
    };

export type StartVoiceProfileSampleInput = {
  readonly displayName: string;
  readonly explicitConsent: true;
  readonly consentTextVersion: string;
  readonly language: string;
  readonly narrationScript: string;
  readonly mimeType: AllowedAudioMimeType;
};

export type VoiceProfileSampleSession = {
  readonly voiceProfileId: string;
  readonly sampleId: string;
  readonly createdAt: string;
};

export type AppendVoiceProfileSampleChunkInput = {
  readonly sampleId: string;
  readonly sequence: number;
  readonly chunk: ArrayBuffer;
};

export type FinalizeVoiceProfileSampleInput = {
  readonly sampleId: string;
  readonly durationMs: number;
};

export type DiscardVoiceProfileSampleInput = {
  readonly sampleId: string;
};

export type DeleteVoiceProfileInput = {
  readonly voiceProfileId: string;
};

export type StartTtsJobInput = {
  readonly voiceProfileId: string;
  readonly script: string;
  readonly language: string;
  readonly mimeType: AllowedAudioMimeType;
  readonly modelId?: string;
};

export type GetTtsJobInput = {
  readonly jobId: string;
};

export type TtsJobActionInput = GetTtsJobInput;

export type TtsJobState =
  | {
      readonly kind: 'queued';
      readonly queuedAt: string;
    }
  | {
      readonly kind: 'running';
      readonly startedAt: string;
    }
  | {
      readonly kind: 'completed';
      readonly completedAt: string;
      readonly outputAssetId: string;
    }
  | {
      readonly kind: 'failed';
      readonly failedAt: string;
      readonly reason: string;
    };

export type LocalTtsJob = {
  readonly id: string;
  readonly provider: TextToSpeechProviderId;
  readonly voiceProfileId: string;
  readonly script: string;
  readonly language: string;
  readonly mimeType: AllowedAudioMimeType;
  readonly modelId?: string;
  readonly state: TtsJobState;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type GeneratedAudioAssetMetadata = {
  readonly id: string;
  readonly jobId: string;
  readonly voiceProfileId: string;
  readonly provider: TextToSpeechProviderId;
  readonly modelId: string;
  readonly mimeType: AllowedAudioMimeType;
  readonly byteLength: number;
  readonly durationMs: number;
  readonly sampleRateHz: number;
  readonly channelCount: number;
  readonly language: string;
  readonly createdAt: string;
};
