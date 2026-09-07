import { describe, expect, it } from 'vitest';

import { getBuiltInStage } from '../../src/domain/stages';
import {
  MAX_VISUAL_WATER,
  waterVisualCapForStage,
  waterVisualLevel
} from '../../src/presentation/board-visuals';

describe('board water visuals', () => {
  it('keeps the default presentation cap for a basic amount', () => {
    const visual = waterVisualLevel(MAX_VISUAL_WATER);

    expect(visual.ratio).toBe(1);
    expect(waterVisualLevel(MAX_VISUAL_WATER * 2).ratio).toBe(1);
  });

  it('uses each stage total water supply as its visual cap', () => {
    const stageOne = getBuiltInStage('stage-01-first-pond');
    const stageThree = getBuiltInStage('stage-03-rain-order');
    if (stageOne === undefined || stageThree === undefined) throw new Error('stage fixture missing');

    expect(waterVisualCapForStage(stageOne)).toBe(32);
    expect(waterVisualCapForStage(stageThree)).toBe(40);
  });

  it('distinguishes amounts above the old fixed cap when a stage allows them', () => {
    const cap = 40;

    expect(waterVisualLevel(32, cap).ratio).toBeGreaterThan(waterVisualLevel(24, cap).ratio);
    expect(waterVisualLevel(cap, cap).ratio).toBe(1);
  });

  it('rejects an invalid visual cap', () => {
    expect(() => waterVisualLevel(1, 0)).toThrow(RangeError);
    expect(() => waterVisualLevel(1, Number.NaN)).toThrow(RangeError);
  });
});
