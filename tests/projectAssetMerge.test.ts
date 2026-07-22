import { describe, expect, it } from 'vitest';

import { mergeImportedAssets } from '../src/shared/projectAssetMerge';
import type { MediaAsset } from '../src/shared/timelineTypes';

function asset(id: string, displayName: string): MediaAsset {
  return {
    byteLength: 1_024,
    createdAt: '2026-01-01T00:00:00.000Z',
    displayName,
    id,
    kind: 'video',
    metadata: null,
    mimeType: 'video/webm',
    projectRelativePath: `media/${id}.webm`,
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

describe('mergeImportedAssets', () => {
  it('preserves existing asset order and appends newly imported assets', () => {
    // Given
    const currentAssets = [asset('asset-1', 'Existing take')];
    const importedAssets = [asset('asset-2', 'Recorded take')];

    // When
    const mergedAssets = mergeImportedAssets(currentAssets, importedAssets);

    // Then
    expect(mergedAssets.map((candidate) => candidate.id)).toEqual(['asset-1', 'asset-2']);
  });

  it('updates imported duplicate ids without duplicating assets', () => {
    // Given
    const currentAssets = [asset('asset-1', 'Old metadata'), asset('asset-2', 'Stable audio')];
    const importedAssets = [asset('asset-1', 'Fresh metadata')];

    // When
    const mergedAssets = mergeImportedAssets(currentAssets, importedAssets);

    // Then
    expect(mergedAssets).toHaveLength(2);
    expect(mergedAssets[0]?.displayName).toBe('Fresh metadata');
    expect(mergedAssets[1]?.displayName).toBe('Stable audio');
  });
});
