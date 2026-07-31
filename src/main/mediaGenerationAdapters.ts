/**
 * Cloud media-generation adapters for the voice/video workspaces. Every
 * adapter takes an injectable fetch, sends the API key only in headers, and
 * returns raw output bytes; callers own writing files and job state. Errors
 * never echo key material and keep provider detail short.
 */

import {
  requestLumaVideo,
  requestRunwayVideo,
  requestSoraVideo,
  requestVeoVideo,
  snapSoraSeconds,
  SORA_ALLOWED_SECONDS,
  type VideoDownload,
  type VideoRequestInput
} from '../shared/videoGeneration';

export { snapSoraSeconds, SORA_ALLOWED_SECONDS };

type FetchLike = typeof fetch;

const REQUEST_TIMEOUT_MS = 60_000;

export const DEFAULT_ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
export const DEFAULT_OPENAI_TTS_VOICE = 'alloy';
export const OPENAI_TTS_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'] as const;

async function safeErrorDetail(response: Response): Promise<string> {
  const bodyText = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } | string; detail?: { message?: string } | string };
    const candidate = parsed.error ?? parsed.detail;
    if (typeof candidate === 'string') return candidate.slice(0, 300);
    if (candidate && typeof candidate.message === 'string') return candidate.message.slice(0, 300);
  } catch {
    // keep raw text
  }
  return bodyText.slice(0, 300);
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function expectOk(response: Response, providerLabel: string): Promise<void> {
  if (response.ok) return;
  const detail = await safeErrorDetail(response);
  const unauthorized = response.status === 401 || response.status === 403;
  throw new Error(
    unauthorized
      ? `${providerLabel} rejected the stored API key (status ${response.status}). Reconnect the provider in Settings.`
      : `${providerLabel} request failed with status ${response.status}${detail ? `: ${detail}` : ''}.`
  );
}

const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

export type SpeechSynthesisInput = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly voiceId: string;
  readonly script: string;
  readonly fetchImpl?: FetchLike;
};

/** ElevenLabs text-to-speech: returns MP3 bytes. */
export async function generateElevenLabsSpeech(input: SpeechSynthesisInput): Promise<Buffer> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const voiceId = input.voiceId.trim().length > 0 ? input.voiceId.trim() : DEFAULT_ELEVENLABS_VOICE_ID;
  const response = await fetchWithTimeout(fetchImpl, `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': input.apiKey },
    body: JSON.stringify({ text: input.script, model_id: input.modelId })
  });
  await expectOk(response, 'ElevenLabs');
  return Buffer.from(await response.arrayBuffer());
}

/** OpenAI text-to-speech (gpt-4o-mini-tts / tts-1 / tts-1-hd): returns MP3 bytes. */
export async function generateOpenAiSpeech(input: SpeechSynthesisInput): Promise<Buffer> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const requestedVoice = input.voiceId.trim();
  const voice = (OPENAI_TTS_VOICES as readonly string[]).includes(requestedVoice) ? requestedVoice : DEFAULT_OPENAI_TTS_VOICE;
  const response = await fetchWithTimeout(fetchImpl, 'https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({ model: input.modelId, input: input.script, voice, response_format: 'mp3' })
  });
  await expectOk(response, 'OpenAI');
  return Buffer.from(await response.arrayBuffer());
}

export type GeneratedVideo = {
  readonly bytes: Buffer;
  /** Provider-side job/operation id, surfaced for debugging and future cancel/retry. */
  readonly providerJobId: string;
};

export type VideoSynthesisInput = VideoRequestInput;

/**
 * Downloads what the shared adapter resolved.
 *
 * The request, the polling and the failure messages are shared with the mobile
 * app; only this last step differs, because the desktop wants bytes it can write
 * to the AI directory and the phone wants the native downloader to stream
 * straight to disk.
 */
async function download(ready: VideoDownload, providerLabel: string, fetchImpl: FetchLike): Promise<GeneratedVideo> {
  const response = await fetchWithTimeout(fetchImpl, ready.url, { method: 'GET', headers: ready.headers }, REQUEST_TIMEOUT_MS * 5);
  await expectOk(response, providerLabel);
  return { bytes: Buffer.from(await response.arrayBuffer()), providerJobId: ready.providerJobId };
}

export async function generateVeoVideo(input: VideoSynthesisInput): Promise<GeneratedVideo> {
  return download(await requestVeoVideo(input), 'Google Veo', input.fetchImpl ?? fetch);
}

export async function generateSoraVideo(input: VideoSynthesisInput): Promise<GeneratedVideo> {
  return download(await requestSoraVideo(input), 'OpenAI Sora', input.fetchImpl ?? fetch);
}

export async function generateRunwayVideo(input: VideoSynthesisInput): Promise<GeneratedVideo> {
  return download(await requestRunwayVideo(input), 'Runway', input.fetchImpl ?? fetch);
}

export async function generateLumaVideo(input: VideoSynthesisInput): Promise<GeneratedVideo> {
  return download(await requestLumaVideo(input), 'Luma', input.fetchImpl ?? fetch);
}
