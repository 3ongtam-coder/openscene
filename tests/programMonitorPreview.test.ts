import { describe, expect, it } from 'vitest';

import { buildProgramMonitorPreview } from '../src/renderer/src/editor/programMonitorPreview';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS, type MediaAsset, type PersistedTimelineClip, type TimelineDocument } from '../src/shared/timelineTypes';

function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset-1',
    displayName: 'clip.webm',
    projectRelativePath: 'assets/asset-1/original.webm',
    kind: 'video',
    mimeType: 'video/webm',
    byteLength: 100,
    metadata: { durationMs: 2_000, width: 1920, height: 1080 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function makeClip(overrides: Partial<PersistedTimelineClip> = {}): PersistedTimelineClip {
  return {
    id: 'clip-1',
    assetId: 'asset-1',
    timelineStartMs: 0,
    sourceStartMs: 0,
    sourceEndMs: 2_000,
    sourceDurationMs: 2_000,
    effects: DEFAULT_CLIP_EFFECTS,
    keyframes: [],
    ...overrides
  };
}

function makeTimeline(overrides: Partial<TimelineDocument> = {}): TimelineDocument {
  return {
    schemaVersion: 3,
    tracks: [
      { id: 'video-track-1', name: 'Video 1', kind: 'video', clips: [] },
      { id: 'audio-track-1', name: 'Audio 1', kind: 'audio', clips: [], mix: DEFAULT_AUDIO_TRACK_MIX }
    ],
    transitions: [],
    ...overrides
  };
}

describe('program monitor preview evaluation', () => {
  it('linearly evaluates clip effect keyframes at the current playhead', () => {
    // Given
    const clip = makeClip({
      effects: { ...DEFAULT_CLIP_EFFECTS, opacity: 1, scale: 1 },
      keyframes: [
        { timelineTimeMs: 0, property: 'opacity', value: 1, interpolation: 'linear' },
        { timelineTimeMs: 1_000, property: 'opacity', value: 0.25, interpolation: 'linear' },
        { timelineTimeMs: 0, property: 'scale', value: 1, interpolation: 'linear' },
        { timelineTimeMs: 1_000, property: 'scale', value: 1.5, interpolation: 'linear' }
      ]
    });
    const timeline = makeTimeline({ tracks: [{ id: 'video-track-1', name: 'Video 1', kind: 'video', clips: [clip] }] });

    // When
    const preview = buildProgramMonitorPreview({ assets: [makeAsset()], playheadMs: 500, timeline });

    // Then
    expect(preview.primaryVisualLayer?.effects.opacity).toBeCloseTo(0.625);
    expect(preview.primaryVisualLayer?.effects.scale).toBeCloseTo(1.25);
  });

  it('applies fade, crossfade, and dip-to-black transition factors around adjacent video clips', () => {
    // Given
    const firstClip = makeClip({ id: 'clip-1', assetId: 'asset-1', timelineStartMs: 0, sourceEndMs: 1_000 });
    const secondClip = makeClip({ id: 'clip-2', assetId: 'asset-2', timelineStartMs: 1_000, sourceEndMs: 2_000 });
    const tracks = [{ id: 'video-track-1', name: 'Video 1', kind: 'video', clips: [firstClip, secondClip] }] as const;
    const assets = [makeAsset(), makeAsset({ id: 'asset-2', displayName: 'next.webm' })];

    // When
    const fadePreview = buildProgramMonitorPreview({
      assets,
      playheadMs: 875,
      timeline: makeTimeline({ tracks, transitions: [{ fromClipId: 'clip-1', toClipId: 'clip-2', type: 'fade', durationMs: 500 }] })
    });
    const crossfadePreview = buildProgramMonitorPreview({
      assets,
      playheadMs: 1_125,
      timeline: makeTimeline({ tracks, transitions: [{ fromClipId: 'clip-1', toClipId: 'clip-2', type: 'crossfade', durationMs: 500 }] })
    });
    const dipPreview = buildProgramMonitorPreview({
      assets,
      playheadMs: 1_000,
      timeline: makeTimeline({ tracks, transitions: [{ fromClipId: 'clip-1', toClipId: 'clip-2', type: 'dipToBlack', durationMs: 500 }] })
    });

    // Then
    expect(fadePreview.primaryVisualLayer?.effects.opacity).toBeCloseTo(0.5);
    expect(crossfadePreview.primaryVisualLayer?.effects.opacity).toBeCloseTo(0.5);
    expect(dipPreview.blackOpacity).toBe(1);
  });

  it('mixes active audio clips with clip volume, track gain, pan, and mute', () => {
    // Given
    const leftClip = makeClip({
      id: 'clip-left',
      assetId: 'asset-left',
      effects: { ...DEFAULT_CLIP_EFFECTS, volume: 0.5 }
    });
    const mutedClip = makeClip({ id: 'clip-muted', assetId: 'asset-muted' });
    const timeline = makeTimeline({
      tracks: [
        { id: 'audio-left', name: 'Left', kind: 'audio', clips: [leftClip], mix: { gainDb: -6, pan: -1, muted: false } },
        { id: 'audio-muted', name: 'Muted', kind: 'audio', clips: [mutedClip], mix: { gainDb: 12, pan: 1, muted: true } }
      ]
    });

    // When
    const preview = buildProgramMonitorPreview({
      assets: [
        makeAsset({ id: 'asset-left', kind: 'audio', displayName: 'left.wav', metadata: { durationMs: 2_000 } }),
        makeAsset({ id: 'asset-muted', kind: 'audio', displayName: 'muted.wav', metadata: { durationMs: 2_000 } })
      ],
      playheadMs: 500,
      timeline
    });

    // Then
    expect(preview.audioLayers).toHaveLength(2);
    expect(preview.audioLayers[0]?.mediaVolume).toBeCloseTo(0.2506, 3);
    expect(preview.audioLayers[0]?.leftGain).toBeCloseTo(0.2506, 3);
    expect(preview.audioLayers[0]?.rightGain).toBe(0);
    expect(preview.audioLayers[1]?.mediaVolume).toBe(0);
    expect(preview.meterLeft).toBeCloseTo(0.2506, 3);
    expect(preview.meterRight).toBe(0);
  });
});
