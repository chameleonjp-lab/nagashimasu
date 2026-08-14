import { describe, expect, it } from 'vitest';

import { clampPlaybackProgress, playbackPulse } from '../../src/presentation/playback-visuals';

describe('playback visual timing', () => {
  it('clamps progress so presentation values cannot escape their range', () => {
    expect(clampPlaybackProgress(undefined)).toBe(0);
    expect(clampPlaybackProgress(null)).toBe(0);
    expect(clampPlaybackProgress(Number.NaN)).toBe(0);
    expect(clampPlaybackProgress(-1)).toBe(0);
    expect(clampPlaybackProgress(0.25)).toBe(0.25);
    expect(clampPlaybackProgress(2)).toBe(1);
  });

  it('peaks at the middle of each trace segment and stays deterministic', () => {
    expect(playbackPulse(0)).toBeCloseTo(0);
    expect(playbackPulse(0.5)).toBeCloseTo(1);
    expect(playbackPulse(1)).toBeCloseTo(0);
    expect(playbackPulse(0.25)).toBe(playbackPulse(0.25));
  });
});

