import { supportedShotSeconds } from './videoStoryboardPlan';

/**
 * Video generation over each provider's HTTP surface.
 *
 * Images could be lifted into shared by handing back base64, because an image is
 * small enough that holding it in a string costs nothing. A video is not: a
 * ten-second clip is megabytes, and base64 inflates it by a third before anything
 * has touched the disk. So the seam here is one step earlier — these functions
 * create the job, poll it, and return *where to fetch the finished video*. The
 * desktop then reads it into a Buffer and writes a file; the phone hands the URL
 * straight to the native downloader and never holds the bytes in JS at all.
 *
 * Everything up to that point — the request bodies, the polling, the failure
 * messages — is identical on both, which is why it belongs here rather than
 * being written twice.
 */

const REQUEST_TIMEOUT_MS = 60_000;
const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 10 * 60_000;

export type VideoAspectRatio = '16:9' | '9:16' | '1:1';

/** Where a finished video can be fetched, and what to send when fetching it. */
export type VideoDownload = {
  readonly url: string;
  /** The API key travels here, never in the URL. */
  readonly headers: Readonly<Record<string, string>>;
  readonly providerJobId: string;
  readonly mimeType: string;
};

/** Coarse enough to drive a label; generation takes minutes, not milliseconds. */
export type VideoProgressStage = 'submitting' | 'generating' | 'ready';

export type VideoRequestInput = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly aspectRatio: VideoAspectRatio;
  readonly durationSeconds: number;
  /** Optional image-to-video seed; only Veo accepts one in this build. */
  readonly referenceImage?: { readonly mimeType: string; readonly base64: string };
  readonly fetchImpl?: typeof fetch;
  readonly pollIntervalMs?: number;
  readonly pollTimeoutMs?: number;
  readonly onProgress?: (stage: VideoProgressStage, elapsedMs: number) => void;
};

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
  fetchImpl: typeof fetch,
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

/**
 * Sora takes a discrete set of lengths, so a request has to land on one of them.
 * The numbers come from the shared table rather than a second literal: a length
 * the table knows and the adapter does not would be silently snapped to a
 * different duration than the one the user was quoted and approved.
 */
export const SORA_ALLOWED_SECONDS: readonly number[] = supportedShotSeconds('openai');

export function snapSoraSeconds(requested: number): number {
  return SORA_ALLOWED_SECONDS.reduce((best, candidate) =>
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best
  );
}

/**
 * Google Veo over the Gemini API: predictLongRunning → poll the operation →
 * hand back the sample's download URI. The key travels in headers only.
 */
export async function requestVeoVideo(input: VideoRequestInput): Promise<VideoDownload> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const pollIntervalMs = input.pollIntervalMs ?? VIDEO_POLL_INTERVAL_MS;
  const pollTimeoutMs = input.pollTimeoutMs ?? VIDEO_POLL_TIMEOUT_MS;
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey };
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  const startedAt = Date.now();
  input.onProgress?.('submitting', 0);

  const startResponse = await fetchWithTimeout(fetchImpl, `${base}/models/${encodeURIComponent(input.modelId)}:predictLongRunning`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      instances: [{
        prompt: input.prompt,
        ...(input.referenceImage === undefined
          ? {}
          : { image: { bytesBase64Encoded: input.referenceImage.base64, mimeType: input.referenceImage.mimeType } })
      }],
      parameters: { aspectRatio: input.aspectRatio === '1:1' ? '16:9' : input.aspectRatio }
    })
  });
  await expectOk(startResponse, 'Google Veo');
  const operation = (await startResponse.json()) as { name?: string };
  if (typeof operation.name !== 'string' || operation.name.length === 0) {
    throw new Error('Google Veo did not return an operation to poll.');
  }

  const deadline = startedAt + pollTimeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`Google Veo generation did not finish within ${Math.round(pollTimeoutMs / 60_000)} minutes.`);
    }
    input.onProgress?.('generating', Date.now() - startedAt);
    await sleep(pollIntervalMs);
    const pollResponse = await fetchWithTimeout(fetchImpl, `${base}/${operation.name}`, { method: 'GET', headers });
    await expectOk(pollResponse, 'Google Veo');
    const status = (await pollResponse.json()) as {
      done?: boolean;
      error?: { message?: string };
      response?: { generateVideoResponse?: { generatedSamples?: readonly { video?: { uri?: string } }[] } };
    };
    if (status.done !== true) continue;
    if (status.error !== undefined) {
      throw new Error(`Google Veo generation failed: ${status.error.message ?? 'unknown error'}.`);
    }
    const videoUri = status.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (typeof videoUri !== 'string' || videoUri.length === 0) {
      throw new Error('Google Veo finished without a downloadable video.');
    }
    input.onProgress?.('ready', Date.now() - startedAt);
    return {
      url: videoUri,
      headers: { 'x-goog-api-key': input.apiKey },
      providerJobId: operation.name,
      mimeType: 'video/mp4'
    };
  }
}

/** OpenAI Sora over /v1/videos: create → poll → hand back the content URL. */
export async function requestSoraVideo(input: VideoRequestInput): Promise<VideoDownload> {
  if (input.referenceImage !== undefined) {
    // Sora takes an input_reference only as multipart, which this adapter does
    // not send. Refuse rather than silently generating without the image.
    throw new Error('OpenAI Sora reference images are not supported in this build; use Google Veo, or remove the reference image.');
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const pollIntervalMs = input.pollIntervalMs ?? VIDEO_POLL_INTERVAL_MS;
  const pollTimeoutMs = input.pollTimeoutMs ?? VIDEO_POLL_TIMEOUT_MS;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` };
  const size = input.aspectRatio === '9:16' ? '720x1280' : input.aspectRatio === '1:1' ? '720x720' : '1280x720';
  const startedAt = Date.now();
  input.onProgress?.('submitting', 0);

  const startResponse = await fetchWithTimeout(fetchImpl, 'https://api.openai.com/v1/videos', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: input.modelId,
      prompt: input.prompt,
      seconds: String(snapSoraSeconds(input.durationSeconds)),
      size
    })
  });
  await expectOk(startResponse, 'OpenAI Sora');
  const created = (await startResponse.json()) as { id?: string };
  if (typeof created.id !== 'string' || created.id.length === 0) {
    throw new Error('OpenAI Sora did not return a video job id.');
  }

  const deadline = startedAt + pollTimeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`OpenAI Sora generation did not finish within ${Math.round(pollTimeoutMs / 60_000)} minutes.`);
    }
    input.onProgress?.('generating', Date.now() - startedAt);
    await sleep(pollIntervalMs);
    const pollResponse = await fetchWithTimeout(fetchImpl, `https://api.openai.com/v1/videos/${encodeURIComponent(created.id)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.apiKey}` }
    });
    await expectOk(pollResponse, 'OpenAI Sora');
    const status = (await pollResponse.json()) as { status?: string; error?: { message?: string } };
    if (status.status === 'failed') {
      throw new Error(`OpenAI Sora generation failed: ${status.error?.message ?? 'unknown error'}.`);
    }
    if (status.status !== 'completed') continue;
    input.onProgress?.('ready', Date.now() - startedAt);
    return {
      url: `https://api.openai.com/v1/videos/${encodeURIComponent(created.id)}/content`,
      headers: { Authorization: `Bearer ${input.apiKey}` },
      providerJobId: created.id,
      mimeType: 'video/mp4'
    };
  }
}

/** The adapter a provider id resolves to, or undefined when none is ported. */
export function videoAdapterFor(providerId: string): ((input: VideoRequestInput) => Promise<VideoDownload>) | undefined {
  if (providerId === 'openai') return requestSoraVideo;
  if (providerId === 'google_gemini') return requestVeoVideo;
  return undefined;
}
