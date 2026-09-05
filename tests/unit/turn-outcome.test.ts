import { describe, expect, it } from 'vitest';

import { Direction } from '../../src/domain/constants';
import type { FlowStepResult, WaterTransfer } from '../../src/domain/types';
import type { StageTraceEvent } from '../../src/domain/stage-session';
import { buildTurnOutcomeSummary } from '../../src/presentation/turn-outcome';

function traceEvent(overrides: Partial<StageTraceEvent>): StageTraceEvent {
  return {
    phase: 'construction',
    flowStep: null,
    placementCells: [],
    rainCells: [],
    protectedOverflows: [],
    flowResult: null,
    ...overrides
  };
}

function flowResult(transfers: readonly WaterTransfer[]): FlowStepResult {
  return {
    flowStep: 1,
    movedWater: 4,
    safeDrained: 2,
    dangerLeaked: 0,
    protectedOverflow: 0,
    transfers,
    drains: [],
    protectedOverflows: []
  };
}

describe('turn outcome summary', () => {
  it('connects the construction, rain, flow route, and continuing result', () => {
    const summary = buildTurnOutcomeSummary({
      construction: 'セル17・セル25を1段上げる',
      trace: [
        traceEvent({ placementCells: [16, 24] }),
        traceEvent({
          phase: 'rain',
          rainCells: [{ index: 17, amount: 8 }]
        }),
        traceEvent({
          phase: 'flow',
          flowStep: 1,
          flowResult: flowResult([
            {
              from: 17,
              to: 18,
              direction: Direction.East,
              kind: 'cell',
              amount: 4
            },
            {
              from: 18,
              to: null,
              direction: Direction.East,
              kind: 'safe-edge',
              amount: 2
            }
          ])
        })
      ],
      phase: 'awaiting-turn'
    });

    expect(summary.construction).toBe('セル17・セル25を1段上げる');
    expect(summary.rain).toBe('雨: 合計8（セルB3）');
    expect(summary.flow).toContain('安全排水2');
    expect(summary.flow).toContain('セルB3→セルC3');
    expect(summary.result).toContain('次の手番');
  });

  it('states when a skipped turn had no rain or water movement', () => {
    const summary = buildTurnOutcomeSummary({
      construction: '施工なし（見送り）',
      trace: [
        traceEvent({}),
        traceEvent({ phase: 'rain' }),
        traceEvent({ phase: 'evaluation' })
      ],
      phase: 'failed'
    });

    expect(summary.construction).toContain('見送り');
    expect(summary.rain).toContain('降っていません');
    expect(summary.flow).toContain('水流はありません');
    expect(summary.result).toContain('失敗条件');
  });
});
