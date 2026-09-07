import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('production board surface parity', () => {
  it('uses the shared board and assembly rules on desktop and mobile without auto generation', async () => {
    const [desktop, desktopEditor, mobile, mobileStore] = await Promise.all([
      source('src/renderer/src/ProductionBoard.tsx'),
      source('src/renderer/src/editor/useTimelineEditor.ts'),
      source('mobile/src/screens/PlanScreen.tsx'),
      source('mobile/src/lib/projectStore.ts')
    ]);
    expect(desktop).toContain('productionShotRows(document)');
    expect(desktop).toContain('activeCharacterIds.has(character.id)');
    expect(desktop).toContain('assignStoryboardReference(document');
    expect(desktop).toContain('addCharacterReference(document');
    expect(desktop).toContain('This board never starts a provider job.');
    expect(desktopEditor).toContain('buildApprovedProductionAssemblyPlan(project.ai');
    expect(desktopEditor).toContain('assembleApprovedProductionCut({');
    expect(mobile).toContain('productionShotRows(activeProject?.ai)');
    expect(mobile).toContain('assembleApprovedWriterShots(activeProject)');
    expect(mobileStore).toContain('buildApprovedProductionAssemblyPlan(project.ai');
    expect(mobileStore).toContain('assembleApprovedProductionCut({');
    expect(desktop).not.toContain('aiGenerateVideo');
  });
});
