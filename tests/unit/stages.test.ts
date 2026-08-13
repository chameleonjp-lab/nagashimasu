import { describe, expect, it } from 'vitest';

import { indexOf } from '../../src/domain/board';
import {
  CELL_COUNT,
  CellFlag,
  DEFAULT_HEIGHT_UNIT,
  MAX_TERRAIN_HEIGHT,
  MIN_TERRAIN_HEIGHT
} from '../../src/domain/constants';
import { parseStageDefinition } from '../../src/domain/stage-definition';
import type { ValidatedStageDefinition } from '../../src/domain/stage-definition';
import {
  BUILT_IN_STAGES,
  getBuiltInStage
} from '../../src/domain/stages';

function requireStage(id: string): ValidatedStageDefinition {
  const stage = getBuiltInStage(id);
  if (stage === undefined) throw new Error(`missing built-in stage ${id}`);
  return stage;
}

function enabledIndices(mask: readonly number[]): number[] {
  return mask.flatMap((enabled, index) => enabled === 1 ? [index] : []);
}

function applyStaticSolution(
  stage: ValidatedStageDefinition,
  operations: readonly {
    readonly cells: readonly number[];
    readonly delta: -1 | 1;
  }[]
): readonly number[] {
  const terrain = [...stage.board.terrain];
  for (const operation of operations) {
    for (const index of operation.cells) {
      expect(stage.constructionMask[index]).toBe(1);
      const next = (terrain[index] ?? Number.NaN) + operation.delta;
      expect(next).toBeGreaterThanOrEqual(MIN_TERRAIN_HEIGHT);
      expect(next).toBeLessThanOrEqual(MAX_TERRAIN_HEIGHT);
      terrain[index] = next;
    }
  }
  return terrain;
}

describe('built-in M2 stage fixtures', () => {
  it('exports three unique, parsed, deeply frozen stages and retrieves them by id', () => {
    expect(BUILT_IN_STAGES.map((stage) => stage.id)).toEqual([
      'stage-01-first-pond',
      'stage-02-open-to-sea',
      'stage-03-rain-order'
    ]);
    expect(new Set(BUILT_IN_STAGES.map((stage) => stage.id)).size).toBe(3);
    expect(Object.isFrozen(BUILT_IN_STAGES)).toBe(true);

    for (const stage of BUILT_IN_STAGES) {
      expect(getBuiltInStage(stage.id)).toBe(stage);
      expect(stage.schemaVersion).toBe('nagashimasu-stage-v1');
      expect(stage.definitionDigest).toMatch(/^[0-9a-f]{16}$/u);
      expect(stage.candidateSequence).toHaveLength(stage.maxTurns + 2);
      expect(stage.board.terrain).toHaveLength(CELL_COUNT);
      expect(Object.isFrozen(stage)).toBe(true);
      expect(Object.isFrozen(stage.board.terrain)).toBe(true);
      expect(Object.isFrozen(stage.candidateSequence)).toBe(true);

      const { definitionDigest, ...definition } = stage;
      const jsonCopy: unknown = JSON.parse(JSON.stringify(definition));
      expect(parseStageDefinition(jsonCopy).definitionDigest).toBe(definitionDigest);
    }

    expect(getBuiltInStage('missing-stage')).toBeUndefined();
  });

  it('keeps stable content digests for all shipped stage data', () => {
    expect(BUILT_IN_STAGES.map((stage) => stage.definitionDigest)).toEqual([
      'ec35efb9ef8bac3b',
      'dec52462f9944723',
      '17747c7a85db4d14'
    ]);
  });

  it('introduces raising, lowering, and mixed forecasting in that order', () => {
    const first = requireStage('stage-01-first-pond');
    const second = requireStage('stage-02-open-to-sea');
    const third = requireStage('stage-03-rain-order');

    expect(first.timerSeconds).toBeNull();
    expect(first.objective.type).toBe('stored-water');
    expect(new Set(first.pieceDefinitions.map((piece) => piece.delta))).toEqual(
      new Set([1])
    );

    expect(second.timerSeconds).toBeNull();
    expect(second.objective.type).toBe('safe-drain');
    expect(new Set(second.pieceDefinitions.map((piece) => piece.delta))).toEqual(
      new Set([-1])
    );

    expect(third.timerSeconds).toBe(20);
    expect(third.objective).toEqual({ type: 'protect', target: 3 });
    expect(new Set(third.pieceDefinitions.map((piece) => piece.delta))).toEqual(
      new Set([-1, 1])
    );
    expect(third.candidateSequence.slice(0, 2)).toEqual([
      'raise-line',
      'lower-single'
    ]);
    expect(third.rainEvents.map((event) => event.turn)).toEqual([2, 5, 9]);
  });

  it('does not contain a three-candidate identical run', () => {
    for (const stage of BUILT_IN_STAGES) {
      for (let index = 2; index < stage.candidateSequence.length; index += 1) {
        const current = stage.candidateSequence[index];
        expect(
          current === stage.candidateSequence[index - 1] &&
          current === stage.candidateSequence[index - 2],
          `${stage.id} candidate run ending at ${index}`
        ).toBe(false);
      }
    }
  });
});

describe('stage 3 anti-dominance structure', () => {
  const stage = requireStage('stage-03-rain-order');
  const westSources = [indexOf(4, 0), indexOf(5, 0)];
  const westGateOne = [indexOf(4, 1), indexOf(5, 1)];
  const westGateTwo = [indexOf(4, 2), indexOf(5, 2)];
  const westProtected = [indexOf(4, 3), indexOf(5, 3)];
  const eastSource = indexOf(2, 5);
  const eastProtected = indexOf(2, 6);
  const eastDrainNotches = [indexOf(1, 5), indexOf(3, 5)];

  it('makes lowering unable to solve the west gate while one raised gate blocks its rain', () => {
    expect(enabledIndices(stage.constructionMask)).toEqual([
      eastDrainNotches[0],
      eastDrainNotches[1],
      westGateOne[0],
      westGateTwo[0],
      westGateOne[1],
      westGateTwo[1]
    ]);

    for (const index of [...westGateOne, ...westGateTwo]) {
      expect(stage.board.terrain[index]).toBe(MIN_TERRAIN_HEIGHT);
      expect((stage.board.terrain[index] ?? 0) - 1).toBeLessThan(
        MIN_TERRAIN_HEIGHT
      );
    }
    for (const index of [...westSources, ...westProtected]) {
      expect(stage.constructionMask[index]).toBe(0);
      expect(stage.board.terrain[index]).toBe(0);
    }
    for (const index of westProtected) {
      expect((stage.board.cellFlags[index] ?? 0) & CellFlag.Protected)
        .toBe(CellFlag.Protected);
    }

    const westRain = stage.rainEvents.find((event) => event.turn === 2);
    expect(westRain?.cells).toEqual(
      westSources.map((index) => ({ index, amount: DEFAULT_HEIGHT_UNIT }))
    );
    const sourceSurfaceAfterRain = DEFAULT_HEIGHT_UNIT;
    for (const gate of [westGateOne, westGateTwo]) {
      for (const index of gate) {
        const raisedGateSurface =
          ((stage.board.terrain[index] ?? 0) + 1) * DEFAULT_HEIGHT_UNIT;
        expect(raisedGateSurface).toBe(sourceSurfaceAfterRain);
      }
    }
  });

  it('makes raising unable to solve the east drain while either lowered notch can', () => {
    expect(stage.constructionMask[eastSource]).toBe(0);
    expect(stage.constructionMask[eastProtected]).toBe(0);
    expect(stage.board.terrain[eastSource]).toBe(2);
    expect(stage.board.terrain[eastProtected]).toBe(1);
    expect((stage.board.cellFlags[eastProtected] ?? 0) & CellFlag.Protected)
      .toBe(CellFlag.Protected);

    const protectedSurface =
      (stage.board.terrain[eastProtected] ?? 0) * DEFAULT_HEIGHT_UNIT;
    for (const notch of eastDrainNotches) {
      const initialSurface =
        (stage.board.terrain[notch] ?? 0) * DEFAULT_HEIGHT_UNIT;
      const loweredSurface =
        ((stage.board.terrain[notch] ?? 0) - 1) * DEFAULT_HEIGHT_UNIT;
      const raisedSurface =
        ((stage.board.terrain[notch] ?? 0) + 1) * DEFAULT_HEIGHT_UNIT;

      expect(stage.constructionMask[notch]).toBe(1);
      expect(stage.board.drainCapacity[notch]).toBe(DEFAULT_HEIGHT_UNIT);
      expect(initialSurface).toBe(protectedSurface);
      expect(loweredSurface).toBeLessThan(protectedSurface);
      expect(raisedSurface).toBeGreaterThan(protectedSurface);
    }
  });

  it('contains at least two mixed solutions with different final terrain', () => {
    const firstOperations = [
      { cells: westGateOne, delta: 1 as const },
      { cells: [eastDrainNotches[0] ?? -1], delta: -1 as const }
    ];
    const secondOperations = [
      { cells: westGateTwo, delta: 1 as const },
      { cells: [eastDrainNotches[1] ?? -1], delta: -1 as const }
    ];

    expect(new Set(firstOperations.map((operation) => operation.delta)))
      .toEqual(new Set([-1, 1]));
    expect(new Set(secondOperations.map((operation) => operation.delta)))
      .toEqual(new Set([-1, 1]));

    const firstTerrain = applyStaticSolution(stage, firstOperations);
    const secondTerrain = applyStaticSolution(stage, secondOperations);
    expect(firstTerrain).not.toEqual(secondTerrain);
    expect(firstTerrain[westGateOne[0] ?? -1]).toBe(1);
    expect(firstTerrain[eastDrainNotches[0] ?? -1]).toBe(0);
    expect(secondTerrain[westGateTwo[0] ?? -1]).toBe(1);
    expect(secondTerrain[eastDrainNotches[1] ?? -1]).toBe(0);
  });
});
