import { CLIP_EFFECT_RANGES, DEFAULT_CLIP_EFFECTS } from './timelineTypes';
import type { ClipEffects } from './timelineTypes';

function isBounded(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function hasOnlyClipEffectKeys(effects: Partial<ClipEffects>): boolean {
  return Object.keys(effects).every(
    (key) =>
      key === 'opacity' ||
      key === 'scale' ||
      key === 'positionX' ||
      key === 'positionY' ||
      key === 'rotation' ||
      key === 'volume'
  );
}

export function isValidClipEffects(effects: ClipEffects): boolean {
  return (
    isBounded(effects.opacity, CLIP_EFFECT_RANGES.opacity.min, CLIP_EFFECT_RANGES.opacity.max) &&
    isBounded(effects.scale, CLIP_EFFECT_RANGES.scale.min, CLIP_EFFECT_RANGES.scale.max) &&
    isBounded(effects.positionX, CLIP_EFFECT_RANGES.positionX.min, CLIP_EFFECT_RANGES.positionX.max) &&
    isBounded(effects.positionY, CLIP_EFFECT_RANGES.positionY.min, CLIP_EFFECT_RANGES.positionY.max) &&
    isBounded(effects.rotation, CLIP_EFFECT_RANGES.rotation.min, CLIP_EFFECT_RANGES.rotation.max) &&
    isBounded(effects.volume, CLIP_EFFECT_RANGES.volume.min, CLIP_EFFECT_RANGES.volume.max)
  );
}

export function normalizeClipEffects(effects: ClipEffects | undefined): ClipEffects | null {
  if (effects !== undefined && !hasOnlyClipEffectKeys(effects)) {
    return null;
  }
  const normalized = effects ?? DEFAULT_CLIP_EFFECTS;
  return isValidClipEffects(normalized) ? { ...normalized } : null;
}

export function clipEffectsEqual(left: ClipEffects, right: ClipEffects): boolean {
  return (
    left.opacity === right.opacity &&
    left.scale === right.scale &&
    left.positionX === right.positionX &&
    left.positionY === right.positionY &&
    left.rotation === right.rotation &&
    left.volume === right.volume
  );
}
