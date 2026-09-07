import { describe, expect, it } from 'vitest';

import { buildCandidateCardPresentation } from '../../src/presentation/candidate-card';

describe('candidate card presentation', () => {
  it('keeps the slot, action, anchor explanation, and rotation together', () => {
    const presentation = buildCandidateCardPresentation({
      slot: 1,
      pieceId: 'raise-l',
      tokenId: 12,
      delta: 1,
      offsets: [
        { row: 0, column: 0 },
        { row: 1, column: 0 },
        { row: 1, column: 1 }
      ],
      rotation: 2
    });

    expect(presentation.titleText).toBe('候補B: 上げる');
    expect(presentation.detailText).toContain('L字・3マス');
    expect(presentation.detailText).toContain('◎基準セル');
    expect(presentation.detailText).toContain('パーツの向き3');
    expect(presentation.titleAttribute).toBe('raise-l / token 12');
    expect(presentation.ariaLabel).toContain('盤面の緑の丸に対応');
  });

  it('keeps a lower piece distinguishable from a raise piece', () => {
    const presentation = buildCandidateCardPresentation({
      slot: 0,
      pieceId: 'lower-line',
      tokenId: 2,
      delta: -1,
      offsets: [
        { row: 0, column: 0 },
        { row: 0, column: 1 }
      ],
      rotation: 0
    });

    expect(presentation.titleText).toBe('候補A: 下げる');
    expect(presentation.detailText).toContain('直線・2マス');
  });
});
