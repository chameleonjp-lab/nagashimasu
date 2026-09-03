import { describe, expect, it } from 'vitest';

import { StageController } from '../../src/application/stage-controller';
import { getBuiltInStage } from '../../src/domain/stages';
import { buildThreeBoardFrame } from '../../src/presentation/three-board-frame';

describe('three board frame contract', () => {
  it('uses preview terrain and boardAfterNextFlow water without changing inputs', () => {
    const stage = getBuiltInStage('stage-01-first-pond');
    if (stage === undefined) throw new Error('stage fixture missing');
    const controller = new StageController(stage);
    const anchor = controller.view.legalAnchorIndices[0];
    if (anchor === undefined) throw new Error('legal anchor fixture missing');
    controller.setAnchor(anchor);
    const view = controller.view;
    if (view.preview === null) throw new Error('preview fixture missing');
    const snapshotBefore = JSON.stringify(view.snapshot.board);
    const previewBefore = JSON.stringify(view.preview);

    const frame = buildThreeBoardFrame(view.snapshot.board, {
      preview: view.preview,
      riskCells: [],
      forecastCells: []
    });

    expect(frame.terrain).toEqual(view.preview.terrainAfterConstruction);
    expect(frame.water).toEqual(view.preview.boardAfterNextFlow.water);
    expect(frame.previewFlow).toBe(view.preview.nextFlow);
    expect(JSON.stringify(view.snapshot.board)).toBe(snapshotBefore);
    expect(JSON.stringify(view.preview)).toBe(previewBefore);
  });

  it('passes every recorded transfer field through without recomputing it', () => {
    const stage = getBuiltInStage('stage-02-open-to-sea');
    if (stage === undefined) throw new Error('stage fixture missing');
    const controller = new StageController(stage);
    const execution = controller.skip();
    const flowEvent = execution.trace.find((event) => event.flowResult !== null);
    if (flowEvent?.flowResult === null || flowEvent === undefined) {
      throw new Error('flow fixture missing');
    }
    const frame = buildThreeBoardFrame(execution.snapshot.board, {
      flowResult: flowEvent.flowResult,
      riskCells: [],
      forecastCells: []
    });
    expect(frame.activeFlow).toBe(flowEvent.flowResult);
    expect(frame.activeFlow?.transfers).toEqual(flowEvent.flowResult.transfers);
    expect(frame.activeFlow?.transfers.map(({ from, to, direction, kind, amount }) =>
      ({ from, to, direction, kind, amount })
    )).toEqual(flowEvent.flowResult.transfers);
  });

  it('keeps supplied risk and result information as display input', () => {
    const stage = getBuiltInStage('stage-01-first-pond');
    if (stage === undefined) throw new Error('stage fixture missing');
    const snapshot = new StageController(stage).view.snapshot.board;
    const risks = [{
      index: 3,
      level: 'critical' as const,
      reasons: ['fixture'],
      water: 0,
      terrain: 4,
      forecastAmount: 99,
      protectedCell: true
    }];
    const frame = buildThreeBoardFrame(snapshot, {
      riskCells: risks,
      resultPhase: 'failed',
      resultText: '表示された結果'
    });
    expect(frame.riskCells).toEqual(risks);
    expect(frame.resultPhase).toBe('failed');
    expect(frame.resultText).toBe('表示された結果');
  });

  it('is deterministic for the same snapshot and options', () => {
    const stage = getBuiltInStage('stage-01-first-pond');
    if (stage === undefined) throw new Error('stage fixture missing');
    const snapshot = new StageController(stage).view.snapshot.board;
    const options = { labelCells: [0, 8], storageCells: [16] } as const;
    expect(buildThreeBoardFrame(snapshot, options)).toEqual(buildThreeBoardFrame(snapshot, options));
  });
});
