import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import type { AllowedAudioMimeType } from '../shared/models';

const DEFAULT_MODEL_ID = 'Qwen/Qwen3-TTS-12Hz-1.7B-Base';
const MAX_TIMEOUT_MS = 1_800_000;
const CONFIG_FIELDS = new Set([
  'executablePath',
  'modelPath',
  'argsTemplate',
  'outputExtension',
  'outputMimeType',
  'timeoutMs',
  'workingDirectory',
  'modelId'
]);
const REQUIRED_TOKENS = ['modelPath', 'voiceSamplePath', 'textPath', 'outputPath'] as const;
const TOKEN_PATTERN = /\{([^{}]+)\}/g;

type PlainRecord = Record<string, unknown>;
type ReadConfigFile = (path: string, encoding: 'utf8') => Promise<string>;

export type LocalTtsArgValues = {
  readonly modelPath: string;
  readonly voiceSamplePath: string;
  readonly textPath: string;
  readonly outputPath: string;
  readonly language: string;
};

export type LocalTtsRunnerConfig = {
  readonly executablePath: string;
  readonly modelPath: string;
  readonly argsTemplate: readonly string[];
  readonly outputExtension: '.wav' | '.mp3' | '.webm';
  readonly outputMimeType: AllowedAudioMimeType;
  readonly timeoutMs: number;
  readonly workingDirectory?: string;
  readonly modelId: string;
};

export type LocalTtsConfigLoadResult =
  | { readonly kind: 'configured'; readonly config: LocalTtsRunnerConfig }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type LoadLocalTtsConfigOptions = {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly readConfigFile?: ReadConfigFile;
};

export class LocalTtsConfigError extends Error {
  override readonly name = 'LocalTtsConfigError';
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: PlainRecord, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw new LocalTtsConfigError(`Local TTS config field "${field}" must be a nonempty string.`);
  }
  return value.trim();
}

function absolutePath(record: PlainRecord, field: string): string {
  const value = requiredString(record, field);
  if (!isAbsolute(value)) {
    throw new LocalTtsConfigError(`Local TTS config field "${field}" must be an absolute path.`);
  }
  return value;
}

function isToken(value: string): value is keyof LocalTtsArgValues {
  switch (value) {
    case 'modelPath':
    case 'voiceSamplePath':
    case 'textPath':
    case 'outputPath':
    case 'language':
      return true;
    default:
      return false;
  }
}

function parseArgsTemplate(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'string')) {
    throw new LocalTtsConfigError('Local TTS config field "argsTemplate" must be a nonempty string array.');
  }

  const foundTokens = new Set<string>();
  for (const argument of value) {
    if (argument.length === 0 || argument.includes('\0')) {
      throw new LocalTtsConfigError('Local TTS argument templates must be nonempty and contain no null bytes.');
    }
    const remainder = argument.replace(TOKEN_PATTERN, (_match, token: string) => {
      if (!isToken(token)) {
        throw new LocalTtsConfigError(`Local TTS argument template contains unknown token "{${token}}".`);
      }
      foundTokens.add(token);
      return '';
    });
    if (remainder.includes('{') || remainder.includes('}')) {
      throw new LocalTtsConfigError('Local TTS argument template contains malformed token syntax.');
    }
  }

  for (const token of REQUIRED_TOKENS) {
    if (!foundTokens.has(token)) {
      throw new LocalTtsConfigError(`Local TTS argument template must include "{${token}}".`);
    }
  }
  return [...value];
}

function parseOutput(record: PlainRecord): Pick<LocalTtsRunnerConfig, 'outputExtension' | 'outputMimeType'> {
  const rawExtension = requiredString(record, 'outputExtension').toLowerCase();
  const extension = rawExtension.startsWith('.') ? rawExtension : `.${rawExtension}`;
  const mimeType = requiredString(record, 'outputMimeType');
  const validPair =
    (extension === '.wav' && mimeType === 'audio/wav') ||
    (extension === '.mp3' && mimeType === 'audio/mpeg') ||
    (extension === '.webm' && (mimeType === 'audio/webm' || mimeType === 'audio/webm;codecs=opus'));
  if (!validPair) {
    throw new LocalTtsConfigError('Local TTS output extension and MIME type are not a supported pair.');
  }
  return { outputExtension: extension, outputMimeType: mimeType };
}

export function parseLocalTtsConfig(value: unknown): LocalTtsRunnerConfig {
  if (!isPlainRecord(value)) {
    throw new LocalTtsConfigError('Local TTS config must be a JSON object.');
  }
  for (const field of Object.keys(value)) {
    if (!CONFIG_FIELDS.has(field)) {
      throw new LocalTtsConfigError(`Local TTS config contains unknown field "${field}".`);
    }
  }

  const timeoutMs = value.timeoutMs;
  if (!Number.isInteger(timeoutMs) || typeof timeoutMs !== 'number' || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new LocalTtsConfigError(`Local TTS timeout must be an integer between 1 and ${MAX_TIMEOUT_MS} milliseconds.`);
  }
  const workingDirectory = value.workingDirectory === undefined ? undefined : absolutePath(value, 'workingDirectory');
  const modelId = value.modelId === undefined ? DEFAULT_MODEL_ID : requiredString(value, 'modelId');
  const output = parseOutput(value);
  return {
    executablePath: absolutePath(value, 'executablePath'),
    modelPath: absolutePath(value, 'modelPath'),
    argsTemplate: parseArgsTemplate(value.argsTemplate),
    ...output,
    timeoutMs,
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    modelId
  };
}

export function expandLocalTtsArgs(template: readonly string[], values: LocalTtsArgValues): readonly string[] {
  return template.map((argument) =>
    argument.replace(TOKEN_PATTERN, (_match, token: string) => {
      if (!isToken(token)) {
        throw new LocalTtsConfigError(`Local TTS argument template contains unknown token "{${token}}".`);
      }
      return values[token];
    })
  );
}

export async function loadLocalTtsConfig(options: LoadLocalTtsConfigOptions = {}): Promise<LocalTtsConfigLoadResult> {
  const environment = options.environment ?? process.env;
  const configPath = environment.VIDEO_TOOL_TTS_CONFIG_PATH?.trim();
  if (configPath === undefined || configPath.length === 0) {
    return { kind: 'unavailable', reason: 'Local TTS is not configured.' };
  }
  if (!isAbsolute(configPath) || configPath.includes('\0')) {
    return { kind: 'unavailable', reason: 'Local TTS config path must be absolute.' };
  }

  const readConfigFile = options.readConfigFile ?? readFile;
  try {
    const source = await readConfigFile(configPath, 'utf8');
    const parsed: unknown = JSON.parse(source);
    return { kind: 'configured', config: parseLocalTtsConfig(parsed) };
  } catch (error: unknown) {
    if (error instanceof LocalTtsConfigError) {
      return { kind: 'unavailable', reason: error.message };
    }
    if (error instanceof SyntaxError) {
      return { kind: 'unavailable', reason: 'Local TTS config is not valid JSON.' };
    }
    return { kind: 'unavailable', reason: 'Local TTS config could not be read.' };
  }
}
