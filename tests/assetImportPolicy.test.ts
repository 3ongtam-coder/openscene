import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ASSET_IMPORT_LIMITS,
  assertAssetImportQuota,
  type AssetImportLimits
} from '../src/main/assetImportPolicy';

const TEST_LIMITS: AssetImportLimits = {
  maximumSelectedFileCount: 2,
  maximumFileBytes: 6,
  maximumRequestBytes: 8,
  maximumProjectBytes: 20
};

describe('asset import policy', () => {
  it('given named production constraints, when inspected, then every import boundary has an explicit finite limit', () => {
    // Given / When / Then
    expect(DEFAULT_ASSET_IMPORT_LIMITS).toEqual({
      maximumSelectedFileCount: 100,
      maximumFileBytes: 2 * 1_024 * 1_024 * 1_024,
      maximumRequestBytes: 4 * 1_024 * 1_024 * 1_024,
      maximumProjectBytes: 20 * 1_024 * 1_024 * 1_024
    });
  });

  it('given file counts and byte totals beyond a configured boundary, when quota is checked, then each request is rejected safely', () => {
    // Given / When / Then
    expect(() => assertAssetImportQuota({ selectedFileBytes: [1, 1, 1], existingProjectBytes: 0 }, TEST_LIMITS)).toThrow(
      'A maximum of 2 media files can be imported at once.'
    );
    expect(() => assertAssetImportQuota({ selectedFileBytes: [7], existingProjectBytes: 0 }, TEST_LIMITS)).toThrow(
      'A selected media file exceeds the 6 byte limit.'
    );
    expect(() => assertAssetImportQuota({ selectedFileBytes: [5, 4], existingProjectBytes: 0 }, TEST_LIMITS)).toThrow(
      'Selected media exceeds the 8 byte request limit.'
    );
    expect(() => assertAssetImportQuota({ selectedFileBytes: [4], existingProjectBytes: 17 }, TEST_LIMITS)).toThrow(
      'The project asset library would exceed the 20 byte limit.'
    );
  });
});
