import { describe, expect, it } from 'vitest';

import { BoardState } from '../../src/domain/board';
import { CELL_COUNT } from '../../src/domain/constants';
import {
  createIsometricLayout,
  getCellGeometry,
  hitTestCell,
  insetDiamond,
  sortCellIndicesForDrawing
} from '../../src/presentation/isometric';

function board(terrain = 0) {
  return new BoardState({ terrain: Array<number>(CELL_COUNT).fill(terrain) }).snapshot();
}

describe('isometric layout', () => {
  it('fits the full board inside the requested viewport', () => {
    const layout = createIsometricLayout(390, 520);
    const geometry = getCellGeometry(layout, board(), 63);
    const corners = geometry.top;
    for (const corner of corners) {
      expect(corner.x).toBeGreaterThanOrEqual(-0.001);
      expect(corner.x).toBeLessThanOrEqual(layout.viewportWidth + 0.001);
      expect(corner.y).toBeGreaterThanOrEqual(-0.001);
      expect(corner.y).toBeLessThanOrEqual(layout.viewportHeight + 0.001);
    }
  });

  it('round-trips the center of every flat cell through hit testing', () => {
    const snapshot = board();
    const layout = createIsometricLayout(800, 600);
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const center = getCellGeometry(layout, snapshot, index).center;
      expect(hitTestCell(layout, snapshot, center.x, center.y)).toBe(index);
    }
  });

  it('snaps a point just outside a top edge to the nearest cell', () => {
    const snapshot = board();
    const layout = createIsometricLayout(800, 600);
    const top = getCellGeometry(layout, snapshot, 0).top[0]!;
    expect(hitTestCell(layout, snapshot, top.x, top.y - 2)).toBe(0);
  });

  it('prefers the higher top face at an overlapping point', () => {
    const terrain = Array<number>(CELL_COUNT).fill(0);
    terrain[0] = 6;
    const snapshot = new BoardState({ terrain }).snapshot();
    const layout = createIsometricLayout(800, 600);
    const center = getCellGeometry(layout, snapshot, 0).center;
    expect(hitTestCell(layout, snapshot, center.x, center.y)).toBe(0);
  });

  it('uses a stable far-to-near draw order', () => {
    const indices = sortCellIndicesForDrawing(board());
    expect(indices).toHaveLength(CELL_COUNT);
    expect(new Set(indices).size).toBe(CELL_COUNT);
    expect(indices.slice(0, 3)).toEqual([0, 1, 8]);
  });

  it('insets a diamond without changing its point count', () => {
    const polygon = getCellGeometry(createIsometricLayout(400, 400), board(), 0).top;
    const inset = insetDiamond(polygon, 4);
    expect(inset).toHaveLength(4);
    expect(inset[0]!.y).toBeGreaterThan(polygon[0]!.y);
    expect(inset[2]!.y).toBeLessThan(polygon[2]!.y);
  });
});
