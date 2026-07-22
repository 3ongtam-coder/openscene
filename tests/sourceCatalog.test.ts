import { describe, expect, it } from 'vitest';

import { SourceCatalog, deriveAppName, sanitizeCaptureSource } from '../src/shared/sourceCatalog';
import { parseAppendRecordingChunkInput, parseSelectSourceInput } from '../src/shared/validators';

function firstSource(sources: ReturnType<SourceCatalog['refresh']>) {
  const source = sources[0];
  if (source === undefined) {
    throw new Error('Expected at least one source.');
  }
  return source;
}

function arrayBufferFromBytes(bytes: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

describe('source catalog', () => {
  it('sanitizes visible source fields and derives app names', () => {
    const source = sanitizeCaptureSource(
      {
        id: ' window:123 ',
        name: '  Safari   -   Product Demo  ',
        displayId: ' 42 ',
        thumbnailDataUrl: 'data:image/png;base64,abc'
      },
      3
    );

    expect(source).toEqual({
      id: 'window:123',
      name: 'Safari - Product Demo',
      appName: 'Safari',
      generation: 3,
      displayId: '42',
      thumbnailDataUrl: 'data:image/png;base64,abc'
    });
    expect(deriveAppName('OBS — Scene Builder')).toBe('OBS');
  });

  it('clears selections after a refresh so stale source IDs are rejected', () => {
    const catalog = new SourceCatalog();
    const initialSource = firstSource(catalog.refresh([{ id: 'one', name: 'Terminal - Build' }]));

    expect(catalog.select({ sourceId: initialSource.id, generation: initialSource.generation })).toEqual(initialSource);
    expect(catalog.getSelected()).toEqual(initialSource);

    catalog.refresh([{ id: 'one', name: 'Terminal - Build' }]);

    expect(catalog.getSelected()).toBeNull();
    expect(catalog.select({ sourceId: initialSource.id, generation: initialSource.generation })).toBeNull();
  });
});

describe('ipc validators', () => {
  it('accepts only well-shaped source selections', () => {
    expect(parseSelectSourceInput({ sourceId: 'window:1', generation: 1 })).toEqual({
      sourceId: 'window:1',
      generation: 1
    });

    expect(parseSelectSourceInput({ sourceId: '', generation: 1 })).toBeNull();
    expect(parseSelectSourceInput({ sourceId: 'window:1', generation: 0 })).toBeNull();
    expect(parseSelectSourceInput({ sourceId: 'window:1', generation: '1' })).toBeNull();
  });

  it('requires recording chunks to carry an ArrayBuffer and monotonic metadata shape', () => {
    const buffer = arrayBufferFromBytes([1, 2, 3]);

    expect(parseAppendRecordingChunkInput({ sessionId: 'session', sequence: 0, chunk: buffer })).toEqual({
      sessionId: 'session',
      sequence: 0,
      chunk: buffer
    });

    expect(parseAppendRecordingChunkInput({ sessionId: 'session', sequence: -1, chunk: buffer })).toBeNull();
    expect(parseAppendRecordingChunkInput({ sessionId: 'session', sequence: 0, chunk: [1, 2, 3] })).toBeNull();
  });
});
