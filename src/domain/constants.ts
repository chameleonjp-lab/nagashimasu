export const BOARD_WIDTH = 8;
export const BOARD_HEIGHT = 8;
export const CELL_COUNT = BOARD_WIDTH * BOARD_HEIGHT;

export const MIN_TERRAIN_HEIGHT = 0;
export const MAX_TERRAIN_HEIGHT = 6;
export const MAX_CELL_WATER = 65_535;

export enum CellFlag {
  None = 0,
  Protected = 1 << 0
}

export const KNOWN_CELL_FLAGS = CellFlag.Protected;

export enum Direction {
  North = 1 << 0,
  East = 1 << 1,
  South = 1 << 2,
  West = 1 << 3
}

export const ALL_DIRECTIONS =
  Direction.North | Direction.East | Direction.South | Direction.West;

export const DIRECTION_ORDER = Object.freeze([
  Direction.North,
  Direction.East,
  Direction.South,
  Direction.West
]);

export const DEFAULT_HEIGHT_UNIT = 8;
export const DEFAULT_MAX_FLOW_PER_STEP = 8;
