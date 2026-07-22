import { isValidAudioTrackMix, isValidClipKeyframe, sortClipKeyframes, transitionsAreValid } from './timelineMetadataValidators';
import type {
  AddClipKeyframeInput,
  AudioTrackMix,
  PersistedTimelineClip,
  RemoveClipKeyframeInput,
  RemoveTransitionInput,
  TimelineDocument,
  TimelineTrack,
  TransitionDescriptor,
  UpdateAudioTrackMixInput,
  UpdateClipKeyframeInput
} from './timelineTypes';

type LocatedClip = {
  readonly clip: PersistedTimelineClip;
  readonly track: TimelineTrack;
};

function findClip(timeline: TimelineDocument, clipId: string): LocatedClip | null {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip !== undefined) return { clip, track };
  }
  return null;
}

function replaceClipMetadata(timeline: TimelineDocument, located: LocatedClip, clip: PersistedTimelineClip): TimelineDocument {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === located.track.id
        ? { ...track, clips: track.clips.map((candidate) => candidate.id === clip.id ? clip : candidate) }
        : track
    )
  };
}

function keyframeMatches(input: RemoveClipKeyframeInput, keyframe: PersistedTimelineClip['keyframes'][number]): boolean {
  return keyframe.property === input.property && keyframe.timelineTimeMs === input.timelineTimeMs;
}

export function addClipKeyframe(timeline: TimelineDocument, input: AddClipKeyframeInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  if (located === null || !isValidClipKeyframe(input.keyframe, located.clip)) return null;
  const existing = located.clip.keyframes.find(
    (keyframe) => keyframe.property === input.keyframe.property && keyframe.timelineTimeMs === input.keyframe.timelineTimeMs
  );
  if (
    existing?.value === input.keyframe.value &&
    existing.interpolation === input.keyframe.interpolation
  ) return timeline;
  const keyframes = sortClipKeyframes([
    ...located.clip.keyframes.filter(
      (keyframe) => keyframe.property !== input.keyframe.property || keyframe.timelineTimeMs !== input.keyframe.timelineTimeMs
    ),
    input.keyframe
  ]);
  return replaceClipMetadata(timeline, located, { ...located.clip, keyframes });
}

export function removeClipKeyframe(timeline: TimelineDocument, input: RemoveClipKeyframeInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  if (located === null || !Number.isFinite(input.timelineTimeMs)) return null;
  const keyframes = located.clip.keyframes.filter((keyframe) => !keyframeMatches(input, keyframe));
  return keyframes.length === located.clip.keyframes.length
    ? timeline
    : replaceClipMetadata(timeline, located, { ...located.clip, keyframes });
}

export function updateClipKeyframe(timeline: TimelineDocument, input: UpdateClipKeyframeInput): TimelineDocument | null {
  const located = findClip(timeline, input.clipId);
  if (
    located === null ||
    !located.clip.keyframes.some((keyframe) => keyframeMatches(input, keyframe)) ||
    !isValidClipKeyframe(input.keyframe, located.clip)
  ) return null;
  const keyframes = sortClipKeyframes([
    ...located.clip.keyframes.filter(
      (keyframe) => !keyframeMatches(input, keyframe) &&
        (keyframe.property !== input.keyframe.property || keyframe.timelineTimeMs !== input.keyframe.timelineTimeMs)
    ),
    input.keyframe
  ]);
  return replaceClipMetadata(timeline, located, { ...located.clip, keyframes });
}

function transitionsEqual(left: TransitionDescriptor, right: TransitionDescriptor): boolean {
  return left.fromClipId === right.fromClipId && left.toClipId === right.toClipId && left.type === right.type && left.durationMs === right.durationMs;
}

export function setTransition(timeline: TimelineDocument, transition: TransitionDescriptor): TimelineDocument | null {
  const transitions = [
    ...timeline.transitions.filter(
      (candidate) => candidate.fromClipId !== transition.fromClipId || candidate.toClipId !== transition.toClipId
    ),
    transition
  ].sort((left, right) => left.fromClipId.localeCompare(right.fromClipId) || left.toClipId.localeCompare(right.toClipId));
  if (!transitionsAreValid(transitions, timeline.tracks)) return null;
  const existing = timeline.transitions.find(
    (candidate) => candidate.fromClipId === transition.fromClipId && candidate.toClipId === transition.toClipId
  );
  return existing !== undefined && transitionsEqual(existing, transition) ? timeline : { ...timeline, transitions };
}

export function removeTransition(timeline: TimelineDocument, input: RemoveTransitionInput): TimelineDocument {
  const transitions = timeline.transitions.filter(
    (transition) => transition.fromClipId !== input.fromClipId || transition.toClipId !== input.toClipId
  );
  return transitions.length === timeline.transitions.length ? timeline : { ...timeline, transitions };
}

export function pruneInvalidTransitions(timeline: TimelineDocument): TimelineDocument {
  const transitions = timeline.transitions.filter((transition) => transitionsAreValid([transition], timeline.tracks));
  if (transitionsAreValid(transitions, timeline.tracks)) return transitions.length === timeline.transitions.length ? timeline : { ...timeline, transitions };
  const accepted: TransitionDescriptor[] = [];
  for (const transition of transitions) {
    if (transitionsAreValid([...accepted, transition], timeline.tracks)) accepted.push(transition);
  }
  return { ...timeline, transitions: accepted };
}

function hasOnlyMixKeys(mix: Partial<AudioTrackMix>): boolean {
  return Object.keys(mix).every((key) => key === 'gainDb' || key === 'pan' || key === 'muted');
}

export function updateAudioTrackMix(timeline: TimelineDocument, input: UpdateAudioTrackMixInput): TimelineDocument | null {
  const track = timeline.tracks.find((candidate) => candidate.id === input.trackId);
  if (track === undefined || track.kind !== 'audio' || !hasOnlyMixKeys(input.mix)) return null;
  const mix = { ...track.mix, ...input.mix };
  if (!isValidAudioTrackMix(mix)) return null;
  if (mix.gainDb === track.mix.gainDb && mix.pan === track.mix.pan && mix.muted === track.mix.muted) return timeline;
  return { ...timeline, tracks: timeline.tracks.map((candidate) => candidate.id === track.id ? { ...track, mix } : candidate) };
}
