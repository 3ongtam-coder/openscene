import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const INSPECTOR_PANEL_SOURCE_URL = new URL('../src/renderer/src/editor/InspectorPanel.tsx', import.meta.url);

function indexOfRequired(source: string, marker: string): number {
  const index = source.indexOf(marker);

  expect(index, `Expected InspectorPanel source to include ${marker}`).toBeGreaterThanOrEqual(0);

  return index;
}

describe('inspector panel selected clip layout', () => {
  it('keeps selected clip trim controls before the selected clip metadata list', async () => {
    const source = await readFile(INSPECTOR_PANEL_SOURCE_URL, 'utf8');
    const selectedClipMetadataIndex = indexOfRequired(source, "{ term: 'Track', description: clip.track.name }");
    const toolbarMarkers = [
      'aria-label="Selected clip trim controls"',
      'editor.moveSelectedClip(-500)',
      'Nudge -0.5s',
      'editor.moveSelectedClip(500)',
      'Nudge +0.5s',
      "editor.trimSelectedClip('left', 500)",
      'Trim left',
      "editor.trimSelectedClip('right', -500)",
      'Trim right',
      'onClick={editor.splitSelectedClip}',
      'Split middle',
      'onClick={editor.deleteSelectedClip}',
      'Delete clip'
    ];

    for (const marker of toolbarMarkers) {
      expect(indexOfRequired(source, marker), `Expected ${marker} before selected clip metadata`).toBeLessThan(selectedClipMetadataIndex);
    }
  });

  it('gives every persisted effect input an explicit accessible name', async () => {
    const source = await readFile(INSPECTOR_PANEL_SOURCE_URL, 'utf8');
    const effectInputLabels = [
      'aria-label="Clip effect position X"',
      'aria-label="Clip effect position Y"',
      'aria-label="Clip effect scale"',
      'aria-label="Clip effect rotation"',
      'aria-label="Clip effect opacity"',
      'aria-label="Clip effect volume"'
    ];

    for (const label of effectInputLabels) {
      indexOfRequired(source, label);
    }
  });

  it('does not suppress the visible focus outline on position inputs', async () => {
    const source = await readFile(INSPECTOR_PANEL_SOURCE_URL, 'utf8');

    expect(source).not.toContain("outline: 'none'");
  });
});
