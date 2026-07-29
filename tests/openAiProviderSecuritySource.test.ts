import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const SOURCE_URLS = {
  adapter: new URL('../src/main/llmAdapter.ts', import.meta.url),
  providers: new URL('../src/shared/llmProviders.ts', import.meta.url),
  preload: new URL('../src/preload/index.ts', import.meta.url),
  settings: new URL('../src/renderer/src/SettingsWorkspace.tsx', import.meta.url),
  context: new URL('../src/renderer/src/LlmProviderContext.tsx', import.meta.url)
} as const;

describe('OpenAI provider source security contract', () => {
  it('uses no private ChatGPT transport or third-party OAuth client identity', async () => {
    const [adapter, providers] = await Promise.all([
      readFile(SOURCE_URLS.adapter, 'utf8'),
      readFile(SOURCE_URLS.providers, 'utf8')
    ]);
    const transportSource = `${adapter}\n${providers}`;

    expect(transportSource).not.toContain('chatgpt.com/backend-api/codex/responses');
    expect(transportSource).not.toContain('anomalyco');
    expect(transportSource).not.toMatch(/client_?id/i);
  });

  it('keeps renderer credential reads limited to boolean status', async () => {
    const [preload, settings, context] = await Promise.all([
      readFile(SOURCE_URLS.preload, 'utf8'),
      readFile(SOURCE_URLS.settings, 'utf8'),
      readFile(SOURCE_URLS.context, 'utf8')
    ]);
    const rendererSource = `${settings}\n${context}`;

    expect(preload).toContain('getProviderCredentialStatus(): Promise<ApiResponse<Record<string, boolean>>>');
    expect(preload).not.toContain('getProviderCredentialValue');
    expect(rendererSource).not.toContain('getCredentialValue');
    expect(settings).toContain('API keys live in main-process safe storage, are write-only from this screen, and are never rendered back.');
  });
});
