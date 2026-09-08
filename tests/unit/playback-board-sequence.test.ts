import { describe, expect, it } from 'vitest';

import { BoardState, indexOf } from '../../src/domain/board';
import { Direction, CELL_COUNT } from '../../src/domain/constants';
import { advanceWaterFlow } from '../../src/domain/water-flow';
import { StageController } from '../../src/application/stage-controller';
import {
  boardForPlaybackEvent,
  buildPlaybackBoardSequence
} from '../../src/application/playback-board-sequence';
import { getBuiltInStage } from '../../src/domain/stages';
import type { StageTraceEvent } from '../../src/domain/stage-session';

const stageTwo = getBuiltInStage('stage-02-open-to-sea');
if (stageTwo === undefined) throw new Error('stage fixture missing');

function ledger(board: { readonly water: readonly number[]; readonly safeDrain: number; readonly dangerLeak: number }): number {
  return board.water.reduce((total, amount) => total + amount, 0) +
    board.safeDrain + board.dangerLeak;
}

function traceWithFlow(result: ReturnType<typeof advanceWaterFlow>): readonly StageTraceEvent[] {
  return Object.freeze([
    Object.freeze({
      phase: 'flow' as const,
      flowStep: result.flowStep,
      placementCells: Object.freeze([] as number[]),
      rainCells: Object.freeze([]),
      protectedOverflows: result.protectedOverflows,
      flowResult: result
    }),
    Object.freeze({
      phase: 'evaluation' as const,
      flowStep: null,
      placementCells: Object.freeze([] as number[]),
      rainCells: Object.freeze([]),
      protectedOverflows: Object.freeze([]),
      flowResult: null
    })
  ]);
}

describe('playback board sequence', () => {
  it('shows the stage 2 rain and four recorded flow boards in order', () => {
    const controller = new StageController(stageTwo, 'unlimited');
    controller.setAnchor(indexOf(3, 4));
    const first = controller.confirm();
    expect(first?.accepted).toBe(true);

    const beforeView = controller.view;
    const preview = controller.previewSkip();
    const execution = controller.skip();
    expect(execution.accepted).toBe(true);
    if (preview === null || !preview.valid) throw new Error('skip preview fixture missing');

    const beforeHash = controller.session.fullStateHash;
    const sequence = buildPlaybackBoardSequence(
      beforeView.snapshot.board,
      preview.boardAfterRain,
      execution.trace,
      execution.snapshot.board
    );

    const source = indexOf(3, 1); // B4
    const flowCells = [
      indexOf(3, 2), // C4
      indexOf(3, 3), // D4
      indexOf(3, 4), // E4
      indexOf(3, 5) // F4
    ];
    expect(sequence.afterRainBoard?.water[source]).toBe(8);
    expect(sequence.flowBoards).toHaveLength(4);
    for (const [step, index] of flowCells.entries()) {
      expect(sequence.flowBoards[step]?.water[index]).toBe(8);
    }
    expect(sequence.flowBoards.at(-1)).toEqual(execution.snapshot.board);
    expect(boardForPlaybackEvent(sequence, sequence.flowEvents[0] ?? null))
      .toEqual(sequence.flowBoards[0]);
    expect(boardForPlaybackEvent(sequence, execution.trace.at(-1) ?? null))
      .toEqual(execution.snapshot.board);
    expect(controller.session.fullStateHash).toBe(beforeHash);

    const displayedBoards = [
      sequence.afterRainBoard,
      ...sequence.flowBoards,
      sequence.finalBoard
    ].filter((board): board is NonNullable<typeof board> => board !== null);
    for (const board of displayedBoards) {
      expect(ledger(board)).toBe(board.introducedWater);
    }
  });

  it('applies a cell drain and dangerous outside flow from the recorded result', () => {
    const drainedWater = Array<number>(CELL_COUNT).fill(0);
    const drainedTerrain = Array<number>(CELL_COUNT).fill(6);
    const drainCapacity = Array<number>(CELL_COUNT).fill(0);
    const drainIndex = indexOf(2, 2);
    drainedWater[drainIndex] = 8;
    drainedTerrain[drainIndex] = 0;
    drainCapacity[drainIndex] = 8;
    const drained = new BoardState({
      terrain: drainedTerrain,
      water: drainedWater,
      drainCapacity
    }).snapshot();
    const drainedState = BoardState.fromSnapshot(drained);
    const drainResult = advanceWaterFlow(drainedState);
    const drainSequence = buildPlaybackBoardSequence(
      drained,
      drained,
      traceWithFlow(drainResult),
      drainedState.snapshot()
    );
    expect(drainResult.transfers).toEqual([]);
    expect(drainResult.drains).toEqual([{ index: drainIndex, amount: 8 }]);
    expect(drainSequence.flowBoards[0]?.water[drainIndex]).toBe(0);
    expect(drainSequence.flowBoards[0]?.safeDrain).toBe(8);
    expect(ledger(drainSequence.flowBoards[0]!)).toBe(8);

    const dangerousWater = Array<number>(CELL_COUNT).fill(0);
    const dangerEdgeMask = Array<number>(CELL_COUNT).fill(0);
    dangerousWater[0] = 8;
    dangerEdgeMask[0] = Direction.North;
    const dangerous = new BoardState({
      water: dangerousWater,
      dangerEdgeMask
    }).snapshot();
    const dangerousState = BoardState.fromSnapshot(dangerous);
    const dangerResult = advanceWaterFlow(dangerousState);
    const dangerSequence = buildPlaybackBoardSequence(
      dangerous,
      dangerous,
      traceWithFlow(dangerResult),
      dangerousState.snapshot()
    );
    expect(dangerResult.dangerLeaked).toBe(8);
    expect(dangerSequence.flowBoards[0]?.water[0]).toBe(0);
    expect(dangerSequence.flowBoards[0]?.dangerLeak).toBe(8);
    expect(ledger(dangerSequence.flowBoards[0]!)).toBe(8);
  });

  it('keeps undo and repeated/restarted playback display-only', () => {
    const controller = new StageController(stageTwo, 'unlimited');
    controller.setAnchor(indexOf(3, 4));
    const first = controller.confirm();
    expect(first?.accepted).toBe(true);
    const beforeUndo = controller.view;
    const undo = controller.undo();
    expect(undo.accepted).toBe(true);

    const sequence = buildPlaybackBoardSequence(
      beforeUndo.snapshot.board,
      null,
      undo.trace,
      undo.snapshot.board
    );
    expect(sequence.flowBoards).toHaveLength(0);
    expect(boardForPlaybackEvent(sequence, undo.trace[0] ?? null))
      .toEqual(undo.snapshot.board);
    expect(buildPlaybackBoardSequence(
      beforeUndo.snapshot.board,
      null,
      undo.trace,
      undo.snapshot.board
    )).toEqual(sequence);

    const restarted = new StageController(
      stageTwo,
      'unlimited',
      controller.session.exportReplay()
    );
    expect(restarted.session.fullStateHash).toBe(controller.session.fullStateHash);
  });
});
