import { describe, expect, it, vi } from 'vitest';

import { requestGeminiWriter } from '../src/shared/writerGeneration';
import type { WriterDraft, WriterRequest } from '../src/shared/writerWorkflow';

const request: WriterRequest = {
  mode: 'content_to_script', sourceText: 'A short product brief.', language: 'Vietnamese',
  audience: 'Creators', tone: 'Clear', targetDurationSeconds: 30
};
const draft: WriterDraft = {
  title: 'Creator tool', screenplay: 'A creator opens the tool.', characters: [],
  styleBible: { palette: [], lighting: '', cameraGrammar: '', texture: '', forbiddenChanges: [] },
  scenes: [{
    title: 'Open', objective: 'Introduce the tool.', setting: 'Studio', timeOfDay: 'Day', characterNames: [], continuityNotes: '',
    shots: [{ durationSeconds: 8, framing: 'Medium', cameraMotion: 'Static', action: 'The tool opens.', dialogue: '', audioCues: [], negativePrompt: '' }]
  }]
};

describe('Gemini Writer generation', () => {
  it('sends structured output through a header-only API key and parses the draft', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain('/gemini-3.1-pro-preview:generateContent');
      expect(String(url)).not.toContain('secret-key');
      expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key');
      const body = JSON.parse(String(init?.body)) as { generationConfig?: Record<string, unknown>; contents?: unknown[] };
      expect(body.generationConfig?.responseMimeType).toBe('application/json');
      expect(body.generationConfig?.responseJsonSchema).toBeDefined();
      expect(body.contents).toHaveLength(1);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(draft) }] } }] }), { status: 200 });
    });
    await expect(requestGeminiWriter({ apiKey: 'secret-key', modelId: 'gemini-3.1-pro-preview', request, fetchImpl })).resolves.toEqual(draft);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails closed on invalid JSON and structurally incomplete output', async () => {
    const response = (text: string) => async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    await expect(requestGeminiWriter({ apiKey: 'key', modelId: 'gemini-3.1-flash-lite', request, fetchImpl: response('{') })).rejects.toThrow('invalid JSON');
    await expect(requestGeminiWriter({ apiKey: 'key', modelId: 'gemini-3.1-flash-lite', request, fetchImpl: response('{}') })).rejects.toThrow('project contract');
  });

  it('does not echo the API key in provider errors', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'Bad request for never-log-me' } }), { status: 400 });
    await expect(requestGeminiWriter({ apiKey: 'never-log-me', modelId: 'gemini-3.1-pro-preview', request, fetchImpl })).rejects.toThrow('Bad request for [REDACTED]');
    try {
      await requestGeminiWriter({ apiKey: 'never-log-me', modelId: 'gemini-3.1-pro-preview', request, fetchImpl });
    } catch (error) {
      expect(String(error)).not.toContain('never-log-me');
    }
  });
});
