import { describe, expect, it } from 'vitest';

import { CELL_COUNT, Direction } from '../../src/domain/constants';
import {
  allCellIndices,
  boardCoordinateForIndex,
  boardFitsCamera,
  cellWorldGeometry,
  computeBoardCameraFit,
  directionVector,
  projectCellCenterToScreen,
  visibleDirectionForRotation,
  waterDisplayHeight,
  waterTransferWorldPoints
} from '../../src/presentation/three-board-math';

describe('three board math', () => {
  it('maps all 64 row-major cells to unique 3D positions', () => {
    const indices = allCellIndices();
    const positions = indices.map((index) => {
      const point = cellWorldGeometry(index, index % 7).center;
      return `${point.x}:${point.y}:${point.z}`;
    });

    expect(indices).toHaveLength(CELL_COUNT);
    expect(new Set(indices).size).toBe(CELL_COUNT);
    expect(new Set(positions).size).toBe(CELL_COUNT);
    expect(boardCoordinateForIndex(0)).toEqual({ row: 0, column: 0 });
    expect(boardCoordinateForIndex(7)).toEqual({ row: 0, column: 7 });
    expect(boardCoordinateForIndex(63)).toEqual({ row: 7, column: 7 });
  });

  it('keeps terrain 0 visible and preserves height 1 through 6', () => {
    expect(cellWorldGeometry(0, 0).topY).toBeGreaterThan(0);
    expect(cellWorldGeometry(0, 1).topY).toBe(1);
    expect(cellWorldGeometry(0, 6).topY).toBe(6);
    expect(cellWorldGeometry(0, 6).corners).toHaveLength(4);
  });

  it('maps logical directions to the four world directions', () => {
    expect(directionVector(Direction.North)).toEqual({ x: 0, y: 0, z: -1 });
    expect(directionVector(Direction.East)).toEqual({ x: 1, y: 0, z: 0 });
    expect(directionVector(Direction.South)).toEqual({ x: 0, y: 0, z: 1 });
    expect(directionVector(Direction.West)).toEqual({ x: -1, y: 0, z: 0 });
  });

  it('rotates displayed directions without changing the logical direction', () => {
    expect(visibleDirectionForRotation(Direction.North, 0)).toBe(Direction.North);
    expect(visibleDirectionForRotation(Direction.North, 1)).toBe(Direction.East);
    expect(visibleDirectionForRotation(Direction.North, 2)).toBe(Direction.South);
    expect(visibleDirectionForRotation(Direction.North, 3)).toBe(Direction.West);
  });

  it('fits the board, maximum terrain, clouds, and outlet space', () => {
    const viewports: readonly (readonly [number, number])[] = [
      [320, 420],
      [390, 420],
      [402, 430],
      [430, 480],
      [844, 390]
    ];
    for (const [viewportWidth, viewportHeight] of viewports) {
      for (const rotation of [0, 1, 2, 3] as const) {
        const fit = computeBoardCameraFit(viewportWidth, viewportHeight, { rotation });
        const bounds = [
          { x: -5.6, y: 0, z: -5.6 },
          { x: -5.6, y: 9.5, z: -5.6 },
          { x: -5.6, y: 0, z: 5.6 },
          { x: -5.6, y: 9.5, z: 5.6 },
          { x: 5.6, y: 0, z: -5.6 },
          { x: 5.6, y: 9.5, z: -5.6 },
          { x: 5.6, y: 0, z: 5.6 },
          { x: 5.6, y: 9.5, z: 5.6 }
        ];
        expect(boardFitsCamera(fit, bounds)).toBe(true);
        expect(projectCellCenterToScreen(fit, 63, 6).x).toBeGreaterThan(0);
        expect(projectCellCenterToScreen(fit, 63, 6).x).toBeLessThan(viewportWidth);
      }
    }
  });

  it('keeps water display height bounded for large domain values', () => {
    expect(waterDisplayHeight(0)).toBeGreaterThan(0);
    expect(waterDisplayHeight(24)).toBe(waterDisplayHeight(240));
    expect(waterDisplayHeight(8)).toBeLessThan(waterDisplayHeight(24));
  });

  it('extends null transfers outside the board in the recorded direction', () => {
    const fit = computeBoardCameraFit(430, 480);
    const points = waterTransferWorldPoints(fit, {
      from: 0,
      to: null,
      direction: Direction.North
    }, Array<number>(CELL_COUNT).fill(0));
    expect(points.to.z).toBeLessThan(points.from.z);
    expect(Math.abs(points.to.z - points.from.z)).toBeGreaterThan(1.5);
  });
});
