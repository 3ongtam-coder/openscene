import { describe, expect, it } from 'vitest';

import { projectAssetImportFailureMessage } from '../src/renderer/src/editor/projectAssetImportFeedback';

describe('projectAssetImportFailureMessage', () => {
  it.each([
    {
      name: 'Error text',
      error: new Error('native path: /Users/jungwon/Movies/private-capture.webm'),
      sensitiveValues: ['native path: /Users/jungwon/Movies/private-capture.webm']
    },
    {
      name: 'absolute path',
      error: new Error('/Users/jungwon/Movies/private-capture.webm'),
      sensitiveValues: ['/Users/jungwon/Movies/private-capture.webm']
    },
    {
      name: 'video-tool-asset URL',
      error: new Error('video-tool-asset://project-assets/private-capture.webm'),
      sensitiveValues: ['video-tool-asset://project-assets/private-capture.webm']
    }
  ])('returns the generic failure message for $name', ({ error, sensitiveValues }) => {
    // Given
    const message = projectAssetImportFailureMessage(error);

    // When
    // Then
    expect(message).toBe('Asset import failed.');
    for (const sensitiveValue of sensitiveValues) {
      expect(message).not.toContain(sensitiveValue);
    }
  });
});
