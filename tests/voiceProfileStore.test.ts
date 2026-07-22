import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { VoiceProfileStore } from '../src/main/voiceProfileStore';

function arrayBufferFromBytes(bytes: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function isInsideDirectory(parentDirectory: string, childPath: string): boolean {
  const normalizedParent = resolve(parentDirectory);
  const normalizedChild = resolve(childPath);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'video-voice-profiles-'));

  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('voice profile store', () => {
  it('given valid consent input, when chunks are appended in order, then finalize persists a profile and list hides file paths', async () => {
    await withTempDirectory(async (directory) => {
      const store = new VoiceProfileStore(directory);
      const startedAt = new Date('2026-07-20T10:00:00.000Z');
      const finishedAt = new Date('2026-07-20T10:00:02.500Z');

      const begun = await store.begin(
        {
          displayName: 'Narration profile',
          explicitConsent: true,
          consentTextVersion: '2026-07',
          language: 'en-US',
          narrationScript: 'Please read this sample sentence aloud.',
          mimeType: 'audio/webm'
        },
        startedAt
      );

      expect(begun.voiceProfileId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
      expect(begun.sampleId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
      expect(isInsideDirectory(directory, begun.stagingProfilePath)).toBe(true);
      expect(isInsideDirectory(directory, begun.stagingSamplePath)).toBe(true);

      await expect(store.append(begun.sampleId, 1, arrayBufferFromBytes([9]))).rejects.toThrow(
        'Unexpected voice profile chunk sequence 1; expected 0.'
      );
      await expect(store.append(begun.sampleId, 0, arrayBufferFromBytes([1, 2, 3]))).resolves.toEqual({
        sequence: 0,
        totalBytes: 3
      });
      await expect(store.append(begun.sampleId, 1, arrayBufferFromBytes([4, 5]))).resolves.toEqual({
        sequence: 1,
        totalBytes: 5
      });

      const finalized = await store.finalize(begun.sampleId, 12_000, finishedAt);
      const sampleBytes = await readFile(finalized.samplePath);
      const metadata = JSON.parse(await readFile(finalized.metadataPath, 'utf8')) as Record<string, unknown>;
      const profiles = await store.list();

      expect(finalized.profile).toEqual({
        id: begun.voiceProfileId,
        displayName: 'Narration profile',
        language: 'en-US',
        sampleCount: 1,
        totalDurationMs: 12_000,
        createdAt: startedAt.toISOString(),
        updatedAt: finishedAt.toISOString()
      });
      expect([...sampleBytes]).toEqual([1, 2, 3, 4, 5]);
      expect(metadata).toEqual({
        voiceProfileId: begun.voiceProfileId,
        sampleId: begun.sampleId,
        displayName: 'Narration profile',
        language: 'en-US',
        narrationScript: 'Please read this sample sentence aloud.',
        sampleMimeType: 'audio/webm',
        samplePath: finalized.samplePath,
        byteLength: 5,
        durationMs: 12_000,
        consentTextVersion: '2026-07',
        consentedAt: startedAt.toISOString(),
        sampleCount: 1,
        totalDurationMs: 12_000,
        createdAt: startedAt.toISOString(),
        updatedAt: finishedAt.toISOString()
      });
      expect(profiles).toEqual([finalized.profile]);

      await store.delete(begun.voiceProfileId);
      await expect(stat(finalized.metadataPath)).rejects.toThrow();
      await expect(store.list()).resolves.toEqual([]);
    });
  });

  it('given an active sample, when a later chunk arrives first, then the store rejects the invalid sequence without advancing state', async () => {
    await withTempDirectory(async (directory) => {
      const store = new VoiceProfileStore(directory);
      const begun = await store.begin({
        displayName: 'Narration profile',
        explicitConsent: true,
        consentTextVersion: '2026-07',
        language: 'en-US',
        narrationScript: 'Please read this sample sentence aloud.',
        mimeType: 'audio/webm'
      });

      await expect(store.append(begun.sampleId, 1, arrayBufferFromBytes([9]))).rejects.toThrow(
        'Unexpected voice profile chunk sequence 1; expected 0.'
      );
      await expect(store.append(begun.sampleId, 0, arrayBufferFromBytes([7, 8]))).resolves.toEqual({
        sequence: 0,
        totalBytes: 2
      });

      await store.discard(begun.sampleId);
    });
  });

  it('given a sample at the total byte cap, when another chunk arrives, then it is rejected and remains discardable', async () => {
    await withTempDirectory(async (directory) => {
      const store = new VoiceProfileStore(directory);
      const begun = await store.begin({
        displayName: 'Narration profile',
        explicitConsent: true,
        consentTextVersion: '2026-07',
        language: 'en-US',
        narrationScript: 'Please read this sample sentence aloud.',
        mimeType: 'audio/wav'
      });
      const oneMebibyte = new ArrayBuffer(1_048_576);

      for (let sequence = 0; sequence < 8; sequence += 1) {
        await store.append(begun.sampleId, sequence, oneMebibyte);
      }
      await expect(store.append(begun.sampleId, 8, arrayBufferFromBytes([1]))).rejects.toThrow(
        'Voice profile sample exceeds the 8388608 byte limit.'
      );
      await store.discard(begun.sampleId);

      await expect(stat(begun.stagingProfilePath)).rejects.toThrow();
    });
  });

  it('given a staged sample, when discard runs, then incomplete files are removed and list stays empty', async () => {
    await withTempDirectory(async (directory) => {
      const store = new VoiceProfileStore(directory);
      const begun = await store.begin({
        displayName: 'Narration profile',
        explicitConsent: true,
        consentTextVersion: '2026-07',
        language: 'en-US',
        narrationScript: 'Please read this sample sentence aloud.',
        mimeType: 'audio/wav'
      });

      await store.append(begun.sampleId, 0, arrayBufferFromBytes([11, 12]));
      await store.discard(begun.sampleId);

      await expect(stat(begun.stagingProfilePath)).rejects.toThrow();
      await expect(stat(begun.stagingSamplePath)).rejects.toThrow();
      await expect(store.list()).resolves.toEqual([]);
    });
  });

  it('given a configured root, when the store creates paths, then every path stays inside the root and escape ids are rejected', async () => {
    await withTempDirectory(async (directory) => {
      const store = new VoiceProfileStore(directory);
      const begun = await store.begin({
        displayName: 'Narration profile',
        explicitConsent: true,
        consentTextVersion: '2026-07',
        language: 'en-US',
        narrationScript: 'Please read this sample sentence aloud.',
        mimeType: 'audio/mpeg'
      });

      expect(isInsideDirectory(directory, begun.stagingProfilePath)).toBe(true);
      expect(isInsideDirectory(directory, begun.stagingSamplePath)).toBe(true);

      await expect(store.delete('../escape')).rejects.toThrow('Invalid voice profile id.');
      await store.discard(begun.sampleId);
    });
  });

  it.each([9_999, 30_001])(
    'given an active sample, when duration %d ms is finalized, then it is rejected and remains discardable',
    async (durationMs) => {
      await withTempDirectory(async (directory) => {
        const store = new VoiceProfileStore(directory);
        const begun = await store.begin({
          displayName: 'Narration profile',
          explicitConsent: true,
          consentTextVersion: '2026-07',
          language: 'en-US',
          narrationScript: 'Please read this sample sentence aloud.',
          mimeType: 'audio/wav'
        });
        await store.append(begun.sampleId, 0, arrayBufferFromBytes([1]));

        await expect(store.finalize(begun.sampleId, durationMs)).rejects.toThrow(
          'Voice profile sample duration must be between 10000 and 30000 milliseconds.'
        );
        await store.discard(begun.sampleId);

        await expect(stat(begun.stagingProfilePath)).rejects.toThrow();
      });
    }
  );
});
