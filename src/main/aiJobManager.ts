import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type {
  ImageGenerationJob,
  ImageGenerationProviderId,
  ImageGenerationRequest,
  TextToSpeechJob,
  TextToSpeechRequest,
  VideoGenerationJob,
  VideoGenerationProviderId,
  VideoGenerationRequest
} from '../shared/providerSeams';
import { getDefaultDomainModelId, getDomainModel, type AiDomainModelConfig } from '../shared/aiDomainModels';
import { estimateImageCost, estimateSpeechCost, estimateVideoCost, type CostEstimate } from '../shared/mediaGenerationPricing';
import { getVideoOperationConstraints, getVideoProviderBinding, validateVideoRequest } from '../shared/mediaCapabilityRegistry';
import { resolveVideoOperation, validateVideoInputSet } from '../shared/videoGeneration';
import { GenerationSpendStore } from './generationSpendStore';
import { discoverFfmpeg } from './ffmpegDiscovery';
import type { CredentialStore } from './credentialStore';
import {
  generateElevenLabsSpeech,
  generateLumaVideo,
  generateOpenAiSpeech,
  generateRunwayVideo,
  generateSoraVideo,
  generateVeoVideo,
  generateVieNeuSpeech,
  listVieNeuVoices
} from './mediaGenerationAdapters';
import { voiceChoices, type VoiceChoice } from '../shared/voiceCatalog';
import {
  generateBytePlusImage,
  generateImagenImage,
  generateOpenAiImage,
  imageExtensionFor,
  type GeneratedImage
} from './imageGenerationAdapters';
import { tmpdir } from 'node:os';
import { speechPreviewUrl } from '../shared/mediaPlaybackUrls';
import type { OpenedAssetPlaybackSource } from './assetLibraryStore';
import { isInsideDirectory } from './projectStoreSupport';
import { parseVoiceDeliverySettings, type VoiceDeliverySettings } from '../shared/voiceDelivery';

const videoJobs = new Map<string, VideoGenerationJob>();
const speechJobs = new Map<string, TextToSpeechJob>();
const imageJobs = new Map<string, ImageGenerationJob>();
let activeCredentialStore: CredentialStore | undefined;
let activeSpendStore: GenerationSpendStore | undefined;

function logSpeechJob(jobId: string, event: string, details: Readonly<Record<string, unknown>> = {}, level: 'info' | 'error' = 'info'): void {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  console[level](`[OpenScene][Speech][${jobId}] ${event}${suffix}`);
}

function logVideoJob(jobId: string, event: string, details: Readonly<Record<string, unknown>> = {}, level: 'info' | 'error' = 'info'): void {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  console[level](`[OpenScene][Video][${jobId}] ${event}${suffix}`);
}

/**
 * A charge refused before it was made.
 *
 * Its own type because the callers have to tell it apart from a provider
 * failure: nothing was generated, nothing was spent, and the user can act on
 * it by raising the ceiling or picking a cheaper model.
 */
export class GenerationSpendError extends Error {
  override readonly name = 'GenerationSpendError';
}

export function setAiJobManagerSpendStore(store?: GenerationSpendStore | undefined): void {
  activeSpendStore = store;
}

/**
 * The ceiling, checked and claimed in one step before a job is created.
 *
 * A check on its own is not a limit: two jobs asked for at once would both read
 * the same total, both pass, and both spend. The store takes the room out of
 * the ceiling as it answers, and the caller either keeps it — `settleSpend`,
 * once the request has gone to a provider — or hands it back.
 *
 * A machine with no ledger wired in — every test, and any host that has not set
 * one — is unlimited, which is what the app did before there were limits at all.
 */
async function reserveSpend(estimate: CostEstimate, acceptUnknownCost: boolean | undefined): Promise<string | null> {
  if (activeSpendStore === undefined) return null;
  const reservation = await activeSpendStore.reserve(estimate, acceptUnknownCost);
  if (!reservation.ok) throw new GenerationSpendError(reservation.reason);
  return reservation.id;
}

/**
 * Settled where the money is actually committed — as the request goes to the
 * provider, not when the job is queued. A job that never got that far because a
 * key was missing cost nothing, so its room goes back rather than being kept.
 */
async function settleSpend(reservationId: string | null, outcome: 'charged' | 'released'): Promise<void> {
  if (activeSpendStore === undefined || reservationId === null) return;
  try {
    if (outcome === 'charged') await activeSpendStore.charge(reservationId);
    else await activeSpendStore.release(reservationId);
  } catch {
    // A ledger that cannot be written must not take a generation down with it.
    // An unsettled reservation is treated as a charge once it goes stale, which
    // errs toward the user's wallet rather than against it.
  }
}

export function setAiJobManagerCredentialStore(store?: CredentialStore | undefined): void {
  activeCredentialStore = store;
}

function getAiStorageDir(): string {
  const userDataDir = app?.getPath !== undefined ? app.getPath('userData') : join(tmpdir(), 'openvideo-ai-storage');
  return join(userDataDir, 'ai_generations');
}

export async function ensureAiDirectories(): Promise<{ videoDir: string; speechDir: string; imageDir: string }> {
  const baseDir = getAiStorageDir();
  const videoDir = join(baseDir, 'video');
  const speechDir = join(baseDir, 'speech');
  const imageDir = join(baseDir, 'image');
  await mkdir(videoDir, { recursive: true });
  await mkdir(speechDir, { recursive: true });
  await mkdir(imageDir, { recursive: true });
  return { videoDir, speechDir, imageDir };
}

type CloudProviderResult =
  | { readonly ok: true; readonly outputFilePath?: string; readonly providerJobId?: string }
  | { readonly ok: false; readonly error: string };

const VIDEO_PROVIDER_LABELS: Record<VideoGenerationProviderId, string> = {
  gemini_veo: 'Google Veo',
  openai_sora: 'OpenAI Sora',
  runway_gen4: 'Runway',
  kling_v3: 'Kling',
  luma_dream: 'Luma',
  minimax_hailuo: 'MiniMax Hailuo'
};

const IMAGE_PROVIDER_LABELS: Record<ImageGenerationProviderId, string> = {
  openai_images: 'OpenAI Images',
  google_imagen: 'Google Imagen',
  byteplus_seedream: 'BytePlus Seedream',
  stability_image: 'Stability AI',
  flux_image: 'Black Forest Labs',
  alibaba_wan_image: 'Alibaba Wan'
};

const IMAGE_MODEL_PROVIDERS: Record<string, { seam: ImageGenerationProviderId; credentialKey: string }> = {
  openai: { seam: 'openai_images', credentialKey: 'openaiApiKey' },
  google_gemini: { seam: 'google_imagen', credentialKey: 'geminiApiKey' },
  byteplus: { seam: 'byteplus_seedream', credentialKey: 'bytePlusApiKey' },
  stability: { seam: 'stability_image', credentialKey: 'stabilityApiKey' },
  black_forest_labs: { seam: 'flux_image', credentialKey: 'blackForestLabsApiKey' },
  alibaba_dashscope: { seam: 'alibaba_wan_image', credentialKey: 'dashscopeApiKey' }
};

const SPEECH_MODEL_PROVIDERS: Record<string, { seam: TextToSpeechJob['provider']; credentialKey?: string; label: string }> = {
  elevenlabs: { seam: 'elevenlabs', credentialKey: 'elevenlabsApiKey', label: 'ElevenLabs' },
  openai: { seam: 'openai_tts', credentialKey: 'openaiApiKey', label: 'OpenAI' },
  google_gemini: { seam: 'gemini_tts', credentialKey: 'geminiApiKey', label: 'Google Gemini' },
  groq: { seam: 'groq_tts', credentialKey: 'groq', label: 'Groq' },
  vieneu_local: { seam: 'vieneu_local', label: 'VieNeu-TTS' }
};

async function invokeCloudVideoProvider(
  jobId: string,
  model: AiDomainModelConfig,
  apiKey: string,
  request: VideoGenerationRequest & { readonly durationSeconds: number },
  outputFilePath: string
): Promise<CloudProviderResult> {
  let lastProgressLogMs = -10_000;
  const synthesisInput = {
    apiKey,
    modelId: model.id,
    prompt: request.prompt,
    aspectRatio: request.aspectRatio ?? ('16:9' as const),
    durationSeconds: request.durationSeconds,
    operation: resolveVideoOperation(request),
    ...(request.referenceImage === undefined ? {} : { referenceImage: request.referenceImage }),
    ...(request.lastFrame === undefined ? {} : { lastFrame: request.lastFrame }),
    ...(request.referenceImages === undefined ? {} : { referenceImages: request.referenceImages }),
    onProgress: (stage: 'submitting' | 'generating' | 'ready', elapsedMs: number) => {
      if (stage === 'generating' && elapsedMs - lastProgressLogMs < 10_000) return;
      lastProgressLogMs = elapsedMs;
      logVideoJob(jobId, `provider.${stage}`, { elapsedSeconds: Math.round(elapsedMs / 1_000) });
    }
  };
  try {
    const binding = getVideoProviderBinding(model.id);
    if (binding === undefined) {
      return { ok: false, error: `${model.providerLabel} video generation adapter is not implemented in this build.` };
    }
    // One entry per ported provider, so adding an adapter is one line rather
    // than another branch in a chain that is easy to leave a provider out of.
    const adapters: Readonly<Record<string, (input: typeof synthesisInput) => Promise<{ bytes: Buffer; providerJobId: string }>>> = {
      google_veo: generateVeoVideo,
      openai_sora: generateSoraVideo,
      runway: generateRunwayVideo,
      luma: generateLumaVideo
    };
    const adapter = adapters[binding.adapterId];
    if (adapter === undefined) {
      return {
        ok: false,
        error: `${model.providerLabel} video generation adapter is not implemented in this build.`
      };
    }
    const generated = await adapter(synthesisInput);
    await writeFile(outputFilePath, generated.bytes);
    return { ok: true, outputFilePath, providerJobId: generated.providerJobId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Cloud video generation failed.' };
  }
}

async function invokeSpeechProvider(
  model: AiDomainModelConfig,
  apiKey: string | undefined,
  request: TextToSpeechRequest,
  outputFilePath: string
): Promise<CloudProviderResult> {
  try {
    let bytes: Buffer;
    if (model.providerId === 'vieneu_local') {
      bytes = await generateVieNeuSpeech({ voiceId: request.voiceId ?? '', script: request.script, ...(request.delivery === undefined ? {} : { delivery: request.delivery }) });
    } else if (model.providerId === 'elevenlabs' && apiKey !== undefined) {
      bytes = await generateElevenLabsSpeech({ apiKey, modelId: model.id, voiceId: request.voiceId ?? '', script: request.script, ...(request.delivery === undefined ? {} : { delivery: request.delivery }) });
    } else if (model.providerId === 'openai' && apiKey !== undefined) {
      bytes = await generateOpenAiSpeech({ apiKey, modelId: model.id, voiceId: request.voiceId ?? '', script: request.script, ...(request.delivery === undefined ? {} : { delivery: request.delivery }) });
    } else {
      return {
        ok: false,
        error: `${model.providerLabel} speech synthesis adapter is not implemented in this build.`
      };
    }
    await writeFile(outputFilePath, bytes);
    return { ok: true, outputFilePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Speech synthesis failed.' };
  }
}

type CloudImageResult =
  | { readonly ok: true; readonly image: GeneratedImage }
  | { readonly ok: false; readonly error: string };

async function invokeCloudImageProvider(
  model: AiDomainModelConfig,
  apiKey: string,
  request: ImageGenerationRequest
): Promise<CloudImageResult> {
  const synthesisInput = {
    apiKey,
    modelId: model.id,
    prompt: request.prompt,
    aspectRatio: request.aspectRatio ?? ('1:1' as const),
    ...(request.negativePrompt === undefined ? {} : { negativePrompt: request.negativePrompt }),
    ...(request.referenceImage === undefined ? {} : { referenceImage: request.referenceImage })
  };
  try {
    let image: GeneratedImage;
    if (model.providerId === 'openai') {
      image = await generateOpenAiImage(synthesisInput);
    } else if (model.providerId === 'google_gemini') {
      image = await generateImagenImage(synthesisInput);
    } else if (model.providerId === 'byteplus') {
      image = await generateBytePlusImage(synthesisInput);
    } else {
      return {
        ok: false,
        error: `${model.providerLabel} image generation adapter is not implemented in this build.`
      };
    }
    return { ok: true, image };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Cloud image generation failed.' };
  }
}

/** Resolve only catalog entries with a runnable adapter for the requested domain. */
function resolveGenerationModel(
  domain: 'voice-generation' | 'video-generation' | 'image-generation',
  requestedModelId: string | undefined
): AiDomainModelConfig {
  const modelId = requestedModelId ?? getDefaultDomainModelId(domain);
  const model = getDomainModel(domain, modelId);
  if (model === undefined || !model.available) {
    throw new Error(`Model ${modelId} is not available for ${domain}.`);
  }
  return model;
}

export async function createVideoGenerationJob(request: VideoGenerationRequest): Promise<VideoGenerationJob> {
  const model = resolveGenerationModel('video-generation', request.modelId);
  const providerMapping = getVideoProviderBinding(model.id);
  if (providerMapping === undefined) throw new Error(`Model ${model.id} has no runnable video provider binding.`);
  const provider: VideoGenerationProviderId = providerMapping.seamProviderId;
  const modelId = model.id;
  const resolvedInputs = validateVideoInputSet(request);
  const operation = resolvedInputs.operation;
  const constraints = getVideoOperationConstraints(modelId, operation);
  const durationSeconds = request.durationSeconds ?? constraints?.durationSeconds[0] ?? 4;
  const aspectRatio = request.aspectRatio ?? constraints?.aspectRatios[0] ?? '16:9';
  const validation = validateVideoRequest({
    modelId,
    operation,
    durationSeconds,
    aspectRatio,
    referenceImageCount: resolvedInputs.referenceImageCount
  });
  if (!validation.ok) throw new Error(validation.message);
  const estimate = estimateVideoCost({ modelId, durationSeconds });
  const reservationId = await reserveSpend(estimate, request.acceptUnknownCost);
  const { videoDir } = await ensureAiDirectories();
  const id = `video-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const now = new Date().toISOString();

  const job: VideoGenerationJob = {
    id,
    provider,
    mode: 'api',
    status: 'queued',
    prompt: request.prompt,
    operation,
    aspectRatio,
    durationSeconds,
    stylePreset: request.stylePreset ?? 'Cinematic',
    modelId,
    createdAt: now,
    updatedAt: now
  };
  const normalizedRequest: VideoGenerationRequest & { readonly durationSeconds: number } = {
    ...request,
    aspectRatio,
    durationSeconds
  };

  videoJobs.set(id, job);
  logVideoJob(id, 'request.queued', {
    modelId,
    operation,
    durationSeconds,
    aspectRatio,
    referenceImageCount: resolvedInputs.referenceImageCount
  });

  setTimeout(async () => {
    const startedAt = Date.now();
    try {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      videoJobs.set(id, job);
      logVideoJob(id, 'process.started');

      let apiKey = request.apiKey?.trim();
      if ((!apiKey || apiKey.length === 0) && activeCredentialStore) {
        apiKey = await activeCredentialStore.getCredentialValue(providerMapping.credentialKey);
      }

      if (!apiKey || apiKey.length === 0) {
        throw new Error(`API key is required for ${VIDEO_PROVIDER_LABELS[provider]} cloud generation. Connect the provider in Settings first.`);
      }

      await settleSpend(reservationId, 'charged');
      logVideoJob(id, 'provider.request.started', { provider: VIDEO_PROVIDER_LABELS[provider] });
      const cloudResult = await invokeCloudVideoProvider(id, model, apiKey, normalizedRequest, join(videoDir, `${id}.mp4`));
      if (!cloudResult.ok) {
        throw new Error(cloudResult.error);
      }

      job.status = 'completed';
      if (cloudResult.outputFilePath !== undefined) {
        job.outputFilePath = cloudResult.outputFilePath;
      }
      if (cloudResult.providerJobId !== undefined) {
        job.providerJobId = cloudResult.providerJobId;
      }

      job.updatedAt = new Date().toISOString();
      videoJobs.set(id, job);
      logVideoJob(id, 'request.completed', {
        elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
        providerJobId: cloudResult.providerJobId
      });
    } catch (err) {
      // Handing the room back is safe whether or not it was already kept:
      // release only takes back a reservation that is still pending, so a
      // failure after the request went out leaves the charge standing.
      await settleSpend(reservationId, 'released');
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : 'Video generation failed';
      job.updatedAt = new Date().toISOString();
      videoJobs.set(id, job);
      logVideoJob(id, 'request.failed', {
        elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
        error: job.error
      }, 'error');
    }
  }, 1000);

  return job;
}

export function getVideoGenerationJob(jobId: string): VideoGenerationJob | null {
  return videoJobs.get(jobId) ?? null;
}

export async function createImageGenerationJob(request: ImageGenerationRequest): Promise<ImageGenerationJob> {
  const model = resolveGenerationModel('image-generation', request.modelId);
  const providerMapping = IMAGE_MODEL_PROVIDERS[model.providerId];
  const provider: ImageGenerationProviderId = providerMapping?.seam ?? 'openai_images';
  // One image per job, which is what this seam creates.
  const estimate = estimateImageCost({ modelId: model.id, imageCount: 1 });
  const reservationId = await reserveSpend(estimate, request.acceptUnknownCost);
  const { imageDir } = await ensureAiDirectories();
  const id = `image-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  const job: ImageGenerationJob = {
    id,
    provider,
    mode: 'api',
    status: 'queued',
    prompt: request.prompt,
    aspectRatio: request.aspectRatio ?? '1:1',
    modelId: model.id,
    ...(request.stylePreset === undefined ? {} : { stylePreset: request.stylePreset }),
    ...(request.negativePrompt === undefined ? {} : { negativePrompt: request.negativePrompt }),
    createdAt: now,
    updatedAt: now
  };

  imageJobs.set(id, job);

  setTimeout(async () => {
    const running: ImageGenerationJob = { ...job, status: 'running', updatedAt: new Date().toISOString() };
    imageJobs.set(id, running);
    try {
      let apiKey = request.apiKey?.trim();
      if ((apiKey === undefined || apiKey.length === 0) && activeCredentialStore) {
        apiKey = await activeCredentialStore.getCredentialValue(providerMapping?.credentialKey ?? 'openaiApiKey');
      }
      if (apiKey === undefined || apiKey.length === 0) {
        throw new Error(
          `API key is required for ${IMAGE_PROVIDER_LABELS[provider]} image generation. Connect the provider in Settings first.`
        );
      }

      await settleSpend(reservationId, 'charged');
      const result = await invokeCloudImageProvider(model, apiKey, request);
      if (!result.ok) {
        throw new Error(result.error);
      }

      const outputFilePath = join(imageDir, `${id}.${imageExtensionFor(result.image.mimeType)}`);
      await writeFile(outputFilePath, result.image.bytes);

      imageJobs.set(id, {
        ...running,
        status: 'completed',
        outputFilePath,
        providerJobId: result.image.providerJobId,
        // Carried inline so the studio can show the result without ever
        // learning a filesystem path.
        previewMimeType: result.image.mimeType,
        previewBase64: result.image.bytes.toString('base64'),
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      // Handing the room back is safe whether or not it was already kept:
      // release only takes back a reservation that is still pending, so a
      // failure after the request went out leaves the charge standing.
      await settleSpend(reservationId, 'released');
      imageJobs.set(id, {
        ...running,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Image generation failed',
        updatedAt: new Date().toISOString()
      });
    }
  }, 0);

  return job;
}

export function getImageGenerationJob(jobId: string): ImageGenerationJob | null {
  return imageJobs.get(jobId) ?? null;
}

/**
 * A finished image, handed back as bytes for use as a video reference. The
 * renderer gets the same inline shape a picked file would produce, so image-to
 * -video does not care whether the seed was generated or chosen from disk.
 */
export function getGeneratedImageAsReference(
  jobId: string
): { readonly displayName: string; readonly mimeType: string; readonly base64: string } | null {
  const job = imageJobs.get(jobId);
  if (job === undefined || job.status !== 'completed' || job.previewBase64 === undefined) return null;
  const mimeType = job.previewMimeType ?? 'image/png';
  return {
    displayName: `AI_Image_${job.id.slice(-6)}.${imageExtensionFor(mimeType)}`,
    mimeType,
    base64: job.previewBase64
  };
}

export async function createSpeechGenerationJob(request: TextToSpeechRequest): Promise<TextToSpeechJob> {
  let delivery: VoiceDeliverySettings | undefined;
  if (request.delivery !== undefined) {
    const parsedDelivery = parseVoiceDeliverySettings(request.delivery);
    if (parsedDelivery === null) {
      throw new Error('Voice delivery settings are invalid. Review the performance script and controls before retrying.');
    }
    delivery = parsedDelivery;
  }
  const providerRequest: TextToSpeechRequest = {
    ...request,
    ...(delivery === undefined ? {} : { delivery })
  };
  const model = resolveGenerationModel('voice-generation', request.modelId);
  const speechMapping = SPEECH_MODEL_PROVIDERS[model.providerId];
  if (speechMapping === undefined) throw new Error(`Model ${model.id} has no runnable speech provider binding.`);
  const provider: TextToSpeechJob['provider'] = speechMapping.seam;
  const modelId = model.id;
  const reservationId = model.executionPath === 'api'
    ? await reserveSpend(estimateSpeechCost({ modelId }), request.acceptUnknownCost)
    : null;
  const { speechDir } = await ensureAiDirectories();
  const id = `speech-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = Date.now();
  const now = new Date().toISOString();

  const job: TextToSpeechJob = {
    id,
    provider,
    mode: model.executionPath,
    status: 'queued',
    script: request.script,
    voiceId: request.voiceId ?? '',
    modelId,
    createdAt: now,
    updatedAt: now
  };

  speechJobs.set(id, job);
  logSpeechJob(id, 'request.queued', {
    provider: speechMapping.label,
    executionPath: model.executionPath,
    model: modelId,
    scriptCharacters: request.script.length,
    performanceScriptCharacters: delivery?.performanceScript.length ?? request.script.length,
    expressiveDelivery: delivery !== undefined,
    voiceConfigured: Boolean(request.voiceId?.trim())
  });

  setTimeout(async () => {
    try {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      speechJobs.set(id, job);
      logSpeechJob(id, 'process.started');

      let apiKey = request.apiKey?.trim();
      if ((!apiKey || apiKey.length === 0) && activeCredentialStore && speechMapping.credentialKey !== undefined) {
        apiKey = await activeCredentialStore.getCredentialValue(speechMapping.credentialKey);
      }

      if (model.executionPath === 'api' && (!apiKey || apiKey.length === 0)) {
        throw new Error(`API key is required for ${speechMapping.label} speech synthesis. Connect the provider in Settings first.`);
      }

      if (model.executionPath === 'api') await settleSpend(reservationId, 'charged');
      logSpeechJob(id, 'provider.request.started', { executionPath: model.executionPath });
      const extension = provider === 'vieneu_local' ? 'wav' : 'mp3';
      const heartbeat = setInterval(() => {
        logSpeechJob(id, 'process.working', { elapsedSeconds: Math.round((Date.now() - startedAt) / 1_000) });
      }, 10_000);
      let result: CloudProviderResult;
      try {
        result = await invokeSpeechProvider(model, apiKey, providerRequest, join(speechDir, `${id}.${extension}`));
      } finally {
        clearInterval(heartbeat);
      }
      if (!result.ok) {
        throw new Error(result.error);
      }

      job.status = 'completed';
      if (result.outputFilePath !== undefined) {
        job.outputFilePath = result.outputFilePath;
        job.previewUrl = speechPreviewUrl(job.id);
      }

      job.updatedAt = new Date().toISOString();
      speechJobs.set(id, job);
      logSpeechJob(id, 'request.completed', { elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10 });
    } catch (err) {
      // Handing the room back is safe whether or not it was already kept:
      // release only takes back a reservation that is still pending, so a
      // failure after the request went out leaves the charge standing.
      await settleSpend(reservationId, 'released');
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : 'Speech synthesis failed';
      job.updatedAt = new Date().toISOString();
      speechJobs.set(id, job);
      logSpeechJob(id, 'request.failed', { elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10, error: job.error }, 'error');
    }
  }, 1000);

  return job;
}

export function getSpeechGenerationJob(jobId: string): TextToSpeechJob | null {
  return speechJobs.get(jobId) ?? null;
}

/**
 * Opens a completed speech result for the privileged media protocol.
 * The renderer receives only a job URL; the file path remains in main and is
 * revalidated at playback time in case it was replaced after generation.
 */
export async function openCompletedSpeechPreviewSource(jobId: string): Promise<OpenedAssetPlaybackSource | null> {
  const job = speechJobs.get(jobId);
  if (job === undefined || job.status !== 'completed' || job.outputFilePath === undefined) return null;
  const speechDirectory = join(getAiStorageDir(), 'speech');
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const directoryBefore = await lstat(speechDirectory);
    if (directoryBefore.isSymbolicLink() || !directoryBefore.isDirectory()) return null;
    const speechRealPath = await realpath(speechDirectory);
    file = await open(job.outputFilePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const [openedStats, pathStats, outputRealPath, directoryAfter] = await Promise.all([
      file.stat(),
      lstat(job.outputFilePath),
      realpath(job.outputFilePath),
      lstat(speechDirectory)
    ]);
    const valid =
      openedStats.isFile() &&
      openedStats.size > 0 &&
      !pathStats.isSymbolicLink() &&
      pathStats.isFile() &&
      pathStats.dev === openedStats.dev &&
      pathStats.ino === openedStats.ino &&
      isInsideDirectory(speechRealPath, outputRealPath) &&
      !directoryAfter.isSymbolicLink() &&
      directoryAfter.isDirectory() &&
      directoryAfter.dev === directoryBefore.dev &&
      directoryAfter.ino === directoryBefore.ino;
    if (!valid) {
      await file.close();
      return null;
    }
    const source = file;
    file = undefined;
    return {
      file: source,
      filePath: job.outputFilePath,
      byteLength: openedStats.size,
      mimeType: job.provider === 'vieneu_local' ? 'audio/wav' : 'audio/mpeg'
    };
  } catch (error) {
    await file?.close();
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ELOOP')) return null;
    throw error;
  }
}

export async function listSpeechVoices(modelId: string): Promise<readonly VoiceChoice[]> {
  const model = resolveGenerationModel('voice-generation', modelId);
  const startedAt = Date.now();
  console.info(`[OpenScene][Speech Voices] request.started ${JSON.stringify({ provider: model.providerLabel, model: model.id })}`);
  try {
    const voices = model.providerId === 'vieneu_local' ? await listVieNeuVoices() : voiceChoices(model.providerId);
    console.info(`[OpenScene][Speech Voices] request.completed ${JSON.stringify({ model: model.id, voices: voices.length, elapsedMs: Date.now() - startedAt })}`);
    return voices;
  } catch (error) {
    console.error(`[OpenScene][Speech Voices] request.failed ${JSON.stringify({ model: model.id, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'Voice discovery failed.' })}`);
    throw error;
  }
}

export function getCompletedAiSource(jobId: string): { sourcePath: string; displayName: string; kind: 'video' | 'audio'; mimeType: string } | null {
  const videoJob = videoJobs.get(jobId);
  if (videoJob && videoJob.status === 'completed' && videoJob.outputFilePath) {
    return {
      sourcePath: videoJob.outputFilePath,
      displayName: `AI_Video_${videoJob.id.slice(-6)}.mp4`,
      kind: 'video',
      mimeType: 'video/mp4'
    };
  }

  const speechJob = speechJobs.get(jobId);
  if (speechJob && speechJob.status === 'completed' && speechJob.outputFilePath) {
    const isWav = speechJob.provider === 'vieneu_local';
    return {
      sourcePath: speechJob.outputFilePath,
      displayName: `AI_Voice_${speechJob.id.slice(-6)}.${isWav ? 'wav' : 'mp3'}`,
      kind: 'audio',
      mimeType: isWav ? 'audio/wav' : 'audio/mpeg'
    };
  }

  return null;
}
