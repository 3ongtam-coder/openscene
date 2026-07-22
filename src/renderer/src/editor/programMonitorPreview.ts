import { clipTimelineEndMs } from '../../../shared/timelineLogic';
import { CLIP_EFFECT_PROPERTIES, DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS } from '../../../shared/timelineTypes';
import type {
  AudioTrackMix,
  ClipEffectProperty,
  ClipEffects,
  ClipKeyframe,
  MediaAsset,
  PersistedTimelineClip,
  TimelineDocument,
  TimelineTrack,
  TransitionDescriptor
} from '../../../shared/timelineTypes';

type ProgramMonitorPreviewInput = {
  readonly assets: readonly MediaAsset[];
  readonly playheadMs: number;
  readonly timeline: TimelineDocument;
};

export type ProgramMonitorVisualLayer = {
  readonly asset: MediaAsset | null;
  readonly clip: PersistedTimelineClip;
  readonly effects: ClipEffects;
  readonly sourceTimeMs: number;
  readonly trackId: string;
};

export type ProgramMonitorAudioLayer = {
  readonly asset: MediaAsset | null;
  readonly clip: PersistedTimelineClip;
  readonly leftGain: number;
  readonly mediaVolume: number;
  readonly rightGain: number;
  readonly sourceTimeMs: number;
  readonly trackId: string;
};

export type ProgramMonitorPreview = {
  readonly audioLayers: readonly ProgramMonitorAudioLayer[];
  readonly blackOpacity: number;
  readonly meterLeft: number;
  readonly meterRight: number;
  readonly primaryVisualLayer: ProgramMonitorVisualLayer | null;
};

type TransitionWindow = {
  readonly cutMs: number;
  readonly descriptor: TransitionDescriptor;
  readonly fromClip: PersistedTimelineClip;
  readonly halfDurationMs: number;
  readonly playheadMs: number;
  readonly progress: number;
  readonly toClip: PersistedTimelineClip;
};

const NO_PREVIEW: ProgramMonitorPreview = Object.freeze({
  audioLayers: [],
  blackOpacity: 0,
  meterLeft: 0,
  meterRight: 0,
  primaryVisualLayer: null
});

function assertNever(value: never): never {
  throw new Error(`Unhandled program monitor preview variant: ${String(value)}`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isClipActiveAt(clip: PersistedTimelineClip, playheadMs: number): boolean {
  return playheadMs >= clip.timelineStartMs && playheadMs < clipTimelineEndMs(clip);
}

function sourceTimeForClip(clip: PersistedTimelineClip, playheadMs: number): number {
  return clip.sourceStartMs + playheadMs - clip.timelineStartMs;
}

function valueForProperty(effects: ClipEffects, property: ClipEffectProperty): number {
  return effects[property];
}

function effectsWithProperty(effects: ClipEffects, property: ClipEffectProperty, value: number): ClipEffects {
  return { ...effects, [property]: value };
}

function interpolateKeyframes(before: ClipKeyframe, after: ClipKeyframe, playheadMs: number): number {
  if (before.timelineTimeMs === after.timelineTimeMs) return after.value;
  const progress = clamp((playheadMs - before.timelineTimeMs) / (after.timelineTimeMs - before.timelineTimeMs), 0, 1);
  return before.value + (after.value - before.value) * progress;
}

function keyframedPropertyValue(
  clip: PersistedTimelineClip,
  property: ClipEffectProperty,
  playheadMs: number
): number {
  const keyframes = [...clip.keyframes]
    .filter((keyframe) => keyframe.property === property)
    .sort((left, right) => left.timelineTimeMs - right.timelineTimeMs);
  const firstKeyframe = keyframes[0];
  if (firstKeyframe === undefined) return valueForProperty(clip.effects, property);
  if (playheadMs <= firstKeyframe.timelineTimeMs) return firstKeyframe.value;

  for (let index = 1; index < keyframes.length; index += 1) {
    const previousKeyframe = keyframes[index - 1];
    const nextKeyframe = keyframes[index];
    if (previousKeyframe === undefined || nextKeyframe === undefined) continue;
    if (playheadMs <= nextKeyframe.timelineTimeMs) {
      return interpolateKeyframes(previousKeyframe, nextKeyframe, playheadMs);
    }
  }

  return keyframes[keyframes.length - 1]?.value ?? valueForProperty(clip.effects, property);
}

export function evaluateClipEffects(clip: PersistedTimelineClip, playheadMs: number): ClipEffects {
  let effects = { ...(clip.effects ?? DEFAULT_CLIP_EFFECTS) };
  for (const property of CLIP_EFFECT_PROPERTIES) {
    effects = effectsWithProperty(effects, property, keyframedPropertyValue(clip, property, playheadMs));
  }
  return effects;
}

function activeClipFromTrack(track: TimelineTrack, playheadMs: number): PersistedTimelineClip | null {
  return track.clips.find((clip) => isClipActiveAt(clip, playheadMs)) ?? null;
}

function findClipById(timeline: TimelineDocument, clipId: string): PersistedTimelineClip | null {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip !== undefined) return clip;
  }
  return null;
}

function transitionWindow(timeline: TimelineDocument, playheadMs: number): TransitionWindow | null {
  for (const descriptor of timeline.transitions) {
    const fromClip = findClipById(timeline, descriptor.fromClipId);
    const toClip = findClipById(timeline, descriptor.toClipId);
    if (fromClip === null || toClip === null) continue;

    const cutMs = toClip.timelineStartMs;
    const halfDurationMs = descriptor.durationMs / 2;
    const startMs = cutMs - halfDurationMs;
    const endMs = cutMs + halfDurationMs;
    if (descriptor.durationMs <= 0 || playheadMs < startMs || playheadMs > endMs) continue;
    return { cutMs, descriptor, fromClip, halfDurationMs, playheadMs, progress: clamp((playheadMs - startMs) / descriptor.durationMs, 0, 1), toClip };
  }
  return null;
}

function visualTransitionOpacity(window: TransitionWindow, activeClipId: string): number {
  if (activeClipId === window.fromClip.id) {
    return clamp((window.cutMs - window.playheadMs) / window.halfDurationMs, 0, 1);
  }
  if (activeClipId === window.toClip.id) {
    return clamp((window.playheadMs - window.cutMs) / window.halfDurationMs, 0, 1);
  }
  return 1;
}

function applyTransitionToEffects(effects: ClipEffects, window: TransitionWindow | null, activeClipId: string): ClipEffects {
  if (window === null) return effects;

  switch (window.descriptor.type) {
    case 'fade': {
      return { ...effects, opacity: effects.opacity * visualTransitionOpacity(window, activeClipId) };
    }
    case 'crossfade': {
      return { ...effects, opacity: effects.opacity * visualTransitionOpacity(window, activeClipId) };
    }
    case 'dipToBlack':
      return effects;
    default:
      return assertNever(window.descriptor.type);
  }
}

function blackOpacityForTransition(window: TransitionWindow | null): number {
  if (window === null) return 0;
  switch (window.descriptor.type) {
    case 'fade':
    case 'crossfade':
      return 0;
    case 'dipToBlack':
      return 1 - Math.abs(window.progress - 0.5) * 2;
    default:
      return assertNever(window.descriptor.type);
  }
}

function gainFromDb(db: number): number {
  return 10 ** (db / 20);
}

function audioPanGains(volume: number, mix: AudioTrackMix): Pick<ProgramMonitorAudioLayer, 'leftGain' | 'mediaVolume' | 'rightGain'> {
  if (mix.muted) return { leftGain: 0, mediaVolume: 0, rightGain: 0 };
  const mediaVolume = clamp(volume * gainFromDb(mix.gainDb), 0, 1);
  return {
    leftGain: mediaVolume * (mix.pan <= 0 ? 1 : 1 - mix.pan),
    mediaVolume,
    rightGain: mediaVolume * (mix.pan >= 0 ? 1 : 1 + mix.pan)
  };
}

export function buildProgramMonitorPreview(input: ProgramMonitorPreviewInput): ProgramMonitorPreview {
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const transition = transitionWindow(input.timeline, input.playheadMs);
  let primaryVisualLayer: ProgramMonitorVisualLayer | null = null;
  const audioLayers: ProgramMonitorAudioLayer[] = [];

  for (const track of input.timeline.tracks) {
    const activeClip = activeClipFromTrack(track, input.playheadMs);
    if (activeClip === null) continue;
    const effects = evaluateClipEffects(activeClip, input.playheadMs);
    const sourceTimeMs = sourceTimeForClip(activeClip, input.playheadMs);

    switch (track.kind) {
      case 'video':
        if (primaryVisualLayer === null) {
          primaryVisualLayer = {
            asset: assetById.get(activeClip.assetId) ?? null,
            clip: activeClip,
            effects: applyTransitionToEffects(effects, transition, activeClip.id),
            sourceTimeMs,
            trackId: track.id
          };
        }
        break;
      case 'audio': {
        const gains = audioPanGains(effects.volume, track.mix ?? DEFAULT_AUDIO_TRACK_MIX);
        audioLayers.push({
          asset: assetById.get(activeClip.assetId) ?? null,
          clip: activeClip,
          leftGain: gains.leftGain,
          mediaVolume: gains.mediaVolume,
          rightGain: gains.rightGain,
          sourceTimeMs,
          trackId: track.id
        });
        break;
      }
      default:
        assertNever(track);
    }
  }

  if (primaryVisualLayer === null && audioLayers.length === 0) return NO_PREVIEW;
  return {
    audioLayers,
    blackOpacity: blackOpacityForTransition(transition),
    meterLeft: clamp(audioLayers.reduce((total, layer) => total + layer.leftGain, 0), 0, 1),
    meterRight: clamp(audioLayers.reduce((total, layer) => total + layer.rightGain, 0), 0, 1),
    primaryVisualLayer
  };
}
