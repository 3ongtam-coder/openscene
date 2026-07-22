import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  expandLocalTtsArgs,
  loadLocalTtsConfig,
  parseLocalTtsConfig
} from '../src/main/localTtsConfig';

const VALID_CONFIG = {
  executablePath: '/opt/qwen/bin/qwen-tts',
  modelPath: '/opt/qwen/models/Qwen3-TTS-12Hz-1.7B-Base',
  argsTemplate: [
    '--model',
    '{modelPath}',
    '--voice',
    '{voiceSamplePath}',
    '--text-file',
    '{textPath}',
    '--output',
    '{outputPath}',
    '--language={language}'
  ],
  outputExtension: '.wav',
  outputMimeType: 'audio/wav',
  timeoutMs: 120_000
} as const;

describe('local TTS runtime config', () => {
  it('fails closed when the config environment variable is absent', async () => {
    const result = await loadLocalTtsConfig({ environment: {} });

    expect(result).toEqual({
      kind: 'unavailable',
      reason: 'Local TTS is not configured.'
    });
  });

  it('parses JSON config and defaults the zero-shot Base model id', async () => {
    const configPath = '/app/config/local-tts.json';
    const result = await loadLocalTtsConfig({
      environment: { VIDEO_TOOL_TTS_CONFIG_PATH: configPath },
      readConfigFile: async (path) => {
        expect(path).toBe(configPath);
        return JSON.stringify(VALID_CONFIG);
      }
    });

    expect(result).toEqual({
      kind: 'configured',
      config: {
        ...VALID_CONFIG,
        modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base'
      }
    });
  });

  it('fails closed when the config file is not valid JSON', async () => {
    const result = await loadLocalTtsConfig({
      environment: { VIDEO_TOOL_TTS_CONFIG_PATH: '/app/config/local-tts.json' },
      readConfigFile: async () => '{ executablePath: invalid }'
    });

    expect(result).toEqual({
      kind: 'unavailable',
      reason: 'Local TTS config is not valid JSON.'
    });
  });

  it.each([
    ['relative executable', { ...VALID_CONFIG, executablePath: 'qwen-tts' }],
    ['relative model', { ...VALID_CONFIG, modelPath: './model' }],
    ['unsafe output pair', { ...VALID_CONFIG, outputExtension: '.mp3' }],
    ['unbounded timeout', { ...VALID_CONFIG, timeoutMs: 1_800_001 }],
    ['unknown token', { ...VALID_CONFIG, argsTemplate: [...VALID_CONFIG.argsTemplate, '{prompt}'] }],
    ['missing output token', { ...VALID_CONFIG, argsTemplate: VALID_CONFIG.argsTemplate.filter((arg) => arg !== '{outputPath}') }]
  ])('rejects invalid config: %s', (_name, value) => {
    expect(() => parseLocalTtsConfig(value)).toThrow();
  });

  it('substitutes recognized tokens as literal argv values without shell parsing', () => {
    const markerPath = join('/tmp', 'must-not-run');
    const args = expandLocalTtsArgs(VALID_CONFIG.argsTemplate, {
      modelPath: '/models/model with spaces',
      voiceSamplePath: '/voices/sample;touch bad.wav',
      textPath: '/tmp/narration.txt',
      outputPath: '/audio/result.wav',
      language: `en-US;touch ${markerPath}`
    });

    expect(args).toContain('/voices/sample;touch bad.wav');
    expect(args).toContain(`--language=en-US;touch ${markerPath}`);
    expect(args).toContain('/models/model with spaces');
  });
});
