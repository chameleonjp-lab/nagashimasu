import { describe, expect, it } from 'vitest';

import { CELL_COUNT, Direction, MAX_TERRAIN_HEIGHT } from '../../src/domain/constants';
import { PIECE_SCHEMA_VERSION } from '../../src/domain/pieces';
import {
  STAGE_SCHEMA_VERSION,
  parseStageDefinition
} from '../../src/domain/stage-definition';
import type { ValidatedStageDefinition } from '../../src/domain/stage-definition';
import type { StageAction } from '../../src/domain/stage-replay';
import { createStageSession } from '../../src/domain/stage-session';
import type {
  StageExecution,
  StageRejectionReason,
  StageSession,
  StageSessionSnapshot
} from '../../src/domain/stage-session';

/**
 * Adversarial specification for M2's stage reducer and stateful session shell.
 */

interface MutableBoardDefinition {
  terrain: number[];
  water: number[];
  cellFlags: number[];
  drainCapacity: number[];
  protectedWaterLimit: number[];
  safeEdgeMask: number[];
  dangerEdgeMask: number[];
}

interface StageFixtureOptions {
  readonly board?: MutableBoardDefinition;
  readonly constructionMask?: number[];
  readonly storageMask?: number[];
  readonly maxTurns?: number;
  readonly timerSeconds?: number | null;
  readonly candidateSequence?: string[];
  readonly rainEvents?: readonly {
    readonly turn: number;
    readonly cells: readonly { readonly index: number; readonly amount: number }[];
  }[];
  readonly objective?: {
    readonly type: 'stored-water' | 'safe-drain' | 'protect';
    readonly target: number;
  };
  readonly failure?: {
    readonly maxDangerLeak: number;
    readonly maxPeakProtectedOverflow: number;
  };
}

function cells(value = 0): number[] {
  return Array<number>(CELL_COUNT).fill(value);
}

function boardWithTerrain(terrain = 3): MutableBoardDefinition {
  return {
    terrain: cells(terrain),
    water: cells(),
    cellFlags: cells(),
    drainCapacity: cells(),
    protectedWaterLimit: cells(),
    safeEdgeMask: cells(),
    dangerEdgeMask: cells()
  };
}

const PIECES = Object.freeze([
  {
    schemaVersion: PIECE_SCHEMA_VERSION,
    id: 'raise-l',
    delta: 1,
    offsets: [
      { row: 0, column: 0 },
      { row: 1, column: 0 },
      { row: 1, column: 1 }
    ]
  },
  {
    schemaVersion: PIECE_SCHEMA_VERSION,
    id: 'lower-single',
    delta: -1,
    offsets: [{ row: 0, column: 0 }]
  },
  {
    schemaVersion: PIECE_SCHEMA_VERSION,
    id: 'raise-single',
    delta: 1,
    offsets: [{ row: 0, column: 0 }]
  }
]);

function makeStage(options: StageFixtureOptions = {}): ValidatedStageDefinition {
  const maxTurns = options.maxTurns ?? 4;
  const defaultSequence = Array.from(
    { length: maxTurns + 2 },
    (_, index) => ['raise-l', 'lower-single', 'raise-single'][index % 3] ?? 'raise-l'
  );

  return parseStageDefinition({
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: 'session-contract',
    dataVersion: '1_0_0',
    name: 'セッション契約試験',
    board: options.board ?? boardWithTerrain(),
    constructionMask: options.constructionMask ?? cells(1),
    storageMask: options.storageMask ?? cells(1),
    maxTurns,
    flowStepsPerTurn: 2,
    timerSeconds: options.timerSeconds === undefined ? 20 : options.timerSeconds,
    pieceDefinitions: PIECES,
    candidateSequence: options.candidateSequence ?? defaultSequence,
    rainEvents: options.rainEvents ?? [
      { turn: maxTurns, cells: [{ index: 0, amount: 1 }] }
    ],
    objective: options.objective ?? { type: 'stored-water', target: 1 },
    failure: options.failure ?? {
      maxDangerLeak: 65_535,
      maxPeakProtectedOverflow: 65_535
    },
    evaluation: {
      parWork: 3,
      controlTarget: 16,
      gradeThresholds: { s: 90, a: 70, b: 40 }
    }
  });
}

function construct(
  actionId: number,
  expectedRevision: number,
  slot: 0 | 1,
  anchorIndex: number,
  rotation: 0 | 1 | 2 | 3
): StageAction {
  return {
    type: 'construct',
    actionId,
    expectedRevision,
    slot,
    anchorIndex,
    rotation
  };
}

function skip(actionId: number, expectedRevision: number): StageAction {
  return { type: 'skip', actionId, expectedRevision };
}

function timeout(actionId: number, expectedRevision: number): StageAction {
  return { type: 'timeout', actionId, expectedRevision };
}

function undo(actionId: number, expectedRevision: number): StageAction {
  return { type: 'undo', actionId, expectedRevision };
}

function reversibleView(snapshot: StageSessionSnapshot): unknown {
  return {
    board: snapshot.board,
    completedTurns: snapshot.completedTurns,
    candidates: snapshot.candidates,
    candidateTokenIds: snapshot.candidateTokenIds,
    nextCandidateIndex: snapshot.nextCandidateIndex,
    nextRainIndex: snapshot.nextRainIndex,
    randomState: snapshot.randomState,
    metrics: snapshot.metrics,
    score: snapshot.score,
    phase: snapshot.phase,
    objectiveMet: snapshot.objectiveMet,
    failureReasons: snapshot.failureReasons
  };
}

function captureAuditState(session: StageSession): unknown {
  return {
    snapshot: session.snapshot,
    fullStateHash: session.fullStateHash,
    reversibleGameplayHash: session.reversibleGameplayHash,
    entries: session.entries
  };
}

function expectRejectedWithoutMutation(
  session: StageSession,
  action: StageAction,
  expectedReason?: StageRejectionReason
): StageExecution {
  const before = captureAuditState(session);
  const execution = session.execute(action);
  expect(execution.accepted).toBe(false);
  expect(execution.trace).toEqual([]);
  if (expectedReason !== undefined) expect(execution.reason).toBe(expectedReason);
  expect(execution.snapshot).toEqual(session.snapshot);
  expect(captureAuditState(session)).toEqual(before);
  return execution;
}

describe('M2 stage-session adversarial contract', () => {
  it('carries both candidates, replenishes only the used slot, and never replenishes skip/timeout', () => {
    const stage = makeStage({
      candidateSequence: [
        'raise-l',
        'lower-single',
        'raise-single',
        'raise-l',
        'lower-single',
        'raise-single'
      ]
    });
    const session = createStageSession(stage, 'standard');

    expect(session.snapshot.candidates).toEqual(['raise-l', 'lower-single']);
    expect(session.snapshot.nextCandidateIndex).toBe(2);

    const placed = session.execute(construct(0, 0, 0, 27, 0));
    expect(placed.accepted).toBe(true);
    expect(placed.snapshot.candidates).toEqual(['raise-single', 'lower-single']);
    expect(placed.snapshot.nextCandidateIndex).toBe(3);
    expect(placed.snapshot.completedTurns).toBe(1);

    const beforeSkip = placed.snapshot.candidates;
    const beforeSkipIndex = placed.snapshot.nextCandidateIndex;
    const skipped = session.execute(skip(1, 1));
    expect(skipped.accepted).toBe(true);
    expect(skipped.snapshot.candidates).toEqual(beforeSkip);
    expect(skipped.snapshot.nextCandidateIndex).toBe(beforeSkipIndex);
    expect(skipped.snapshot.completedTurns).toBe(2);

    const timedSession = createStageSession(stage, 'standard');
    const beforeTimeout = timedSession.snapshot;
    const timedOut = timedSession.execute(timeout(0, 0));
    expect(timedOut.accepted).toBe(true);
    expect(timedOut.snapshot.candidates).toEqual(beforeTimeout.candidates);
    expect(timedOut.snapshot.nextCandidateIndex).toBe(
      beforeTimeout.nextCandidateIndex
    );
    expect(timedOut.snapshot.completedTurns).toBe(1);

    const unlimited = createStageSession(stage, 'unlimited');
    expectRejectedWithoutMutation(unlimited, timeout(0, 0), 'timer-disabled');
  });

  it('places an asymmetric piece in all four rotations using canonical board cells', () => {
    const expectedCells = [
      [27, 35, 36],
      [26, 27, 34],
      [18, 19, 27],
      [20, 27, 28]
    ] as const;

    for (const rotation of [0, 1, 2, 3] as const) {
      const session = createStageSession(makeStage());
      const result = session.execute(construct(0, 0, 0, 27, rotation));
      expect(result.accepted).toBe(true);
      for (const index of expectedCells[rotation]) {
        expect(result.snapshot.board.terrain[index]).toBe(4);
      }
      expect(result.trace.map((event) => event.phase)).toEqual([
        'construction',
        'rain',
        'flow',
        'flow',
        'evaluation'
      ]);
    }
  });

  it('previews every production flow step without mutating state and matches execution', () => {
    const stage = makeStage({
      rainEvents: [{ turn: 1, cells: [{ index: 27, amount: 8 }] }]
    });
    const session = createStageSession(stage);
    const action = construct(0, 0, 0, 27, 0);
    const before = captureAuditState(session);
    const preview = session.preview(action);

    expect(preview.valid).toBe(true);
    if (!('nextFlow' in preview)) throw new Error('expected a valid turn preview');
    expect(preview.placementCells).toEqual([27, 35, 36]);
    expect(preview.rainCells).toEqual([{ index: 27, amount: 8 }]);
    expect(preview.boardAfterRain.water[27]).toBe(8);
    expect(preview.boardAfterRain.flowStep).toBe(0);
    expect(preview.flowSteps).toHaveLength(2);
    expect(preview.boardAfterTurn).toEqual(
      expect.objectContaining({ flowStep: 2 })
    );
    expect(preview.phase).toBe('awaiting-turn');
    expect(preview.failureReasons).toEqual([]);
    expect(captureAuditState(session)).toEqual(before);

    const execution = session.execute(action);
    const firstFlow = execution.trace.find((event) => event.phase === 'flow');
    expect(firstFlow?.flowResult).toEqual(preview.nextFlow);
    expect(firstFlow?.flowStep).toBe(preview.boardAfterNextFlow.flowStep);
    expect(execution.snapshot.board.terrain).toEqual(preview.terrainAfterConstruction);
    expect(execution.snapshot.board).toEqual(preview.boardAfterTurn);
    expect(execution.snapshot.phase).toBe(preview.phase);
    expect(execution.snapshot.failureReasons).toEqual(preview.failureReasons);
  });

  it('reports a failure that appears after the first preview step', () => {
    const board = boardWithTerrain(3);
    board.terrain[6] = 2;
    board.terrain[7] = 1;
    board.dangerEdgeMask[7] = Direction.East;
    board.water[6] = 8;
    const stage = makeStage({
      board,
      rainEvents: [],
      objective: { type: 'stored-water', target: 1 },
      failure: { maxDangerLeak: 0, maxPeakProtectedOverflow: 65_535 }
    });
    const session = createStageSession(stage);
    const preview = session.preview(skip(0, 0));

    expect(preview.valid).toBe(true);
    if (!('nextFlow' in preview)) throw new Error('expected a valid turn preview');
    expect(preview.nextFlow.dangerLeaked).toBe(0);
    expect(preview.flowSteps[1]?.dangerLeaked).toBeGreaterThan(0);
    expect(preview.phase).toBe('failed');
    expect(preview.failureReasons).toContain('danger-leak');
  });

  it('rejects board edges and construction-mask violations without consuming state', () => {
    const edgeSession = createStageSession(makeStage());
    expectRejectedWithoutMutation(
      edgeSession,
      construct(0, 0, 0, 63, 0),
      'cell-out-of-bounds'
    );

    const constructionMask = cells(1);
    constructionMask[35] = 0;
    const forbiddenSession = createStageSession(makeStage({ constructionMask }));
    expectRejectedWithoutMutation(
      forbiddenSession,
      construct(0, 0, 0, 27, 0),
      'construction-forbidden'
    );
  });

  it('rejects upper/lower terrain limits and rolls back every multi-cell write', () => {
    const upperBoard = boardWithTerrain();
    upperBoard.terrain[35] = MAX_TERRAIN_HEIGHT;
    const upperSession = createStageSession(makeStage({ board: upperBoard }));
    const beforeUpper = upperSession.snapshot.board.terrain;
    expectRejectedWithoutMutation(
      upperSession,
      construct(0, 0, 0, 27, 0),
      'terrain-limit'
    );
    expect(upperSession.snapshot.board.terrain).toEqual(beforeUpper);
    expect(upperSession.snapshot.board.terrain[27]).toBe(3);
    expect(upperSession.snapshot.board.terrain[35]).toBe(MAX_TERRAIN_HEIGHT);

    const lowerBoard = boardWithTerrain();
    lowerBoard.terrain[27] = 0;
    const lowerSession = createStageSession(makeStage({ board: lowerBoard }));
    expectRejectedWithoutMutation(
      lowerSession,
      construct(0, 0, 1, 27, 0),
      'terrain-limit'
    );
    expect(lowerSession.snapshot.board.terrain[27]).toBe(0);
  });

  it('deduplicates exact retries while rejecting action collisions, stale revisions, and skipped ids', () => {
    const session = createStageSession(makeStage());
    const action = construct(0, 0, 0, 27, 0);
    const first = session.execute(action);
    expect(first.accepted).toBe(true);
    const afterFirst = captureAuditState(session);

    const retry = session.execute(action);
    expect(retry.accepted).toBe(true);
    expect(retry.replayed).toBe(true);
    expect(retry.trace).toEqual(first.trace);
    expect(retry.snapshot).toEqual(first.snapshot);
    expect(captureAuditState(session)).toEqual(afterFirst);
    expect(session.entries).toHaveLength(1);

    expectRejectedWithoutMutation(
      session,
      construct(0, 0, 0, 28, 0),
      'action-id-collision'
    );
    expectRejectedWithoutMutation(session, skip(1, 0), 'stale-revision');
    expectRejectedWithoutMutation(session, skip(2, 1), 'stale-action-id');
  });

  it('serializes construct/timeout races so exactly one contender advances the turn', () => {
    const stage = makeStage();
    const constructFirst = createStageSession(stage, 'standard');
    expect(constructFirst.execute(construct(0, 0, 0, 27, 0)).accepted).toBe(true);
    expectRejectedWithoutMutation(
      constructFirst,
      timeout(0, 0),
      'action-id-collision'
    );
    expect(constructFirst.snapshot.completedTurns).toBe(1);
    expect(constructFirst.entries).toHaveLength(1);

    const timeoutFirst = createStageSession(stage, 'standard');
    expect(timeoutFirst.execute(timeout(0, 0)).accepted).toBe(true);
    expectRejectedWithoutMutation(
      timeoutFirst,
      construct(0, 0, 0, 27, 0),
      'action-id-collision'
    );
    expect(timeoutFirst.snapshot.completedTurns).toBe(1);
    expect(timeoutFirst.entries).toHaveLength(1);
  });

  it('Undo restores every reversible field/hash while monotonically advancing audit state', () => {
    const stage = makeStage({
      rainEvents: [{ turn: 1, cells: [{ index: 27, amount: 8 }] }]
    });
    const session = createStageSession(stage);
    const before = session.snapshot;
    const beforeReversibleHash = session.reversibleGameplayHash;
    const beforeFullHash = session.fullStateHash;

    const first = session.execute(construct(0, 0, 0, 27, 0));
    expect(first.accepted).toBe(true);
    expect(session.reversibleGameplayHash).not.toBe(beforeReversibleHash);
    const afterTurnFullHash = session.fullStateHash;

    const undone = session.execute(undo(1, 1));
    expect(undone.accepted).toBe(true);
    expect(reversibleView(undone.snapshot)).toEqual(reversibleView(before));
    expect(session.reversibleGameplayHash).toBe(beforeReversibleHash);
    expect(session.fullStateHash).not.toBe(beforeFullHash);
    expect(session.fullStateHash).not.toBe(afterTurnFullHash);
    expect(undone.snapshot.undoUsed).toBe(true);
    expect(undone.snapshot.revision).toBe(2);
    expect(undone.snapshot.nextActionId).toBe(2);
    expect(session.entries).toHaveLength(2);

    const repeated = session.execute(construct(2, 2, 0, 27, 0));
    expect(repeated.accepted).toBe(true);
    expect(repeated.trace).toEqual(first.trace);
    expect(reversibleView(repeated.snapshot)).toEqual(reversibleView(first.snapshot));
    expectRejectedWithoutMutation(session, undo(3, 3), 'undo-already-used');
  });

  it('finishes all fixed flow steps and gives failure precedence over simultaneous clear', () => {
    const board = boardWithTerrain(MAX_TERRAIN_HEIGHT);
    board.water[27] = 1;
    board.dangerEdgeMask[0] = Direction.North;
    const stage = makeStage({
      board,
      maxTurns: 1,
      candidateSequence: ['raise-l', 'lower-single', 'raise-single'],
      rainEvents: [{ turn: 1, cells: [{ index: 0, amount: 8 }] }],
      objective: { type: 'stored-water', target: 1 },
      failure: { maxDangerLeak: 0, maxPeakProtectedOverflow: 65_535 }
    });
    const session = createStageSession(stage);
    const result = session.execute(skip(0, 0));

    expect(result.accepted).toBe(true);
    expect(result.snapshot.objectiveMet).toBe(true);
    expect(result.snapshot.failureReasons).not.toHaveLength(0);
    expect(result.snapshot.phase).toBe('failed');
    expect(result.trace.filter((event) => event.phase === 'flow')).toHaveLength(2);
    expect(result.trace.at(-1)?.phase).toBe('evaluation');
  });

  it('records rain-time flooding even when the first flow step drains it away', () => {
    const board = boardWithTerrain();
    board.cellFlags[27] = 1;
    board.protectedWaterLimit[27] = 0;
    board.drainCapacity[27] = 8;
    const stage = makeStage({
      board,
      maxTurns: 1,
      candidateSequence: ['raise-l', 'lower-single', 'raise-single'],
      rainEvents: [{ turn: 1, cells: [{ index: 27, amount: 8 }] }],
      objective: { type: 'protect', target: 1 },
      failure: { maxDangerLeak: 65_535, maxPeakProtectedOverflow: 0 }
    });
    const session = createStageSession(stage);
    const result = session.execute(skip(0, 0));

    expect(result.accepted).toBe(true);
    expect(result.trace[1]?.phase).toBe('rain');
    expect(result.trace[1]?.protectedOverflows).toEqual([{ index: 27, amount: 8 }]);
    expect(result.trace[2]?.protectedOverflows).toEqual([]);
    expect(result.snapshot.metrics.firstFloodStep).toBe(0);
    expect(result.snapshot.metrics.peakProtectedOverflow).toBe(8);
    expect(result.snapshot.phase).toBe('failed');
    expect(result.snapshot.failureReasons).toContain('protected-overflow');
  });

  it('atomically rejects failed placement with no trace, checkpoint, hash, or log residue', () => {
    const board = boardWithTerrain();
    board.terrain[36] = MAX_TERRAIN_HEIGHT;
    const session = createStageSession(makeStage({ board }));
    const before = captureAuditState(session);

    const result = session.execute(construct(0, 0, 0, 27, 0));
    expect(result.accepted).toBe(false);
    expect(result.trace).toEqual([]);
    expect(result.snapshot.undoUsed).toBe(false);
    expect(result.snapshot.revision).toBe(0);
    expect(result.snapshot.nextActionId).toBe(0);
    expect(result.snapshot.completedTurns).toBe(0);
    expect(captureAuditState(session)).toEqual(before);
  });
});
