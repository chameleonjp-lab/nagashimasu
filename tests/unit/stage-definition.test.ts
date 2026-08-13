import { describe, expect, it } from 'vitest';

import { CELL_COUNT, CellFlag } from '../../src/domain/constants';
import { PIECE_SCHEMA_VERSION } from '../../src/domain/pieces';
import {
  STAGE_SCHEMA_VERSION,
  parseStageDefinition,
  parseValidatedStageDefinition
} from '../../src/domain/stage-definition';

function cells(value = 0): number[] {
  return Array<number>(CELL_COUNT).fill(value);
}

function validStage(): Record<string, unknown> {
  return {
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: 'stage-01',
    dataVersion: '1_0_0',
    name: 'はじめての貯水',
    board: {
      terrain: cells(),
      water: cells(1),
      cellFlags: cells(),
      drainCapacity: cells(),
      protectedWaterLimit: cells(),
      safeEdgeMask: cells(),
      dangerEdgeMask: cells()
    },
    constructionMask: cells(1),
    storageMask: cells(1),
    maxTurns: 3,
    flowStepsPerTurn: 4,
    timerSeconds: null,
    pieceDefinitions: [
      {
        schemaVersion: PIECE_SCHEMA_VERSION,
        id: 'raise-single',
        delta: 1,
        offsets: [{ row: 0, column: 0 }]
      }
    ],
    candidateSequence: Array<string>(5).fill('raise-single'),
    rainEvents: [
      { turn: 1, cells: [{ index: 0, amount: 3 }] },
      { turn: 3, cells: [{ index: 1, amount: 4 }] }
    ],
    objective: { type: 'stored-water', target: 50 },
    failure: { maxDangerLeak: 10, maxPeakProtectedOverflow: 5 },
    evaluation: {
      parWork: 6,
      controlTarget: 50,
      gradeThresholds: { s: 90, a: 70, b: 40 }
    }
  };
}

function reversedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => reversedJson(entry));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, entry]) => [key, reversedJson(entry)])
    );
  }
  return value;
}

describe('stage definition parsing', () => {
  it('accepts and normalizes a complete versioned stage', () => {
    const parsed = parseStageDefinition(validStage());

    expect(parsed.schemaVersion).toBe('nagashimasu-stage-v1');
    expect(parsed.board.water).toHaveLength(64);
    expect(parsed.candidateSequence).toHaveLength(5);
    expect(parsed.rainEvents.map((event) => event.turn)).toEqual([1, 3]);
    expect(parsed.definitionDigest).toMatch(/^[0-9a-f]{16}$/u);
  });

  it('rejects unknown top-level and nested keys', () => {
    expect(() => parseStageDefinition({ ...validStage(), surprise: true }))
      .toThrow(/unknown key surprise/);

    const stage = validStage();
    stage['objective'] = { type: 'stored-water', target: 50, bonus: 2 };
    expect(() => parseStageDefinition(stage)).toThrow(/unknown key bonus/);
  });

  it('rejects invalid board array lengths, values, and non-JSON arrays', () => {
    const shortBoard = validStage();
    (shortBoard['board'] as Record<string, unknown>)['terrain'] = cells().slice(1);
    expect(() => parseStageDefinition(shortBoard)).toThrow(/exactly 64/);

    const badRange = validStage();
    ((badRange['board'] as Record<string, unknown>)['water'] as number[])[2] = 65_536;
    expect(() => parseStageDefinition(badRange)).toThrow(/water\[2\]/);

    const sparse = validStage();
    (sparse['board'] as Record<string, unknown>)['terrain'] = Array<number>(64);
    expect(() => parseStageDefinition(sparse)).toThrow(/missing array entry/);

    const extraKey = validStage();
    const terrain = (extraKey['board'] as Record<string, unknown>)['terrain'] as
      number[] & { note?: string };
    terrain.note = 'invalid';
    expect(() => parseStageDefinition(extraKey)).toThrow(/unknown array key note/);
  });

  it('rejects undefined piece references and the wrong queue length', () => {
    const badReference = validStage();
    (badReference['candidateSequence'] as string[])[2] = 'missing-piece';
    expect(() => parseStageDefinition(badReference)).toThrow(/defined piece id/);

    const shortQueue = validStage();
    (shortQueue['candidateSequence'] as string[]).pop();
    expect(() => parseStageDefinition(shortQueue)).toThrow(/exactly 5/);

    const oversizedReference = validStage();
    (oversizedReference['candidateSequence'] as string[])[0] = 'x'.repeat(49);
    expect(() => parseStageDefinition(oversizedReference)).toThrow(/1 to 48/);
  });

  it('rejects oversized nested input before semantic board validation', () => {
    const oversizedRain = validStage();
    ((oversizedRain['board'] as Record<string, unknown>)['water'] as number[])[0] =
      65_536;
    oversizedRain['rainEvents'] = [
      {
        turn: 1,
        cells: Array.from({ length: 65 }, (_, index) => ({
          index: index % 64,
          amount: 1
        }))
      }
    ];
    expect(() => parseStageDefinition(oversizedRain)).toThrow(/1 to 64 entries/);

    const oversizedOffsets = validStage();
    ((oversizedOffsets['board'] as Record<string, unknown>)['water'] as number[])[0] =
      65_536;
    (oversizedOffsets['pieceDefinitions'] as Record<string, unknown>[])[0] = {
      schemaVersion: PIECE_SCHEMA_VERSION,
      id: 'oversized',
      delta: 1,
      offsets: Array.from({ length: 4 }, () => ({ row: 0, column: 0 }))
    };
    expect(() => parseStageDefinition(oversizedOffsets)).toThrow(/1 to 3 entries/);
  });

  it('rejects unordered turns, duplicate turns, and duplicate rain cells', () => {
    const unordered = validStage();
    unordered['rainEvents'] = [
      { turn: 3, cells: [{ index: 0, amount: 1 }] },
      { turn: 2, cells: [{ index: 1, amount: 1 }] }
    ];
    expect(() => parseStageDefinition(unordered)).toThrow(/strictly increasing/);

    const duplicateTurn = validStage();
    duplicateTurn['rainEvents'] = [
      { turn: 1, cells: [{ index: 0, amount: 1 }] },
      { turn: 1, cells: [{ index: 1, amount: 1 }] }
    ];
    expect(() => parseStageDefinition(duplicateTurn)).toThrow(/strictly increasing/);

    const duplicateCell = validStage();
    duplicateCell['rainEvents'] = [
      {
        turn: 1,
        cells: [
          { index: 7, amount: 1 },
          { index: 7, amount: 2 }
        ]
      }
    ];
    expect(() => parseStageDefinition(duplicateCell)).toThrow(/duplicate index 7/);
  });

  it('caps initial water plus scheduled rain at one 16-bit ledger', () => {
    const exactLimit = validStage();
    exactLimit['rainEvents'] = [{ turn: 1, cells: [{ index: 0, amount: 65_471 }] }];
    expect(() => parseStageDefinition(exactLimit)).not.toThrow();

    const stage = validStage();
    stage['rainEvents'] = [{ turn: 1, cells: [{ index: 0, amount: 65_472 }] }];
    expect(() => parseStageDefinition(stage)).toThrow(/initial water plus all rain/);
  });

  it('requires strictly descending grade thresholds', () => {
    const stage = validStage();
    stage['evaluation'] = {
      parWork: 6,
      controlTarget: 50,
      gradeThresholds: { s: 90, a: 90, b: 40 }
    };
    expect(() => parseStageDefinition(stage)).toThrow(/s > a > b/);
  });

  it('rejects objectives that cannot be satisfied by the data', () => {
    const noStorage = validStage();
    noStorage['storageMask'] = cells();
    expect(() => parseStageDefinition(noStorage)).toThrow(/storage cell/);

    const noSafeOutlet = validStage();
    noSafeOutlet['objective'] = { type: 'safe-drain', target: 1 };
    expect(() => parseStageDefinition(noSafeOutlet)).toThrow(/safe edge or drain/);

    const noProtectedCell = validStage();
    noProtectedCell['objective'] = { type: 'protect', target: 1 };
    expect(() => parseStageDefinition(noProtectedCell)).toThrow(/protected cell/);

    const excessiveStoredTarget = validStage();
    excessiveStoredTarget['objective'] = { type: 'stored-water', target: 72 };
    expect(() => parseStageDefinition(excessiveStoredTarget)).toThrow(/available water/);

    const protectedStage = validStage();
    const protectedBoard = protectedStage['board'] as Record<string, unknown>;
    (protectedBoard['cellFlags'] as number[])[0] = CellFlag.Protected;
    protectedStage['objective'] = { type: 'protect', target: 3 };
    expect(() => parseStageDefinition(protectedStage)).toThrow(/scheduled rain events/);
  });

  it('creates a canonical stable digest that changes with content', () => {
    const source = validStage();
    const canonical = parseStageDefinition(source);
    const reordered = parseStageDefinition(reversedJson(source));
    expect(reordered.definitionDigest).toBe(canonical.definitionDigest);

    const changed = validStage();
    changed['name'] = '別の名前';
    expect(parseStageDefinition(changed).definitionDigest)
      .not.toBe(canonical.definitionDigest);
  });

  it('defensively copies and deeply freezes the accepted definition', () => {
    const source = validStage();
    const parsed = parseStageDefinition(source);
    source['name'] = '改ざん';
    ((source['board'] as Record<string, unknown>)['terrain'] as number[])[0] = 6;
    (source['candidateSequence'] as string[])[0] = '改ざん';
    (((source['pieceDefinitions'] as Record<string, unknown>[])[0]?.['offsets']) as
      Record<string, number>[])[0] = { row: 7, column: 7 };
    (((source['rainEvents'] as Record<string, unknown>[])[0]?.['cells']) as
      Record<string, number>[])[0] = { index: 7, amount: 99 };

    expect(parsed.name).toBe('はじめての貯水');
    expect(parsed.board.terrain[0]).toBe(0);
    expect(parsed.candidateSequence[0]).toBe('raise-single');
    expect(parsed.pieceDefinitions[0]?.offsets[0]).toEqual({ row: 0, column: 0 });
    expect(parsed.rainEvents[0]?.cells[0]).toEqual({ index: 0, amount: 3 });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.board)).toBe(true);
    expect(Object.isFrozen(parsed.board.terrain)).toBe(true);
    expect(Object.isFrozen(parsed.constructionMask)).toBe(true);
    expect(Object.isFrozen(parsed.storageMask)).toBe(true);
    expect(Object.isFrozen(parsed.candidateSequence)).toBe(true);
    expect(Object.isFrozen(parsed.pieceDefinitions)).toBe(true);
    expect(Object.isFrozen(parsed.pieceDefinitions[0])).toBe(true);
    expect(Object.isFrozen(parsed.pieceDefinitions[0]?.offsets)).toBe(true);
    expect(Object.isFrozen(parsed.rainEvents)).toBe(true);
    expect(Object.isFrozen(parsed.rainEvents[0])).toBe(true);
    expect(Object.isFrozen(parsed.rainEvents[0]?.cells)).toBe(true);
    expect(Object.isFrozen(parsed.objective)).toBe(true);
    expect(Object.isFrozen(parsed.failure)).toBe(true);
    expect(Object.isFrozen(parsed.evaluation)).toBe(true);
    expect(Object.isFrozen(parsed.evaluation.gradeThresholds)).toBe(true);
    expect(() => {
      (parsed.board.terrain as number[])[0] = 4;
    }).toThrow(TypeError);
  });

  it('revalidates a parsed definition and rejects forged content at execution boundaries', () => {
    const parsed = parseStageDefinition(validStage());
    expect(parseValidatedStageDefinition(parsed)).toEqual(parsed);

    const forged = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
    forged['name'] = 'digestを更新していない改ざん';
    expect(() => parseValidatedStageDefinition(forged)).toThrow(/digest does not match/);

    expect(() => parseValidatedStageDefinition({
      ...parsed,
      definitionDigest: 'ABCDEF0123456789'
    })).toThrow(/lowercase hexadecimal/);
  });
});
