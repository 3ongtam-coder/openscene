import { describe, expect, it } from 'vitest';

import {
  migrateTimelineDocumentV1,
  migrateTimelineDocumentV2,
  parseCreateProjectInput,
  parseDeleteProjectInput,
  parseGetAssetPlaybackUrlInput,
  parseImportMediaInput,
  parseImportRecordingResultAssetInput,
  parseImportTtsResultAssetInput,
  parseListProjectsInput,
  parseOpenProjectInput,
  parseSaveTimelineInput,
  parseTimelineDocument,
  parseUpdateAssetMetadataInput
} from '../src/shared/timelineValidators';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';

const validClip = {
  id: 'clip-1',
  assetId: 'asset-1',
  timelineStartMs: 0,
  sourceStartMs: 0,
  sourceEndMs: 1_000,
  sourceDurationMs: 2_000,
  effects: DEFAULT_CLIP_EFFECTS,
  keyframes: []
};

const validTimeline = {
  schemaVersion: 3,
  tracks: [
    { id: 'video-track-1', name: 'Video 1', kind: 'video', clips: [validClip] },
    { id: 'audio-track-1', name: 'Audio 1', kind: 'audio', clips: [], mix: DEFAULT_AUDIO_TRACK_MIX }
  ],
  transitions: []
};

describe('project request validators', () => {
  it('parses a bounded trimmed project name and rejects malformed shapes', () => {
    // Given / When / Then
    expect(parseCreateProjectInput({ name: '  Product demo  ' })).toEqual({ name: 'Product demo' });
    expect(parseCreateProjectInput({ name: '' })).toBeNull();
    expect(parseCreateProjectInput({ name: 'x'.repeat(81) })).toBeNull();
    expect(parseCreateProjectInput({ name: 'Demo', unexpected: true })).toBeNull();
  });

  it('accepts only an empty list request', () => {
    // Given / When / Then
    expect(parseListProjectsInput(undefined)).toEqual({});
    expect(parseListProjectsInput({})).toEqual({});
    expect(parseListProjectsInput({ page: 1 })).toBeNull();
  });

  it('parses opaque project ids for open and delete', () => {
    // Given / When / Then
    expect(parseOpenProjectInput({ projectId: 'project_01' })).toEqual({ projectId: 'project_01' });
    expect(parseDeleteProjectInput({ projectId: 'project:01' })).toEqual({ projectId: 'project:01' });
    expect(parseOpenProjectInput({ projectId: 'project 01' })).toBeNull();
    expect(parseDeleteProjectInput({ projectId: '../project' })).toBeNull();
  });
});

describe('asset request validators', () => {
  it('parses imported media registered by project-relative path', () => {
    // Given
    const input = {
      projectId: 'project-1',
      displayName: '  Camera take  ',
      projectRelativePath: 'media/camera-take.webm',
      kind: 'video',
      mimeType: 'video/webm',
      byteLength: 1_024
    };

    // When / Then
    expect(parseImportMediaInput(input)).toEqual({ ...input, displayName: 'Camera take' });
  });

  it('rejects filesystem paths, traversal, invalid kinds, and invalid byte metadata', () => {
    // Given
    const base = {
      projectId: 'project-1',
      displayName: 'Camera take',
      kind: 'video',
      mimeType: 'video/webm',
      byteLength: 1_024
    };

    // When / Then
    expect(parseImportMediaInput({ ...base, projectRelativePath: '/Users/me/take.webm' })).toBeNull();
    expect(parseImportMediaInput({ ...base, projectRelativePath: 'C:/Users/me/take.webm' })).toBeNull();
    expect(parseImportMediaInput({ ...base, projectRelativePath: '../take.webm' })).toBeNull();
    expect(parseImportMediaInput({ ...base, projectRelativePath: 'media\\take.webm' })).toBeNull();
    expect(parseImportMediaInput({ ...base, projectRelativePath: 'media/take.webm', kind: 'image' })).toBeNull();
    expect(parseImportMediaInput({ ...base, projectRelativePath: 'media/take.webm', byteLength: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseImportMediaInput({ ...base, projectRelativePath: 'media/take.webm', byteLength: -1 })).toBeNull();
  });

  it('parses finite browser metadata with optional dimensions', () => {
    // Given / When
    const video = parseUpdateAssetMetadataInput({
      projectId: 'project-1',
      assetId: 'asset-1',
      durationMs: 1_234.5,
      width: 1_920,
      height: 1_080
    });
    const audio = parseUpdateAssetMetadataInput({ projectId: 'project-1', assetId: 'asset-2', durationMs: 500 });

    // Then
    expect(video).toEqual({ projectId: 'project-1', assetId: 'asset-1', durationMs: 1_234.5, width: 1_920, height: 1_080 });
    expect(audio).toEqual({ projectId: 'project-1', assetId: 'asset-2', durationMs: 500 });
    expect(parseUpdateAssetMetadataInput({ projectId: 'project-1', assetId: 'asset-1', durationMs: Number.NaN })).toBeNull();
    expect(parseUpdateAssetMetadataInput({ projectId: 'project-1', assetId: 'asset-1', durationMs: 1, width: -1 })).toBeNull();
  });

  it('requires known opaque project and asset ids for playback URLs', () => {
    // Given / When / Then
    expect(parseGetAssetPlaybackUrlInput({ projectId: 'project-1', assetId: 'asset-1' })).toEqual({
      projectId: 'project-1',
      assetId: 'asset-1'
    });
    expect(parseGetAssetPlaybackUrlInput({ projectId: 'project-1', assetId: '/tmp/media' })).toBeNull();
  });

  it('accepts only ID-only recording and TTS result import payloads', () => {
    expect(parseImportRecordingResultAssetInput({ projectId: 'project-1', sessionId: 'session_01' })).toEqual({
      projectId: 'project-1',
      sessionId: 'session_01'
    });
    expect(parseImportTtsResultAssetInput({ projectId: 'project-1', jobId: 'job_01' })).toEqual({
      projectId: 'project-1',
      jobId: 'job_01'
    });
    expect(parseImportRecordingResultAssetInput({ projectId: 'project-1', sessionId: 'session_01', outputPath: '/tmp/take.webm' })).toBeNull();
    expect(parseImportTtsResultAssetInput({ projectId: 'project-1', jobId: 'job_01', sourcePath: '/tmp/audio.wav' })).toBeNull();
  });
});

describe('timeline document validators', () => {
  it('parses save requests and canonicalizes clip ordering', () => {
    // Given
    const laterClip = { ...validClip, id: 'clip-2', assetId: 'asset-2', timelineStartMs: 2_000 };
    const unsorted = {
      ...validTimeline,
      tracks: [{ ...validTimeline.tracks[0], clips: [laterClip, validClip] }, validTimeline.tracks[1]]
    };

    // When
    const parsed = parseSaveTimelineInput({ projectId: 'project-1', timeline: unsorted });

    // Then
    expect(parsed?.timeline.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-1', 'clip-2']);
    expect(parseTimelineDocument(validTimeline)).toEqual(validTimeline);
  });

  it('rejects invalid source bounds, duplicate ids, overlap, and extra fields', () => {
    // Given
    const invalidBounds = { ...validClip, sourceEndMs: 2_001 };
    const overlap = { ...validClip, id: 'clip-2', timelineStartMs: 999 };
    const duplicateTrack = { ...validTimeline.tracks[1], id: 'video-track-1' };

    // When / Then
    expect(parseTimelineDocument({ ...validTimeline, tracks: [{ ...validTimeline.tracks[0], clips: [invalidBounds] }] })).toBeNull();
    expect(parseTimelineDocument({ ...validTimeline, tracks: [{ ...validTimeline.tracks[0], clips: [validClip, overlap] }] })).toBeNull();
    expect(parseTimelineDocument({ ...validTimeline, tracks: [validTimeline.tracks[0], duplicateTrack] })).toBeNull();
    expect(parseTimelineDocument({ ...validTimeline, unexpected: true })).toBeNull();
  });

  it('rejects malformed, out-of-range, and unknown clip effect fields', () => {
    // Given
    const withEffects = (effects: unknown) => ({
      ...validTimeline,
      tracks: [{ ...validTimeline.tracks[0], clips: [{ ...validClip, effects }] }]
    });

    // When / Then
    expect(parseTimelineDocument(withEffects({ ...DEFAULT_CLIP_EFFECTS, opacity: 1.01 }))).toBeNull();
    expect(parseTimelineDocument(withEffects({ ...DEFAULT_CLIP_EFFECTS, positionX: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(parseTimelineDocument(withEffects({ ...DEFAULT_CLIP_EFFECTS, volume: -0.01 }))).toBeNull();
    expect(parseTimelineDocument(withEffects({ ...DEFAULT_CLIP_EFFECTS, keyframes: [] }))).toBeNull();
    expect(parseTimelineDocument(withEffects({ opacity: 1 }))).toBeNull();
    expect(migrateTimelineDocumentV1({ ...validTimeline, schemaVersion: 1 })).toBeNull();
  });

  it('accepts clip effect boundaries and defaults clips to unity media volume', () => {
    // Given
    const boundaryEffects = {
      opacity: 0,
      scale: 2,
      positionX: -10_000,
      positionY: 10_000,
      rotation: 360,
      volume: 1
    };

    // When
    const parsed = parseTimelineDocument({
      ...validTimeline,
      tracks: [{ ...validTimeline.tracks[0], clips: [{ ...validClip, effects: boundaryEffects }] }]
    });

    // Then
    expect(parsed?.tracks[0]?.clips[0]?.effects).toEqual(boundaryEffects);
    expect(DEFAULT_CLIP_EFFECTS.volume).toBe(1);
  });

  it('canonicalizes bounded linear keyframes and rejects duplicate or invalid coordinates', () => {
    // Given
    const keyframes = [
      { timelineTimeMs: 750, property: 'opacity', value: 0.25, interpolation: 'linear' },
      { timelineTimeMs: 250, property: 'scale', value: 1.5, interpolation: 'linear' },
      { timelineTimeMs: 250, property: 'opacity', value: 0.75, interpolation: 'linear' }
    ];
    const withKeyframes = (value: unknown) => ({
      ...validTimeline,
      tracks: [{ ...validTimeline.tracks[0], clips: [{ ...validClip, keyframes: value }] }, validTimeline.tracks[1]]
    });

    // When
    const parsed = parseTimelineDocument(withKeyframes(keyframes));

    // Then
    expect(parsed?.tracks[0]?.clips[0]?.keyframes).toEqual([keyframes[2], keyframes[1], keyframes[0]]);
    expect(parseTimelineDocument(withKeyframes([...keyframes, keyframes[2]]))).toBeNull();
    expect(parseTimelineDocument(withKeyframes([{ ...keyframes[0], timelineTimeMs: 1_001 }]))).toBeNull();
    expect(parseTimelineDocument(withKeyframes([{ ...keyframes[0], value: 1.01 }]))).toBeNull();
    expect(parseTimelineDocument(withKeyframes([{ ...keyframes[0], interpolation: 'hold' }]))).toBeNull();
    expect(parseTimelineDocument(withKeyframes([{ ...keyframes[0], property: 'blur' }]))).toBeNull();
  });

  it('accepts explicit adjacent video transitions and rejects ambiguous transition regions', () => {
    // Given
    const clips = [validClip, { ...validClip, id: 'clip-2', assetId: 'asset-2', timelineStartMs: 1_000 }];
    const transition = { fromClipId: 'clip-1', toClipId: 'clip-2', type: 'crossfade', durationMs: 250 };
    const timeline = { ...validTimeline, tracks: [{ ...validTimeline.tracks[0], clips }, validTimeline.tracks[1]], transitions: [transition] };

    // When / Then
    expect(parseTimelineDocument(timeline)?.transitions).toEqual([transition]);
    expect(parseTimelineDocument({ ...timeline, transitions: [{ ...transition, durationMs: 1_001 }] })).toBeNull();
    expect(parseTimelineDocument({ ...timeline, transitions: [transition, transition] })).toBeNull();
    expect(parseTimelineDocument({ ...timeline, transitions: [{ ...transition, type: 'wipe' }] })).toBeNull();
    expect(parseTimelineDocument({
      ...timeline,
      tracks: [{ ...timeline.tracks[0], clips: [clips[0], { ...clips[1], timelineStartMs: 1_001 }] }, timeline.tracks[1]]
    })).toBeNull();
    const thirdClip = { ...validClip, id: 'clip-3', assetId: 'asset-3', timelineStartMs: 2_000 };
    expect(parseTimelineDocument({
      ...validTimeline,
      tracks: [{ ...validTimeline.tracks[0], clips: [...clips, thirdClip] }, validTimeline.tracks[1]],
      transitions: [
        { ...transition, durationMs: 600 },
        { fromClipId: 'clip-2', toClipId: 'clip-3', type: 'fade', durationMs: 600 }
      ]
    })).toBeNull();
  });

  it('requires bounded audio mix metadata only on audio tracks', () => {
    // Given
    const withMix = (mix: unknown) => ({
      ...validTimeline,
      tracks: [validTimeline.tracks[0], { ...validTimeline.tracks[1], mix }]
    });

    // When / Then
    expect(parseTimelineDocument(withMix({ gainDb: -60, pan: -1, muted: true }))?.tracks[1]).toMatchObject({
      mix: { gainDb: -60, pan: -1, muted: true }
    });
    expect(parseTimelineDocument(withMix({ gainDb: 12, pan: 1, muted: false }))).not.toBeNull();
    expect(parseTimelineDocument(withMix({ gainDb: -60.01, pan: 0, muted: false }))).toBeNull();
    expect(parseTimelineDocument(withMix({ gainDb: 0, pan: 1.01, muted: false }))).toBeNull();
    expect(parseTimelineDocument(withMix({ gainDb: 0, pan: 0, muted: 0 }))).toBeNull();
    expect(parseTimelineDocument({
      ...validTimeline,
      tracks: [{ ...validTimeline.tracks[0], mix: DEFAULT_AUDIO_TRACK_MIX }, validTimeline.tracks[1]]
    })).toBeNull();
  });

  it('migrates legacy clips with unity media volume', () => {
    // Given
    const legacyTimeline = {
      schemaVersion: 1,
      tracks: [{
        ...validTimeline.tracks[0],
        clips: [{
          id: validClip.id,
          assetId: validClip.assetId,
          timelineStartMs: validClip.timelineStartMs,
          sourceStartMs: validClip.sourceStartMs,
          sourceEndMs: validClip.sourceEndMs,
          sourceDurationMs: validClip.sourceDurationMs
        }]
      }]
    };

    // When
    const migrated = migrateTimelineDocumentV1(legacyTimeline);

    // Then
    expect(migrated?.tracks[0]?.clips[0]?.effects.volume).toBe(1);
    expect(migrated?.tracks[0]?.clips[0]?.keyframes).toEqual([]);
    expect(migrated?.transitions).toEqual([]);
  });

  it('migrates v2 clips and tracks with v3 local metadata defaults', () => {
    // Given
    const v2Timeline = {
      schemaVersion: 2,
      tracks: [
        {
          id: 'video-track-1',
          name: 'Video 1',
          kind: 'video',
          clips: [{
            id: validClip.id,
            assetId: validClip.assetId,
            timelineStartMs: validClip.timelineStartMs,
            sourceStartMs: validClip.sourceStartMs,
            sourceEndMs: validClip.sourceEndMs,
            sourceDurationMs: validClip.sourceDurationMs,
            effects: DEFAULT_CLIP_EFFECTS
          }]
        },
        { id: 'audio-track-1', name: 'Audio 1', kind: 'audio', clips: [] }
      ]
    };

    // When
    const migrated = migrateTimelineDocumentV2(v2Timeline);

    // Then
    expect(migrated).toMatchObject({
      schemaVersion: 3,
      transitions: [],
      tracks: [
        { kind: 'video', clips: [{ keyframes: [] }] },
        { kind: 'audio', mix: DEFAULT_AUDIO_TRACK_MIX }
      ]
    });
  });

  it('rejects collections beyond track and per-track clip limits', () => {
    // Given
    const tooManyTracks = Array.from({ length: 33 }, (_, index) => ({
      id: `track-${index}`,
      name: `Track ${index}`,
      kind: 'video',
      clips: []
    }));
    const tooManyClips = Array.from({ length: 501 }, (_, index) => ({
      ...validClip,
      id: `clip-${index}`,
      timelineStartMs: index * 1_000
    }));

    // When / Then
    expect(parseTimelineDocument({ schemaVersion: 3, tracks: tooManyTracks, transitions: [] })).toBeNull();
    expect(
      parseTimelineDocument({
        schemaVersion: 3,
        tracks: [{ id: 'video-track-1', name: 'Video 1', kind: 'video', clips: tooManyClips }],
        transitions: []
      })
    ).toBeNull();
  });
});
