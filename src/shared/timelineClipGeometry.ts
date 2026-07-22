import type { TimelineClip } from './timelineTypes';

export function clipDurationMs(clip: TimelineClip): number {
  return clip.sourceEndMs - clip.sourceStartMs;
}

export function clipTimelineEndMs(clip: TimelineClip): number {
  return clip.timelineStartMs + clipDurationMs(clip);
}

function compareClips(left: TimelineClip, right: TimelineClip): number {
  if (left.timelineStartMs !== right.timelineStartMs) {
    return left.timelineStartMs - right.timelineStartMs;
  }
  if (left.id < right.id) {
    return -1;
  }
  return left.id > right.id ? 1 : 0;
}

export function sortTimelineClips<T extends TimelineClip>(clips: readonly T[]): readonly T[] {
  return [...clips].sort(compareClips);
}
