import { CLIP_EFFECT_RANGES } from '../../../shared/timelineTypes';
import type { ClipEffects } from '../../../shared/timelineTypes';

const PERCENT_SCALE = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function effectUnitToPercent(value: number): number {
  return Math.round(value * PERCENT_SCALE);
}

export function effectPercentToOpacity(percent: number): ClipEffects['opacity'] {
  return clamp(percent / PERCENT_SCALE, CLIP_EFFECT_RANGES.opacity.min, CLIP_EFFECT_RANGES.opacity.max);
}

export function effectPercentToScale(percent: number): ClipEffects['scale'] {
  return clamp(percent / PERCENT_SCALE, CLIP_EFFECT_RANGES.scale.min, CLIP_EFFECT_RANGES.scale.max);
}

export function effectVolumeToDb(volume: number): number {
  const { min, max } = CLIP_EFFECT_RANGES.volumeDb;
  return Math.round(min + volume * (max - min));
}

export function effectDbToVolume(db: number): ClipEffects['volume'] {
  const { min, max } = CLIP_EFFECT_RANGES.volumeDb;
  return clamp((db - min) / (max - min), CLIP_EFFECT_RANGES.volume.min, CLIP_EFFECT_RANGES.volume.max);
}

export function effectCssTransform(effects: ClipEffects): string {
  return `translate(${effects.positionX}px, ${effects.positionY}px) scale(${effects.scale}) rotate(${effects.rotation}deg)`;
}
