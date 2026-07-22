import type { MediaKind } from './timelineTypes';

export type PlainRecord = Record<string, unknown>;

export const TIMELINE_VALIDATION_LIMITS = {
  nameLength: 80,
  opaqueIdLength: 128,
  relativePathLength: 512,
  mimeTypeLength: 128,
  durationMs: 86_400_000,
  mediaDimensionPixels: 32_768,
  tracks: 32,
  clipsPerTrack: 500,
  clipsTotal: 2_000,
  keyframesPerClip: 1_000,
  keyframesTotal: 20_000,
  transitions: 2_000
} as const;

export function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function hasAllowedKeys(record: PlainRecord, allowedKeys: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}

export function getTrimmedString(record: PlainRecord, key: string, maxLength: number): string | null {
  const value = record[key];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

export function getOpaqueId(record: PlainRecord, key: string): string | null {
  const value = getTrimmedString(record, key, TIMELINE_VALIDATION_LIMITS.opaqueIdLength);
  return value !== null && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null;
}

export function getFiniteNonNegative(record: PlainRecord, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function getBoundedNonNegative(record: PlainRecord, key: string, maxValue: number): number | null {
  const value = getFiniteNonNegative(record, key);
  return value !== null && value <= maxValue ? value : null;
}

export function getMediaKind(record: PlainRecord, key: string): MediaKind | null {
  const value = record[key];
  return value === 'video' || value === 'audio' ? value : null;
}

export function getRelativePath(record: PlainRecord, key: string): string | null {
  const value = getTrimmedString(record, key, TIMELINE_VALIDATION_LIMITS.relativePathLength);
  if (value === null || value.startsWith('/') || /^[A-Za-z]:\//.test(value) || value.includes('\\') || value.includes('\0')) {
    return null;
  }
  const segments = value.split('/');
  return segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ? null : value;
}

export function getMimeType(record: PlainRecord, key: string): string | null {
  const value = getTrimmedString(record, key, TIMELINE_VALIDATION_LIMITS.mimeTypeLength);
  return value !== null && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value) ? value : null;
}
