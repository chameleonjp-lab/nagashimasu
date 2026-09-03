import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_COUNT,
  Direction,
  MAX_TERRAIN_HEIGHT
} from '../domain/constants';
import { coordinateOf } from '../domain/board';
import { waterVisualLevel } from './board-visuals';
import type { ScreenPoint } from './three-board-picking';

export type BoardRotation = 0 | 1 | 2 | 3;

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BoardCellCoordinate {
  readonly row: number;
  readonly column: number;
}

export interface BoardCameraFit {
  readonly boardWidth: number;
  readonly boardHeight: number;
  readonly cellSize: number;
  readonly groundThickness: number;
  readonly maxTerrainHeight: number;
  readonly cameraDistance: number;
  readonly cameraElevation: number;
  readonly cameraAzimuth: number;
  readonly target: Vec3Like;
  readonly position: Vec3Like;
  readonly right: Vec3Like;
  readonly up: Vec3Like;
  readonly halfHeight: number;
  readonly aspect: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly rotation: BoardRotation;
}

export interface BoardCellWorldGeometry {
  readonly index: number;
  readonly row: number;
  readonly column: number;
  readonly terrain: number;
  readonly center: Vec3Like;
  readonly topY: number;
  readonly corners: readonly Vec3Like[];
}

const DEFAULT_CELL_SIZE = 1;
const DEFAULT_GROUND_THICKNESS = 0.12;
const DEFAULT_CAMERA_DISTANCE = 20;
const DEFAULT_CAMERA_ELEVATION = Math.PI * 0.26;
const DEFAULT_CAMERA_AZIMUTH = Math.PI * 0.25;
const DEFAULT_CLOUD_HEIGHT = 3.5;
const DEFAULT_OUTLET_MARGIN = 1.6;
const CAMERA_MARGIN = 0.55;

function freezeVec3(x: number, y: number, z: number): Vec3Like {
  return Object.freeze({ x, y, z });
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

function normalizeVector(value: Vec3Like, label: string): Vec3Like {
  const length = Math.hypot(value.x, value.y, value.z);
  if (!Number.isFinite(length) || length <= 0) throw new RangeError(`${label} must not be zero`);
  return freezeVec3(value.x / length, value.y / length, value.z / length);
}

function subtract(left: Vec3Like, right: Vec3Like): Vec3Like {
  return freezeVec3(left.x - right.x, left.y - right.y, left.z - right.z);
}

function dot(left: Vec3Like, right: Vec3Like): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function addScaled(origin: Vec3Like, direction: Vec3Like, amount: number): Vec3Like {
  return freezeVec3(
    origin.x + direction.x * amount,
    origin.y + direction.y * amount,
    origin.z + direction.z * amount
  );
}

export function normalizeBoardRotation(value: number): BoardRotation {
  if (!Number.isFinite(value)) return 0;
  return (((Math.trunc(value) % 4) + 4) % 4) as BoardRotation;
}

export function boardCoordinateForIndex(index: number): BoardCellCoordinate {
  if (!Number.isSafeInteger(index) || index < 0 || index >= CELL_COUNT) {
    throw new RangeError(`cell index must be an integer from 0 to ${CELL_COUNT - 1}`);
  }
  const coordinate = coordinateOf(index);
  return Object.freeze({ row: coordinate.row, column: coordinate.column });
}

/** Maps a logical edge to the quarter-turned display edge for marker tests. */
export function visibleDirectionForRotation(
  direction: Direction,
  rotation: BoardRotation
): Direction {
  const directions = [Direction.North, Direction.East, Direction.South, Direction.West] as const;
  const directionIndex = directions.indexOf(direction as (typeof directions)[number]);
  if (directionIndex < 0) return direction;
  return directions[(directionIndex + rotation) % directions.length] ?? direction;
}

/** Returns the fixed world direction of a logical edge. */
export function directionVector(direction: Direction): Vec3Like {
  switch (direction) {
    case Direction.North: return freezeVec3(0, 0, -1);
    case Direction.East: return freezeVec3(1, 0, 0);
    case Direction.South: return freezeVec3(0, 0, 1);
    case Direction.West: return freezeVec3(-1, 0, 0);
    default: return freezeVec3(0, 0, 0);
  }
}

export function terrainBlockHeight(terrain: number): number {
  assertFinite(terrain, 'terrain');
  if (terrain < 0 || terrain > MAX_TERRAIN_HEIGHT) {
    throw new RangeError(`terrain must be from 0 to ${MAX_TERRAIN_HEIGHT}`);
  }
  return Math.max(DEFAULT_GROUND_THICKNESS, terrain);
}

export function terrainTopY(terrain: number): number {
  return terrainBlockHeight(terrain);
}

export function waterDisplayHeight(amount: number): number {
  return waterVisualLevel(amount).depth;
}

function cellXZ(row: number, column: number, cellSize: number): { readonly x: number; readonly z: number } {
  return Object.freeze({
    x: (column - (BOARD_WIDTH - 1) / 2) * cellSize,
    z: (row - (BOARD_HEIGHT - 1) / 2) * cellSize
  });
}

export function cellWorldGeometry(
  index: number,
  terrain: number,
  cellSize = DEFAULT_CELL_SIZE
): BoardCellWorldGeometry {
  const coordinate = boardCoordinateForIndex(index);
  assertPositive(cellSize, 'cellSize');
  const xz = cellXZ(coordinate.row, coordinate.column, cellSize);
  const topY = terrainTopY(terrain);
  const half = cellSize / 2;
  const center = freezeVec3(xz.x, topY, xz.z);
  const corners = Object.freeze([
    freezeVec3(xz.x - half, topY, xz.z - half),
    freezeVec3(xz.x + half, topY, xz.z - half),
    freezeVec3(xz.x + half, topY, xz.z + half),
    freezeVec3(xz.x - half, topY, xz.z + half)
  ]);
  return Object.freeze({
    index,
    row: coordinate.row,
    column: coordinate.column,
    terrain,
    center,
    topY,
    corners
  });
}

function cameraBasis(position: Vec3Like, target: Vec3Like): {
  readonly forward: Vec3Like;
  readonly right: Vec3Like;
  readonly up: Vec3Like;
} {
  const forward = normalizeVector(subtract(target, position), 'camera forward');
  const right = normalizeVector({
    x: -forward.z,
    y: 0,
    z: forward.x
  }, 'camera right');
  const up = normalizeVector({
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x
  }, 'camera up');
  return Object.freeze({ forward, right, up });
}

function projectedExtents(
  position: Vec3Like,
  target: Vec3Like,
  bounds: readonly Vec3Like[]
): { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number; } {
  const basis = cameraBasis(position, target);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of bounds) {
    const relative = subtract(point, target);
    const x = dot(relative, basis.right);
    const y = dot(relative, basis.up);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return Object.freeze({ minX, maxX, minY, maxY });
}

function boardCameraBounds(
  maxTerrainHeight: number,
  cellSize: number,
  cloudHeight: number,
  outletMargin: number
): readonly Vec3Like[] {
  const halfXZ = BOARD_WIDTH * cellSize / 2 + outletMargin;
  const maxY = terrainTopY(maxTerrainHeight) + cloudHeight;
  return Object.freeze(
    [0, 1].flatMap((xSide) => [0, 1].flatMap((ySide) => [0, 1].map((zSide) =>
      freezeVec3(
        (xSide === 0 ? -1 : 1) * halfXZ,
        ySide === 0 ? 0 : maxY,
        (zSide === 0 ? -1 : 1) * halfXZ
      )
    )))
  );
}

/** Creates an orthographic fit that includes the board, outlets, and clouds. */
export function computeBoardCameraFit(
  viewportWidth: number,
  viewportHeight: number,
  options: {
    readonly rotation?: number;
    readonly maxTerrainHeight?: number;
    readonly cellSize?: number;
    readonly cloudHeight?: number;
    readonly outletMargin?: number;
  } = {}
): BoardCameraFit {
  assertPositive(viewportWidth, 'viewportWidth');
  assertPositive(viewportHeight, 'viewportHeight');
  const maxTerrainHeight = options.maxTerrainHeight ?? MAX_TERRAIN_HEIGHT;
  const cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
  const cloudHeight = options.cloudHeight ?? DEFAULT_CLOUD_HEIGHT;
  const outletMargin = options.outletMargin ?? DEFAULT_OUTLET_MARGIN;
  if (maxTerrainHeight < 0 || maxTerrainHeight > MAX_TERRAIN_HEIGHT) {
    throw new RangeError(`maxTerrainHeight must be from 0 to ${MAX_TERRAIN_HEIGHT}`);
  }
  assertPositive(cellSize, 'cellSize');
  assertPositive(cloudHeight, 'cloudHeight');
  assertPositive(outletMargin, 'outletMargin');

  const rotation = normalizeBoardRotation(options.rotation ?? 0);
  const target = freezeVec3(0, Math.max(0.8, maxTerrainHeight * 0.36 + 0.8), 0);
  const cameraAzimuth = DEFAULT_CAMERA_AZIMUTH + rotation * Math.PI / 2;
  const horizontalDistance = DEFAULT_CAMERA_DISTANCE * Math.cos(DEFAULT_CAMERA_ELEVATION);
  const position = freezeVec3(
    target.x + Math.sin(cameraAzimuth) * horizontalDistance,
    target.y + DEFAULT_CAMERA_DISTANCE * Math.sin(DEFAULT_CAMERA_ELEVATION),
    target.z + Math.cos(cameraAzimuth) * horizontalDistance
  );
  const extents = projectedExtents(
    position,
    target,
    boardCameraBounds(maxTerrainHeight, cellSize, cloudHeight, outletMargin)
  );
  const aspect = viewportWidth / viewportHeight;
  const projectedWidth = Math.max(Math.abs(extents.minX), Math.abs(extents.maxX)) * 2;
  const projectedHeight = Math.max(Math.abs(extents.minY), Math.abs(extents.maxY)) * 2;
  const halfHeight = Math.max(
    projectedHeight / 2,
    projectedWidth / (2 * aspect)
  ) + CAMERA_MARGIN;
  const basis = cameraBasis(position, target);

  return Object.freeze({
    boardWidth: BOARD_WIDTH,
    boardHeight: BOARD_HEIGHT,
    cellSize,
    groundThickness: DEFAULT_GROUND_THICKNESS,
    maxTerrainHeight,
    cameraDistance: DEFAULT_CAMERA_DISTANCE,
    cameraElevation: DEFAULT_CAMERA_ELEVATION,
    cameraAzimuth,
    target,
    position,
    right: basis.right,
    up: basis.up,
    halfHeight,
    aspect,
    viewportWidth,
    viewportHeight,
    rotation
  });
}

/** Orthographically projects a world point into CSS pixels. */
export function projectWorldToScreen(
  fit: BoardCameraFit,
  world: Vec3Like
): ScreenPoint {
  const relative = subtract(world, fit.target);
  const cameraX = dot(relative, fit.right);
  const cameraY = dot(relative, fit.up);
  return Object.freeze({
    x: fit.viewportWidth / 2 + cameraX / (fit.halfHeight * fit.aspect) * fit.viewportWidth / 2,
    y: fit.viewportHeight / 2 - cameraY / fit.halfHeight * fit.viewportHeight / 2
  });
}

export function projectCellCenterToScreen(
  fit: BoardCameraFit,
  index: number,
  terrain: number,
  yOffset = 0.18
): ScreenPoint {
  const geometry = cellWorldGeometry(index, terrain, fit.cellSize);
  return projectWorldToScreen(fit, addScaled(geometry.center, freezeVec3(0, 1, 0), yOffset));
}

/** Returns the visible top center and outward endpoint for a recorded transfer. */
export function waterTransferWorldPoints(
  fit: BoardCameraFit,
  transfer: {
    readonly from: number;
    readonly to: number | null;
    readonly direction: Direction;
  },
  terrain: readonly number[]
): { readonly from: Vec3Like; readonly to: Vec3Like; } {
  const fromTerrain = terrain[transfer.from] ?? 0;
  const fromGeometry = cellWorldGeometry(transfer.from, fromTerrain, fit.cellSize);
  const from = addScaled(fromGeometry.center, freezeVec3(0, 1, 0), 0.22);
  if (transfer.to !== null) {
    const toTerrain = terrain[transfer.to] ?? 0;
    const toGeometry = cellWorldGeometry(transfer.to, toTerrain, fit.cellSize);
    return Object.freeze({
      from,
      to: addScaled(toGeometry.center, freezeVec3(0, 1, 0), 0.22)
    });
  }

  const direction = directionVector(transfer.direction);
  const edgeCenter = addScaled(from, direction, fit.cellSize * 0.5);
  return Object.freeze({
    from,
    to: addScaled(edgeCenter, direction, fit.cellSize * 1.6)
  });
}

export function interpolateWorldPoint(
  from: Vec3Like,
  to: Vec3Like,
  progress: number
): Vec3Like {
  const ratio = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return freezeVec3(
    from.x + (to.x - from.x) * ratio,
    from.y + (to.y - from.y) * ratio,
    from.z + (to.z - from.z) * ratio
  );
}

export function allCellIndices(): readonly number[] {
  return Object.freeze(Array.from({ length: CELL_COUNT }, (_, index) => index));
}

export function boardFitsCamera(
  fit: BoardCameraFit,
  bounds: readonly Vec3Like[]
): boolean {
  const extents = projectedExtents(fit.position, fit.target, bounds);
  const horizontalHalf = fit.halfHeight * fit.aspect;
  return extents.minX >= -horizontalHalf &&
    extents.maxX <= horizontalHalf &&
    extents.minY >= -fit.halfHeight &&
    extents.maxY <= fit.halfHeight;
}
