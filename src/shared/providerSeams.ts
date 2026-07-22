export type VideoGenerationProviderId = 'gemini_veo' | 'openai_sora';
export type TextToSpeechProviderId = 'elevenlabs' | 'local_qwen';
export type ProviderJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface VideoGenerationRequest {
  prompt: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  durationSeconds: number;
  stylePreset?: string;
}

export interface VideoGenerationJob {
  id: string;
  provider: VideoGenerationProviderId;
  status: ProviderJobStatus;
  prompt: string;
  providerJobId?: string;
  outputAssetId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoGenerationProvider {
  readonly id: VideoGenerationProviderId;
  readonly label: string;
  createJob(request: VideoGenerationRequest): Promise<VideoGenerationJob>;
  getJob(jobId: string): Promise<VideoGenerationJob>;
}

export interface TextToSpeechRequest {
  script: string;
  voiceId: string;
  modelId?: string;
  language?: string;
}

export interface TextToSpeechJob {
  id: string;
  provider: TextToSpeechProviderId;
  status: ProviderJobStatus;
  script: string;
  voiceId: string;
  outputAssetId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TextToSpeechProvider {
  readonly id: TextToSpeechProviderId;
  readonly label: string;
  createJob(request: TextToSpeechRequest): Promise<TextToSpeechJob>;
  getJob(jobId: string): Promise<TextToSpeechJob>;
}
