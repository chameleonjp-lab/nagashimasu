import { describe, expect, it } from 'vitest';

import { BoardState } from '../../src/domain/board';
import { CELL_COUNT, Direction } from '../../src/domain/constants';
import { getBuiltInStage } from '../../src/domain/stages';
import {
  createIsometricLayout,
  CONSTRUCTION_TAP_TARGET_PX,
  displayCoordinateForIndex,
  displayDirection,
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

  it('keeps hit testing aligned after every supported camera rotation', () => {
    const snapshot = board();
    for (const rotation of [0, 1, 2, 3] as const) {
      const layout = createIsometricLayout(800, 600, { rotation });
      for (let index = 0; index < CELL_COUNT; index += 1) {
        const center = getCellGeometry(layout, snapshot, index).center;
        expect(hitTestCell(layout, snapshot, center.x, center.y)).toBe(index);
      }
    }
  });

  it('rotates logical coordinates and edges together', () => {
    expect(displayCoordinateForIndex(0, 1)).toEqual({ row: 0, column: 7 });
    expect(displayCoordinateForIndex(0, 2)).toEqual({ row: 7, column: 7 });
    expect(displayCoordinateForIndex(0, 3)).toEqual({ row: 7, column: 0 });
    expect(displayDirection(Direction.North, 1)).toBe(Direction.East);
    expect(displayDirection(Direction.North, 2)).toBe(Direction.South);
    expect(displayDirection(Direction.North, 3)).toBe(Direction.West);
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

  it('prioritizes a legal construction marker when a low cell is covered', () => {
    const stage = getBuiltInStage('stage-02-open-to-sea');
    if (stage === undefined) throw new Error('stage fixture missing');
    const snapshot = new BoardState(stage.board).snapshot();
    const layout = createIsometricLayout(390, 280, { padding: 16 });
    const coveredAnchor = 28;
    const center = getCellGeometry(layout, snapshot, coveredAnchor).center;

    expect(hitTestCell(layout, snapshot, center.x, center.y)).not.toBe(coveredAnchor);
    expect(
      hitTestCell(layout, snapshot, center.x, center.y, [coveredAnchor])
    ).toBe(coveredAnchor);
  });

  it('keeps the legal marker target at the 44 CSS px minimum on a narrow board', () => {
    const stage = getBuiltInStage('stage-02-open-to-sea');
    if (stage === undefined) throw new Error('stage fixture missing');
    const snapshot = new BoardState(stage.board).snapshot();
    const layout = createIsometricLayout(390, 280, { padding: 16 });
    const coveredAnchor = 28;
    const center = getCellGeometry(layout, snapshot, coveredAnchor).center;

    expect(CONSTRUCTION_TAP_TARGET_PX).toBe(44);
    expect(
      hitTestCell(
        layout,
        snapshot,
        center.x + CONSTRUCTION_TAP_TARGET_PX / 2 - 0.5,
        center.y,
        [coveredAnchor]
      )
    ).toBe(coveredAnchor);
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
