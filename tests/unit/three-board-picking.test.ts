import { describe, expect, it } from 'vitest';

import { CELL_COUNT } from '../../src/domain/constants';
import {
  computeBoardCameraFit,
  projectCellCenterToScreen
} from '../../src/presentation/three-board-math';
import {
  CONSTRUCTION_TAP_RADIUS_CSS_PX,
  normalizedDeviceCoordinates,
  pickNearestLegalCell
} from '../../src/presentation/three-board-picking';

describe('three board picking math', () => {
  it('returns the same logical cell at every projected center and rotation', () => {
    const terrain = Array.from({ length: CELL_COUNT }, (_, index) => index % 7);
    for (const rotation of [0, 1, 2, 3] as const) {
      const fit = computeBoardCameraFit(390, 420, { rotation });
      for (let index = 0; index < CELL_COUNT; index += 1) {
        const point = projectCellCenterToScreen(fit, index, terrain[index]!);
        expect(pickNearestLegalCell(point, [{ index, x: point.x, y: point.y }])).toBe(index);
      }
    }
  });

  it('uses the nearest legal anchor within 22 CSS px', () => {
    const fit = computeBoardCameraFit(402, 430);
    const point = projectCellCenterToScreen(fit, 28, 6);
    const within = { x: point.x + 21.5, y: point.y };
    const outside = { x: point.x + 25, y: point.y };
    const center = [{ index: 28, x: point.x, y: point.y }];

    expect(CONSTRUCTION_TAP_RADIUS_CSS_PX).toBe(22);
    expect(pickNearestLegalCell(within, center)).toBe(28);
    expect(pickNearestLegalCell(outside, center)).toBeNull();
  });

  it('selects the closest marker when legal areas overlap', () => {
    expect(pickNearestLegalCell(
      { x: 100, y: 100 },
      [
        { index: 9, x: 119, y: 100 },
        { index: 10, x: 104, y: 100 }
      ]
    )).toBe(10);
  });

  it('does not select an invalid or non-finite marker', () => {
    expect(pickNearestLegalCell(
      { x: 100, y: 100 },
      [
        { index: -1, x: 100, y: 100 },
        { index: CELL_COUNT, x: 100, y: 100 },
        { index: 4, x: Number.NaN, y: 100 }
      ]
    )).toBeNull();
  });

  it('normalizes pointer coordinates independently of device pixel ratio', () => {
    expect(normalizedDeviceCoordinates({ x: 0, y: 0 }, 390, 420)).toEqual({ x: -1, y: 1 });
    expect(normalizedDeviceCoordinates({ x: 195, y: 210 }, 390, 420)).toEqual({ x: 0, y: 0 });
    expect(normalizedDeviceCoordinates({ x: 390, y: 420 }, 390, 420)).toEqual({ x: 1, y: -1 });
  });
});
