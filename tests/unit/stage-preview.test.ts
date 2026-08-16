import { describe, expect, it } from 'vitest';

import { StageController } from '../../src/application/stage-controller';
import { getBuiltInStage } from '../../src/domain/stages';
import { buildStagePreviewSummary } from '../../src/presentation/stage-preview';

const stageOne = getBuiltInStage('stage-01-first-pond');
const stageThree = getBuiltInStage('stage-03-rain-order');
if (stageOne === undefined || stageThree === undefined) {
  throw new Error('built-in stage fixture missing');
}

describe('stage preview summary', () => {
  it('describes construction and the next flow without changing the session', () => {
    const controller = new StageController(stageOne);
    controller.setAnchor(8);
    const beforeHash = controller.session.reversibleGameplayHash;
    const summary = buildStagePreviewSummary(
      controller.view.snapshot,
      controller.view.preview
    );

    expect(summary).not.toBeNull();
    expect(summary?.construction).toBe('セル9・セル10を1段上げる');
    expect(summary?.rain).toBe('この手の雨はありません');
    expect(summary?.flow).toBe('次の水流で大きな変化はありません');
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

    expect(summary?.rain).toBe('雨16（セル33・セル41）');
  });

  it('returns no summary when there is no pending placement', () => {
    const controller = new StageController(stageOne);
    expect(buildStagePreviewSummary(controller.view.snapshot, null)).toBeNull();
  });
});
