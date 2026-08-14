import { describe, expect, it } from 'vitest';

import {
  resultCauseText,
  resultFirstBreakText,
  resultImprovementHint
} from '../../src/presentation/result-feedback';
import type { ResultFeedbackInput } from '../../src/presentation/result-feedback';

function input(overrides: Partial<ResultFeedbackInput> = {}): ResultFeedbackInput {
  return {
    phase: 'failed',
    failureReasons: ['protected-overflow'],
    metrics: {
      firstFloodStep: 1,
      firstFloodStepByCell: [3, 2, null]
    },
    score: {
      safety: 30,
      efficiency: 20,
      control: 10,
      total: 60,
      grade: 'C'
    },
    ...overrides
  };
}

describe('result feedback', () => {
  it('identifies the first protected cell when the domain provides it', () => {
    expect(resultFirstBreakText(input())).toBe('最初の破綻: 保護対象のセル2');
  });

  it('uses a generic danger outlet when no exact danger cell exists', () => {
    const value = input({
      failureReasons: ['danger-leak'],
      metrics: { firstFloodStep: null, firstFloodStepByCell: [null, null] }
    });
    expect(resultFirstBreakText(value)).toBe('最初の破綻: 危険側の出口');
    expect(resultCauseText(value)).toContain('危険側へ流出');
    expect(resultImprovementHint(value)).toContain('危険側へ向かう低い辺');
  });

  it('combines multiple failure reasons into one cause sentence', () => {
    const value = input({ failureReasons: ['danger-leak', 'protected-overflow'] });
    expect(resultCauseText(value)).toContain('と');
    expect(resultImprovementHint(value)).toContain('保護対象');
  });

  it('gives an objective hint when the only failure is unfinished progress', () => {
    const value = input({
      failureReasons: ['objective-not-met'],
      metrics: { firstFloodStep: null, firstFloodStepByCell: [null] }
    });
    expect(resultFirstBreakText(value)).toBe('最初の破綻: 目的の未達');
    expect(resultCauseText(value)).toContain('目的値');
    expect(resultImprovementHint(value)).toContain('目的のセル');
  });

  it('selects one lower score axis after a clear', () => {
    const value = input({
      phase: 'cleared',
      failureReasons: [],
      metrics: { firstFloodStep: null, firstFloodStepByCell: [] },
      score: { safety: 50, efficiency: 30, control: 12, total: 92, grade: 'A' }
    });
    expect(resultFirstBreakText(value)).toContain('なし');
    expect(resultCauseText(value)).toContain('目的を達成');
    expect(resultImprovementHint(value)).toContain('排水能力');
  });

  it('falls back to a non-empty hint for complete scores', () => {
    const value = input({
      phase: 'cleared',
      failureReasons: [],
      metrics: { firstFloodStep: null, firstFloodStepByCell: [] },
      score: { safety: 50, efficiency: 30, control: 20, total: 100, grade: 'S' }
    });
    expect(resultImprovementHint(value)).toMatch(/^次に改善する1点:/u);
  });
});
