import type {
  AbortRecordingInput,
  AppendVoiceProfileSampleChunkInput,
  DeleteVoiceProfileInput,
  DiscardVoiceProfileSampleInput,
  AppendRecordingChunkInput,
  FinishRecordingInput,
  FinalizeVoiceProfileSampleInput,
  GetTtsJobInput,
  ResultActionInput,
  StartTtsJobInput,
  StartVoiceProfileSampleInput,
  SelectSourceInput,
  SourceAvailabilityInput,
  StartRecordingInput,
  TtsJobActionInput
} from './models';
import type { AllowedAudioMimeType } from './models';

type PlainRecord = Record<string, unknown>;

const MAX_DISPLAY_NAME_LENGTH = 80;
const MAX_CONSENT_TEXT_VERSION_LENGTH = 32;
const MAX_NARRATION_SCRIPT_LENGTH = 1000;
const MAX_TTS_SCRIPT_LENGTH = 5000;
const MAX_OPAQUE_ID_LENGTH = 128;
const MAX_SAMPLE_CHUNK_BYTES = 1_048_576;
const MAX_MODEL_ID_LENGTH = 128;

function isAllowedAudioMimeType(value: string): value is AllowedAudioMimeType {
  switch (value) {
    case 'audio/webm':
    case 'audio/webm;codecs=opus':
    case 'audio/wav':
    case 'audio/mpeg':
      return true;
    default:
      return false;
  }
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getTrimmedString(record: PlainRecord, key: string, maxLength: number): string | null {
  const value = record[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function getString(record: PlainRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getOpaqueId(record: PlainRecord, key: string): string | null {
  const value = getTrimmedString(record, key, MAX_OPAQUE_ID_LENGTH);
  if (value === null) {
    return null;
  }

  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null;
}

function getLanguageTag(record: PlainRecord, key: string): string | null {
  const value = getTrimmedString(record, key, 32);
  if (value === null) {
    return null;
  }

  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) ? value : null;
}

function getAllowedAudioMimeType(record: PlainRecord, key: string): AllowedAudioMimeType | null {
  const value = getTrimmedString(record, key, 64);
  if (value === null || !isAllowedAudioMimeType(value)) {
    return null;
  }

  return value;
}

function getNonNegativeInteger(record: PlainRecord, key: string): number | null {
  const value = record[key];
  return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : null;
}

function getPositiveInteger(record: PlainRecord, key: string): number | null {
  const value = record[key];
  return Number.isInteger(value) && typeof value === 'number' && value > 0 ? value : null;
}

function getBoundedArrayBuffer(record: PlainRecord, key: string, maxBytes: number): ArrayBuffer | null {
  const value = record[key];
  return value instanceof ArrayBuffer && value.byteLength > 0 && value.byteLength <= maxBytes ? value : null;
}

export function parseSelectSourceInput(value: unknown): SelectSourceInput | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const sourceId = getString(value, 'sourceId');
  const generation = getPositiveInteger(value, 'generation');
  if (sourceId === null || generation === null) {
    return null;
  }

  return { sourceId, generation };
}

export function parseStartRecordingInput(value: unknown): StartRecordingInput | null {
  return parseSelectSourceInput(value);
}

export function parseAppendRecordingChunkInput(value: unknown): AppendRecordingChunkInput | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const sessionId = getString(value, 'sessionId');
  const sequence = getNonNegativeInteger(value, 'sequence');
  const chunk = value.chunk;
  if (sessionId === null || sequence === null || !(chunk instanceof ArrayBuffer)) {
    return null;
  }

  return { sessionId, sequence, chunk };
}

export function parseStartVoiceProfileSampleInput(value: unknown): StartVoiceProfileSampleInput | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const displayName = getTrimmedString(value, 'displayName', MAX_DISPLAY_NAME_LENGTH);
  const explicitConsent = value.explicitConsent === true ? true : null;
  const consentTextVersion = getTrimmedString(value, 'consentTextVersion', MAX_CONSENT_TEXT_VERSION_LENGTH);
  const language = getLanguageTag(value, 'language');
  const narrationScript = getTrimmedString(value, 'narrationScript', MAX_NARRATION_SCRIPT_LENGTH);
  const mimeType = getAllowedAudioMimeType(value, 'mimeType');
  if (
    displayName === null ||
    explicitConsent === null ||
    consentTextVersion === null ||
    language === null ||
    narrationScript === null ||
    mimeType === null
  ) {
    return null;
  }

  return {
    displayName,
    explicitConsent,
    consentTextVersion,
    language,
    narrationScript,
    mimeType
  };
}

export function parseAppendVoiceProfileSampleChunkInput(value: unknown): AppendVoiceProfileSampleChunkInput | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const sampleId = getOpaqueId(value, 'sampleId');
  const sequence = getNonNegativeInteger(value, 'sequence');
  const chunk = getBoundedArrayBuffer(value, 'chunk', MAX_SAMPLE_CHUNK_BYTES);
  if (sampleId === null || sequence === null || chunk === null) {
    return null;
  }

  return { sampleId, sequence, chunk };
}

export function parseFinalizeVoiceProfileSampleInput(value: unknown): FinalizeVoiceProfileSampleInput | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const sampleId = getOpaqueId(value, 'sampleId');
  const durationMs = getNonNegativeInteger(value, 'durationMs');
  if (sampleId === null || durationMs === null) {
    return null;
  }

  return { sampleId, durationMs };
}

export function parseDiscardVoiceProfileSampleInput(value: unknown): DiscardVoiceProfileSampleInput | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const sampleId = getOpaqueId(value, 'sampleId');
  if (sampleId === null) {
    return null;
  }

  return { sampleId };
}

export function parseDeleteVoiceProfileInput(value: unknown): DeleteVoiceProfileInput | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const voiceProfileId = getOpaqueId(value, 'voiceProfileId');
  if (voiceProfileId === null) {
    return null;
  }

  return { voiceProfileId };
}

export function parseStartTtsJobInput(value: unknown): StartTtsJobInput | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const voiceProfileId = getOpaqueId(value, 'voiceProfileId');
  const script = getTrimmedString(value, 'script', MAX_TTS_SCRIPT_LENGTH);
  const language = getLanguageTag(value, 'language');
  const mimeType = getAllowedAudioMimeType(value, 'mimeType');
  const modelIdValue = value.modelId;
  const modelId =
    modelIdValue === undefined ? undefined : getTrimmedString(value, 'modelId', MAX_MODEL_ID_LENGTH);
  if (voiceProfileId === null || script === null || language === null || mimeType === null || modelId === null) {
    return null;
  }

  return {
    voiceProfileId,
    script,
    language,
    mimeType,
    ...(modelId === undefined ? {} : { modelId })
  };
}

export function parseGetTtsJobInput(value: unknown): GetTtsJobInput | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const jobId = getOpaqueId(value, 'jobId');
  if (jobId === null) {
    return null;
  }

  return { jobId };
}

export function parseTtsJobActionInput(value: unknown): TtsJobActionInput | null {
  return parseGetTtsJobInput(value);
}

export function parseFinishRecordingInput(value: unknown): FinishRecordingInput | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const sessionId = getString(value, 'sessionId');
  const durationMs = getNonNegativeInteger(value, 'durationMs');
  if (sessionId === null || durationMs === null) {
    return null;
  }

  return { sessionId, durationMs };
}

export function parseAbortRecordingInput(value: unknown): AbortRecordingInput | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const sessionId = getString(value, 'sessionId');
  const reason = getString(value, 'reason');
  if (sessionId === null || reason === null) {
    return null;
  }

  return { sessionId, reason };
}

export function parseResultActionInput(value: unknown): ResultActionInput | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const sessionId = getString(value, 'sessionId');
  if (sessionId === null) {
    return null;
  }

  return { sessionId };
}

export function parseSourceAvailabilityInput(value: unknown): SourceAvailabilityInput | null {
  return parseResultActionInput(value);
}
