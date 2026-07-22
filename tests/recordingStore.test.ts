import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { RecordingFileStore, createRecordingFileName, sanitizeFileSegment } from '../src/main/recordingStore';

function arrayBufferFromBytes(bytes: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

describe('recording file lifecycle', () => {
  it('creates stable WebM names from unsafe window titles', () => {
    const now = new Date('2026-07-20T10:11:12.130Z');

    expect(sanitizeFileSegment('Safari / Demo: Checkout?')).toBe('Safari-Demo-Checkout');
    expect(createRecordingFileName('Safari / Demo: Checkout?', now)).toBe('2026-07-20T10-11-12-130Z-Safari-Demo-Checkout.webm');
  });

  it('streams chunks in order and finalizes result metadata without retaining chunks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-tool-'));
    const store = new RecordingFileStore(directory);
    const session = await store.begin({
      sourceId: 'window:1',
      sourceName: 'Terminal - Build Log',
      now: new Date('2026-07-20T10:00:00.000Z')
    });

    await expect(store.appendChunk(session.id, 1, arrayBufferFromBytes([9]))).rejects.toThrow('Unexpected recording chunk sequence');
    await expect(store.appendChunk(session.id, 0, arrayBufferFromBytes([1, 2, 3]))).resolves.toEqual({
      sequence: 0,
      totalBytes: 3
    });
    await expect(store.appendChunk(session.id, 1, arrayBufferFromBytes([4, 5]))).resolves.toEqual({
      sequence: 1,
      totalBytes: 5
    });

    const result = await store.finalize(session.id, 2300, new Date('2026-07-20T10:00:02.300Z'));
    const bytes = await readFile(result.outputPath);

    expect(result.directory).toBe(directory);
    expect(result.fileSizeBytes).toBe(5);
    expect(result.durationMs).toBe(2300);
    expect([...bytes]).toEqual([1, 2, 3, 4, 5]);
    expect(store.getResult(session.id)).toEqual(result);
  });

  it('aborts an active partial recording and removes the file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-tool-'));
    const store = new RecordingFileStore(directory);
    const session = await store.begin({ sourceId: 'window:2', sourceName: 'Notes' });

    await store.appendChunk(session.id, 0, arrayBufferFromBytes([7, 8]));
    await store.abort(session.id);

    await expect(stat(session.outputPath)).rejects.toThrow();
    expect(store.getActiveSession(session.id)).toBeNull();
  });
});
