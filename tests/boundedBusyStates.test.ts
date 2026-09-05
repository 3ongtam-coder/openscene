import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readRepo(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('bounded renderer busy states', () => {
  it('gives Writer and all media polling explicit stop paths', async () => {
    const [writer, image, speech, video] = await Promise.all([
      readRepo('src/shared/writerGeneration.ts'),
      readRepo('src/renderer/src/ImageGenerationWorkspace.tsx'),
      readRepo('src/renderer/src/NarrationPanel.tsx'),
      readRepo('src/renderer/src/VideoGenerationWorkspace.tsx')
    ]);

    expect(writer).toContain('GEMINI_WRITER_TIMEOUT_MS');
    expect(writer).toContain('controller.abort()');
    expect(writer).toContain('Gemini Writer did not finish within');

    expect(image).toContain('IMAGE_JOB_UI_TIMEOUT_MS');
    expect(image).toContain('Stopped waiting after 12 minutes');
    expect(image).toContain("'Image job polling failed.'");
    expect(image).toContain('if (pollTimerRef.current !== null) clearInterval(pollTimerRef.current)');
    expect(image.indexOf('Date.now() >= pollingDeadline')).toBeLessThan(image.indexOf('if (pollInFlightRef.current) return;'));

    expect(speech).toContain('speechPollInFlightRef');
    expect(speech).toContain('speechPollGenerationRef');
    expect(speech).toContain("'Speech job polling failed.'");
    expect(speech).toContain('Speech synthesis did not finish within 10 minutes');
    expect(speech.indexOf('Date.now() >= deadline')).toBeLessThan(speech.indexOf('if (speechPollInFlightRef.current) return;'));

    expect(video).toContain('activePollJobs');
    expect(video).toContain('inFlightPollJobs');
    expect(video.indexOf('Date.now() > pollingDeadline')).toBeLessThan(video.indexOf('if (inFlightPollJobs.current.has(job.id)) return;'));
  });

  it('clears editor busy state in finally even when IPC rejects', async () => {
    const editor = await readRepo('src/renderer/src/editor/useTimelineEditor.ts');
    const helperStart = editor.indexOf('const invokeWhileBusy');
    const helperEnd = editor.indexOf('const openProject', helperStart);
    const helper = editor.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThan(-1);
    expect(helper).toContain('try {');
    expect(helper).toContain('catch (error: unknown)');
    expect(helper).toContain('finally {');
    expect(helper).toContain('setIsBusy(false)');
    expect(editor).toContain("invokeWhileBusy(() => window.videoTool.detachVideoAudio");
    expect(editor).toContain('invokeWhileBusy(\n      () => window.videoTool.saveTimeline');
  });

  it('does not switch or close an active project after a failed unsaved save', async () => {
    const app = await readRepo('src/renderer/src/App.tsx');
    expect(app).toContain('editor.hasUnsavedTimeline && !await editor.saveTimeline()) return;');
    expect(app.indexOf('editor.hasUnsavedTimeline && !await editor.saveTimeline()) return;'))
      .toBeLessThan(app.indexOf('const opened = await editor.openProject(projectId)'));
    expect(app.indexOf('if (editor.project?.id === projectId && editor.hasUnsavedTimeline && !await editor.saveTimeline()) return;'))
      .toBeLessThan(app.indexOf('setProjectTabs(next.tabs);'));
  });
});
