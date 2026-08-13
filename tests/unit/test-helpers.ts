import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_COUNT,
  CellFlag,
  Direction,
  SeededRandom,
  indexOf
} from '../../src/domain';
import type { BoardDefinition } from '../../src/domain';

export function cells(value = 0): number[] {
  return Array<number>(CELL_COUNT).fill(value);
}

export function createRandomBoardDefinition(seed: number): BoardDefinition {
  const random = new SeededRandom(seed);
  const terrain = cells();
  const water = cells();
  const cellFlags = cells();
  const drainCapacity = cells();
  const protectedWaterLimit = cells();
  const safeEdgeMask = cells();
  const dangerEdgeMask = cells();

  for (let row = 0; row < BOARD_HEIGHT; row += 1) {
    for (let column = 0; column < BOARD_WIDTH; column += 1) {
      const index = indexOf(row, column);
      terrain[index] = random.nextInt(7);
      water[index] = random.nextInt(25);

      if (random.nextInt(13) === 0) {
        cellFlags[index] = CellFlag.Protected;
        protectedWaterLimit[index] = random.nextInt(16);
      }
      if (random.nextInt(17) === 0) {
        drainCapacity[index] = 1 + random.nextInt(4);
      }
    }
  }

  const north = indexOf(0, random.nextInt(BOARD_WIDTH));
  const east = indexOf(random.nextInt(BOARD_HEIGHT), BOARD_WIDTH - 1);
  const south = indexOf(BOARD_HEIGHT - 1, random.nextInt(BOARD_WIDTH));
  const west = indexOf(random.nextInt(BOARD_HEIGHT), 0);
  safeEdgeMask[north] = Direction.North;
  dangerEdgeMask[east] = Direction.East;
  safeEdgeMask[south] = Direction.South;
  dangerEdgeMask[west] = Direction.West;

  return {
    terrain,
    water,
    cellFlags,
    drainCapacity,
    protectedWaterLimit,
    safeEdgeMask,
    dangerEdgeMask
  };
}

export function shuffledScanOrder(seed: number): number[] {
  const random = new SeededRandom(seed);
  const order = Array.from({ length: CELL_COUNT }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = random.nextInt(index + 1);
    const current = order[index];
    const other = order[swapIndex];
    if (current === undefined || other === undefined) throw new Error('invalid shuffle');
    order[index] = other;
    order[swapIndex] = current;
  }
  return order;
}
