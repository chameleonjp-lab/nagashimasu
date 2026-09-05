import { describe, expect, it } from 'vitest';

import { mobileControlsFocusTarget } from '../../src/presentation/mobile-controls-focus';

const readyInput = {
  phase: 'awaiting-turn' as const,
  hasPendingPlacement: false,
  selectedCandidateSlot: 0 as const,
  boardReady: true,
  inputLocked: false,
  playbackActive: false
};

describe('mobile controls focus', () => {
  it('focuses the selected candidate when a new turn opens', () => {
    expect(mobileControlsFocusTarget(readyInput)).toBe('candidate-a');
    expect(mobileControlsFocusTarget({ ...readyInput, selectedCandidateSlot: 1 })).toBe('candidate-b');
  });

  it('focuses confirmation after a board placement opens the sheet', () => {
    expect(mobileControlsFocusTarget({ ...readyInput, hasPendingPlacement: true })).toBe('confirm');
  });

  it('focuses retry after the result sheet opens', () => {
    expect(mobileControlsFocusTarget({ ...readyInput, phase: 'failed' })).toBe('retry');
    expect(mobileControlsFocusTarget({ ...readyInput, phase: 'cleared' })).toBe('retry');
  });

  it('keeps the close control available while the board is unavailable', () => {
    expect(mobileControlsFocusTarget({ ...readyInput, boardReady: false })).toBe('close');
    expect(mobileControlsFocusTarget({ ...readyInput, inputLocked: true })).toBe('close');
    expect(mobileControlsFocusTarget({ ...readyInput, playbackActive: true })).toBe('close');
  });
});
