import { describe, expect, it, vi } from 'vitest';

import {
  requestSoraVideo,
  requestVeoVideo,
  snapSoraSeconds,
  videoAdapterFor
} from '../src/shared/videoGeneration';

/**
 * These cover the half of video generation that both hosts share: the request,
 * the polling, and where the finished video is fetched from. The download itself
 * is deliberately not part of it — the desktop reads bytes into a Buffer and the
 * phone streams to disk natively, so there is nothing common left to test.
 */

describe('shared video generation', () => {
  it('polls Veo until done and reports the sample URI with the key in a header', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(url);
      expect(url).not.toContain('gemini-key');
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('gemini-key');
      if (url.endsWith(':predictLongRunning')) {
        return new Response(JSON.stringify({ name: 'operations/abc' }), { status: 200 });
      }
      // First poll is unfinished, so a caller that stops at the first response
      // would be caught here rather than in production.
      if (calls.filter((entry) => entry.endsWith('operations/abc')).length === 1) {
        return new Response(JSON.stringify({ done: false }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          done: true,
          response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://files/clip.mp4' } }] } }
        }),
        { status: 200 }
      );
    });

    const ready = await requestVeoVideo({
      apiKey: 'gemini-key',
      modelId: 'veo-3.0-generate-001',
      prompt: 'a lighthouse',
      aspectRatio: '16:9',
      durationSeconds: 8,
      pollIntervalMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(ready.url).toBe('https://files/clip.mp4');
    expect(ready.providerJobId).toBe('operations/abc');
    expect(ready.headers).toEqual({ 'x-goog-api-key': 'gemini-key' });
  });

  it('squares a 1:1 request to 16:9 for Veo, which does not render square', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith(':predictLongRunning')) {
        expect(JSON.parse(init.body as string).parameters.aspectRatio).toBe('16:9');
        return new Response(JSON.stringify({ name: 'operations/x' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          done: true,
          response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://files/x.mp4' } }] } }
        }),
        { status: 200 }
      );
    });

    await requestVeoVideo({
      apiKey: 'k',
      modelId: 'veo-3.0-generate-001',
      prompt: 'p',
      aspectRatio: '1:1',
      durationSeconds: 8,
      pollIntervalMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch
    });
  });

  it('snaps a Sora request to an accepted length and points at the content URL', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === 'https://api.openai.com/v1/videos') {
        const body = JSON.parse(init.body as string);
        // 9s is not an accepted Sora length; the nearest one is 8.
        expect(body.seconds).toBe('8');
        expect(body.size).toBe('1280x720');
        return new Response(JSON.stringify({ id: 'video_1' }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'completed' }), { status: 200 });
    });

    const ready = await requestSoraVideo({
      apiKey: 'sk-test',
      modelId: 'sora-2',
      prompt: 'p',
      aspectRatio: '16:9',
      durationSeconds: 9,
      pollIntervalMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(ready.url).toBe('https://api.openai.com/v1/videos/video_1/content');
    expect(ready.headers).toEqual({ Authorization: 'Bearer sk-test' });
  });

  it('surfaces a provider-side failure instead of returning an unusable job', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === 'https://api.openai.com/v1/videos'
        ? new Response(JSON.stringify({ id: 'video_2' }), { status: 200 })
        : new Response(JSON.stringify({ status: 'failed', error: { message: 'content policy' } }), { status: 200 })
    );

    await expect(
      requestSoraVideo({
        apiKey: 'sk-test',
        modelId: 'sora-2',
        prompt: 'p',
        aspectRatio: '16:9',
        durationSeconds: 8,
        pollIntervalMs: 0,
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow(/content policy/);
  });

  it('never echoes the key when a provider rejects it', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(
      requestVeoVideo({
        apiKey: 'secret-key-value',
        modelId: 'veo-3.0-generate-001',
        prompt: 'p',
        aspectRatio: '16:9',
        durationSeconds: 8,
        pollIntervalMs: 0,
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow(/rejected the stored API key/);

    await expect(
      requestVeoVideo({
        apiKey: 'secret-key-value',
        modelId: 'veo-3.0-generate-001',
        prompt: 'p',
        aspectRatio: '16:9',
        durationSeconds: 8,
        pollIntervalMs: 0,
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.not.toThrow(/secret-key-value/);
  });

  it('refuses a Sora reference image rather than dropping it silently', async () => {
    await expect(
      requestSoraVideo({
        apiKey: 'sk-test',
        modelId: 'sora-2',
        prompt: 'p',
        aspectRatio: '16:9',
        durationSeconds: 8,
        referenceImage: { mimeType: 'image/png', base64: 'AAA' }
      })
    ).rejects.toThrow(/reference images are not supported/);
  });

  it('snaps only to lengths the shared table publishes', () => {
    expect(snapSoraSeconds(9)).toBe(8);
    expect(snapSoraSeconds(11)).toBe(12);
    expect(snapSoraSeconds(1)).toBe(4);
  });

  it('resolves an adapter only for providers that actually have one', () => {
    expect(videoAdapterFor('openai')).toBe(requestSoraVideo);
    expect(videoAdapterFor('google_gemini')).toBe(requestVeoVideo);
    // Listed in the catalog but unported: callers must get undefined and say so
    // rather than picking a wrong adapter.
    expect(videoAdapterFor('kling')).toBeUndefined();
    expect(videoAdapterFor('byteplus')).toBeUndefined();
  });
});
