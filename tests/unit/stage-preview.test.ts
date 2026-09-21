import { describe, expect, it } from 'vitest';

import { StageController } from '../../src/application/stage-controller';
import { getBuiltInStage } from '../../src/domain/stages';
import {
  buildStagePreviewSummary,
  buildStageSkipPreviewSummary
} from '../../src/presentation/stage-preview';

const stageOne = getBuiltInStage('stage-01-first-pond');
const stageThree = getBuiltInStage('stage-03-rain-order');
if (stageOne === undefined || stageThree === undefined) {
  throw new Error('built-in stage fixture missing');
}

describe('stage preview summary', () => {
  it('describes the full turn horizon without changing the session', () => {
    const controller = new StageController(stageOne);
    controller.setAnchor(8);
    const beforeHash = controller.session.reversibleGameplayHash;
    const summary = buildStagePreviewSummary(
      controller.view.snapshot,
      controller.view.preview
    );

    expect(summary).not.toBeNull();
    expect(summary?.construction).toBe('セルA2・セルB2を1段上げる');
    expect(summary?.rain).toBe('この手の雨はありません');
    expect(summary?.flow).toBe('4回の水流後: 大きな変化はありません');
    expect(summary?.result).toBe('見込み: この手の後も続けられます');
    expect(controller.session.reversibleGameplayHash).toBe(beforeHash);
  });

  it('shows the rain cells from the same preview used by the board', () => {
    const controller = new StageController(stageThree);
    expect(controller.skip().accepted).toBe(true);
    controller.setAnchor(33);
    const summary = buildStagePreviewSummary(
      controller.view.snapshot,
      controller.view.preview
    );

    expect(summary?.rain).toBe('雨16（セルA5・セルA6）');
    expect(summary?.result).toBe('見込み: 失敗（保護セルが浸水）');
  });

  it('returns no summary when there is no pending placement', () => {
    const controller = new StageController(stageOne);
    expect(buildStagePreviewSummary(controller.view.snapshot, null)).toBeNull();
  });

  it('shows current versus after-skip progress and the projected score', () => {
    const controller = new StageController(stageOne);
    const snapshot = controller.view.snapshot;
    const preview = controller.previewSkip();
    const summary = buildStageSkipPreviewSummary(stageOne, snapshot, preview);

    expect(summary?.current).toContain('現在: 池にためた水 0 / 24');
    expect(summary?.forecast).toContain('見送り後の予測: 池にためた水 0 / 24');
    expect(summary?.result).toContain('見送り予測: 継続');
    expect(summary?.score).toContain('予測スコア:');
    expect(controller.session.reversibleGameplayHash).toBe(
      new StageController(stageOne).session.reversibleGameplayHash
    );
  });

  it('uses the final skip preview evidence, including failure, without executing it', () => {
    const controller = new StageController(stageThree);
    expect(controller.skip().accepted).toBe(true);
    const beforeHash = controller.session.reversibleGameplayHash;
    const snapshot = controller.view.snapshot;
    const preview = controller.previewSkip();
    const summary = buildStageSkipPreviewSummary(stageThree, snapshot, preview);

    expect(preview?.phase).toBe('failed');
    expect(summary?.result).toContain('見送り予測: 失敗');
    expect(summary?.forecast).toContain('見送り後の予測:');
    expect(controller.session.reversibleGameplayHash).toBe(beforeHash);
  });
});
