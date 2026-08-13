import {
  BoardState,
  CELL_COUNT,
  CellFlag,
  Direction,
  WATER_RULES_VERSION
} from '../../dist/nagashimasu-domain.js';

if (CELL_COUNT !== 64) throw new Error('built library exported an invalid board size');
if (Direction.North !== 1) throw new Error('built library did not export Direction');
if (CellFlag.Protected !== 1) throw new Error('built library did not export CellFlag');
if (WATER_RULES_VERSION !== 'nagashimasu-water-v1') {
  throw new Error('built library exported an unexpected rules version');
}
if (new BoardState().totalWater !== 0) {
  throw new Error('built library could not construct an empty board');
}
