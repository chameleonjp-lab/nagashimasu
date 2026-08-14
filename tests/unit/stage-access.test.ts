import { describe, expect, it } from 'vitest';

import {
  isStageUnlocked,
  stageAccessLabel
} from '../../src/application/stage-access';

describe('stage access', () => {
  it('keeps stage 1 available for a new player', () => {
    expect(isStageUnlocked('stage-01-first-pond', [])).toBe(true);
    expect(stageAccessLabel('stage-01-first-pond', [])).toBe('挑戦可能');
  });

  it('opens stage 2 only after stage 1 is cleared', () => {
    expect(isStageUnlocked('stage-02-open-to-sea', [])).toBe(false);
    expect(stageAccessLabel('stage-02-open-to-sea', [])).toBe('前のステージをクリアすると解放');
    expect(isStageUnlocked('stage-02-open-to-sea', ['stage-01-first-pond'])).toBe(true);
    expect(stageAccessLabel('stage-02-open-to-sea', ['stage-01-first-pond'])).toBe('挑戦可能');
  });

  it('opens stage 3 after stage 2 is cleared and labels cleared stages', () => {
    expect(isStageUnlocked('stage-03-rain-order', ['stage-01-first-pond'])).toBe(false);
    expect(isStageUnlocked('stage-03-rain-order', ['stage-02-open-to-sea'])).toBe(true);
    expect(stageAccessLabel('stage-02-open-to-sea', ['stage-02-open-to-sea'])).toBe('クリア済み');
  });

  it('does not expose unknown stage ids', () => {
    expect(isStageUnlocked('stage-99-unknown', [])).toBe(false);
    expect(stageAccessLabel('stage-99-unknown', [])).toBe('前のステージをクリアすると解放');
  });
});
