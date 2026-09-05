import { describe, expect, it } from 'vitest';

import { resultScoreGuideText } from '../../src/presentation/result-score-guide';

describe('result score guide', () => {
  it('distinguishes the stage 1 clear target from its control score range', () => {
    expect(resultScoreGuideText({
      objective: { type: 'stored-water', target: 24 },
      evaluation: { controlTarget: 32 }
    })).toContain('クリア条件は池に雨水を24ためること。流量制御は池に残った水を32まで評価します。');
  });

  it('describes safe-drain using water as both the objective and score unit', () => {
    expect(resultScoreGuideText({
      objective: { type: 'safe-drain', target: 8 },
      evaluation: { controlTarget: 8 }
    })).toContain('クリア条件は安全な出口へ水を8流すこと。流量制御も安全排水を8まで評価します。');
  });

  it('calls out the event-versus-water distinction for protect stages', () => {
    expect(resultScoreGuideText({
      objective: { type: 'protect', target: 3 },
      evaluation: { controlTarget: 24 }
    })).toContain('クリア条件は保護対象を3回守ること。流量制御は守れた雨の水量を24まで評価します。');
  });
});
