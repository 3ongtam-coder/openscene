import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS } from '../src/shared/ipc';
import { parseAppendVoiceProfileSampleChunkInput, parseDeleteVoiceProfileInput, parseDiscardVoiceProfileSampleInput, parseFinalizeVoiceProfileSampleInput, parseGetTtsJobInput, parseStartTtsJobInput, parseStartVoiceProfileSampleInput, parseTtsJobActionInput } from '../src/shared/validators';
import { TextToSpeechProviderId } from '../src/shared/providerSeams';

function arrayBufferFromBytes(bytes: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function longString(length: number): string {
  return 'x'.repeat(length);
}

describe('voice profile contracts', () => {
  it('accepts an explicit-consent sample start payload and rejects consentless or malformed requests', () => {
    expect(
      parseStartVoiceProfileSampleInput({
        displayName: 'Narration profile',
        explicitConsent: true,
        consentTextVersion: '2026-07',
        language: 'en-US',
        narrationScript: 'Please read this sample sentence aloud.',
        mimeType: 'audio/webm'
      })
    ).toEqual({
      displayName: 'Narration profile',
      explicitConsent: true,
      consentTextVersion: '2026-07',
      language: 'en-US',
      narrationScript: 'Please read this sample sentence aloud.',
      mimeType: 'audio/webm'
    });

    expect(
      parseStartVoiceProfileSampleInput({
        displayName: 'Narration profile',
        explicitConsent: false,
        consentTextVersion: '2026-07',
        language: 'en-US',
        narrationScript: 'Please read this sample sentence aloud.',
        mimeType: 'audio/webm'
      })
    ).toBeNull();
    expect(
      parseStartVoiceProfileSampleInput({
        displayName: '',
        explicitConsent: true,
        consentTextVersion: '2026-07',
        language: 'en-US',
        narrationScript: 'Please read this sample sentence aloud.',
        mimeType: 'audio/webm'
      })
    ).toBeNull();
    expect(
      parseStartVoiceProfileSampleInput({
        displayName: 'Narration profile',
        explicitConsent: true,
        consentTextVersion: '2026-07',
        language: 'en-US',
        narrationScript: longString(1001),
        mimeType: 'audio/webm'
      })
    ).toBeNull();
  });

  it('accepts bounded sample chunks and rejects bad ids or oversized chunks', () => {
    const chunk = arrayBufferFromBytes([1, 2, 3]);

    expect(
      parseAppendVoiceProfileSampleChunkInput({
        sampleId: 'sample_01',
        sequence: 0,
        chunk
      })
    ).toEqual({
      sampleId: 'sample_01',
      sequence: 0,
      chunk
    });

    expect(
      parseAppendVoiceProfileSampleChunkInput({
        sampleId: '',
        sequence: 0,
        chunk
      })
    ).toBeNull();
    expect(
      parseAppendVoiceProfileSampleChunkInput({
        sampleId: 'sample_01',
        sequence: -1,
        chunk
      })
    ).toBeNull();
    expect(
      parseAppendVoiceProfileSampleChunkInput({
        sampleId: 'sample_01',
        sequence: 0,
        chunk: arrayBufferFromBytes(new Array(1_048_577).fill(0))
      })
    ).toBeNull();
  });

  it('accepts voice profile lifecycle ids for finalize, discard, and delete requests', () => {
    expect(parseFinalizeVoiceProfileSampleInput({ sampleId: 'sample_01', durationMs: 1200 })).toEqual({
      sampleId: 'sample_01',
      durationMs: 1200
    });
    expect(parseDiscardVoiceProfileSampleInput({ sampleId: 'sample_01' })).toEqual({ sampleId: 'sample_01' });
    expect(parseDeleteVoiceProfileInput({ voiceProfileId: 'profile_01' })).toEqual({ voiceProfileId: 'profile_01' });

    expect(parseFinalizeVoiceProfileSampleInput({ sampleId: '', durationMs: 1200 })).toBeNull();
    expect(parseFinalizeVoiceProfileSampleInput({ sampleId: 'sample_01', durationMs: -1 })).toBeNull();
    expect(parseFinalizeVoiceProfileSampleInput({ sampleId: 'sample_01', durationMs: 1.5 })).toBeNull();
    expect(parseDiscardVoiceProfileSampleInput({ sampleId: ' ' })).toBeNull();
    expect(parseDeleteVoiceProfileInput({ voiceProfileId: '' })).toBeNull();
  });
});

describe('local TTS contracts', () => {
  it('accepts a bounded local TTS job request and rejects invalid ids, scripts, languages, and mime types', () => {
    expect(
      parseStartTtsJobInput({
        voiceProfileId: 'profile_01',
        script: 'Hello from OpenVideo.',
        language: 'en-US',
        mimeType: 'audio/wav',
        modelId: 'qwen3-tts-1.7b-base'
      })
    ).toEqual({
      voiceProfileId: 'profile_01',
      script: 'Hello from OpenVideo.',
      language: 'en-US',
      mimeType: 'audio/wav',
      modelId: 'qwen3-tts-1.7b-base'
    });

    expect(
      parseStartTtsJobInput({
        voiceProfileId: '',
        script: 'Hello from OpenVideo.',
        language: 'en-US',
        mimeType: 'audio/wav'
      })
    ).toBeNull();
    expect(
      parseStartTtsJobInput({
        voiceProfileId: 'profile_01',
        script: '',
        language: 'en-US',
        mimeType: 'audio/wav'
      })
    ).toBeNull();
    expect(
      parseStartTtsJobInput({
        voiceProfileId: 'profile_01',
        script: longString(5001),
        language: 'en-US',
        mimeType: 'audio/wav'
      })
    ).toBeNull();
    expect(
      parseStartTtsJobInput({
        voiceProfileId: 'profile_01',
        script: 'Hello from OpenVideo.',
        language: '',
        mimeType: 'audio/wav'
      })
    ).toBeNull();
    expect(
      parseStartTtsJobInput({
        voiceProfileId: 'profile_01',
        script: 'Hello from OpenVideo.',
        language: 'en-US',
        mimeType: 'audio/aac'
      })
    ).toBeNull();
  });

  it('accepts job actions with opaque job ids', () => {
    expect(parseGetTtsJobInput({ jobId: 'job_01' })).toEqual({ jobId: 'job_01' });
    expect(parseTtsJobActionInput({ jobId: 'job_01' })).toEqual({ jobId: 'job_01' });
    expect(parseGetTtsJobInput({ jobId: '' })).toBeNull();
    expect(parseTtsJobActionInput({ jobId: 'job 01' })).toBeNull();
  });

  it('recognizes local_qwen as a text-to-speech provider id and exposes the new channels', () => {
    const providerId: TextToSpeechProviderId = 'local_qwen';

    expect(providerId).toBe('local_qwen');
    expect(IPC_CHANNELS.voiceProfilesList).toBe('voice-profiles:list');
    expect(IPC_CHANNELS.voiceProfilesStart).toBe('voice-profiles:start');
    expect(IPC_CHANNELS.voiceProfilesAppend).toBe('voice-profiles:append');
    expect(IPC_CHANNELS.voiceProfilesFinalize).toBe('voice-profiles:finalize');
    expect(IPC_CHANNELS.voiceProfilesDiscard).toBe('voice-profiles:discard');
    expect(IPC_CHANNELS.voiceProfilesDelete).toBe('voice-profiles:delete');
    expect(IPC_CHANNELS.getTtsRuntimeStatus).toBe('tts:runtime-status');
    expect(IPC_CHANNELS.startTtsJob).toBe('tts:start-job');
    expect(IPC_CHANNELS.getTtsJob).toBe('tts:get-job');
    expect(IPC_CHANNELS.openTtsResult).toBe('tts:open-result');
    expect(IPC_CHANNELS.revealTtsResult).toBe('tts:reveal-result');
  });
});
