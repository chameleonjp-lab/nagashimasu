import { describe, expect, it } from 'vitest';

import { BoardState } from '../../src/domain/board';
import {
  CELL_COUNT,
  MAX_CELL_WATER
} from '../../src/domain/constants';
import { PIECE_SCHEMA_VERSION } from '../../src/domain/pieces';
import {
  STAGE_SCHEMA_VERSION,
  parseStageDefinition
} from '../../src/domain/stage-definition';
import type { ValidatedStageDefinition } from '../../src/domain/stage-definition';
import type { StageAction } from '../../src/domain/stage-replay';
import {
  createInitialStageState,
  hashFullStageState,
  hashReversibleGameplay,
  reduceStageAction
} from '../../src/domain/stage-session';
import type {
  StageMetrics,
  StageReducerState,
  StageScore
} from '../../src/domain/stage-session';
import { BUILT_IN_STAGES } from '../../src/domain/stages';
import type { BoardSnapshot } from '../../src/domain/types';

function cells(value = 0): number[] {
  return Array<number>(CELL_COUNT).fill(value);
}

function testStage(options: {
  readonly initialWater?: number;
  readonly rainAmount?: number;
} = {}): ValidatedStageDefinition {
  const water = cells();
  water[27] = options.initialWater ?? 20;
  const maxTurns = 4;

  return parseStageDefinition({
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: 'invariant-stage',
    dataVersion: '1_0_0',
    name: '不変条件試験',
    board: {
      terrain: cells(3),
      water,
      cellFlags: cells(),
      drainCapacity: cells(),
      protectedWaterLimit: cells(),
      safeEdgeMask: cells(),
      dangerEdgeMask: cells()
    },
    constructionMask: cells(1),
    storageMask: cells(1),
    maxTurns,
    flowStepsPerTurn: 2,
    timerSeconds: 20,
    pieceDefinitions: [
      {
        schemaVersion: PIECE_SCHEMA_VERSION,
        id: 'raise-single',
        delta: 1,
        offsets: [{ row: 0, column: 0 }]
      }
    ],
    candidateSequence: Array<string>(maxTurns + 2).fill('raise-single'),
    rainEvents: options.rainAmount === undefined
      ? []
      : [{ turn: 1, cells: [{ index: 0, amount: options.rainAmount }] }],
    objective: {
      type: 'stored-water',
      target: Math.max(1, options.initialWater ?? 20)
    },
    failure: {
      maxDangerLeak: MAX_CELL_WATER,
      maxPeakProtectedOverflow: MAX_CELL_WATER
    },
    evaluation: {
      parWork: 1,
      controlTarget: 20,
      gradeThresholds: { s: 90, a: 70, b: 40 }
    }
  });
}

function skip(actionId = 0, expectedRevision = 0): StageAction {
  return { type: 'skip', actionId, expectedRevision };
}

function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function craftedState(
  source: StageReducerState,
  changes: {
    readonly board?: BoardSnapshot;
    readonly metrics?: Partial<StageMetrics>;
  }
): StageReducerState {
  const copy = jsonCopy(source);
  return {
    ...copy,
    gameplay: {
      ...copy.gameplay,
      board: changes.board ?? copy.gameplay.board,
      metrics: {
        ...copy.gameplay.metrics,
        ...changes.metrics
      }
    }
  };
}

function expectThrowWithoutMutation(
  definition: ValidatedStageDefinition,
  state: StageReducerState,
  expectedMessage: RegExp
): void {
  const before = jsonCopy(state);
  const beforeFullHash = hashFullStageState(definition, state);
  const beforeGameplayHash = hashReversibleGameplay(state.gameplay);

  expect(() => reduceStageAction(definition, state, skip(), 0))
    .toThrow(expectedMessage);

  expect(state).toEqual(before);
  expect(hashFullStageState(definition, state)).toBe(beforeFullHash);
  expect(hashReversibleGameplay(state.gameplay)).toBe(beforeGameplayHash);
}

function snapshotWithCounters(
  snapshot: BoardSnapshot,
  changes: Partial<Pick<
    BoardSnapshot,
    'flowStep' | 'introducedWater' | 'safeDrain' | 'dangerLeak'
  >> & { readonly water?: readonly number[] }
): BoardSnapshot {
  return BoardState.fromSnapshot({
    ...snapshot,
    ...changes
  }).snapshot();
}

function scoreAfterSkip(
  definition: ValidatedStageDefinition,
  state: StageReducerState
): StageScore {
  const reduction = reduceStageAction(definition, state, skip(), 0);
  expect(reduction.accepted).toBe(true);
  return reduction.state.gameplay.score;
}

function expectScoreBounds(score: StageScore): void {
  expect(score.safety).toBeGreaterThanOrEqual(0);
  expect(score.safety).toBeLessThanOrEqual(50);
  expect(score.efficiency).toBeGreaterThanOrEqual(0);
  expect(score.efficiency).toBeLessThanOrEqual(30);
  expect(score.control).toBeGreaterThanOrEqual(0);
  expect(score.control).toBeLessThanOrEqual(20);
  expect(score.total).toBe(score.safety + score.efficiency + score.control);
  expect(score.total).toBeGreaterThanOrEqual(0);
  expect(score.total).toBeLessThanOrEqual(100);
}

describe('pure stage reducer failure atomicity', () => {
  it('leaves the source state and both hashes intact when rain exceeds Uint16', () => {
    const definition = testStage({ initialWater: 0, rainAmount: 1 });
    const initial = createInitialStageState(definition);
    const water = cells();
    water[0] = MAX_CELL_WATER;
    const fullCell = new BoardState({ water }).snapshot();
    const state = craftedState(initial, { board: fullCell });

    expectThrowWithoutMutation(definition, state, /water\[0\] after rain/);
  });

  it('rolls back after flow counter overflow at Number.MAX_SAFE_INTEGER', () => {
    const definition = testStage();
    const initial = createInitialStageState(definition);
    const exhaustedCounter = snapshotWithCounters(initial.gameplay.board, {
      flowStep: Number.MAX_SAFE_INTEGER
    });
    const state = craftedState(initial, { board: exhaustedCounter });

    expectThrowWithoutMutation(definition, state, /flowStep/);
  });

  it('rolls back completed flow work when score multiplication exceeds safe integer', () => {
    const definition = testStage();
    const initial = createInitialStageState(definition);
    // parWork is subtracted before multiplying by four, so two is the first
    // offset that keeps the post-subtraction product outside the safe range.
    const unsafePenaltyWork = Math.floor(Number.MAX_SAFE_INTEGER / 4) + 2;
    const state = craftedState(initial, {
      metrics: { work: unsafePenaltyWork }
    });

    expectThrowWithoutMutation(definition, state, /work penalty.*safe integer/);
  });
});

describe('stage reducer water and scoring invariants', () => {
  it('balances introduced water against board water, safe drain, and danger leak after every accepted turn', () => {
    let acceptedTurns = 0;

    for (const definition of BUILT_IN_STAGES) {
      let state = createInitialStageState(definition);
      while (state.gameplay.phase === 'awaiting-turn') {
        const action = skip(state.nextActionId, state.revision);
        const reduction = reduceStageAction(
          definition,
          state,
          action,
          state.nextActionId
        );
        expect(reduction.accepted).toBe(true);
        state = reduction.state;
        acceptedTurns += 1;

        const snapshot = state.gameplay.board;
        const storedWater = snapshot.water.reduce(
          (total, amount) => total + amount,
          0
        );
        expect(snapshot.introducedWater).toBe(
          storedWater + snapshot.safeDrain + snapshot.dangerLeak
        );
        expect(() => BoardState.fromSnapshot(snapshot).assertWaterLedger())
          .not.toThrow();
      }
    }

    expect(acceptedTurns).toBeGreaterThan(3);
  });

  it('keeps all score axes bounded and makes every adverse metric monotonic', () => {
    const definition = testStage();
    const initial = createInitialStageState(definition);

    const dangerScores = [0, 2, 4].map((dangerLeak) => {
      const board = snapshotWithCounters(initial.gameplay.board, {
        introducedWater: initial.gameplay.board.introducedWater + dangerLeak,
        dangerLeak
      });
      return scoreAfterSkip(
        definition,
        craftedState(initial, {
          board,
          metrics: { dangerLeaked: dangerLeak }
        })
      );
    });

    const floodScores = [0, 2, 4].map((protectedDamage) => {
      const peakOverflowByCell = cells();
      peakOverflowByCell[0] = protectedDamage;
      return scoreAfterSkip(
        definition,
        craftedState(initial, {
          metrics: {
            peakProtectedOverflow: protectedDamage,
            peakOverflowByCell,
            protectedDamage
          }
        })
      );
    });

    const workScores = [1, 3, 5].map((work) =>
      scoreAfterSkip(definition, craftedState(initial, { metrics: { work } }))
    );
    const drainOverflowScores = [0, 2, 4].map((drainCapacityOverflow) =>
      scoreAfterSkip(
        definition,
        craftedState(initial, { metrics: { drainCapacityOverflow } })
      )
    );

    for (const score of [
      ...dangerScores,
      ...floodScores,
      ...workScores,
      ...drainOverflowScores
    ]) {
      expectScoreBounds(score);
    }

    expect(dangerScores.map((score) => score.safety)).toEqual([50, 46, 42]);
    expect(floodScores.map((score) => score.safety)).toEqual([50, 40, 30]);
    expect(workScores.map((score) => score.efficiency)).toEqual([30, 22, 14]);
    expect(drainOverflowScores.map((score) => score.control)).toEqual([20, 18, 16]);
  });
});
