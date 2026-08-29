import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_COUNT,
  MAX_TERRAIN_HEIGHT
} from '../domain/constants';
import { coordinateOf } from '../domain/board';
import type { BoardSnapshot } from '../domain/types';

export interface IsometricPoint {
  readonly x: number;
  readonly y: number;
}

export interface IsometricLayout {
  readonly boardWidth: number;
  readonly boardHeight: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly heightScale: number;
  readonly originX: number;
  readonly originY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export interface IsometricCellGeometry {
  readonly index: number;
  readonly row: number;
  readonly column: number;
  readonly terrain: number;
  readonly center: IsometricPoint;
  readonly top: readonly IsometricPoint[];
  readonly groundCenter: IsometricPoint;
  readonly leftSide: readonly IsometricPoint[];
  readonly rightSide: readonly IsometricPoint[];
}

export interface IsometricLayoutOptions {
  readonly padding?: number;
  readonly maxTerrainHeight?: number;
  readonly tileAspect?: number;
}

const DEFAULT_PADDING = 12;
const DEFAULT_TILE_ASPECT = 0.52;

function assertViewport(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

function point(x: number, y: number): IsometricPoint {
  return Object.freeze({ x, y });
}

function terrainValue(snapshot: Pick<BoardSnapshot, 'terrain'>, index: number): number {
  const value = snapshot.terrain[index];
  if (value === undefined) throw new RangeError(`terrain is missing cell ${index}`);
  return value;
}

/** Creates a fitted, fixed-angle layout for the complete 8×8 board. */
export function createIsometricLayout(
  viewportWidth: number,
  viewportHeight: number,
  options: IsometricLayoutOptions = {}
): IsometricLayout {
  assertViewport(viewportWidth, 'viewportWidth');
  assertViewport(viewportHeight, 'viewportHeight');

  const padding = options.padding ?? DEFAULT_PADDING;
  const maxTerrainHeight = options.maxTerrainHeight ?? MAX_TERRAIN_HEIGHT;
  const tileAspect = options.tileAspect ?? DEFAULT_TILE_ASPECT;
  if (!Number.isFinite(padding) || padding < 0) {
    throw new RangeError('padding must be a non-negative finite number');
  }
  if (!Number.isFinite(maxTerrainHeight) || maxTerrainHeight < 0) {
    throw new RangeError('maxTerrainHeight must be a non-negative finite number');
  }
  if (!Number.isFinite(tileAspect) || tileAspect <= 0) {
    throw new RangeError('tileAspect must be a positive finite number');
  }

  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  const widthLimitedTileWidth = (availableWidth * 2) / (BOARD_WIDTH + BOARD_HEIGHT);
  const heightLimitedTileWidth =
    (availableHeight * 2) /
    ((BOARD_WIDTH + BOARD_HEIGHT) * tileAspect + maxTerrainHeight * 0.75);
  const tileWidth = Math.max(1, Math.min(widthLimitedTileWidth, heightLimitedTileWidth));
  const tileHeight = tileWidth * tileAspect;
  const heightScale = Math.max(4, tileHeight * 0.75);

  return Object.freeze({
    boardWidth: BOARD_WIDTH,
    boardHeight: BOARD_HEIGHT,
    tileWidth,
    tileHeight,
    heightScale,
    originX: viewportWidth / 2,
    originY: padding + maxTerrainHeight * heightScale + tileHeight / 2,
    viewportWidth,
    viewportHeight
  });
}

export function projectCell(
  layout: IsometricLayout,
  index: number,
  terrain: number
): IsometricPoint {
  if (!Number.isSafeInteger(index) || index < 0 || index >= CELL_COUNT) {
    throw new RangeError(`cell index must be an integer from 0 to ${CELL_COUNT - 1}`);
  }
  if (!Number.isFinite(terrain)) throw new RangeError('terrain must be finite');
  const { row, column } = coordinateOf(index);
  return point(
    layout.originX + (column - row) * layout.tileWidth / 2,
    layout.originY + (row + column) * layout.tileHeight / 2 - terrain * layout.heightScale
  );
}

function diamond(center: IsometricPoint, layout: IsometricLayout): readonly IsometricPoint[] {
  return Object.freeze([
    point(center.x, center.y - layout.tileHeight / 2),
    point(center.x + layout.tileWidth / 2, center.y),
    point(center.x, center.y + layout.tileHeight / 2),
    point(center.x - layout.tileWidth / 2, center.y)
  ]);
}

export function getCellGeometry(
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  index: number,
  terrainOverride?: number
): IsometricCellGeometry {
  const terrain = terrainOverride ?? terrainValue(snapshot, index);
  const center = projectCell(layout, index, terrain);
  const groundCenter = projectCell(layout, index, 0);
  const top = diamond(center, layout);
  const ground = diamond(groundCenter, layout);

  return Object.freeze({
    index,
    ...coordinateOf(index),
    terrain,
    center,
    top,
    groundCenter,
    leftSide: Object.freeze([top[3]!, top[2]!, ground[2]!, ground[3]!]),
    rightSide: Object.freeze([top[1]!, top[2]!, ground[2]!, ground[1]!])
  });
}

function pointInPolygon(pointValue: IsometricPoint, polygon: readonly IsometricPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (currentPoint === undefined || previousPoint === undefined) continue;
    const intersects =
      currentPoint.y > pointValue.y !== previousPoint.y > pointValue.y &&
      pointValue.x <
        ((previousPoint.x - currentPoint.x) * (pointValue.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Returns the cell under a canvas-local point, or null outside the board.
 *
 * When preferredCellIndices is supplied, its cells are checked first. This is
 * important for construction: a low cell can be covered visually by a higher
 * cell, but its construction marker must remain tappable.
 */
export function hitTestCell(
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  x: number,
  y: number,
  preferredCellIndices: readonly number[] = []
): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const geometries = Array.from(
    { length: CELL_COUNT },
    (_, index) => getCellGeometry(layout, snapshot, index)
  );
  const preferred = new Set(
    preferredCellIndices.filter(
      (index) => Number.isSafeInteger(index) && index >= 0 && index < CELL_COUNT
    )
  );
  const distanceFromCenter = (geometry: IsometricCellGeometry): number =>
    Math.hypot(geometry.center.x - x, geometry.center.y - y);

  const preferredDirectHits = geometries
    .filter(
      (geometry) => preferred.has(geometry.index) && pointInPolygon(point(x, y), geometry.top)
    )
    .sort((left, right) => distanceFromCenter(left) - distanceFromCenter(right));
  const preferredDirectHit = preferredDirectHits[0];
  if (preferredDirectHit !== undefined) return preferredDirectHit.index;

  // The marker is deliberately larger than the drawn circle so that a finger
  // can select a low, covered anchor. The nearest marker wins when hit areas
  // overlap on a narrow phone viewport.
  const markerHitRadius = Math.max(
    12,
    Math.min(22, Math.min(layout.tileWidth, layout.tileHeight) * 0.95)
  );
  const preferredMarkerHit = geometries
    .filter(
      (geometry) => preferred.has(geometry.index) && distanceFromCenter(geometry) <= markerHitRadius
    )
    .sort((left, right) => distanceFromCenter(left) - distanceFromCenter(right))[0];
  if (preferredMarkerHit !== undefined) return preferredMarkerHit.index;

  const candidates = geometries.filter((geometry) => pointInPolygon(point(x, y), geometry.top));
  candidates.sort((left, right) => {
    if (left.terrain !== right.terrain) return right.terrain - left.terrain;
    const leftDepth = left.row + left.column;
    const rightDepth = right.row + right.column;
    if (leftDepth !== rightDepth) return rightDepth - leftDepth;
    return left.index - right.index;
  });
  const directHit = candidates[0]?.index;
  if (directHit !== undefined) return directHit;

  // A small tolerance makes a finger landing on a shared edge choose the
  // nearest visible cell without making distant points select the board.
  const tolerance = Math.max(4, Math.min(layout.tileWidth, layout.tileHeight) * 0.12);
  const nearby = geometries
    .filter((geometry) => {
      const xs = geometry.top.map((current) => current.x);
      const ys = geometry.top.map((current) => current.y);
      return (
        x >= Math.min(...xs) - tolerance &&
        x <= Math.max(...xs) + tolerance &&
        y >= Math.min(...ys) - tolerance &&
        y <= Math.max(...ys) + tolerance
      );
    })
    .sort((left, right) => {
      const leftDistance = distanceFromCenter(left);
      const rightDistance = distanceFromCenter(right);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return right.terrain - left.terrain || left.index - right.index;
    });
  const nearest = nearby[0];
  if (nearest === undefined) return null;
  const nearestDistance = distanceFromCenter(nearest);
  return nearestDistance <= Math.hypot(layout.tileWidth / 2, layout.tileHeight / 2) + tolerance
    ? nearest.index
    : null;
}

export function sortCellIndicesForDrawing(
  snapshot: Pick<BoardSnapshot, 'terrain'>
): readonly number[] {
  const indices = Array.from({ length: CELL_COUNT }, (_, index) => index);
  indices.sort((left, right) => {
    const leftCoordinate = coordinateOf(left);
    const rightCoordinate = coordinateOf(right);
    const depthDifference =
      leftCoordinate.row + leftCoordinate.column - rightCoordinate.row - rightCoordinate.column;
    if (depthDifference !== 0) return depthDifference;
    const terrainDifference = terrainValue(snapshot, left) - terrainValue(snapshot, right);
    if (terrainDifference !== 0) return terrainDifference;
    return left - right;
  });
  return Object.freeze(indices);
}

export function insetDiamond(
  polygon: readonly IsometricPoint[],
  amount: number
): readonly IsometricPoint[] {
  if (polygon.length !== 4) throw new RangeError('diamond polygon must have four points');
  const center = polygon.reduce(
    (sum, current) => point(sum.x + current.x / 4, sum.y + current.y / 4),
    point(0, 0)
  );
  return Object.freeze(
    polygon.map((current) => {
      const factor = Math.max(0, 1 - amount / Math.max(1, Math.hypot(current.x - center.x, current.y - center.y)));
      return point(
        center.x + (current.x - center.x) * factor,
        center.y + (current.y - center.y) * factor
      );
    })
  );
}
