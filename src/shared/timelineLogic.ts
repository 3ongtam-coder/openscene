import type { AddTrackInput, TimelineDocument, TimelineTrack } from './timelineTypes';
import { clipTimelineEndMs } from './timelineClipGeometry';
import { DEFAULT_AUDIO_TRACK_MIX, TIMELINE_SCHEMA_VERSION } from './timelineTypes';

export { clipDurationMs, clipTimelineEndMs } from './timelineClipGeometry';
export {
  deleteClip,
  moveClip,
  placeClip,
  splitClip,
  trimClipLeft,
  trimClipRight,
  updateClipEffects
} from './timelineClipLogic';
export {
  addClipKeyframe,
  removeClipKeyframe,
  removeTransition,
  setTransition,
  updateAudioTrackMix,
  updateClipKeyframe
} from './timelineMetadataLogic';

export const INITIAL_VIDEO_TRACK_ID = 'video-track-1' as const;
export const INITIAL_AUDIO_TRACK_ID = 'audio-track-1' as const;

export function createInitialTimeline(): TimelineDocument {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    tracks: [
      { id: INITIAL_VIDEO_TRACK_ID, name: 'Video 1', kind: 'video', clips: [] },
      { id: INITIAL_AUDIO_TRACK_ID, name: 'Audio 1', kind: 'audio', clips: [], mix: { ...DEFAULT_AUDIO_TRACK_MIX } }
    ],
    transitions: []
  };
}

export function timelineDurationMs(timeline: TimelineDocument): number {
  let durationMs = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) durationMs = Math.max(durationMs, clipTimelineEndMs(clip));
  }
  return durationMs;
}

export function addTrack(timeline: TimelineDocument, input: AddTrackInput): TimelineDocument | null {
  const name = input.name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(input.id) || input.id.length > 128 || name.length === 0 || name.length > 80 || timeline.tracks.some((track) => track.id === input.id)) {
    return null;
  }
  const track: TimelineTrack = input.kind === 'video'
    ? { ...input, kind: 'video', name, clips: [] }
    : { ...input, kind: 'audio', name, clips: [], mix: { ...DEFAULT_AUDIO_TRACK_MIX } };
  return { ...timeline, tracks: [...timeline.tracks, track] };
}
