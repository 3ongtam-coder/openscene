import { useCallback, useEffect, useMemo, useState } from 'react';

import type { LocalProjectSnapshot, TimelineDocument } from '../../../shared/timelineTypes';
import { clampPlayheadMs, findPlaybackClipAt } from './editorTimelineView';

export function useTimelinePlayback(project: LocalProjectSnapshot | null) {
  const [playheadMs, setPlayheadMsState] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const activePlaybackClip = useMemo(
    () => project === null ? null : findPlaybackClipAt(project.timeline, project.assets, playheadMs),
    [playheadMs, project]
  );

  const resetPlayback = useCallback(() => {
    setPlayheadMsState(0);
    setIsPlaying(false);
  }, []);

  const setPlayheadMs = useCallback((value: number, timeline?: TimelineDocument) => {
    setPlayheadMsState((current) => {
      const targetTimeline = timeline ?? project?.timeline;
      return targetTimeline === undefined ? current : clampPlayheadMs(targetTimeline, value);
    });
  }, [project]);

  const clampToTimeline = useCallback((timeline?: TimelineDocument) => {
    const targetTimeline = timeline ?? project?.timeline;
    if (targetTimeline !== undefined) setPlayheadMsState((current) => clampPlayheadMs(targetTimeline, current));
  }, [project]);

  useEffect(() => {
    if (!isPlaying || project === null) return undefined;
    const interval = window.setInterval(() => {
      setPlayheadMsState((current) => {
        const endMs = clampPlayheadMs(project.timeline, Number.MAX_SAFE_INTEGER);
        const next = clampPlayheadMs(project.timeline, current + 100);
        if (next >= endMs) setIsPlaying(false);
        return next;
      });
    }, 100);
    return () => window.clearInterval(interval);
  }, [isPlaying, project]);

  return { activePlaybackClip, clampToTimeline, isPlaying, playheadMs, resetPlayback, setIsPlaying, setPlayheadMs };
}
