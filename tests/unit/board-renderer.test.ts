import { describe, expect, it } from 'vitest';

import { BoardState } from '../../src/domain/board';
import { CELL_COUNT, Direction } from '../../src/domain/constants';
import {
  createIsometricLayout,
  getCellGeometry
} from '../../src/presentation/isometric';
import { interpolateWaterTransferPoint } from '../../src/presentation/board-renderer';
import type { WaterTransfer } from '../../src/domain/types';

function board() {
  return new BoardState({ terrain: Array<number>(CELL_COUNT).fill(0) }).snapshot();
}

describe('board playback water transfer visuals', () => {
  it('interpolates a recorded transfer from its source to its destination', () => {
    const snapshot = board();
    const layout = createIsometricLayout(800, 600);
    const transfer: WaterTransfer = {
      from: 0,
      to: 1,
      direction: Direction.East,
      kind: 'cell',
      amount: 4
    };
    const from = getCellGeometry(layout, snapshot, transfer.from).center;
    if (transfer.to === null) throw new Error('cell transfer fixture must have a destination');
    const to = getCellGeometry(layout, snapshot, transfer.to).center;
    const middle = interpolateWaterTransferPoint(layout, snapshot, transfer, 0.5);

    expect(interpolateWaterTransferPoint(layout, snapshot, transfer, 0)).toEqual(from);
    expect(interpolateWaterTransferPoint(layout, snapshot, transfer, 1)).toEqual(to);
    expect(middle.x).toBeCloseTo((from.x + to.x) / 2);
    expect(middle.y).toBeCloseTo((from.y + to.y) / 2);
  });

  it('clamps playback progress before positioning an outlet transfer', () => {
    const snapshot = board();
    const layout = createIsometricLayout(800, 600);
    const transfer: WaterTransfer = {
      from: 0,
      to: null,
      direction: Direction.North,
      kind: 'safe-edge',
      amount: 2
    };
    const start = interpolateWaterTransferPoint(layout, snapshot, transfer, -1);
    const end = interpolateWaterTransferPoint(layout, snapshot, transfer, 2);

    expect(start).toEqual(getCellGeometry(layout, snapshot, transfer.from).center);
    expect(end.y).toBeLessThan(start.y);
  });
});
