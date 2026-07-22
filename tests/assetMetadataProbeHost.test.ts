import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildClipFromAsset, mediaAssetReady } from '../src/renderer/src/editor/editorTimelineView';
import type { MediaAsset } from '../src/shared/timelineTypes';

function makeImportedVideo(metadata: MediaAsset['metadata']): MediaAsset {
  return {
    id: 'asset-1',
    displayName: 'take.webm',
    projectRelativePath: 'assets/asset-1/original.webm',
    kind: 'video',
    mimeType: 'video/webm',
    byteLength: 100,
    metadata,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

describe('asset metadata probe host', () => {
  it('keeps an imported video unplaceable until valid metadata arrives', () => {
    const pendingAsset = makeImportedVideo(null);
    const readyAsset = makeImportedVideo({ durationMs: 4_000, width: 1_920, height: 1_080 });

    expect(mediaAssetReady(pendingAsset)).toBe(false);
    expect(buildClipFromAsset(pendingAsset, 'clip-a', 0)).toBeNull();
    expect(mediaAssetReady(readyAsset)).toBe(true);
    expect(buildClipFromAsset(readyAsset, 'clip-a', 0)).toEqual({
      id: 'clip-a',
      assetId: 'asset-1',
      timelineStartMs: 0,
      sourceStartMs: 0,
      sourceEndMs: 4_000,
      sourceDurationMs: 4_000
    });
  });

  it('keeps the asset metadata probe style out of display:none', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8');
    const assetProbeRule = styles.match(/\.asset-probe\s*\{[^}]*\}/s);

    expect(assetProbeRule).not.toBeNull();
    expect(assetProbeRule?.[0]).not.toContain('display: none');
  });
});
