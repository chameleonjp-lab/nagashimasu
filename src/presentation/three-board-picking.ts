import { CELL_COUNT } from '../domain/constants';

export const CONSTRUCTION_TAP_TARGET_CSS_PX = 44;
export const CONSTRUCTION_TAP_RADIUS_CSS_PX = CONSTRUCTION_TAP_TARGET_CSS_PX / 2;

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface ProjectedCellCenter extends ScreenPoint {
  readonly index: number;
}

function isValidCellIndex(index: number): boolean {
  return Number.isSafeInteger(index) && index >= 0 && index < CELL_COUNT;
}

/** Returns the nearest legal marker within the 44 CSS px operation target. */
export function pickNearestLegalCell(
  pointer: ScreenPoint,
  projectedCenters: readonly ProjectedCellCenter[],
  radiusCssPx = CONSTRUCTION_TAP_RADIUS_CSS_PX
): number | null {
  if (
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y) ||
    !Number.isFinite(radiusCssPx) ||
    radiusCssPx < 0
  ) return null;

  let nearestIndex: number | null = null;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const center of projectedCenters) {
    if (!isValidCellIndex(center.index) || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      continue;
    }
    const distanceSquared = (center.x - pointer.x) ** 2 + (center.y - pointer.y) ** 2;
    if (
      distanceSquared <= radiusCssPx ** 2 &&
      (distanceSquared < nearestDistanceSquared ||
        (distanceSquared === nearestDistanceSquared &&
          (nearestIndex === null || center.index < nearestIndex)))
    ) {
      nearestIndex = center.index;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return nearestIndex;
}

export function normalizedDeviceCoordinates(
  point: ScreenPoint,
  widthCss: number,
  heightCss: number
): ScreenPoint | null {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(widthCss) ||
    !Number.isFinite(heightCss) ||
    widthCss <= 0 ||
    heightCss <= 0
  ) return null;
  return Object.freeze({
    x: (point.x / widthCss) * 2 - 1,
    y: 1 - (point.y / heightCss) * 2
  });
}
