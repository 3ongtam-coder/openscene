import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readRepo = (path: string): Promise<string> => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('reviewed video candidate parity', () => {
  it('uses the shared approval gate on desktop and mobile', async () => {
    const [desktop, mobile] = await Promise.all([
      readRepo('src/renderer/src/VideoGenerationWorkspace.tsx'),
      readRepo('mobile/src/screens/PlanScreen.tsx')
    ]);
    expect(desktop).toContain('decideGenerationCandidate(document, generationId');
    expect(desktop).toContain('setCandidateContinuity(document, generationId');
    expect(mobile).toContain('candidateApprovalBlockReason({');
    expect(mobile).toContain('CONTINUITY_REVIEW_FIELDS.map');
    expect(mobile).toContain('Approve to timeline');
  });

  it('keeps generated candidates out of the mobile timeline until approval', async () => {
    const [screen, store, agentTools] = await Promise.all([
      readRepo('mobile/src/screens/PlanScreen.tsx'),
      readRepo('mobile/src/lib/projectStore.ts'),
      readRepo('mobile/src/lib/agentTools.ts')
    ]);
    expect(screen).toContain('saveGeneratedVideoCandidate(project, result.asset)');
    expect(screen).toContain('appendAssetToTimeline(project, asset)');
    expect(store).toContain('export function saveGeneratedVideoCandidate');
    expect(agentTools).toContain('saveGeneratedVideoCandidate(project, result.asset)');
    expect(agentTools).not.toContain('appendAssetToTimeline(project, result.asset)');
  });

  it('previews desktop candidates through a path-free protected media URL', async () => {
    const [studio, manager, protocol] = await Promise.all([
      readRepo('src/renderer/src/VideoGenerationWorkspace.tsx'),
      readRepo('src/main/aiJobManager.ts'),
      readRepo('src/main/timelineAssetResponse.ts')
    ]);
    expect(studio).toContain('src={job.previewUrl}');
    expect(manager).toContain('job.previewUrl = videoPreviewUrl(job.id)');
    expect(protocol).toContain("url.hostname === 'video-preview'");
    expect(studio).not.toContain('src={job.outputFilePath}');
  });
});
