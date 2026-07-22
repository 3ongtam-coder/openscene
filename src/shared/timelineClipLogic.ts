import { clipTimelineEndMs, sortTimelineClips } from './timelineClipGeometry';
import { clipEffectsEqual, hasOnlyClipEffectKeys, isValidClipEffects, normalizeClipEffects } from './timelineEffects';
import { pruneInvalidTransitions } from './timelineMetadataLogic';
import { parseClipKeyframes } from './timelineMetadataValidators';
import type {
  MoveClipInput,
  PlaceClipInput,
  PersistedTimelineClip,
  SplitClipInput,
  TimelineClip,
  TimelineDocument,
  TimelineTrack,
  TrimClipLeftInput,
  TrimClipRightInput,
  UpdateClipEffectsInput
} from './timelineTypes';

type LocatedClip = {
  readonly clip: PersistedTimelineClip;
  readonly track: TimelineTrack;
};

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isOpaqueId(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function normalizeClip(clip: TimelineClip): PersistedTimelineClip | null {
  const effects = normalizeClipEffects(clip.effects);
  if (effects === null) return null;
  const normalized = { ...clip, effects, keyframes: [] };
  const keyframes = parseClipKeyframes(clip.keyframes ?? [], normalized);
  return keyframes === null ? null : { ...normalized, keyframes };
}

function isValidClip(clip: PersistedTimelineClip): boolean {
  return (
    isOpaqueId(clip.id) &&
    isOpaqueId(clip.assetId) &&
    isFiniteNonNegative(clip.timelineStartMs) &&
    isFiniteNonNegative(clip.sourceStartMs) &&
    isFiniteNonNegative(clip.sourceEndMs) &&
    isFiniteNonNegative(clip.sourceDurationMs) &&
    clip.sourceEndMs > clip.sourceStartMs &&
    clip.sourceEndMs <= clip.sourceDurationMs &&
    isValidClipEffects(clip.effects) &&
    parseClipKeyframes(clip.keyframes, clip)?.length === clip.keyframes.length
  );
}

function findClip(timeline: TimelineDocument, clipId: string): LocatedClip | null {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip !== undefined) return { clip, track };
  }
  return null;
}

function hasClipId(timeline: TimelineDocument, clipId: string): boolean {
  return findClip(timeline, clipId) !== null;
}

function overlapsTrack(track: TimelineTrack, candidate: PersistedTimelineClip, excludedClipId?: string): boolean {
  const candidateEndMs = clipTimelineEndMs(candidate);
  return track.clips.some(
    (clip) => clip.id !== excludedClipId && candidate.timelineStartMs < clipTimelineEndMs(clip) && candidateEndMs > clip.timelineStartMs
  );
}

function replaceClip(timeline: TimelineDocument, located: LocatedClip, clip: PersistedTimelineClip): TimelineDocument | null {
  const boundedClip = {
    ...clip,
    keyframes: clip.keyframes.filter(
      (keyframe) => keyframe.timelineTimeMs >= clip.timelineStartMs && keyframe.timelineTimeMs <= clipTimelineEndMs(clip)
    )
  };
  if (!isValidClip(boundedClip) || overlapsTrack(located.track, boundedClip, located.clip.id)) return null;
  return pruneInvalidTransitions({
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === located.track.id
        ? { ...track, clips: sortTimelineClips(track.clips.map((current) => current.id === boundedClip.id ? boundedClip : current)) }
        : track
    )
  });
}

export function placeClip(timeline: TimelineDocument, input: PlaceClipInput): TimelineDocument | null {
  const track = timeline.tracks.find((candidate) => candidate.id === input.trackId);
  const clip = normalizeClip(input.clip);
  if (track === undefined || hasClipId(timeline, input.clip.id) || clip === null || !isValidClip(clip) || overlapsTrack(track, clip)) return null;
  return {
    ...timeline,
    tracks: timeline.tracks.map((candidate) =>
      candidate.id === track.id ? { ...candidate, clips: sortTimelineClips([...candidate.clips, clip]) } : candidate
    )
  };
}

export function moveClip(timeline: TimelineDocument, input: MoveClipInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  const targetTrack = timeline.tracks.find((track) => track.id === input.targetTrackId);
  if (located === null || targetTrack === undefined || !isFiniteNonNegative(input.timelineStartMs)) return null;
  if (located.track.id === targetTrack.id && located.clip.timelineStartMs === input.timelineStartMs) return timeline;
  const deltaMs = input.timelineStartMs - located.clip.timelineStartMs;
  const movedClip = {
    ...located.clip,
    timelineStartMs: input.timelineStartMs,
    keyframes: located.clip.keyframes.map((keyframe) => ({ ...keyframe, timelineTimeMs: keyframe.timelineTimeMs + deltaMs }))
  };
  if (overlapsTrack(targetTrack, movedClip, located.clip.id)) return null;
  return pruneInvalidTransitions({
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (track.id === located.track.id && track.id === targetTrack.id) {
        return { ...track, clips: sortTimelineClips(track.clips.map((clip) => clip.id === movedClip.id ? movedClip : clip)) };
      }
      if (track.id === located.track.id) return { ...track, clips: track.clips.filter((clip) => clip.id !== movedClip.id) };
      return track.id === targetTrack.id ? { ...track, clips: sortTimelineClips([...track.clips, movedClip]) } : track;
    })
  });
}

export function trimClipLeft(timeline: TimelineDocument, input: TrimClipLeftInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  if (located === null || !isFiniteNonNegative(input.timelineStartMs)) return null;
  if (located.clip.timelineStartMs === input.timelineStartMs) return timeline;
  const deltaMs = input.timelineStartMs - located.clip.timelineStartMs;
  return replaceClip(timeline, located, {
    ...located.clip,
    timelineStartMs: input.timelineStartMs,
    sourceStartMs: located.clip.sourceStartMs + deltaMs
  });
}

export function trimClipRight(timeline: TimelineDocument, input: TrimClipRightInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  if (located === null || !isFiniteNonNegative(input.timelineEndMs)) return null;
  const currentEndMs = clipTimelineEndMs(located.clip);
  if (currentEndMs === input.timelineEndMs) return timeline;
  return replaceClip(timeline, located, {
    ...located.clip,
    sourceEndMs: located.clip.sourceEndMs + input.timelineEndMs - currentEndMs
  });
}

export function updateClipEffects(timeline: TimelineDocument, input: UpdateClipEffectsInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  if (located === null || !hasOnlyClipEffectKeys(input.effects)) return null;
  const effects = { ...located.clip.effects, ...input.effects };
  if (!isValidClipEffects(effects)) return null;
  if (clipEffectsEqual(effects, located.clip.effects)) return timeline;
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === located.track.id
        ? { ...track, clips: track.clips.map((clip) => clip.id === located.clip.id ? { ...clip, effects } : clip) }
        : track
    )
  };
}

export function splitClip(timeline: TimelineDocument, input: SplitClipInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  if (
    located === null ||
    !isFiniteNonNegative(input.atMs) ||
    !isOpaqueId(input.rightClipId) ||
    hasClipId(timeline, input.rightClipId) ||
    input.atMs <= located.clip.timelineStartMs ||
    input.atMs >= clipTimelineEndMs(located.clip)
  ) return null;
  const sourceSplitMs = located.clip.sourceStartMs + input.atMs - located.clip.timelineStartMs;
  const leftClip = {
    ...located.clip,
    sourceEndMs: sourceSplitMs,
    keyframes: located.clip.keyframes.filter((keyframe) => keyframe.timelineTimeMs <= input.atMs)
  };
  const rightClip = {
    ...located.clip,
    id: input.rightClipId,
    timelineStartMs: input.atMs,
    sourceStartMs: sourceSplitMs,
    keyframes: located.clip.keyframes.filter((keyframe) => keyframe.timelineTimeMs >= input.atMs)
  };
  return pruneInvalidTransitions({
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === located.track.id
        ? { ...track, clips: sortTimelineClips(track.clips.flatMap((clip) => clip.id === located.clip.id ? [leftClip, rightClip] : [clip])) }
        : track
    ),
    transitions: timeline.transitions.map((transition) => ({
      ...transition,
      fromClipId: transition.fromClipId === located.clip.id ? rightClip.id : transition.fromClipId,
      toClipId: transition.toClipId === located.clip.id ? leftClip.id : transition.toClipId
    }))
  });
}

export function deleteClip(timeline: TimelineDocument, clipId: string): TimelineDocument {
  const located = findClip(timeline, clipId);
  if (located === null) return timeline;
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === located.track.id ? { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) } : track
    ),
    transitions: timeline.transitions.filter((transition) => transition.fromClipId !== clipId && transition.toClipId !== clipId)
  };
}
