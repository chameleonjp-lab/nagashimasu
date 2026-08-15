import { describe, expect, it } from 'vitest';

import { indexOf } from '../../src/domain/board';
import {
  MAX_TERRAIN_HEIGHT,
  MIN_TERRAIN_HEIGHT
} from '../../src/domain/constants';
import { resolvePiecePlacement } from '../../src/domain/pieces';
import type { Rotation } from '../../src/domain/pieces';
import type { ValidatedStageDefinition } from '../../src/domain/stage-definition';
import type { CandidateSlot, StageAction } from '../../src/domain/stage-replay';
import {
  StageSession,
  createInitialStageState,
  createStageSession,
  hashReversibleGameplay,
  reduceStageAction
} from '../../src/domain/stage-session';
import type { StageReducerState } from '../../src/domain/stage-session';
import { getBuiltInStage } from '../../src/domain/stages';

interface PlannedConstruct {
  readonly type: 'construct';
  readonly slot: CandidateSlot;
  readonly anchorIndex: number;
  readonly rotation: Rotation;
}

interface PlannedSkip {
  readonly type: 'skip';
}

type PlannedMove = PlannedConstruct | PlannedSkip;

interface TurnMove {
  /** One-based turn number. */
  readonly turn: number;
  readonly move: PlannedMove;
}

function requireStage(id: string): ValidatedStageDefinition {
  const stage = getBuiltInStage(id);
  if (stage === undefined) throw new Error(`missing built-in stage ${id}`);
  return stage;
}

function executeNext(session: StageSession, move: PlannedMove): void {
  const { nextActionId, revision } = session.snapshot;
  const action: StageAction = move.type === 'construct'
    ? {
      type: 'construct',
      actionId: nextActionId,
      expectedRevision: revision,
      slot: move.slot,
      anchorIndex: move.anchorIndex,
      rotation: move.rotation
    }
    : {
      type: 'skip',
      actionId: nextActionId,
      expectedRevision: revision
    };
  const result = session.execute(action);
  if (!result.accepted) {
    throw new Error(
      `turn ${session.snapshot.completedTurns + 1} rejected: ${result.reason ?? 'unknown'}`
    );
  }
}

function playPlan(
  stage: ValidatedStageDefinition,
  moves: readonly TurnMove[]
): StageSession {
  const session = createStageSession(stage, 'unlimited');
  const byTurn = new Map(moves.map(({ turn, move }) => [turn, move]));
  while (
    session.snapshot.phase === 'awaiting-turn' &&
    session.snapshot.completedTurns < stage.maxTurns
  ) {
    const turn = session.snapshot.completedTurns + 1;
    executeNext(session, byTurn.get(turn) ?? { type: 'skip' });
  }
  return session;
}

function expectClearedAtLastTurn(
  session: StageSession,
  stage: ValidatedStageDefinition
): void {
  expect(session.snapshot.phase).toBe('cleared');
  expect(session.snapshot.completedTurns).toBe(stage.maxTurns);
  expect(session.snapshot.objectiveMet).toBe(true);
  expect(session.snapshot.failureReasons).toEqual([]);
  expect(session.entries).toHaveLength(stage.maxTurns);
  expect(session.entries.map((entry) => entry.action.actionId)).toEqual(
    Array.from({ length: stage.maxTurns }, (_, index) => index)
  );
  expect(session.entries.map((entry) => entry.action.expectedRevision)).toEqual(
    Array.from({ length: stage.maxTurns }, (_, index) => index)
  );
}

function firstLegalMove(
  stage: ValidatedStageDefinition,
  session: StageSession,
  slot: CandidateSlot
): PlannedMove {
  const pieceId = session.snapshot.candidates[slot];
  const piece = stage.pieceDefinitions.find((candidate) => candidate.id === pieceId);
  if (piece === undefined) throw new Error(`missing candidate piece ${pieceId}`);

  for (let anchorIndex = 0; anchorIndex < stage.board.terrain.length; anchorIndex += 1) {
    for (const rotation of [0, 1, 2, 3] as const) {
      const placement = resolvePiecePlacement(piece, anchorIndex, rotation);
      if (!placement.valid) continue;
      const legal = placement.cells.every((index) => {
        const next = (session.snapshot.board.terrain[index] ?? -1) + piece.delta;
        return stage.constructionMask[index] === 1 &&
          next >= MIN_TERRAIN_HEIGHT &&
          next <= MAX_TERRAIN_HEIGHT;
      });
      if (legal) return { type: 'construct', slot, anchorIndex, rotation };
    }
  }
  return { type: 'skip' };
}

function playFirstLegalFixedSlot(
  stage: ValidatedStageDefinition,
  slot: CandidateSlot
): StageSession {
  const session = createStageSession(stage, 'unlimited');
  while (
    session.snapshot.phase === 'awaiting-turn' &&
    session.snapshot.completedTurns < stage.maxTurns
  ) {
    executeNext(session, firstLegalMove(stage, session, slot));
  }
  return session;
}

interface PolicyExploration {
  readonly terminalStates: readonly StageReducerState[];
  readonly visitedStates: number;
}

function policyMoves(
  stage: ValidatedStageDefinition,
  state: StageReducerState,
  allows: (slot: CandidateSlot, delta: -1 | 1) => boolean
): readonly PlannedMove[] {
  const moves: PlannedMove[] = [{ type: 'skip' }];
  for (const slot of [0, 1] as const) {
    const pieceId = state.gameplay.candidates[slot];
    const piece = stage.pieceDefinitions.find((candidate) => candidate.id === pieceId);
    if (piece === undefined) throw new Error(`missing candidate piece ${pieceId}`);
    if (!allows(slot, piece.delta)) continue;

    const placements = new Set<string>();
    for (let anchorIndex = 0; anchorIndex < stage.board.terrain.length; anchorIndex += 1) {
      for (const rotation of [0, 1, 2, 3] as const) {
        const placement = resolvePiecePlacement(piece, anchorIndex, rotation);
        if (!placement.valid) continue;
        const legal = placement.cells.every((index) => {
          const next = (state.gameplay.board.terrain[index] ?? -1) + piece.delta;
          return stage.constructionMask[index] === 1 &&
            next >= MIN_TERRAIN_HEIGHT &&
            next <= MAX_TERRAIN_HEIGHT;
        });
        const signature = placement.cells.join(',');
        if (!legal || placements.has(signature)) continue;
        placements.add(signature);
        moves.push({ type: 'construct', slot, anchorIndex, rotation });
      }
    }
  }
  return moves;
}

function explorePolicy(
  stage: ValidatedStageDefinition,
  allows: (slot: CandidateSlot, delta: -1 | 1) => boolean
): PolicyExploration {
  let frontier = [createInitialStageState(stage, 'unlimited')];
  const terminalByHash = new Map<string, StageReducerState>();
  let visitedStates = 0;

  while (frontier.length > 0) {
    const nextByHash = new Map<string, StageReducerState>();
    for (const state of frontier) {
      visitedStates += 1;
      if (state.gameplay.phase !== 'awaiting-turn') {
        terminalByHash.set(hashReversibleGameplay(state.gameplay), state);
        continue;
      }

      for (const move of policyMoves(stage, state, allows)) {
        const action: StageAction = move.type === 'construct'
          ? {
            type: 'construct',
            actionId: state.nextActionId,
            expectedRevision: state.revision,
            slot: move.slot,
            anchorIndex: move.anchorIndex,
            rotation: move.rotation
          }
          : {
            type: 'skip',
            actionId: state.nextActionId,
            expectedRevision: state.revision
          };
        const reduction = reduceStageAction(
          stage,
          state,
          action,
          state.gameplay.completedTurns
        );
        if (!reduction.accepted || reduction.replayed) {
          throw new Error(`policy exploration rejected ${move.type}: ${reduction.reason}`);
        }
        const key = hashReversibleGameplay(reduction.state.gameplay);
        if (reduction.state.gameplay.phase === 'awaiting-turn') {
          nextByHash.set(key, reduction.state);
        } else {
          terminalByHash.set(key, reduction.state);
        }
      }
    }
    frontier = [...nextByHash.values()];
  }

  return Object.freeze({
    terminalStates: Object.freeze([...terminalByHash.values()]),
    visitedStates
  });
}

function terrainHash(terrain: readonly number[]): string {
  let hash = 0xcbf29ce484222325n;
  for (const height of terrain) {
    hash ^= BigInt(height);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

describe('built-in stage headless playthroughs', () => {
  it('clears stage 1 through either carried line or two replenished singles', () => {
    const stage = requireStage('stage-01-first-pond');
    const lineRoute = playPlan(stage, [
      {
        turn: 1,
        move: {
          type: 'construct',
          slot: 0,
          anchorIndex: indexOf(2, 0),
          rotation: 1
        }
      }
    ]);
    const singleRoute = playPlan(stage, [
      {
        turn: 1,
        move: {
          type: 'construct',
          slot: 1,
          anchorIndex: indexOf(2, 0),
          rotation: 0
        }
      },
      {
        turn: 2,
        move: {
          type: 'construct',
          slot: 1,
          anchorIndex: indexOf(3, 0),
          rotation: 0
        }
      }
    ]);

    expectClearedAtLastTurn(lineRoute, stage);
    expectClearedAtLastTurn(singleRoute, stage);
    expect(lineRoute.snapshot.score).toMatchObject({ total: 100, grade: 'S' });
    expect(singleRoute.snapshot.score).toMatchObject({ total: 100, grade: 'S' });
    expect(lineRoute.snapshot.metrics.work).toBe(2);
    expect(singleRoute.snapshot.metrics.work).toBe(2);
  });

  it('clears stage 2 by lowering its precise bottleneck', () => {
    const stage = requireStage('stage-02-open-to-sea');
    const session = playPlan(stage, [
      {
        turn: 1,
        move: {
          type: 'construct',
          slot: 0,
          anchorIndex: indexOf(3, 4),
          rotation: 0
        }
      }
    ]);

    expectClearedAtLastTurn(session, stage);
    expect(session.snapshot.metrics.safeDrained).toBe(8);
    expect(session.snapshot.metrics.work).toBe(1);
    expect(session.snapshot.score).toMatchObject({ total: 100, grade: 'S' });
  });

  it('clears stage 3 through two mixed routes with different final terrain', () => {
    const stage = requireStage('stage-03-rain-order');
    const northRoute = playPlan(stage, [
      {
        turn: 1,
        move: {
          type: 'construct',
          slot: 0,
          anchorIndex: indexOf(4, 1),
          rotation: 1
        }
      },
      {
        turn: 2,
        move: {
          type: 'construct',
          slot: 1,
          anchorIndex: indexOf(1, 5),
          rotation: 0
        }
      }
    ]);
    const southRoute = playPlan(stage, [
      {
        turn: 1,
        move: {
          type: 'construct',
          slot: 0,
          anchorIndex: indexOf(4, 2),
          rotation: 1
        }
      },
      {
        turn: 2,
        move: {
          type: 'construct',
          slot: 1,
          anchorIndex: indexOf(3, 5),
          rotation: 0
        }
      }
    ]);

    for (const session of [northRoute, southRoute]) {
      expectClearedAtLastTurn(session, stage);
      expect(session.snapshot.metrics.peakProtectedOverflow).toBe(0);
      expect(session.snapshot.metrics.safeDrained).toBe(24);
      expect(session.snapshot.metrics.work).toBe(3);
      expect(session.snapshot.score).toMatchObject({ total: 100, grade: 'S' });
    }
    expect(northRoute.snapshot.board.terrain).not.toEqual(
      southRoute.snapshot.board.terrain
    );
    expect(terrainHash(northRoute.snapshot.board.terrain)).not.toBe(
      terrainHash(southRoute.snapshot.board.terrain)
    );
  });
});

describe('built-in stage dominance checks', () => {
  it('does not let all-skip clear any of stages 1 to 3', () => {
    for (const stageId of [
      'stage-01-first-pond',
      'stage-02-open-to-sea',
      'stage-03-rain-order'
    ]) {
      const stage = requireStage(stageId);
      const session = playPlan(stage, []);
      expect(session.snapshot.phase, stageId).not.toBe('cleared');
      expect(session.snapshot.score.grade, stageId).toBeNull();
    }
  });

  it('rejects raise-only, lower-only, and all-skip solutions for stage 3', () => {
    const stage = requireStage('stage-03-rain-order');
    const raiseOnly = playPlan(stage, [
      {
        turn: 1,
        move: {
          type: 'construct',
          slot: 0,
          anchorIndex: indexOf(4, 1),
          rotation: 1
        }
      },
      {
        turn: 2,
        move: {
          type: 'construct',
          slot: 0,
          anchorIndex: indexOf(1, 5),
          rotation: 0
        }
      }
    ]);
    const lowerOnly = playPlan(stage, [
      {
        turn: 1,
        move: {
          type: 'construct',
          slot: 1,
          anchorIndex: indexOf(1, 5),
          rotation: 0
        }
      }
    ]);
    const allSkip = playPlan(stage, []);

    for (const session of [raiseOnly, lowerOnly, allSkip]) {
      expect(session.snapshot.phase).toBe('failed');
      expect(session.snapshot.failureReasons).toContain('protected-overflow');
      expect(session.snapshot.metrics.peakProtectedOverflow).toBeGreaterThan(0);
      expect(session.snapshot.score.grade).toBeNull();
    }
    expect(raiseOnly.snapshot.metrics.peakProtectedOverflow).toBe(4);
    expect(lowerOnly.snapshot.metrics.peakProtectedOverflow).toBe(2);
    expect(allSkip.snapshot.metrics.peakProtectedOverflow).toBe(2);

    const everyRaiseOnly = explorePolicy(stage, (_slot, delta) => delta === 1);
    const everyLowerOnly = explorePolicy(stage, (_slot, delta) => delta === -1);
    for (const exploration of [everyRaiseOnly, everyLowerOnly]) {
      expect(exploration.terminalStates.length).toBeGreaterThan(0);
      expect(exploration.terminalStates.every(
        (state) => state.gameplay.phase !== 'cleared'
      )).toBe(true);
      expect(exploration.visitedStates).toBeLessThan(5_000);
    }
  });

  it('does not let a blind first-legal fixed-slot policy dominate stages 1 or 2', () => {
    for (const stageId of ['stage-01-first-pond', 'stage-02-open-to-sea']) {
      const stage = requireStage(stageId);
      for (const slot of [0, 1] as const) {
        const session = playFirstLegalFixedSlot(stage, slot);
        expect(session.snapshot.phase, `${stageId} slot ${slot}`).not.toBe('cleared');
        expect(session.snapshot.score.grade, `${stageId} slot ${slot}`).toBeNull();
      }
    }
  });

  it('does not let stage 2 slot 1 opening detours replace its precise solution', () => {
    const stage = requireStage('stage-02-open-to-sea');
    const direct = playPlan(stage, [
      {
        turn: 1,
        move: {
          type: 'construct',
          slot: 0,
          anchorIndex: indexOf(3, 4),
          rotation: 0
        }
      }
    ]);
    const slotOneDetours: StageSession[] = [];
    for (const lineColumn of [2, 3, 4]) {
      for (const singleColumn of [2, 3, 4, 5]) {
        slotOneDetours.push(playPlan(stage, [
          {
            turn: 1,
            move: {
              type: 'construct',
              slot: 1,
              anchorIndex: indexOf(3, lineColumn),
              rotation: 0
            }
          },
          {
            turn: 2,
            move: {
              type: 'construct',
              slot: 1,
              anchorIndex: indexOf(3, singleColumn),
              rotation: 0
            }
          }
        ]));
      }
    }

    expect(direct.snapshot.phase).toBe('cleared');
    expect(slotOneDetours).toHaveLength(12);
    expect(slotOneDetours.every((session) => session.snapshot.phase === 'failed'))
      .toBe(true);
    expect(Math.max(
      ...slotOneDetours.map((session) => session.snapshot.metrics.safeDrained)
    )).toBeLessThan(stage.objective.target);
  });
});
