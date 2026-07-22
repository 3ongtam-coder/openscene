import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const exportPanelSource = readFileSync(new URL('../src/renderer/src/editor/ExportPanel.tsx', import.meta.url), 'utf8');

describe('renderer export panel source contract', () => {
  it('uses only typed videoTool export calls from the renderer', () => {
    expect(exportPanelSource).toContain('window.videoTool.startExportJob');
    expect(exportPanelSource).toContain('window.videoTool.getExportJob');
    expect(exportPanelSource).toContain('window.videoTool.cancelExportJob');
    expect(exportPanelSource).toContain('window.videoTool.openExportResult');
    expect(exportPanelSource).toContain('window.videoTool.revealExportResult');
    expect(exportPanelSource).not.toContain('ipcRenderer');
  });

  it('does not expose export paths, FFmpeg executable paths, or FFmpeg argv in renderer copy', () => {
    expect(exportPanelSource).not.toMatch(/outputPath|executablePath|argv|args:/);
    expect(exportPanelSource).toContain('never output paths or FFmpeg arguments');
  });
});
