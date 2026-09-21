import { describe, expect, it } from 'vitest';

import { StageController } from '../../src/application/stage-controller';
import { getBuiltInStage } from '../../src/domain/stages';
import { buildCellInspection } from '../../src/presentation/cell-inspection';
import { buildStageProjection } from '../../src/presentation/stage-projection';

const stage = getBuiltInStage('stage-01-first-pond');
if (stage === undefined) throw new Error('stage fixture missing');

describe('cell inspection', () => {
  it('shows current values, authoritative preview values, and readable reasons', () => {
    const controller = new StageController(stage);
    controller.setAnchor(8);
    const view = controller.view;
    const projection = buildStageProjection(
      stage,
      view.snapshot,
      view.forecasts,
      view.preview
    );
    const inspection = buildCellInspection({
      index: 8,
      board: view.snapshot.board,
      preview: view.preview,
      risk: projection.risks[8] ?? null
    });

    expect(inspection?.title).toBe('セルA2の確認');
    expect(inspection?.current).toContain('現在: 地形');
    expect(inspection?.facilities).toContain('排水口');
    expect(inspection?.forecast).toContain('この手の予測:');
    expect(inspection?.risk).toMatch(/^危険理由:/u);
    expect(controller.session.snapshot.completedTurns).toBe(0);
  });

  it('does not invent a preview when the placement is invalid', () => {
    const controller = new StageController(stage);
    controller.setAnchor(0);
    const view = controller.view;
    const inspection = buildCellInspection({
      index: 0,
      board: view.snapshot.board,
      preview: view.preview,
      risk: null
    });

    expect(inspection?.current).toContain('現在:');
    expect(inspection?.forecast).toContain('予測: この場所では候補を置けません');
    expect(inspection?.facilities).toContain('保護対象ではありません');
    expect(inspection?.risk).toBe('危険理由: 今の予測では大きな危険はありません');
    expect(controller.session.snapshot.completedTurns).toBe(0);
  });

  it('keeps non-placement inspection useful with exact rain and facility evidence', () => {
    const controller = new StageController(stage);
    const board = controller.view.snapshot.board;
    const inspection = buildCellInspection({
      index: 0,
      board,
      preview: null,
      risk: {
        index: 0,
        level: 'danger',
        reasons: Object.freeze(['次の雨が5降ります']),
        water: board.water[0] ?? 0,
        terrain: board.terrain[0] ?? 0,
        forecastAmount: 5,
        protectedCell: true
      }
    });

    expect(inspection?.facilities).toContain('保護対象');
    expect(inspection?.forecast).toContain('次の雨5');
    expect(inspection?.risk).toContain('次の雨が5降ります');
    expect(controller.session.snapshot.completedTurns).toBe(0);
  });

  it('returns null for an out-of-range cell without mutating input', () => {
    const controller = new StageController(stage);
    const before = controller.session.reversibleGameplayHash;
    expect(buildCellInspection({
      index: 64,
      board: controller.view.snapshot.board,
      preview: null,
      risk: null
    })).toBeNull();
    expect(controller.session.reversibleGameplayHash).toBe(before);
  });
});
