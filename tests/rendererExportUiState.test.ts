import { describe, expect, it } from 'vitest';

import {
  getExportActionState,
  getExportProgressPercent,
  getExportStatusView,
  isExportJobActive
} from '../src/renderer/src/editor/exportUiState';
import type { LocalExportJob } from '../src/shared/exportTypes';

const baseJob = {
  id: 'export_01',
  projectId: 'project_01',
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z'
} as const;

function jobWithState(state: LocalExportJob['state']): LocalExportJob {
  return { ...baseJob, state };
}

describe('renderer export UI state', () => {
  it('keeps export actions disabled until a saved local project is ready', () => {
    expect(getExportActionState({ hasProject: false, hasUnsavedTimeline: false, job: null, isStarting: false })).toEqual({
      canCancel: false,
      canOpen: false,
      canReveal: false,
      canStart: false,
      shouldPoll: false
    });

    expect(getExportActionState({ hasProject: true, hasUnsavedTimeline: true, job: null, isStarting: false })).toMatchObject({
      canStart: false,
      shouldPoll: false
    });

    expect(getExportActionState({ hasProject: true, hasUnsavedTimeline: false, job: null, isStarting: false })).toMatchObject({
      canStart: true,
      shouldPoll: false
    });
  });

  it('polls only queued and running jobs and exposes cancel only for active jobs', () => {
    const queuedJob = jobWithState({ kind: 'queued', queuedAt: '2026-07-22T00:00:01.000Z' });
    const runningJob = jobWithState({
      kind: 'running',
      startedAt: '2026-07-22T00:00:02.000Z',
      progress: { durationMs: 10_000, processedMs: 4_000, ratio: 0.4 }
    });
    const completedJob = jobWithState({
      kind: 'completed',
      completedAt: '2026-07-22T00:00:03.000Z',
      fileName: 'project-export.mp4',
      fileSizeBytes: 42_000
    });

    expect(isExportJobActive(queuedJob)).toBe(true);
    expect(isExportJobActive(runningJob)).toBe(true);
    expect(isExportJobActive(completedJob)).toBe(false);
    expect(getExportActionState({ hasProject: true, hasUnsavedTimeline: false, job: queuedJob, isStarting: false })).toMatchObject({ canCancel: true, shouldPoll: true });
    expect(getExportActionState({ hasProject: true, hasUnsavedTimeline: false, job: runningJob, isStarting: false })).toMatchObject({ canCancel: true, shouldPoll: true });
    expect(getExportActionState({ hasProject: true, hasUnsavedTimeline: false, job: completedJob, isStarting: false })).toMatchObject({ canOpen: true, canReveal: true, shouldPoll: false });
  });

  it('builds path-free labels for progress, completion, unavailable, and failure states', () => {
    const runningJob = jobWithState({
      kind: 'running',
      startedAt: '2026-07-22T00:00:02.000Z',
      progress: { durationMs: 10_000, processedMs: 3_333, ratio: 0.3333 }
    });
    const completedJob = jobWithState({
      kind: 'completed',
      completedAt: '2026-07-22T00:00:03.000Z',
      fileName: 'safe-name.mp4',
      fileSizeBytes: 5_242_880
    });
    const failedJob = jobWithState({
      kind: 'failed',
      failedAt: '2026-07-22T00:00:04.000Z',
      reason: 'FFmpeg was not configured and was not found on the system PATH.'
    });

    expect(getExportProgressPercent(runningJob)).toBe(33);
    expect(getExportStatusView({ hasProject: true, hasUnsavedTimeline: false, job: runningJob, isStarting: false })).toMatchObject({
      detail: '33% complete. Rendering MP4 H.264/AAC locally.',
      progressValue: 33,
      tone: 'warning'
    });
    expect(getExportStatusView({ hasProject: true, hasUnsavedTimeline: false, job: completedJob, isStarting: false })).toMatchObject({
      detail: 'safe-name.mp4 is ready. Size: 5.00 MB.',
      progressValue: 100,
      tone: 'success'
    });
    expect(getExportStatusView({ hasProject: true, hasUnsavedTimeline: false, job: failedJob, isStarting: false })).toMatchObject({
      detail: 'FFmpeg was not configured and was not found on the system PATH.',
      progressValue: 0,
      tone: 'danger'
    });
  });
});
