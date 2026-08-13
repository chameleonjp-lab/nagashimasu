import { describe, expect, it } from 'vitest';

import { StageController } from '../../src/application/stage-controller';
import { getBuiltInStage } from '../../src/domain/stages';
import { buildStageProjection, riskLabel } from '../../src/presentation/stage-projection';
import type { StageRiskLevel } from '../../src/presentation/stage-projection';

const stageOne = getBuiltInStage('stage-01-first-pond');
const stageThree = getBuiltInStage('stage-03-rain-order');
if (stageOne === undefined || stageThree === undefined) throw new Error('stage fixture missing');

describe('stage projection', () => {
  it('keeps forecast amounts and cell positions tied to the StageSession forecast', () => {
    const controller = new StageController(stageOne);
    const view = controller.view;
    const beforeHash = controller.session.fullStateHash;
    const projection = buildStageProjection(stageOne, view.snapshot, view.forecasts, view.preview);
    expect(projection.forecasts[0]?.turn).toBe(3);
    expect(projection.forecasts[0]?.totalAmount).toBe(16);
    expect(projection.forecastCells.map((cell) => cell.index)).toEqual([17, 25, 17, 25]);
    expect(projection.forecastCells.every((cell) => cell.amount === 8)).toBe(true);
    expect(projection.risks[17]?.level).toBe('caution');
    expect(projection.risks[17]?.reasons).toContain('次の雨が8降ります');
    expect(controller.session.fullStateHash).toBe(beforeHash);
  });

  it('surfaces exact protected overflow evidence after a failing turn', () => {
    const controller = new StageController(stageThree);
    expect(controller.skip().accepted).toBe(true);
    const failed = controller.skip();
    expect(failed.accepted).toBe(true);
    const view = controller.view;
    const projection = buildStageProjection(stageThree, view.snapshot, view.forecasts, view.preview);
    const critical = projection.risks.filter((risk) => risk.level === 'critical');
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.some((risk) => risk.reasons.some((reason) => reason.includes('浸水')))).toBe(true);
  });

  it('uses the four user-facing risk labels', () => {
    const levels: readonly StageRiskLevel[] = ['safe', 'caution', 'danger', 'critical'];
    expect(levels.map((level) => riskLabel(level))).toEqual([
      '安全',
      '注意',
      '危険',
      '決壊寸前'
    ]);
  });
});
