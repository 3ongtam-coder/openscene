import { describe, expect, it } from 'vitest';

import {
  mediaDurationMsFromSeconds,
  metadataProbeFailureMessage,
  programMonitorPreviewLoadState,
  programMonitorFailureMessage
} from '../src/renderer/src/editor/mediaLoadFailures';

describe('media load failures', () => {
  it.each([
    { label: 'NaN', seconds: Number.NaN },
    { label: 'Infinity', seconds: Number.POSITIVE_INFINITY },
    { label: 'zero', seconds: 0 },
    { label: 'negative', seconds: -1 }
  ])('returns null for $label seconds', ({ seconds }) => {
    expect(mediaDurationMsFromSeconds(seconds)).toBeNull();
  });

  it('rounds positive seconds to milliseconds', () => {
    expect(mediaDurationMsFromSeconds(1.2345)).toBe(1_235);
  });

  it('returns a generic path-safe metadata probe failure message', () => {
    // Given
    const absolutePath = '/Users/alice/Videos/secret.mov';
    const ipcUrl = 'ipc://127.0.0.1:9000/video';
    const rawError = new Error('boom: stack detail');

    // When
    const message = metadataProbeFailureMessage(absolutePath, ipcUrl, rawError);

    // Then
    expect(message).toBeTruthy();
    expect(message).not.toContain(absolutePath);
    expect(message).not.toContain(ipcUrl);
    expect(message).not.toContain(rawError.message);
  });

  it('returns a generic path-safe program monitor failure message', () => {
    // Given
    const absolutePath = '/Users/alice/Videos/secret.mov';
    const ipcUrl = 'ipc://127.0.0.1:9000/video';
    const rawError = new Error('boom: stack detail');

    // When
    const message = programMonitorFailureMessage(absolutePath, ipcUrl, rawError);

    // Then
    expect(message).toBeTruthy();
    expect(message).not.toContain(absolutePath);
    expect(message).not.toContain(ipcUrl);
    expect(message).not.toContain(rawError.message);
  });

  describe('program monitor preview load state', () => {
    it('represents a loading preview', () => {
      expect(programMonitorPreviewLoadState({ type: 'loading' })).toEqual({ status: 'loading' });
    });

    it('represents a ready preview with its secure URL', () => {
      const url = 'video-tool-asset://playback/project-1/asset-1';

      expect(programMonitorPreviewLoadState({ type: 'ready', url })).toEqual({ status: 'ready', url });
    });

    it('represents a failed preview with the generic program monitor message', () => {
      expect(programMonitorPreviewLoadState({ type: 'error' })).toEqual({
        status: 'error',
        message: programMonitorFailureMessage()
      });
    });
  });
});
