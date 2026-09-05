import { BOARD_WIDTH, CELL_COUNT } from '../domain/constants';

/** Returns the player-facing A1-style coordinate for a row-major cell index. */
export function cellCoordinate(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index >= CELL_COUNT) {
    throw new RangeError(`cell index must be an integer from 0 to ${CELL_COUNT - 1}`);
  }
  const row = Math.floor(index / BOARD_WIDTH);
  const column = index % BOARD_WIDTH;
  return `${String.fromCharCode('A'.charCodeAt(0) + column)}${row + 1}`;
}

/** Adds the Japanese cell prefix used in instructions and status messages. */
export function cellLabel(index: number): string {
  return `セル${cellCoordinate(index)}`;
}
