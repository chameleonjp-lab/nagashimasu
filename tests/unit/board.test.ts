import { describe, expect, it } from 'vitest';

import {
  BoardState,
  CELL_COUNT,
  CellFlag,
  Direction,
  MAX_CELL_WATER,
  coordinateOf,
  hashBoardSnapshot,
  indexOf
} from '../../src/domain';
import { cells } from './test-helpers';

describe('BoardState', () => {
  it('creates an empty 8 by 8 board with a balanced water ledger', () => {
    const board = new BoardState();

    expect(board.snapshot().water).toHaveLength(CELL_COUNT);
    expect(board.totalWater).toBe(0);
    expect(board.introducedWater).toBe(0);
    expect(coordinateOf(indexOf(7, 7))).toEqual({ row: 7, column: 7 });
    expect(() => board.assertWaterLedger()).not.toThrow();
  });

  it('adds rain atomically and rejects Uint16 overflow', () => {
    const water = cells();
    water[0] = MAX_CELL_WATER - 2;
    const board = new BoardState({ water });
    const before = board.snapshot();

    expect(() =>
      board.addRain([
        { index: 0, amount: 2 },
        { index: 0, amount: 1 }
      ])
    ).toThrow(/Uint16|water\[0\]/);
    expect(board.snapshot()).toEqual(before);

    board.addRain([{ index: 1, amount: 7 }]);
    expect(board.getWater(1)).toBe(7);
    expect(board.introducedWater).toBe(MAX_CELL_WATER - 2 + 7);
  });

  it('keeps water when terrain is raised or lowered', () => {
    const terrain = cells(2);
    const water = cells();
    const target = indexOf(3, 3);
    water[target] = 11;
    const board = new BoardState({ terrain, water });

    board.applyTerrainDelta([target], 1);
    expect(board.getTerrain(target)).toBe(3);
    expect(board.getWater(target)).toBe(11);

    board.applyTerrainDelta([target], -2);
    expect(board.getTerrain(target)).toBe(1);
    expect(board.getWater(target)).toBe(11);
    expect(board.introducedWater).toBe(11);
  });

  it('rejects an invalid construction without changing any cell', () => {
    const terrain = cells(2);
    terrain[0] = 6;
    const board = new BoardState({ terrain });
    const before = board.snapshot();

    expect(() => board.applyTerrainDelta([1, 0], 1)).toThrow(/terrain\[0\]/);
    expect(() => board.applyTerrainDelta([1, 1], 1)).toThrow(/duplicate/);
    expect(board.snapshot()).toEqual(before);
  });

  it('accepts outlets only on matching boundary edges', () => {
    const safeEdgeMask = cells();
    const dangerEdgeMask = cells();
    safeEdgeMask[indexOf(0, 2)] = Direction.North;
    dangerEdgeMask[indexOf(4, 7)] = Direction.East;

    expect(() => new BoardState({ safeEdgeMask, dangerEdgeMask })).not.toThrow();

    safeEdgeMask[indexOf(3, 3)] = Direction.North;
    expect(() => new BoardState({ safeEdgeMask, dangerEdgeMask })).toThrow(/non-boundary/);
  });

  it('rejects one boundary edge being both safe and dangerous', () => {
    const safeEdgeMask = cells();
    const dangerEdgeMask = cells();
    safeEdgeMask[0] = Direction.North;
    dangerEdgeMask[0] = Direction.North;

    expect(() => new BoardState({ safeEdgeMask, dangerEdgeMask })).toThrow(/both/);
  });

  it('reports protected overflow without removing or double-counting water', () => {
    const water = cells();
    const flags = cells();
    const limits = cells();
    water[10] = 9;
    flags[10] = CellFlag.Protected;
    limits[10] = 4;
    const board = new BoardState({
      water,
      cellFlags: flags,
      protectedWaterLimit: limits
    });

    expect(board.getProtectedOverflow()).toBe(5);
    expect(board.totalWater).toBe(9);
    expect(board.introducedWater).toBe(9);
  });

  it('round-trips snapshots and produces stable state hashes', () => {
    const board = new BoardState({ terrain: cells(3), water: cells(2) });
    const snapshot = board.snapshot();
    const restored = BoardState.fromSnapshot(snapshot);

    expect(restored.snapshot()).toEqual(snapshot);
    expect(hashBoardSnapshot(restored.snapshot())).toBe(hashBoardSnapshot(snapshot));
  });

  it('rejects a snapshot whose counters do not match its stored water', () => {
    const snapshot = new BoardState({ water: cells(1) }).snapshot();

    expect(() =>
      BoardState.fromSnapshot({ ...snapshot, introducedWater: snapshot.introducedWater + 1 })
    ).toThrow(/ledger/);
  });
});
