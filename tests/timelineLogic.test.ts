import { describe, expect, it } from 'vitest';

import {
  INITIAL_AUDIO_TRACK_ID,
  INITIAL_VIDEO_TRACK_ID,
  addClipKeyframe,
  addTrack,
  createInitialTimeline,
  deleteClip,
  moveClip,
  placeClip,
  removeClipKeyframe,
  removeTransition,
  setTransition,
  splitClip,
  timelineDurationMs,
  trimClipLeft,
  trimClipRight,
  updateAudioTrackMix,
  updateClipEffects,
  updateClipKeyframe
} from '../src/shared/timelineLogic';
import {
  DEFAULT_AUDIO_TRACK_MIX,
  DEFAULT_CLIP_EFFECTS,
  type TimelineClip,
  type TimelineDocument,
  type TimelineTrack
} from '../src/shared/timelineTypes';

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    assetId: 'asset-1',
    timelineStartMs: 0,
    sourceStartMs: 0,
    sourceEndMs: 1_000,
    sourceDurationMs: 5_000,
    keyframes: [],
    ...overrides
  };
}

function requireTrack(timeline: TimelineDocument, trackId: string): TimelineTrack {
  const track = timeline.tracks.find((candidate) => candidate.id === trackId);
  if (track === undefined) {
    throw new Error(`Missing test track ${trackId}`);
  }
  return track;
}

function requireTimeline(result: TimelineDocument | null): TimelineDocument {
  if (result === null) {
    throw new Error('Expected timeline edit to succeed');
  }
  return result;
}

describe('timeline creation and duration', () => {
  it('creates deterministic empty video and audio tracks', () => {
    // Given / When
    const timeline = createInitialTimeline();

    // Then
    expect(timeline).toEqual({
      schemaVersion: 3,
      tracks: [
        { id: INITIAL_VIDEO_TRACK_ID, name: 'Video 1', kind: 'video', clips: [] },
        { id: INITIAL_AUDIO_TRACK_ID, name: 'Audio 1', kind: 'audio', clips: [], mix: DEFAULT_AUDIO_TRACK_MIX }
      ],
      transitions: []
    });
    expect(createInitialTimeline()).not.toBe(timeline);
  });

  it('adds, updates, sorts, deduplicates, and removes bounded clip keyframes immutably', () => {
    // Given
    const timeline = requireTimeline(placeClip(createInitialTimeline(), { trackId: INITIAL_VIDEO_TRACK_ID, clip: makeClip() }));
    const later = { timelineTimeMs: 750, property: 'opacity', value: 0.25, interpolation: 'linear' } as const;
    const earlier = { timelineTimeMs: 250, property: 'opacity', value: 0.75, interpolation: 'linear' } as const;

    // When
    const withLater = requireTimeline(addClipKeyframe(timeline, { clipId: 'clip-1', keyframe: later }));
    const withBoth = requireTimeline(addClipKeyframe(withLater, { clipId: 'clip-1', keyframe: earlier }));
    const replaced = requireTimeline(addClipKeyframe(withBoth, { clipId: 'clip-1', keyframe: { ...earlier, value: 0.5 } }));
    const updated = requireTimeline(updateClipKeyframe(replaced, {
      clipId: 'clip-1',
      property: 'opacity',
      timelineTimeMs: 750,
      keyframe: { ...later, timelineTimeMs: 500, value: 0.4 }
    }));
    const removed = requireTimeline(removeClipKeyframe(updated, { clipId: 'clip-1', property: 'opacity', timelineTimeMs: 250 }));

    // Then
    expect(requireTrack(withBoth, INITIAL_VIDEO_TRACK_ID).clips[0]?.keyframes).toEqual([earlier, later]);
    expect(requireTrack(replaced, INITIAL_VIDEO_TRACK_ID).clips[0]?.keyframes).toHaveLength(2);
    expect(requireTrack(removed, INITIAL_VIDEO_TRACK_ID).clips[0]?.keyframes).toEqual([{ ...later, timelineTimeMs: 500, value: 0.4 }]);
    expect(requireTrack(timeline, INITIAL_VIDEO_TRACK_ID).clips[0]?.keyframes).toEqual([]);
    expect(addClipKeyframe(timeline, { clipId: 'clip-1', keyframe: { ...later, timelineTimeMs: 1_001 } })).toBeNull();
  });

  it('sets and removes transitions only across adjacent clips on one video track', () => {
    // Given
    const first = requireTimeline(placeClip(createInitialTimeline(), { trackId: INITIAL_VIDEO_TRACK_ID, clip: makeClip() }));
    const timeline = requireTimeline(placeClip(first, {
      trackId: INITIAL_VIDEO_TRACK_ID,
      clip: makeClip({
        id: 'clip-2',
        assetId: 'asset-2',
        timelineStartMs: 1_000,
        keyframes: [{ timelineTimeMs: 1_250, property: 'opacity', value: 0.5, interpolation: 'linear' }]
      })
    }));
    const transition = { fromClipId: 'clip-1', toClipId: 'clip-2', type: 'crossfade', durationMs: 250 } as const;

    // When
    const transitioned = requireTimeline(setTransition(timeline, transition));
    const removed = removeTransition(transitioned, { fromClipId: 'clip-1', toClipId: 'clip-2' });

    // Then
    expect(transitioned.transitions).toEqual([transition]);
    expect(removed.transitions).toEqual([]);
    expect(timeline.transitions).toEqual([]);
    expect(setTransition(timeline, { ...transition, durationMs: 1_001 })).toBeNull();
    expect(setTransition(timeline, { ...transition, toClipId: 'clip-1' })).toBeNull();
    const moved = requireTimeline(moveClip(transitioned, {
      clipId: 'clip-2',
      targetTrackId: INITIAL_VIDEO_TRACK_ID,
      timelineStartMs: 1_100
    }));
    expect(moved.transitions).toEqual([]);
    expect(requireTrack(moved, INITIAL_VIDEO_TRACK_ID).clips[1]?.keyframes[0]?.timelineTimeMs).toBe(1_350);
  });

  it('updates bounded mix controls only on audio tracks', () => {
    // Given
    const timeline = createInitialTimeline();

    // When
    const updated = requireTimeline(updateAudioTrackMix(timeline, {
      trackId: INITIAL_AUDIO_TRACK_ID,
      mix: { gainDb: -6, pan: 0.5, muted: true }
    }));

    // Then
    expect(requireTrack(updated, INITIAL_AUDIO_TRACK_ID)).toMatchObject({ mix: { gainDb: -6, pan: 0.5, muted: true } });
    expect(requireTrack(timeline, INITIAL_AUDIO_TRACK_ID)).toMatchObject({ mix: DEFAULT_AUDIO_TRACK_MIX });
    expect(updateAudioTrackMix(timeline, { trackId: INITIAL_VIDEO_TRACK_ID, mix: { muted: true } })).toBeNull();
    expect(updateAudioTrackMix(timeline, { trackId: INITIAL_AUDIO_TRACK_ID, mix: { pan: 1.01 } })).toBeNull();
  });

  it('uses the latest clip end across all tracks as timeline duration', () => {
    // Given
    const video = requireTimeline(placeClip(createInitialTimeline(), { trackId: INITIAL_VIDEO_TRACK_ID, clip: makeClip() }));
    const timeline = requireTimeline(
      placeClip(video, {
        trackId: INITIAL_AUDIO_TRACK_ID,
        clip: makeClip({ id: 'clip-2', assetId: 'asset-2', timelineStartMs: 800, sourceEndMs: 2_000 })
      })
    );

    // When / Then
    expect(timelineDurationMs(createInitialTimeline())).toBe(0);
    expect(timelineDurationMs(timeline)).toBe(2_800);
  });
});

describe('clip placement and movement', () => {
  it('places clips without mutating input and orders them by start then id', () => {
    // Given
    const original = createInitialTimeline();

    // When
    const later = requireTimeline(
      placeClip(original, { trackId: INITIAL_VIDEO_TRACK_ID, clip: makeClip({ id: 'clip-b', timelineStartMs: 2_000 }) })
    );
    const timeline = requireTimeline(
      placeClip(later, { trackId: INITIAL_VIDEO_TRACK_ID, clip: makeClip({ id: 'clip-a', timelineStartMs: 1_000 }) })
    );

    // Then
    expect(requireTrack(timeline, INITIAL_VIDEO_TRACK_ID).clips.map((clip) => clip.id)).toEqual(['clip-a', 'clip-b']);
    expect(requireTrack(timeline, INITIAL_VIDEO_TRACK_ID).clips.map((clip) => clip.effects)).toEqual([
      DEFAULT_CLIP_EFFECTS,
      DEFAULT_CLIP_EFFECTS
    ]);
    expect(requireTrack(original, INITIAL_VIDEO_TRACK_ID).clips).toEqual([]);
  });

  it('updates effects on one existing clip without changing timing, tracks, or the input timeline', () => {
    // Given
    const first = requireTimeline(
      placeClip(createInitialTimeline(), { trackId: INITIAL_VIDEO_TRACK_ID, clip: makeClip() })
    );
    const timeline = requireTimeline(
      placeClip(first, {
        trackId: INITIAL_VIDEO_TRACK_ID,
        clip: makeClip({ id: 'clip-2', assetId: 'asset-2', timelineStartMs: 2_000 })
      })
    );

    // When
    const updated = requireTimeline(
      updateClipEffects(timeline, {
        clipId: 'clip-2',
        effects: { opacity: 0.4, positionX: -320, rotation: 270, volume: 1 }
      })
    );

    // Then
    const originalClips = requireTrack(timeline, INITIAL_VIDEO_TRACK_ID).clips;
    const updatedClips = requireTrack(updated, INITIAL_VIDEO_TRACK_ID).clips;
    expect(updatedClips[0]).toBe(originalClips[0]);
    expect(updatedClips[1]).toEqual({
      ...originalClips[1],
      effects: { ...DEFAULT_CLIP_EFFECTS, opacity: 0.4, positionX: -320, rotation: 270, volume: 1 }
    });
    expect(originalClips[1]?.effects).toEqual(DEFAULT_CLIP_EFFECTS);
    expect(updateClipEffects(timeline, { clipId: 'missing', effects: { scale: 2 } })).toBeNull();
    expect(updateClipEffects(timeline, { clipId: 'clip-1', effects: { positionY: 10_001 } })).toBeNull();
    expect(updateClipEffects(timeline, { clipId: 'clip-1', effects: { opacity: 1 } })).toBe(timeline);
    const effectsWithUnknownKey = { opacity: 0.5, keyframes: [] };
    expect(updateClipEffects(timeline, { clipId: 'clip-1', effects: effectsWithUnknownKey })).toBeNull();
  });

  it('rejects same-track overlap while allowing adjacency and cross-track overlap', () => {
    // Given
    const placed = requireTimeline(
      placeClip(createInitialTimeline(), { trackId: INITIAL_VIDEO_TRACK_ID, clip: makeClip() })
    );

    // When / Then
    expect(
      placeClip(placed, {
        trackId: INITIAL_VIDEO_TRACK_ID,
        clip: makeClip({ id: 'overlap', timelineStartMs: 999 })
      })
    ).toBeNull();
    expect(
      placeClip(placed, {
        trackId: INITIAL_VIDEO_TRACK_ID,
        clip: makeClip({ id: 'adjacent', timelineStartMs: 1_000 })
      })
    ).not.toBeNull();
    expect(
      placeClip(placed, {
        trackId: INITIAL_AUDIO_TRACK_ID,
        clip: makeClip({ id: 'cross-track' })
      })
    ).not.toBeNull();
  });

  it('moves clips within and across tracks but rejects collisions', () => {
    // Given
    const first = requireTimeline(
      placeClip(createInitialTimeline(), { trackId: INITIAL_VIDEO_TRACK_ID, clip: makeClip() })
    );
    const timeline = requireTimeline(
      placeClip(first, {
        trackId: INITIAL_VIDEO_TRACK_ID,
        clip: makeClip({ id: 'clip-2', timelineStartMs: 2_000 })
      })
    );

    // When
    const moved = requireTimeline(
      moveClip(timeline, { clipId: 'clip-1', targetTrackId: INITIAL_AUDIO_TRACK_ID, timelineStartMs: 2_000 })
    );

    // Then
    expect(requireTrack(moved, INITIAL_VIDEO_TRACK_ID).clips.map((clip) => clip.id)).toEqual(['clip-2']);
    expect(requireTrack(moved, INITIAL_AUDIO_TRACK_ID).clips.map((clip) => clip.id)).toEqual(['clip-1']);
    expect(moveClip(timeline, { clipId: 'clip-1', targetTrackId: INITIAL_VIDEO_TRACK_ID, timelineStartMs: 1_500 })).toBeNull();
    expect(moveClip(timeline, { clipId: 'clip-1', targetTrackId: INITIAL_VIDEO_TRACK_ID, timelineStartMs: 0 })).toBe(timeline);
  });
});

describe('clip trimming', () => {
  it('trims or extends the left edge without crossing source start', () => {
    // Given
    const timeline = requireTimeline(
      placeClip(createInitialTimeline(), {
        trackId: INITIAL_VIDEO_TRACK_ID,
        clip: makeClip({ timelineStartMs: 1_000, sourceStartMs: 500, sourceEndMs: 2_500 })
      })
    );

    // When
    const extended = requireTimeline(trimClipLeft(timeline, { clipId: 'clip-1', timelineStartMs: 500 }));
    const trimmed = requireTimeline(trimClipLeft(timeline, { clipId: 'clip-1', timelineStartMs: 1_500 }));

    // Then
    expect(requireTrack(extended, INITIAL_VIDEO_TRACK_ID).clips[0]).toMatchObject({ timelineStartMs: 500, sourceStartMs: 0 });
    expect(requireTrack(trimmed, INITIAL_VIDEO_TRACK_ID).clips[0]).toMatchObject({ timelineStartMs: 1_500, sourceStartMs: 1_000 });
    expect(trimClipLeft(timeline, { clipId: 'clip-1', timelineStartMs: 499 })).toBeNull();
    expect(trimClipLeft(timeline, { clipId: 'clip-1', timelineStartMs: 3_000 })).toBeNull();
  });

  it('trims or extends the right edge without crossing source duration', () => {
    // Given
    const timeline = requireTimeline(
      placeClip(createInitialTimeline(), {
        trackId: INITIAL_VIDEO_TRACK_ID,
        clip: makeClip({ timelineStartMs: 1_000, sourceStartMs: 500, sourceEndMs: 2_500, sourceDurationMs: 3_000 })
      })
    );

    // When
    const extended = requireTimeline(trimClipRight(timeline, { clipId: 'clip-1', timelineEndMs: 3_500 }));
    const trimmed = requireTimeline(trimClipRight(timeline, { clipId: 'clip-1', timelineEndMs: 2_000 }));

    // Then
    expect(requireTrack(extended, INITIAL_VIDEO_TRACK_ID).clips[0]?.sourceEndMs).toBe(3_000);
    expect(requireTrack(trimmed, INITIAL_VIDEO_TRACK_ID).clips[0]?.sourceEndMs).toBe(1_500);
    expect(trimClipRight(timeline, { clipId: 'clip-1', timelineEndMs: 3_501 })).toBeNull();
    expect(trimClipRight(timeline, { clipId: 'clip-1', timelineEndMs: 1_000 })).toBeNull();
  });
});

describe('clip splitting, deletion, and tracks', () => {
  it('splits only strictly inside a clip and keeps source ranges contiguous', () => {
    // Given
    const timeline = requireTimeline(
      placeClip(createInitialTimeline(), {
        trackId: INITIAL_VIDEO_TRACK_ID,
        clip: makeClip({
          timelineStartMs: 1_000,
          sourceStartMs: 500,
          sourceEndMs: 2_500,
          effects: { ...DEFAULT_CLIP_EFFECTS, opacity: 0.5, scale: 1.25, volume: 0.25 },
          keyframes: [{ timelineTimeMs: 2_000, property: 'opacity', value: 0.75, interpolation: 'linear' }]
        })
      })
    );

    // When
    const split = requireTimeline(splitClip(timeline, { clipId: 'clip-1', atMs: 2_000, rightClipId: 'clip-right' }));

    // Then
    expect(requireTrack(split, INITIAL_VIDEO_TRACK_ID).clips).toEqual([
      makeClip({
        timelineStartMs: 1_000,
        sourceStartMs: 500,
        sourceEndMs: 1_500,
        effects: { ...DEFAULT_CLIP_EFFECTS, opacity: 0.5, scale: 1.25, volume: 0.25 },
        keyframes: [{ timelineTimeMs: 2_000, property: 'opacity', value: 0.75, interpolation: 'linear' }]
      }),
      makeClip({
        id: 'clip-right',
        timelineStartMs: 2_000,
        sourceStartMs: 1_500,
        sourceEndMs: 2_500,
        effects: { ...DEFAULT_CLIP_EFFECTS, opacity: 0.5, scale: 1.25, volume: 0.25 },
        keyframes: [{ timelineTimeMs: 2_000, property: 'opacity', value: 0.75, interpolation: 'linear' }]
      })
    ]);
    expect(splitClip(timeline, { clipId: 'clip-1', atMs: 1_000, rightClipId: 'right-a' })).toBeNull();
    expect(splitClip(timeline, { clipId: 'clip-1', atMs: 3_000, rightClipId: 'right-b' })).toBeNull();
    expect(splitClip(timeline, { clipId: 'clip-1', atMs: 2_000, rightClipId: '  ' })).toBeNull();
  });

  it('deletes an existing clip and treats a missing clip as a no-op', () => {
    // Given
    const timeline = requireTimeline(
      placeClip(createInitialTimeline(), { trackId: INITIAL_VIDEO_TRACK_ID, clip: makeClip() })
    );

    // When
    const deleted = deleteClip(timeline, 'clip-1');

    // Then
    expect(requireTrack(deleted, INITIAL_VIDEO_TRACK_ID).clips).toEqual([]);
    expect(deleteClip(timeline, 'missing')).toBe(timeline);
  });

  it('appends empty tracks deterministically and rejects duplicate ids', () => {
    // Given
    const timeline = createInitialTimeline();

    // When
    const added = requireTimeline(addTrack(timeline, { id: 'video-track-2', name: 'Video 2', kind: 'video' }));

    // Then
    expect(added.tracks.map((track) => track.id)).toEqual([
      INITIAL_VIDEO_TRACK_ID,
      INITIAL_AUDIO_TRACK_ID,
      'video-track-2'
    ]);
    expect(addTrack(added, { id: INITIAL_VIDEO_TRACK_ID, name: 'Duplicate', kind: 'video' })).toBeNull();
    expect(addTrack(added, { id: 'track 3', name: 'Invalid ID', kind: 'video' })).toBeNull();
  });
});
