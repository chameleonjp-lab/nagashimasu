import { describe, expect, it } from 'vitest';

import { shouldStartTurnTimerAfterVisibility } from '../../src/application/visibility-resume';

const base = {
  pageHidden: false,
  paused: false,
  playbackActive: false,
  phase: 'awaiting-turn' as const,
  timerActive: false
};

describe('visibility resume', () => {
  it('starts a timer when playback finished while hidden', () => {
    expect(shouldStartTurnTimerAfterVisibility(base)).toBe(true);
  });

  it('does not start while playback is still active', () => {
    expect(shouldStartTurnTimerAfterVisibility({ ...base, playbackActive: true })).toBe(false);
  });

  it('does not restart an explicitly paused or terminal session', () => {
    expect(shouldStartTurnTimerAfterVisibility({ ...base, paused: true })).toBe(false);
    expect(shouldStartTurnTimerAfterVisibility({ ...base, phase: 'cleared' })).toBe(false);
    expect(shouldStartTurnTimerAfterVisibility({ ...base, phase: 'failed' })).toBe(false);
  });

  it('keeps an existing timer untouched', () => {
    expect(shouldStartTurnTimerAfterVisibility({ ...base, timerActive: true })).toBe(false);
  });
});
