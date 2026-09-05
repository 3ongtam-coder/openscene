import { describe, expect, it, vi } from 'vitest';
import {
  createSpeechGenerationJob,
  createVideoGenerationJob,
  getCompletedAiSource,
  openCompletedSpeechPreviewSource,
  getSpeechGenerationJob,
  getVideoGenerationJob
} from '../src/main/aiJobManager';
import { createVoiceDeliverySettings } from '../src/shared/voiceDelivery';

describe('AI Job Manager and cloud provider seams', () => {
  it('rejects a cross-domain model id before creating a video job', async () => {
    await expect(
      createVideoGenerationJob({
        prompt: 'A cloud scene',
        aspectRatio: '16:9',
        durationSeconds: 3,
        modelId: 'eleven_multilingual_v2'
      })
    ).rejects.toThrow('is not available for video-generation');
  });

  it('rejects unimplemented cloud models before queuing a misleading job', async () => {
    // Kling and MiniMax stay honestly unavailable until their adapters land, and
    // Aleph edits a source video this build does not send, so job creation
    // refuses all three up front. Runway and Luma moved out of this list when
    // their adapters landed.
    for (const modelId of ['kling-v2.5-turbo', 'minimax-hailuo-02', 'aleph2', 'grok-imagine-video-1.5']) {
      await expect(createVideoGenerationJob({
        prompt: `Test prompt for ${modelId}`,
        aspectRatio: '16:9',
        durationSeconds: 5,
        modelId
      })).rejects.toThrow('is not available for video-generation');
    }
  });

  it('fails implemented cloud models without a connected key instead of calling out', async () => {
    const soraJob = await createVideoGenerationJob({
      prompt: 'Test prompt for Sora',
      aspectRatio: '16:9',
      durationSeconds: 4,
      modelId: 'sora-2'
    });
    const elevenJob = await createSpeechGenerationJob({
      script: 'Cloud narration without a key',
      voiceId: '',
      modelId: 'eleven_multilingual_v2'
    });
    // Every media job is a cloud job now — there is no local runner to fall back on.
    expect(soraJob.mode).toBe('api');
    expect(soraJob.provider).toBe('openai_sora');
    expect(elevenJob.mode).toBe('api');
    expect(elevenJob.provider).toBe('elevenlabs');

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const failedVideo = getVideoGenerationJob(soraJob.id);
    expect(failedVideo?.status).toBe('failed');
    expect(failedVideo?.error).toContain('API key is required for OpenAI Sora');
    expect(failedVideo?.outputFilePath).toBeUndefined();
    const failedSpeech = getSpeechGenerationJob(elevenJob.id);
    expect(failedSpeech?.status).toBe('failed');
    expect(failedSpeech?.error).toContain('API key is required for ElevenLabs');
    // Nothing was produced, so there is no importable source.
    expect(getCompletedAiSource(soraJob.id)).toBeNull();
    expect(getCompletedAiSource(elevenJob.id)).toBeNull();
  }, 10_000);

  it('defaults each media domain to an available cloud model when no model id is supplied', async () => {
    const videoJob = await createVideoGenerationJob({
      prompt: 'Default model scene',
      aspectRatio: '16:9'
    });
    const speechJob = await createSpeechGenerationJob({ script: 'Default model narration', voiceId: '' });

    expect(videoJob.mode).toBe('api');
    expect(videoJob.durationSeconds).toBe(4);
    expect(speechJob.mode).toBe('api');
    expect(videoJob.modelId).toBeDefined();
    expect(speechJob.modelId).toBeDefined();
  });

  it('runs VieNeu locally without an API key and exposes an importable WAV', async () => {
    const wav = Buffer.alloc(46);
    wav.write('RIFF', 0, 'ascii'); wav.writeUInt32LE(0xffffffff, 4); wav.write('WAVEfmt ', 8, 'ascii');
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48_000, 24); wav.writeUInt32LE(96_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'ascii'); wav.writeUInt32LE(1_000_000_000, 40); wav.writeInt16LE(42, 44);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({ text: '[thở dài] Xin chào từ VieNeu.', voice_id: 'voice-north' });
      return new Response(new Uint8Array(wav), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
    }));
    try {
      const job = await createSpeechGenerationJob({
        script: 'Xin chào từ VieNeu.',
        delivery: createVoiceDeliverySettings('[thở dài] Xin chào từ VieNeu.'),
        voiceId: 'voice-north',
        modelId: 'vieneu-v3-turbo'
      });
      expect(job).toMatchObject({ provider: 'vieneu_local', mode: 'local', status: 'queued' });

      await new Promise((resolve) => setTimeout(resolve, 1_500));

      expect(getSpeechGenerationJob(job.id)?.status).toBe('completed');
      expect(getSpeechGenerationJob(job.id)?.previewUrl).toBe(`video-tool-asset://speech-preview/${job.id}`);
      expect(getSpeechGenerationJob(job.id)?.previewUrl).not.toContain('ai_generations');
      const previewSource = await openCompletedSpeechPreviewSource(job.id);
      expect(previewSource).toMatchObject({ byteLength: 46, mimeType: 'audio/wav' });
      await previewSource?.file.close();
      expect(getCompletedAiSource(job.id)).toMatchObject({ kind: 'audio', mimeType: 'audio/wav' });
      expect(getCompletedAiSource(job.id)?.displayName).toMatch(/\.wav$/);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 10_000);

  it('rejects invalid model controls before a job or provider call is queued', async () => {
    await expect(createVideoGenerationJob({
      prompt: 'Invalid square Veo request', aspectRatio: '1:1', durationSeconds: 4,
      modelId: 'veo-3.1-generate-preview'
    })).rejects.toThrow(/accepts 16:9 or 9:16/);
    await expect(createVideoGenerationJob({
      prompt: 'Invalid Sora duration', aspectRatio: '16:9', durationSeconds: 5,
      modelId: 'sora-2'
    })).rejects.toThrow(/accepts 4, 8, 12 second/);
  });

  it('rejects invalid expressive delivery before queuing speech', async () => {
    await expect(createSpeechGenerationJob({
      script: 'Clean captions.', voiceId: 'voice', modelId: 'eleven_v3',
      delivery: { ...createVoiceDeliverySettings('Spoken text.'), speed: 3 }
    })).rejects.toThrow('Voice delivery settings are invalid');
  });
});
