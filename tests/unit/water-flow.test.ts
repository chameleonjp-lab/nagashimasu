import { describe, expect, it } from 'vitest';

import {
  BoardState,
  CELL_COUNT,
  CellFlag,
  Direction,
  MAX_CELL_WATER,
  advanceWaterFlow,
  indexOf,
  previewWaterFlow
} from '../../src/domain';
import { cells } from './test-helpers';

describe('advanceWaterFlow', () => {
  it('holds water in a basin while its surface stays below the surrounding terrain', () => {
    const terrain = cells(2);
    const water = cells();
    const basin = indexOf(3, 3);
    terrain[basin] = 0;
    water[basin] = 8;
    const board = new BoardState({ terrain, water });

    const result = advanceWaterFlow(board);

    expect(result.movedWater).toBe(0);
    expect(board.getWater(basin)).toBe(8);
    expect(board.introducedWater).toBe(board.totalWater);
  });

  it('moves water through a descending channel one fixed step at a time', () => {
    const terrain = cells(6);
    const water = cells();
    const high = indexOf(2, 2);
    const middle = indexOf(2, 3);
    const low = indexOf(2, 4);
    terrain[high] = 2;
    terrain[middle] = 1;
    terrain[low] = 0;
    water[high] = 8;
    const board = new BoardState({ terrain, water });

    const firstStep = advanceWaterFlow(board);
    expect(board.getWater(high)).toBe(0);
    expect(board.getWater(middle)).toBe(8);
    expect(board.getWater(low)).toBe(0);
    expect(firstStep.transfers).toEqual([
      {
        from: high,
        to: middle,
        direction: Direction.East,
        kind: 'cell',
        amount: 8
      }
    ]);

    advanceWaterFlow(board);
    expect(board.getWater(middle)).toBe(0);
    expect(board.getWater(low)).toBe(8);
    expect(board.totalWater).toBe(8);
  });

  it('accounts for safe boundary drainage separately from dangerous leakage', () => {
    const terrain = cells(6);
    const water = cells();
    const safeEdges = cells();
    const dangerEdges = cells();
    const safeCell = indexOf(0, 2);
    const dangerCell = indexOf(7, 5);
    terrain[safeCell] = 0;
    terrain[dangerCell] = 0;
    water[safeCell] = 8;
    water[dangerCell] = 8;
    safeEdges[safeCell] = Direction.North;
    dangerEdges[dangerCell] = Direction.South;
    const board = new BoardState({
      terrain,
      water,
      safeEdgeMask: safeEdges,
      dangerEdgeMask: dangerEdges
    });

    const result = advanceWaterFlow(board);

    expect(result.safeDrained).toBe(8);
    expect(result.dangerLeaked).toBe(8);
    expect(board.safeDrain).toBe(8);
    expect(board.dangerLeak).toBe(8);
    expect(board.totalWater).toBe(0);
    expect(board.introducedWater).toBe(16);
  });

  it('applies drain capacity after simultaneous inflow and leaves excess water', () => {
    const terrain = cells(6);
    const water = cells();
    const drains = cells();
    const drain = indexOf(4, 4);
    terrain[drain] = 0;
    water[drain] = 10;
    drains[drain] = 3;
    const board = new BoardState({ terrain, water, drainCapacity: drains });

    const result = advanceWaterFlow(board);

    expect(result.safeDrained).toBe(3);
    expect(board.getWater(drain)).toBe(7);
    expect(board.safeDrain).toBe(3);
    expect(board.totalWater + board.safeDrain).toBe(board.introducedWater);
  });

  it('lets a drain process same-step inflow before leaving the excess in place', () => {
    const terrain = cells(6);
    const water = cells();
    const drains = cells();
    const source = indexOf(4, 3);
    const drain = indexOf(4, 4);
    terrain[source] = 1;
    terrain[drain] = 0;
    water[source] = 8;
    drains[drain] = 3;
    const board = new BoardState({ terrain, water, drainCapacity: drains });

    advanceWaterFlow(board);

    expect(board.getWater(source)).toBe(0);
    expect(board.getWater(drain)).toBe(5);
    expect(board.safeDrain).toBe(3);
  });

  it('splits corner outflow between safe and dangerous edges by the normal tie rule', () => {
    const terrain = cells(6);
    const water = cells();
    const safeEdges = cells();
    const dangerEdges = cells();
    const corner = indexOf(0, 0);
    terrain[corner] = 0;
    water[corner] = 3;
    safeEdges[corner] = Direction.North;
    dangerEdges[corner] = Direction.West;
    const board = new BoardState({
      terrain,
      water,
      safeEdgeMask: safeEdges,
      dangerEdgeMask: dangerEdges
    });

    advanceWaterFlow(board);

    expect(board.safeDrain).toBe(2);
    expect(board.dangerLeak).toBe(1);
    expect(board.totalWater).toBe(0);
  });

  it('splits an integer remainder across equal lowest neighbors deterministically', () => {
    const terrain = cells(6);
    const water = cells();
    const center = indexOf(3, 3);
    const neighbors = [
      indexOf(2, 3),
      indexOf(3, 4),
      indexOf(4, 3),
      indexOf(3, 2)
    ];
    terrain[center] = 1;
    water[center] = 5;
    for (const neighbor of neighbors) terrain[neighbor] = 0;
    const board = new BoardState({ terrain, water });

    advanceWaterFlow(board);

    expect(neighbors.map((index) => board.getWater(index)).sort()).toEqual([1, 1, 1, 2]);
    expect(board.totalWater).toBe(5);
  });

  it('keeps protected overflow on the board as a damage reading', () => {
    const terrain = cells(6);
    const water = cells();
    const flags = cells();
    const limits = cells();
    const target = indexOf(3, 3);
    terrain[target] = 0;
    water[target] = 9;
    flags[target] = CellFlag.Protected;
    limits[target] = 4;
    const board = new BoardState({
      terrain,
      water,
      cellFlags: flags,
      protectedWaterLimit: limits
    });

    const result = advanceWaterFlow(board);

    expect(result.protectedOverflow).toBe(5);
    expect(board.getWater(target)).toBe(9);
    expect(board.introducedWater).toBe(board.totalWater);
  });

  it('uses the production step for preview without mutating the source board', () => {
    const terrain = cells(6);
    const water = cells();
    const origin = indexOf(1, 1);
    const destination = indexOf(1, 2);
    terrain[origin] = 2;
    terrain[destination] = 0;
    water[origin] = 8;
    const board = new BoardState({ terrain, water });
    const before = board.snapshot();

    const preview = previewWaterFlow(board);
    expect(board.snapshot()).toEqual(before);

    advanceWaterFlow(board);
    expect(board.snapshot()).toEqual(preview.snapshot);
  });

  it('rejects a cell overflow before writing to Uint16 storage', () => {
    const terrain = cells(6);
    const water = cells(MAX_CELL_WATER);
    const target = indexOf(3, 4);
    terrain[target] = 0;
    const board = new BoardState({ terrain, water });
    const before = board.snapshot();

    expect(() => advanceWaterFlow(board)).toThrow(/Uint16/);
    expect(board.snapshot()).toEqual(before);
  });

  it('allows same-step drainage to reduce a temporary inflow above Uint16 range', () => {
    const terrain = cells(6);
    const water = cells(MAX_CELL_WATER);
    const drains = cells();
    const target = indexOf(3, 4);
    terrain[target] = 0;
    water[target] = MAX_CELL_WATER - 5;
    drains[target] = 40;
    const board = new BoardState({ terrain, water, drainCapacity: drains });

    const result = advanceWaterFlow(board);

    expect(result.drains).toContainEqual({ index: target, amount: 40 });
    expect(board.getWater(target)).toBe(MAX_CELL_WATER - 13);
    expect(board.totalWater + board.safeDrain).toBe(board.introducedWater);
  });

  it('validates custom scan orders as exact board permutations', () => {
    const board = new BoardState();
    expect(() => advanceWaterFlow(board, { scanOrder: [0] })).toThrow(/exactly/);
    expect(() =>
      advanceWaterFlow(board, {
        scanOrder: Array<number>(CELL_COUNT).fill(0)
      })
    ).toThrow(/repeats/);
  });

  it('rejects unsafe rule values before calculating a surface', () => {
    const board = new BoardState();
    expect(() => advanceWaterFlow(board, { config: { maxFlowPerStep: 65_536 } })).toThrow(
      /maxFlowPerStep/
    );
    expect(() =>
      advanceWaterFlow(board, { config: { heightUnit: Number.MAX_SAFE_INTEGER } })
    ).toThrow(/heightUnit/);
  });
});
