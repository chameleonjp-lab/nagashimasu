import { describe, expect, it } from 'vitest';

import {
  failureReasonText,
  playbackGuideText,
  rejectionReasonText,
  resultVisualText
} from '../../src/presentation/game-copy';

describe('game presentation copy', () => {
  it('describes every trace phase without changing the player-facing wording', () => {
    expect(playbackGuideText('construction', null)).toEqual({
      action: 'いま起きていること: 地面の高さを変えています。',
      detail: '選んだ配置を盤面へ反映しています。'
    });
    expect(playbackGuideText('rain', null).action).toContain('予報どおり');
    expect(playbackGuideText('flow', 4).action).toContain('4回目');
    expect(playbackGuideText('evaluation', null).detail).toContain('少し待って');
    expect(playbackGuideText('undo', null).action).toContain('元に戻');
  });

  it('keeps failure labels and result priority aligned with the existing UI', () => {
    expect(failureReasonText('danger-leak')).toBe('危険側へ流出しました');
    expect(failureReasonText('protected-overflow')).toBe('保護対象が浸水しました');
    expect(failureReasonText('objective-not-met')).toBe('ステージの目的を達成できませんでした');
    expect(resultVisualText('cleared', ['danger-leak'])).toBe('クリア：目標を達成しました');
    expect(resultVisualText('failed', ['protected-overflow', 'danger-leak'])).toBe('失敗：保護対象が浸水しました');
    expect(resultVisualText('failed', [])).toBe('失敗：目標を達成できませんでした');
  });

  it('keeps operation rejection messages explicit and null-safe', () => {
    expect(rejectionReasonText(null)).toBe('');
    expect(rejectionReasonText('construction-forbidden')).toBe('ここは施工できません。');
    expect(rejectionReasonText('stale-revision')).toBe('操作を受け付けません（stale-revision）。');
    expect(rejectionReasonText('undo-unavailable')).toBe('戻せる手番がありません。');
  });
});
