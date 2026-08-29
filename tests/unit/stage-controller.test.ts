import { describe, expect, it } from 'vitest';

import { StageController } from '../../src/application/stage-controller';
import { getBuiltInStage } from '../../src/domain/stages';

const stage = getBuiltInStage('stage-01-first-pond');
const stageTwo = getBuiltInStage('stage-02-open-to-sea');
if (stage === undefined || stageTwo === undefined) throw new Error('stage fixture missing');

describe('StageController', () => {
  it('connects candidate selection and one-step preview without changing domain state', () => {
    const controller = new StageController(stage);
    const beforeHash = controller.session.reversibleGameplayHash;
    controller.setAnchor(8);
    const view = controller.view;
    expect(view.pending?.anchorIndex).toBe(8);
    expect(view.preview).not.toBeNull();
    expect(view.preview?.placementCells).toEqual([8, 9]);
    expect(controller.session.reversibleGameplayHash).toBe(beforeHash);
    expect(controller.session.snapshot.completedTurns).toBe(0);
  });

  it('keeps pointer placement separate from confirmation', () => {
    const controller = new StageController(stage);
    controller.setAnchor(8);
    expect(controller.session.snapshot.completedTurns).toBe(0);
    const execution = controller.confirm();
    expect(execution?.accepted).toBe(true);
    expect(controller.session.snapshot.completedTurns).toBe(1);
    expect(controller.view.pending).toBeNull();
  });

  it('exposes legal anchors for the selected candidate even on a narrow board', () => {
    const controller = new StageController(stageTwo);
    controller.selectCandidate(1);

    expect(controller.view.legalAnchorIndices).toEqual([26, 27, 28]);
  });

  it('shows an invalid placement without consuming a candidate or turn', () => {
    const controller = new StageController(stage);
    const before = controller.session.snapshot;
    controller.setAnchor(0);
    expect(controller.view.preview).toBeNull();
    expect(controller.view.validation?.valid).toBe(false);
    const execution = controller.confirm();
    expect(execution?.accepted).toBe(false);
    expect(controller.session.snapshot.completedTurns).toBe(before.completedTurns);
    expect(controller.session.snapshot.nextActionId).toBe(before.nextActionId);
    expect(controller.session.snapshot.candidateTokenIds).toEqual(before.candidateTokenIds);
  });

  it('changes preview direction only after an explicit rotation action', () => {
    const controller = new StageController(stage);
    controller.setAnchor(8);
    const before = controller.view.preview;
    controller.rotate();
    const after = controller.view.preview;
    expect(before?.action.type).toBe('construct');
    expect(after?.action.type).toBe('construct');
    if (before?.action.type !== 'construct' || after?.action.type !== 'construct') {
      throw new Error('preview action is not a construction');
    }
    expect(before.action.rotation).toBe(0);
    expect(after.action.rotation).toBe(1);
    expect(controller.session.snapshot.completedTurns).toBe(0);
  });

  it('switches the candidate used by an existing pending anchor', () => {
    const controller = new StageController(stage);
    controller.setAnchor(8);
    controller.selectCandidate(1);
    expect(controller.view.pending?.slot).toBe(1);
    expect(controller.view.preview?.action.type).toBe('construct');
    const preview = controller.view.preview;
    if (preview?.action.type !== 'construct') throw new Error('preview action is not a construction');
    expect(preview.action.slot).toBe(1);
    expect(controller.session.snapshot.completedTurns).toBe(0);
  });

  it('keeps the unused candidate token when a slot is used', () => {
    const controller = new StageController(stage);
    const before = controller.view.candidates;
    controller.setAnchor(8);
    const execution = controller.confirm();
    expect(execution?.accepted).toBe(true);
    const after = controller.view.candidates;
    expect(after[0]?.tokenId).not.toBe(before[0]?.tokenId);
    expect(after[1]?.tokenId).toBe(before[1]?.tokenId);
  });

  it('keeps preview flow evidence aligned with the committed first flow step', () => {
    const controller = new StageController(stage);
    controller.setAnchor(8);
    const preview = controller.view.preview;
    if (preview === null) throw new Error('preview is missing');
    const execution = controller.confirm();
    expect(execution?.accepted).toBe(true);
    const firstFlow = execution?.trace.find((event) => event.phase === 'flow');
    expect(firstFlow?.flowResult).toEqual(preview.nextFlow);
  });

  it('restores a controller from a replay with identical state hashes', () => {
    const controller = new StageController(stage);
    controller.setAnchor(8);
    const execution = controller.confirm();
    expect(execution?.accepted).toBe(true);

    const restored = new StageController(stage, 'standard', controller.session.exportReplay());
    expect(restored.session.snapshot).toEqual(controller.session.snapshot);
    expect(restored.session.fullStateHash).toBe(controller.session.fullStateHash);
    expect(restored.session.reversibleGameplayHash).toBe(controller.session.reversibleGameplayHash);
  });
});
