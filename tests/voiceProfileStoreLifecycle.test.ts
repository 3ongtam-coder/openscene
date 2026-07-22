import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import type { WriteStream } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const streamControl = vi.hoisted(() => {
  let currentStream: PassThrough | null = null;
  let resolveStreamReady: (() => void) | null = null;
  let streamReady = new Promise<void>((resolve) => {
    resolveStreamReady = resolve;
  });

  return {
    reset(): void {
      currentStream = null;
      streamReady = new Promise<void>((resolve) => {
        resolveStreamReady = resolve;
      });
    },
    createWriteStreamMock(): WriteStream {
      currentStream = new PassThrough();
      resolveStreamReady?.();
      return currentStream as unknown as WriteStream;
    },
    async waitForStream(): Promise<void> {
      if (currentStream !== null) {
        return;
      }

      await streamReady;
    },
    releaseOpen(): void {
      if (currentStream === null) {
        throw new Error('Expected a pending voice profile stream.');
      }

      currentStream.emit('open');
    },
    failOpen(error: Error): void {
      if (currentStream === null) {
        throw new Error('Expected a pending voice profile stream.');
      }

      currentStream.emit('error', error);
    }
  };
});

afterEach(() => {
  streamControl.reset();
});

vi.mock('node:fs', async () => {
  const actual = await import('node:fs');

  return {
    ...actual,
    createWriteStream: vi.fn(() => streamControl.createWriteStreamMock())
  };
});

import { VoiceProfileStore } from '../src/main/voiceProfileStore';

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'video-voice-profile-lifecycle-'));

  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('voice profile store begin lifecycle', () => {
  it('keeps begin pending until the write stream opens', async () => {
    await withTempDirectory(async (directory) => {
      const store = new VoiceProfileStore(directory);
      let settled = false;

      const begun = store.begin({
        displayName: 'Narration profile',
        explicitConsent: true,
        consentTextVersion: '2026-07',
        language: 'en-US',
        narrationScript: 'Please read this sentence aloud.',
        mimeType: 'audio/wav'
      });

      void begun.then(() => {
        settled = true;
      });

      await streamControl.waitForStream();
      await Promise.resolve();
      expect(settled).toBe(false);

      streamControl.releaseOpen();

      const started = await begun;
      expect(started.stagingSamplePath).toContain('pending');
    });
  });

  it('turns a delayed open error into a rejected begin without an unhandled stream error', async () => {
    await withTempDirectory(async (directory) => {
      const store = new VoiceProfileStore(directory);

      const begun = store.begin({
        displayName: 'Narration profile',
        explicitConsent: true,
        consentTextVersion: '2026-07',
        language: 'en-US',
        narrationScript: 'Please read this sentence aloud.',
        mimeType: 'audio/wav'
      });

      await streamControl.waitForStream();
      expect(() => {
        streamControl.failOpen(new Error('ENOENT'));
      }).not.toThrow();

      await expect(begun).rejects.toThrow('ENOENT');
    });
  });
});
