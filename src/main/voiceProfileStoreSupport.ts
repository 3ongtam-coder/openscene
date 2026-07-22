import type { WriteStream } from 'node:fs';
import { resolve } from 'node:path';

import type { AllowedAudioMimeType, VoiceProfile } from '../shared/models';

export const PROFILE_DIR = 'profiles';
export const PENDING_DIR = 'pending';
export const METADATA_FILE = 'metadata.json';

// 30 seconds of 48 kHz stereo 16-bit PCM is 5.76 MB; 8 MiB leaves bounded container overhead.
export const MAX_VOICE_PROFILE_SAMPLE_BYTES = 8 * 1_024 * 1_024;

export const SAMPLE_EXTENSION_BY_MIME: Record<AllowedAudioMimeType, string> = {
  'audio/webm': '.webm',
  'audio/webm;codecs=opus': '.webm',
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3'
} as const;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

type PlainRecord = Record<string, unknown>;

export interface ActiveVoiceProfileSample {
  readonly voiceProfileId: string;
  readonly sampleId: string;
  readonly displayName: string;
  readonly language: string;
  readonly narrationScript: string;
  readonly mimeType: AllowedAudioMimeType;
  readonly consentTextVersion: string;
  readonly consentedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stagingProfilePath: string;
  readonly stagingSamplePath: string;
  readonly sampleFileName: string;
  readonly stream: WriteStream;
  nextSequence: number;
  byteLength: number;
}

export interface PersistedVoiceProfileMetadata {
  readonly voiceProfileId: string;
  readonly sampleId: string;
  readonly displayName: string;
  readonly language: string;
  readonly narrationScript: string;
  readonly sampleMimeType: AllowedAudioMimeType;
  readonly samplePath: string;
  readonly byteLength: number;
  readonly durationMs: number | null;
  readonly consentTextVersion: string;
  readonly consentedAt: string;
  readonly sampleCount: 1;
  readonly totalDurationMs: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(record: PlainRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getNumber(record: PlainRecord, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) ? value : null;
}

export function isAllowedAudioMimeType(value: string): value is AllowedAudioMimeType {
  return Object.hasOwn(SAMPLE_EXTENSION_BY_MIME, value);
}

export function sampleExtensionForMimeType(mimeType: AllowedAudioMimeType): string {
  return SAMPLE_EXTENSION_BY_MIME[mimeType];
}

export function assertOpaqueId(value: string, label: string): void {
  if (!OPAQUE_ID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
}

export function isInsideDirectory(parentDirectory: string, childPath: string): boolean {
  const normalizedParent = resolve(parentDirectory);
  const normalizedChild = resolve(childPath);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

export function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolveFinished, rejectFinished) => {
    stream.once('finish', resolveFinished);
    stream.once('error', rejectFinished);
    stream.end();
  });
}

export function waitForDrain(stream: WriteStream): Promise<void> {
  return new Promise((resolveDrain, rejectDrain) => {
    stream.once('drain', resolveDrain);
    stream.once('error', rejectDrain);
  });
}

export function waitForStreamReady(stream: WriteStream): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    stream.once('open', resolveReady);
    stream.once('error', rejectReady);
  });
}

export function toVoiceProfile(metadata: PersistedVoiceProfileMetadata): VoiceProfile {
  return {
    id: metadata.voiceProfileId,
    displayName: metadata.displayName,
    language: metadata.language,
    sampleCount: metadata.sampleCount,
    totalDurationMs: metadata.totalDurationMs,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt
  };
}

export function parsePersistedMetadata(value: unknown): PersistedVoiceProfileMetadata | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const voiceProfileId = getString(value, 'voiceProfileId');
  const sampleId = getString(value, 'sampleId');
  const displayName = getString(value, 'displayName');
  const language = getString(value, 'language');
  const narrationScript = getString(value, 'narrationScript');
  const sampleMimeTypeValue = getString(value, 'sampleMimeType');
  const samplePath = getString(value, 'samplePath');
  const byteLength = getNumber(value, 'byteLength');
  const durationMsValue = value.durationMs;
  const durationMs = durationMsValue === null ? null : getNumber(value, 'durationMs');
  const consentTextVersion = getString(value, 'consentTextVersion');
  const consentedAt = getString(value, 'consentedAt');
  const sampleCount = getNumber(value, 'sampleCount');
  const totalDurationMs = getNumber(value, 'totalDurationMs');
  const createdAt = getString(value, 'createdAt');
  const updatedAt = getString(value, 'updatedAt');

  if (
    voiceProfileId === null ||
    sampleId === null ||
    displayName === null ||
    language === null ||
    narrationScript === null ||
    sampleMimeTypeValue === null ||
    samplePath === null ||
    byteLength === null ||
    (durationMsValue !== null && durationMs === null) ||
    consentTextVersion === null ||
    consentedAt === null ||
    sampleCount !== 1 ||
    totalDurationMs === null ||
    createdAt === null ||
    updatedAt === null ||
    !isAllowedAudioMimeType(sampleMimeTypeValue)
  ) {
    return null;
  }

  return {
    voiceProfileId,
    sampleId,
    displayName,
    language,
    narrationScript,
    sampleMimeType: sampleMimeTypeValue,
    samplePath,
    byteLength,
    durationMs,
    consentTextVersion,
    consentedAt,
    sampleCount: 1,
    totalDurationMs,
    createdAt,
    updatedAt
  };
}
