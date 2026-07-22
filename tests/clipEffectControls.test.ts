import { describe, expect, it } from 'vitest';

import {
  effectCssTransform,
  effectDbToVolume,
  effectPercentToOpacity,
  effectPercentToScale,
  effectUnitToPercent,
  effectVolumeToDb
} from '../src/renderer/src/editor/clipEffectControls';
import { DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';

describe('clip effect control conversions', () => {
  it('maps persisted unit effects to inspector percentages', () => {
    expect(effectUnitToPercent(0.73)).toBe(73);
    expect(effectPercentToOpacity(45)).toBe(0.45);
    expect(effectPercentToOpacity(120)).toBe(1);
    expect(effectPercentToScale(125)).toBe(1.25);
    expect(effectPercentToScale(250)).toBe(2);
  });

  it('maps unity media volume to zero decibels and back', () => {
    expect(DEFAULT_CLIP_EFFECTS.volume).toBe(1);
    expect(effectVolumeToDb(1)).toBe(0);
    expect(effectDbToVolume(0)).toBe(1);
    expect(effectDbToVolume(-100)).toBe(0);
    expect(effectDbToVolume(99)).toBe(1);
  });

  it('builds the program monitor video transform from persisted effects', () => {
    expect(effectCssTransform({
      ...DEFAULT_CLIP_EFFECTS,
      positionX: 12,
      positionY: -8,
      rotation: 45,
      scale: 1.5
    })).toBe('translate(12px, -8px) scale(1.5) rotate(45deg)');
  });
});
